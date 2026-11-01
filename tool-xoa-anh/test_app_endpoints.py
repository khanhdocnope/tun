import base64
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import numpy as np
from PIL import Image

# Ensure mocking for environment without gradio/torch/spaces
for mod in ["gradio", "torch", "spaces"]:
    if mod not in sys.modules:
        m = MagicMock()
        m.Progress = MagicMock
        sys.modules[mod] = m

sys.path.insert(0, str(Path(__file__).parent))

from app import fastapi_app, MAX_PIXELS
from fastapi.testclient import TestClient


class TestAppEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(fastapi_app)
        img = Image.new("RGB", (100, 100), color=(255, 255, 255))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        self.valid_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")

    def test_cors_headers(self):
        # OPTIONS preflight request
        headers = {
            "Origin": "https://manga-typeset-vercel.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        }
        res = self.client.options("/clean_page", headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertIn("access-control-allow-origin", res.headers)
        self.assertIn(res.headers["access-control-allow-origin"], ["*", "https://manga-typeset-vercel.app"])

    def test_health_and_ping_endpoints(self):
        for route in ["/health", "/api/ping", "/ping", "/api/v1/health"]:
            res = self.client.get(route)
            self.assertEqual(res.status_code, 200, f"Route {route} failed")
            data = res.json()
            self.assertEqual(data["status"], "ready")
            self.assertIn("device", data)
            self.assertEqual(data["max_pixels"], MAX_PIXELS)

    def test_clean_page_success(self):
        dummy_cleaned = Image.new("RGB", (100, 100), color=(255, 255, 255))
        dummy_mask = Image.new("RGB", (100, 100), color=(0, 0, 0))
        dummy_stats = {
            "mode": "Chỉ xóa Chat (giữ SFX)",
            "timings_ms": {"total": 50.0},
            "device": "cpu",
        }

        with patch("manga_cleaner.cleaner_pipeline.clean_image", return_value=(dummy_cleaned, dummy_mask, dummy_stats)):
            res = self.client.post("/clean_page", json={
                "imageBase64": self.valid_b64,
                "cleanSFX": False,
                "dilationPx": 4,
                "inpaintModel": "anime-lama",
            })
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertTrue(data["success"])
            self.assertTrue(data["cleanedImageBase64"].startswith("data:image/"))
            self.assertTrue(data["colorMaskBase64"].startswith("data:image/"))
            self.assertIn("stats", data)
            self.assertIn("api_timings_ms", data["stats"])

    def test_clean_page_invalid_model(self):
        res = self.client.post("/clean_page", json={
            "imageBase64": self.valid_b64,
            "inpaintModel": "unknown-nonexistent-model",
        })
        self.assertEqual(res.status_code, 422)

    def test_clean_page_empty_payload(self):
        res = self.client.post("/clean_page", json={
            "imageBase64": "",
        })
        self.assertEqual(res.status_code, 400)

    def test_oom_guard_downscaling(self):
        from manga_cleaner import cleaner_pipeline
        # Create 2400x1200 image (> 2048px)
        large_img = Image.new("RGB", (2400, 1200), color=(255, 255, 255))
        # Mock bubbles and text_det to return dummy data
        mock_ms = MagicMock()
        mock_ms.chat_boxes = []
        mock_ms.sfx_boxes = []
        mock_ms.chat_text = np.zeros((1024, 2048), dtype=np.uint8)
        mock_ms.sfx_text = np.zeros((1024, 2048), dtype=np.uint8)
        mock_ms.chat_erase = np.zeros((1024, 2048), dtype=np.uint8)
        mock_ms.sfx_erase = np.zeros((1024, 2048), dtype=np.uint8)

        with patch.object(cleaner_pipeline.bubbles, "ready", True), \
             patch("manga_cleaner._cpu_page_job", return_value=(
                 np.full((1024, 2048, 3), 255, dtype=np.uint8),
                 mock_ms,
                 {"detect": 10.0, "seg": 20.0, "masks": 5.0, "inpaint": 30.0},
                 "test-engine",
                 0,
                 np.zeros((1024, 2048), dtype=np.uint8)
             )):
            cleaned, mask, stats = cleaner_pipeline.clean_image(large_img, force_cpu=True)
            self.assertEqual(cleaned.size, (2400, 1200))
            self.assertEqual(mask.size, (2400, 1200))
            self.assertTrue(stats.get("downscaled"))
            self.assertEqual(stats["width"], 2400)
            self.assertEqual(stats["height"], 1200)


if __name__ == "__main__":
    unittest.main()
