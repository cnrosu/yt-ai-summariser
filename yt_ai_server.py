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
from urllib.parse import urlparse, parse_qs

# Patch PATH so that Whisper can find ffmpeg. Use paths relative to this file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FFMPEG_DIR = os.path.join(BASE_DIR, "ffmpeg", "bin")
os.environ["PATH"] += os.pathsep + FFMPEG_DIR

app = Flask(__name__)

print("Loading Whisper model once at startup...")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
COMPUTE_TYPE = "float16" if DEVICE == "cuda" else "int8"
WHISPER_MODEL = WhisperModel("base", device=DEVICE, compute_type=COMPUTE_TYPE)
print("Whisper model loaded on", DEVICE, "with", COMPUTE_TYPE)

# Global dictionary to hold active job statuses and results (transient).
jobs = {}

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

def process_job(job_id, url, video_id):
    try:
        temp_dir = tempfile.mkdtemp()
        print("Using temp dir:", temp_dir)
        jobs[job_id]['status'] = "downloading"
        # Download audio using yt-dlp.
        subprocess.run([
            sys.executable, "-m", "yt_dlp",
            "-x", "--audio-format", "mp3",
            "--ffmpeg-location", FFMPEG_DIR,
            "-o", f"{temp_dir}/%(title)s.%(ext)s",
            url
        ], check=True)

        mp3_files = glob.glob(os.path.join(temp_dir, "*.mp3"))
        if not mp3_files:
            raise Exception("No MP3 file was downloaded.")
        audio_file = mp3_files[0]
        print("Found audio file:", audio_file)
        jobs[job_id]['status'] = "transcribing"
        print("Starting transcription...")
        segments, _ = WHISPER_MODEL.transcribe(audio_file)
        transcript = "".join(segment.text for segment in segments)
        print("Transcription complete.")
        jobs[job_id]['status'] = "done"
        jobs[job_id]['transcript'] = transcript

        # Save the transcript persistently as plain text in the video folder.
        cache_filename = get_cache_filename(video_id)
        with open(cache_filename, "w", encoding="utf-8") as f:
            f.write(transcript)
        print("Cached transcript to", cache_filename)

        os.remove(audio_file)
        shutil.rmtree(temp_dir)

    except Exception as e:
        print("ERROR during transcription:")
        traceback.print_exc()
        jobs[job_id]['status'] = "error"
        jobs[job_id]['error'] = str(e)
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass

@app.route("/api/transcribe", methods=["POST"])
def start_transcription():
    data = request.get_json()
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
        print("Found cached transcript for video ID:", video_id,
              "len=", len(transcript))
        return jsonify({"transcript": transcript, "cached": True})
    # Otherwise, start a new transcription job.
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued"}
    thread = threading.Thread(target=process_job, args=(job_id, url, video_id))
    thread.start()
    return jsonify({"jobId": job_id})

@app.route("/api/status", methods=["GET"])
def job_status():
    job_id = request.args.get("jobId")
    if not job_id or job_id not in jobs:
        return jsonify({"error": "Job not found"}), 404
    job = jobs[job_id].copy()
    print("Status check", job_id, job.get("status"))
    if job.get("status") == "done" and job.get("transcript"):
        print("Returning transcript length", len(job["transcript"]))
    return jsonify(job)

@app.route("/api/kill", methods=["POST"])
def kill_job():
    job_id = request.args.get("jobId")
    if not job_id or job_id not in jobs:
        return jsonify({"error": "Job not found"}), 404
    job = jobs[job_id]
    job["killed"] = True
    return jsonify({"success": True, "status": "cancelled"})

@app.route("/api/load", methods=["GET"])
def load_transcript():
    video_id = request.args.get("videoId")
    if not video_id:
        return jsonify({"error": "videoId parameter is required"}), 400
    cache_filename = get_cache_filename(video_id)
    if os.path.isfile(cache_filename):
        with open(cache_filename, "r", encoding="utf-8") as f:
            transcript = f.read()
        print("Loaded cached transcript for video id:", video_id,
              "len=", len(transcript))
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
    print("🚀 Starting YouTranscribe server on http://localhost:5010")
    app.run(port=5010)
