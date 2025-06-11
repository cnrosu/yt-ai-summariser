# yt-ai-summariser

Chrome extension and Python backend for transcribing YouTube videos with Whisper and analysing them using GPT models. The extension, **YouTranscribe**, now provides a Material-style UI with quick actions, suggested questions and a dedicated settings page for your API key.

Transcripts are cached per video on disk and in the browser. Any questions you ask are saved in Chrome sync storage so they remain tied to your Google account and are not shared with other users. A copy of each question/answer pair is also written on the server next to the transcript for that video.
