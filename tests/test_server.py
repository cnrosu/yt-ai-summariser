import os
import sys
import tempfile
import shutil
import unittest
import json

sys.path.append(os.path.dirname(os.path.dirname(__file__)))
import types

# Stub the whisper module to avoid heavy import during tests
sys.modules.setdefault('whisper', types.SimpleNamespace(load_model=lambda *a, **k: None))

import yt_ai_server

class ServerErrorHandlingTests(unittest.TestCase):
    def setUp(self):
        self.client = yt_ai_server.app.test_client()
        self.temp_dir = tempfile.mkdtemp()
        yt_ai_server.CACHE_DIR = self.temp_dir
        os.makedirs(self.temp_dir, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def test_transcribe_invalid_json(self):
        resp = self.client.post('/api/transcribe', data='not json', content_type='application/json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('error', resp.get_json())

    def test_load_corrupted_cache(self):
        video_id = 'abc123'
        cache_file = yt_ai_server.get_cache_filename(video_id)
        with open(cache_file, 'w', encoding='utf-8') as f:
            f.write('this is not json')
        resp = self.client.get(f'/api/load?videoId={video_id}')
        self.assertEqual(resp.status_code, 500)
        self.assertIn('error', resp.get_json())

if __name__ == '__main__':
    unittest.main()
