"""Flask server for downloading and transcribing YouTube videos."""

from flask import Flask, request, jsonify
import sys
import subprocess
from faster_whisper import WhisperModel
import torch
import os
import tempfile
import glob
import traceback
import uuid
import threading
import shutil
import json
import logging
from urllib.parse import urlparse, parse_qs
from dotenv import load_dotenv

from job import Job
from job_manager import JobManager

load_dotenv()

# Base directory for resolving relative paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Directory containing ffmpeg binaries
FFMPEG_DIR = os.getenv("FFMPEG_DIR", os.path.join(BASE_DIR, "ffmpeg", "bin"))

# Server listening port
PORT = int(os.getenv("PORT", "5010"))

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger(__name__)

app = Flask(__name__)

LOGGER.info("Loading faster-whisper model once at startup...")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
COMPUTE_TYPE = "float16" if DEVICE == "cuda" else "int8"
WHISPER_MODEL = WhisperModel("base", device=DEVICE, compute_type=COMPUTE_TYPE)
LOGGER.info("faster-whisper model loaded on %s with %s", DEVICE, COMPUTE_TYPE)

# Thread-safe job manager. The raw dictionary is exported for backward
# compatibility with unit tests.
job_manager = JobManager()
jobs = job_manager.jobs

# Persistent caching: each video gets its own folder under
# chromeplugin/transcripts where the transcript and any saved QA pairs are
# stored uncompressed.
CACHE_DIR = os.path.join(BASE_DIR, "chromeplugin", "transcripts")
os.makedirs(CACHE_DIR, exist_ok=True)

def get_video_dir(video_id):
    """Return directory path for a given video id."""
    video_dir = os.path.join(CACHE_DIR, video_id)
    os.makedirs(video_dir, exist_ok=True)
    return video_dir

def get_cache_filename(video_id):
    """Return the transcript file for the video."""
    return os.path.join(get_video_dir(video_id), f"{video_id}.txt")

def get_qa_filename(video_id):
    """Return the QA file for the video."""
    return os.path.join(get_video_dir(video_id), f"{video_id}_qa.txt")

def process_job(job_id: str, url: str, video_id: str) -> None:
    """Background worker that downloads and transcribes the video."""
    temp_dir = tempfile.mkdtemp()
    LOGGER.info("Using temp dir: %s", temp_dir)
    job_manager.update(job_id, status="downloading")
    env = os.environ.copy()
    env["PATH"] = env.get("PATH", "") + os.pathsep + FFMPEG_DIR
    try:
        subprocess.run([
            sys.executable,
            "-m",
            "yt_dlp",
            "-x",
            "--audio-format",
            "mp3",
            "--ffmpeg-location",
            FFMPEG_DIR,
            "-o",
            f"{temp_dir}/%(title)s.%(ext)s",
            url,
        ], check=True, env=env)
    except subprocess.CalledProcessError as e:
        LOGGER.exception("Download failed")
        job_manager.update(job_id, status="error", error=f"Failed to download: {e}")
        shutil.rmtree(temp_dir, ignore_errors=True)
        return
    except Exception as e:
        LOGGER.exception("Unexpected error during download")
        job_manager.update(job_id, status="error", error=str(e))
        shutil.rmtree(temp_dir, ignore_errors=True)
        return

    mp3_files = glob.glob(os.path.join(temp_dir, "*.mp3"))
    if not mp3_files:
        job_manager.update(job_id, status="error", error="No MP3 file was downloaded.")
        shutil.rmtree(temp_dir, ignore_errors=True)
        return

    audio_file = mp3_files[0]
    LOGGER.info("Found audio file: %s", audio_file)
    job = job_manager.get(job_id)
    if job and job.killed:
        shutil.rmtree(temp_dir, ignore_errors=True)
        return

    job_manager.update(job_id, status="transcribing")
    LOGGER.info("Starting transcription...")
    try:
        segments, _ = WHISPER_MODEL.transcribe(audio_file)
    except Exception as e:
        LOGGER.exception("Transcription failed")
        job_manager.update(job_id, status="error", error=f"Failed to transcribe: {e}")
        shutil.rmtree(temp_dir, ignore_errors=True)
        return

    job = job_manager.get(job_id)
    if job and job.killed:
        shutil.rmtree(temp_dir, ignore_errors=True)
        return

    transcript = "".join(segment.text for segment in segments)
    LOGGER.info("Transcription complete.")
    job_manager.update(job_id, status="done", transcript=transcript)

    cache_filename = get_cache_filename(video_id)
    with open(cache_filename, "w", encoding="utf-8") as f:
        f.write(transcript)
    LOGGER.info("Cached transcript to %s", cache_filename)

    try:
        os.remove(audio_file)
    except OSError as e:
        LOGGER.warning("Failed to remove %s: %s", audio_file, e)
    shutil.rmtree(temp_dir, ignore_errors=True)

@app.route("/api/transcribe", methods=["POST"])
def start_transcription():
    """Begin a new transcription job or return an existing one."""
    data = request.get_json() or {}
    url = data.get("url")
    if not url:
        return jsonify({"error": "URL is required"}), 400
    parsed_url = urlparse(url)
    qs = parse_qs(parsed_url.query)
    video_id = qs.get("v", [None])[0]
    if not video_id:
        return jsonify({"error": "Invalid YouTube URL: video id not found"}), 400
    # Check if a cached transcript exists.
    cache_filename = get_cache_filename(video_id)
    if os.path.isfile(cache_filename):
        with open(cache_filename, "r", encoding="utf-8") as f:
            transcript = f.read()
        LOGGER.info("Found cached transcript for video ID: %s len=%s", video_id, len(transcript))
        return jsonify({"transcript": transcript, "cached": True})
    # If a job is already running for this video, reuse it and add a listener.
    for jid, job in list(job_manager.jobs.items()):
        if job.video_id == video_id and job.status not in ("done", "error", "cancelled"):
            listeners = job_manager.increment_listeners(jid)
            LOGGER.info("Reusing job %s listeners %d", jid, listeners)
            return jsonify({"jobId": jid})

    # Otherwise, start a new transcription job.
    job = job_manager.create_job(video_id)
    thread = threading.Thread(target=process_job, args=(job.job_id, url, video_id))
    thread.start()
    return jsonify({"jobId": job.job_id})

@app.route("/api/status", methods=["GET"])
def job_status():
    """Return the current status for a job."""
    job_id = request.args.get("jobId")
    job = job_manager.get(job_id) if job_id else None
    if not job:
        return jsonify({"error": "Job not found"}), 404
    LOGGER.info("Status check %s %s", job_id, job.status)
    if job.status == "done" and job.transcript:
        LOGGER.info("Returning transcript length %d", len(job.transcript))
    return jsonify(job.to_dict())

@app.route("/api/kill", methods=["POST"])
def kill_job():
    """Reduce the listener count or cancel a job when none remain."""
    job_id = request.args.get("jobId")
    job = job_manager.get(job_id) if job_id else None
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.listeners > 1:
        job_manager.update(job_id, listeners=job.listeners - 1)
        LOGGER.info("Decremented listener count for %s to %d", job_id, job.listeners)
        return jsonify({"success": True, "status": job.status, "listeners": job.listeners})
    job_manager.update(job_id, killed=True, status="cancelled", listeners=0)
    return jsonify({"success": True, "status": "cancelled", "listeners": 0})

@app.route("/api/load", methods=["GET"])
def load_transcript():
    video_id = request.args.get("videoId")
    if not video_id:
        return jsonify({"error": "videoId parameter is required"}), 400
    cache_filename = get_cache_filename(video_id)
    if os.path.isfile(cache_filename):
        with open(cache_filename, "r", encoding="utf-8") as f:
            transcript = f.read()
        LOGGER.info("Loaded cached transcript for video id: %s len=%s", video_id, len(transcript))
        return jsonify({"transcript": transcript, "cached": True})
    else:
        return jsonify({"error": "Transcript not found"}), 404

@app.route("/api/save_qa", methods=["POST"])
def save_qa():
    data = request.get_json() or {}
    video_id = data.get("videoId") or data.get("video_id")
    question = data.get("question")
    answer = data.get("answer")
    if not video_id or question is None or answer is None:
        return jsonify({"error": "videoId, question and answer are required"}), 400
    qa_file = get_qa_filename(video_id)
    entry = {"question": question, "answer": answer}
    with open(qa_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return jsonify({"success": True})

if __name__ == "__main__":
    LOGGER.info("🚀 Starting YouTranscribe server on http://localhost:%s", PORT)
    app.run(port=PORT)
