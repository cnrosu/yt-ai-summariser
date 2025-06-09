from flask import Flask, request, jsonify
import sys
import subprocess
import whisper
import os
import tempfile
import glob
import traceback
import uuid
import threading
import shutil
import json
from urllib.parse import urlparse, parse_qs
from lzstring import LZString

# Patch PATH so that Whisper can find ffmpeg. Use paths relative to this file
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FFMPEG_DIR = os.path.join(BASE_DIR, "ffmpeg", "bin")
os.environ["PATH"] += os.pathsep + FFMPEG_DIR

app = Flask(__name__)

# Global dictionary to hold active job statuses and results (transient).
jobs = {}

# Persistent caching: transcripts are stored in chromeplugin/transcripts relative
# to the repository root.
CACHE_DIR = os.path.join(BASE_DIR, "chromeplugin", "transcripts")
os.makedirs(CACHE_DIR, exist_ok=True)

def get_cache_filename(video_id):
    """Return the full path of the cache file for the given video id."""
    return os.path.join(CACHE_DIR, f"{video_id}.json")

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
        print("Loading Whisper model...")
        model = whisper.load_model("base")
        print("Starting transcription...")
        result = model.transcribe(audio_file)
        transcript = result["text"]
        print("Transcription complete.")
        jobs[job_id]['status'] = "done"
        jobs[job_id]['transcript'] = transcript

        # Save the transcript persistently as a JSON file.
        cache_data = {"video_id": video_id, "transcript": transcript}
        cache_filename = get_cache_filename(video_id)
        with open(cache_filename, "w", encoding="utf-8") as f:
            json.dump(cache_data, f)
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
            cache_data = json.load(f)
        print("Found cached transcript for video ID:", video_id)
        compressed = lz.compressToBase64(cache_data["transcript"])
        return jsonify({"transcript": compressed, "cached": True})
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
    if job.get("transcript"):
        job["transcript"] = lz.compressToBase64(job["transcript"])
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
            cache_data = json.load(f)
        print("Loaded cached transcript for video id:", video_id)
        compressed = lz.compressToBase64(cache_data["transcript"])
        return jsonify({"transcript": compressed, "cached": True})
    else:
        return jsonify({"error": "Transcript not found"}), 404

if __name__ == "__main__":
    print("🚀 Starting YouTranscribe server on http://localhost:5010")
    app.run(port=5010)
