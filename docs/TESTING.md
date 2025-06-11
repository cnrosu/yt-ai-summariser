# Testing Guide

This project uses **pytest** to exercise the Flask API implemented in
`yt_ai_server.py`.

The tests avoid heavy dependencies such as the real `WhisperModel` or
invoking `yt_dlp`.  A lightweight dummy model and thread implementation are
injected with `pytest` fixtures.  This keeps the test suite fast and
self-contained while still verifying the API behaviour and file caching
logic.

## Running Tests

1. Install Python 3.10 or newer.
2. (Optional) Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate
   ```
3. Install the project and test requirements:
   ```bash
   pip install -r requirements.txt
   pip install -r requirements-dev.txt
   ```
4. Execute the test suite:
   ```bash
   pytest
   ```

The tests simulate transcription and caching without network access, so
they run quickly and deterministically.
