import base64
import io
import inspect
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import numpy as np
from PIL import Image

# Mock dependencies not available in the testing environment
for mod in [
    "gradio",
    "torch",
    "spaces",
    "manga_translator",
    "manga_translator.config",
    "manga_translator.detection",
    "manga_translator.textline_merge",
    "manga_translator.mask_refinement",
    "manga_translator.inpainting",
    "manga_translator.utils",
    "manga_translator.utils.sort",
]:
    if mod not in sys.modules:
        m = MagicMock()
        m.Progress = MagicMock
        sys.modules[mod] = m

sys.path.insert(0, str(Path(__file__).parent / "manga-image-translator-ref"))

from app import (
    fastapi_app,
    process_image,
    process_zip,
    decode_base64_image,
    encode_image_base64,
    format_boxes,
    sort_boxes_regions,
)
from fastapi.testclient import TestClient


class MockTextBlock:
    def __init__(self, x=10, y=20, w=100, h=50, direction="v", font_size=24, angle=0.0):
        self.xywh = np.array([x, y, w, h])
        self.direction = direction
        self.font_size = font_size
        self.angle = angle
        self.center = np.array([x + w / 2, y + h / 2])

    def get_font_colors(self):
        return np.array([0, 0, 0]), np.array([255, 255, 255])


class TestMITApi(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(fastapi_app)
        # Create a small dummy 100x100 white image
        img = Image.new("RGB", (100, 100), color=(255, 255, 255))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        self.valid_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")

    def test_default_parameters(self):
        sig_img = inspect.signature(process_image)
        self.assertEqual(sig_img.parameters["detector_name"].default, "default")
        self.assertEqual(sig_img.parameters["inpainter_name"].default, "aot")

        sig_zip = inspect.signature(process_zip)
        self.assertEqual(sig_zip.parameters["detector_name"].default, "default")
        self.assertEqual(sig_zip.parameters["inpainter_name"].default, "aot")

    def test_health_endpoint(self):
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("device", data)

        # Test root endpoint with json accept header
        res_root = self.client.get("/", headers={"accept": "application/json"})
        self.assertEqual(res_root.status_code, 200)
        self.assertEqual(res_root.json()["status"], "ok")

        # Test root endpoint with format query param
        res_root_param = self.client.get("/?format=json")
        self.assertEqual(res_root_param.status_code, 200)
        self.assertEqual(res_root_param.json()["status"], "ok")

    def test_detect_boxes_endpoint(self):
        mock_regions = [
            MockTextBlock(x=10, y=10, w=50, h=100, direction="v", font_size=24, angle=0.0),
            MockTextBlock(x=70, y=10, w=60, h=30, direction="h", font_size=18, angle=5.2),
        ]

        with patch("app._detect_boxes_gpu", return_value=(mock_regions, {"detect_s": 0.1})):
            res = self.client.post("/api/detect-boxes", json={
                "imageBase64": self.valid_b64,
                "readingOrder": "manga",
                "detector": "default",
            })
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIn("boxes", data)
            self.assertEqual(len(data["boxes"]), 2)

            box1 = data["boxes"][0]
            self.assertEqual(box1["id"], "box_1")
            self.assertEqual(box1["order"], 1)
            self.assertEqual(box1["box"], [10, 10, 50, 100])
            self.assertEqual(box1["direction"], "v")
            self.assertEqual(box1["font_size_est"], 24)
            self.assertEqual(box1["fg_color"], [0, 0, 0])
            self.assertEqual(box1["bg_color"], [255, 255, 255])

            box2 = data["boxes"][1]
            self.assertEqual(box2["id"], "box_2")
            self.assertEqual(box2["order"], 2)
            self.assertEqual(box2["box"], [70, 10, 60, 30])
            self.assertEqual(box2["direction"], "h")
            self.assertEqual(box2["angle"], 5.2)

    def test_clean_endpoint(self):
        dummy_rgb = np.zeros((100, 100, 3), dtype=np.uint8)
        dummy_mask = np.zeros((100, 100), dtype=np.uint8)

        with patch("app._process_inpaint_gpu", return_value=(dummy_rgb, dummy_mask, {"inpaint_s": 0.2})):
            res = self.client.post("/api/clean", json={
                "imageBase64": self.valid_b64,
                "detector": "default",
                "inpainter": "aot",
                "dilation_offset": 2,
            })
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIn("cleanedImageBase64", data)
            self.assertTrue(data["cleanedImageBase64"].startswith("data:image/jpeg;base64,"))

        with patch("app._process_mask_inpaint_gpu", return_value=(dummy_rgb, {"inpaint_s": 0.15})):
            res_mask = self.client.post("/api/clean", json={
                "imageBase64": self.valid_b64,
                "maskBase64": self.valid_b64,
                "inpainter": "aot",
            })
            self.assertEqual(res_mask.status_code, 200)
            self.assertIn("cleanedImageBase64", res_mask.json())

    def test_process_page_endpoint(self):
        dummy_rgb = np.zeros((100, 100, 3), dtype=np.uint8)
        dummy_mask = np.zeros((100, 100), dtype=np.uint8)
        mock_regions = [
            MockTextBlock(x=5, y=5, w=40, h=80, direction="v", font_size=20),
        ]

        with patch("app._process_page_gpu", return_value=(dummy_rgb, dummy_mask, mock_regions, {"total_s": 0.3})):
            res = self.client.post("/api/process-page", json={
                "imageBase64": self.valid_b64,
                "readingOrder": "manga",
                "detector": "default",
                "inpainter": "aot",
                "dilation_offset": 0,
            })
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIn("cleanedImageBase64", data)
            self.assertTrue(data["cleanedImageBase64"].startswith("data:image/jpeg;base64,"))
            self.assertIn("boxes", data)
            self.assertEqual(len(data["boxes"]), 1)
            self.assertEqual(data["boxes"][0]["box"], [5, 5, 40, 80])

    def test_invalid_base64_error(self):
        res = self.client.post("/api/detect-boxes", json={
            "imageBase64": "invalid_base64_content@@",
        })
        self.assertEqual(res.status_code, 400)


if __name__ == "__main__":
    unittest.main()
