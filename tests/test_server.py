import json
import os
import sys
import types
import importlib
import tempfile

# Ensure the project root is on sys.path so yt_ai_server can be imported
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT_DIR)

import pytest

class DummyWhisper:
    def __init__(self, *args, **kwargs):
        pass
    def transcribe(self, audio_file):
        segment = types.SimpleNamespace(text="dummy transcript")
        return [segment], None

class DummyThread:
    def __init__(self, target=None, args=()):
        self.target = target
        self.args = args
    def start(self):
        if self.target:
            self.target(*self.args)

@pytest.fixture()
def app(monkeypatch, tmp_path):
    dummy_module = types.ModuleType("faster_whisper")
    dummy_module.WhisperModel = DummyWhisper
    monkeypatch.setitem(sys.modules, "faster_whisper", dummy_module)

    dummy_torch = types.ModuleType("torch")
    dummy_torch.cuda = types.SimpleNamespace(is_available=lambda: False)
    monkeypatch.setitem(sys.modules, "torch", dummy_torch)

    import yt_ai_server
    importlib.reload(yt_ai_server)

    monkeypatch.setattr(yt_ai_server.threading, "Thread", DummyThread)
    monkeypatch.setattr(yt_ai_server, "CACHE_DIR", tmp_path)

    def dummy_process(job_id, url, video_id):
        yt_ai_server.jobs[job_id]["status"] = "done"
        yt_ai_server.jobs[job_id]["transcript"] = "dummy transcript"
        cache_file = yt_ai_server.get_cache_filename(video_id)
        with open(cache_file, "w", encoding="utf-8") as f:
            f.write("dummy transcript")
    monkeypatch.setattr(yt_ai_server, "process_job", dummy_process)

    return yt_ai_server.app.test_client(), yt_ai_server

def test_transcribe_and_cache(app):
    client, server = app
    url = "https://www.youtube.com/watch?v=abc123"

    resp = client.post("/api/transcribe", json={"url": url})
    data = resp.get_json()
    assert "jobId" in data
    job_id = data["jobId"]

    status = client.get("/api/status", query_string={"jobId": job_id}).get_json()
    assert status["status"] == "done"
    assert status["transcript"] == "dummy transcript"

    load_resp = client.get("/api/load", query_string={"videoId": "abc123"})
    load = load_resp.get_json()
    assert load["cached"] is True
    assert load["transcript"] == "dummy transcript"

    # Calling again should return cached transcript directly
    resp2 = client.post("/api/transcribe", json={"url": url})
    data2 = resp2.get_json()
    assert data2["cached"] is True
    assert data2["transcript"] == "dummy transcript"

def test_status_not_found(app):
    client, _ = app
    resp = client.get("/api/status", query_string={"jobId": "missing"})
    assert resp.status_code == 404

def test_load_not_found(app):
    client, _ = app
    resp = client.get("/api/load", query_string={"videoId": "nope"})
    assert resp.status_code == 404

def test_save_qa(app):
    client, server = app
    qa = {"videoId": "vid1", "question": "q", "answer": "a"}
    resp = client.post("/api/save_qa", json=qa)
    assert resp.get_json()["success"] is True

    qa_file = server.get_qa_filename("vid1")
    with open(qa_file, "r", encoding="utf-8") as f:
        line = f.readline()
    assert json.loads(line) == {"question": "q", "answer": "a"}

def test_transcribe_missing_url(app):
    client, _ = app
    resp = client.post("/api/transcribe", json={})
    assert resp.status_code == 400

def test_save_qa_missing_fields(app):
    client, _ = app
    resp = client.post("/api/save_qa", json={"videoId": "id"})
    assert resp.status_code == 400


def test_job_listener_count(monkeypatch, tmp_path):
    dummy_module = types.ModuleType("faster_whisper")
    dummy_module.WhisperModel = DummyWhisper
    monkeypatch.setitem(sys.modules, "faster_whisper", dummy_module)

    dummy_torch = types.ModuleType("torch")
    dummy_torch.cuda = types.SimpleNamespace(is_available=lambda: False)
    monkeypatch.setitem(sys.modules, "torch", dummy_torch)

    import yt_ai_server
    importlib.reload(yt_ai_server)

    monkeypatch.setattr(yt_ai_server.threading, "Thread", DummyThread)
    monkeypatch.setattr(yt_ai_server, "CACHE_DIR", tmp_path)

    def dummy_process(job_id, url, video_id):
        yt_ai_server.jobs[job_id]["status"] = "transcribing"

    monkeypatch.setattr(yt_ai_server, "process_job", dummy_process)

    client = yt_ai_server.app.test_client()
    url = "https://www.youtube.com/watch?v=xyz987"

    first = client.post("/api/transcribe", json={"url": url}).get_json()
    jid = first["jobId"]
    assert yt_ai_server.jobs[jid]["listeners"] == 1

    second = client.post("/api/transcribe", json={"url": url}).get_json()
    assert second["jobId"] == jid
    assert yt_ai_server.jobs[jid]["listeners"] == 2

    kill1 = client.post("/api/kill", query_string={"jobId": jid}).get_json()
    assert kill1["listeners"] == 1
    assert yt_ai_server.jobs[jid]["status"] != "cancelled"

    kill2 = client.post("/api/kill", query_string={"jobId": jid}).get_json()
    assert kill2["status"] == "cancelled"


def test_kill_sets_killed_flag(app):
    client, server = app
    url = "https://www.youtube.com/watch?v=kill123"

    resp = client.post("/api/transcribe", json={"url": url}).get_json()
    jid = resp["jobId"]

    kill = client.post("/api/kill", query_string={"jobId": jid}).get_json()
    assert kill["success"] is True
    assert kill["status"] == "cancelled"
    assert kill["listeners"] == 0
    assert server.jobs[jid]["killed"] is True

