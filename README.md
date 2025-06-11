# yt-ai-summariser

Chrome extension and Python backend for transcribing YouTube videos with Whisper and analysing them using GPT models. The extension, **YouTranscribe**, now provides a Material-style UI with quick actions, suggested questions and a dedicated settings page for your API key. Transcripts are stored compressed on the server and decompressed before being sent to the browser.

## Setup

Install dependencies including the `lzstring` module used for transcript compression:

```bash
pip install flask whisper lzstring torch yt-dlp
```
