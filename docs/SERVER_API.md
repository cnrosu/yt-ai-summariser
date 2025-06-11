# YouTranscribe Server API

This document describes the HTTP endpoints exposed by `yt_ai_server.py`. The server is implemented using [Flask](https://flask.palletsprojects.com/) and is intended to run locally alongside the YouTranscribe Chrome extension.

All endpoints are prefixed with `/api` and by default the server listens on `http://localhost:5010`.

## Architecture Overview

```
Chrome Extension <--HTTP--> Flask Server -- faster-whisper & yt_dlp --> Transcripts
                                 |
                                 +-- Local cache (per video)
                                 +-- Saved Q&A pairs
```

1. **Chrome extension** (`chromeplugin/`)
   - Injects a popup UI into YouTube pages.
   - Sends requests to the local Flask server to transcribe videos and store question/answer pairs.
2. **Flask server** (`yt_ai_server.py`)
   - Downloads audio using `yt_dlp` and converts it to MP3 using a bundled `ffmpeg`.
   - Runs the faster-whisper model once at startup to transcribe audio.
   - Caches the transcript and any generated Q&A pairs in `chromeplugin/transcripts/<video_id>/`.
   - Exposes a small REST API for the extension.

The server keeps track of active transcription jobs in memory. Jobs are processed in background threads so that the API remains responsive.

## Endpoints

### `POST /api/transcribe`
Start a new transcription or return a cached transcript if available.

**Request body** (JSON):
```json
{
  "url": "https://www.youtube.com/watch?v=..."
}
```

**Successful response**:
- If a cached transcript exists:
```json
{
  "transcript": "text",
  "cached": true
}
```
- Otherwise a new job is created and a job ID is returned:
```json
{
  "jobId": "<uuid>"
}
```

### `GET /api/status?jobId=<id>`
Retrieve the status of a transcription job.

**Response JSON**:
```json
{
  "status": "queued | downloading | transcribing | done | error",
  "transcript": "text",      // present when status == "done"
  "error": "message"         // present when status == "error"
}
```

### `POST /api/kill?jobId=<id>`
Cancel a running job. The server marks the job as killed but does not forcibly terminate the faster-whisper process. Returns:
```json
{ "success": true, "status": "cancelled" }
```

### `GET /api/load?videoId=<id>`
Return the cached transcript for the given video ID.

**Response** (`200`):
```json
{ "transcript": "text", "cached": true }
```
If no transcript exists a `404` is returned.

### `POST /api/save_qa`
Store a question/answer pair for a video.

**Request body** (JSON):
```json
{
  "videoId": "<id>",
  "question": "text",
  "answer": "text"
}
```

**Response**:
```json
{ "success": true }
```

All saved Q&A pairs are appended as JSON lines to `<video_id>_qa.txt` inside the transcript folder.

## Running the Server

Install the dependencies listed in `setup_yt_ai.ps1` or run the setup scripts for your platform. Then execute:
```bash
python yt_ai_server.py
```
The server will load the faster-whisper model on startup and listen on port `5010`.

