import sys
import struct
import json
import subprocess
import whisper
import tempfile
import os

def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack('I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(message)

def send_message(message):
    encoded = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.flush()

def download_audio(video_url):
    out_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3").name
    subprocess.run([
        "yt-dlp", "-x", "--audio-format", "mp3",
        "-o", out_file, video_url
    ], check=True)
    return out_file

def transcribe_audio(audio_file):
    model = whisper.load_model("base")  # or use OpenAI API
    result = model.transcribe(audio_file)
    return result["text"]

def main():
    while True:
        message = read_message()
        if message is None:
            break

        try:
            video_url = message["url"]
            audio_path = download_audio(video_url)
            transcript = transcribe_audio(audio_path)
            os.remove(audio_path)

            send_message({ "success": True, "transcript": transcript })
        except Exception as e:
            send_message({ "success": False, "error": str(e) })

if __name__ == "__main__":
    main()
