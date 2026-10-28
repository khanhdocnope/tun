import io
import os
import tempfile
import unittest
import zipfile
from unittest.mock import patch
import numpy as np
from PIL import Image

import sys
from pathlib import Path
from unittest.mock import MagicMock

for mod in ["gradio", "torch", "spaces", "manga_translator", "manga_translator.config", "manga_translator.detection", "manga_translator.textline_merge", "manga_translator.mask_refinement", "manga_translator.inpainting"]:
    if mod not in sys.modules:
        m = MagicMock()
        m.Progress = MagicMock
        sys.modules[mod] = m

sys.path.insert(0, str(Path(__file__).parent / "manga-image-translator-ref"))

from app import natural_sort_key, process_zip


class TestMITZipProcessing(unittest.TestCase):
    def test_natural_sort_order(self):
        filenames = ["page_10.png", "page_1.png", "page_2.png", "page_20.jpg", "page_3.webp"]
        filenames.sort(key=natural_sort_key)
        self.assertEqual(filenames, ["page_1.png", "page_2.png", "page_3.webp", "page_10.png", "page_20.jpg"])

    def test_process_zip_synthetic(self):
        # Create a synthetic zip in memory
        temp_in = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        with zipfile.ZipFile(temp_in.name, "w") as zf:
            for i in [1, 2]:
                img = Image.new("RGB", (100, 100), color=(255, 255, 255))
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                zf.writestr(f"chapter1/page_{i}.png", buf.getvalue())
            # Add an ignoreable non-image
            zf.writestr("chapter1/readme.txt", "Some text")
            zf.writestr("__MACOSX/page_1.png", "junk")
        temp_in.close()

        # Mock _process_inpaint_gpu
        def mock_inpaint(img_rgb, detector_name, inpainter_name, dilation_offset=0, detect_size=1024):
            return img_rgb, np.zeros((100, 100), dtype=np.uint8), {"detect_s": 0.05, "merge_s": 0.01, "mask_refine_s": 0.01, "inpaint_s": 0.1}

        class MockProgress:
            def __call__(self, val, desc=None):
                pass

        with patch("app._process_inpaint_gpu", side_effect=mock_inpaint):
            out_zip_path, summary_text, preview_items = process_zip(
                temp_in.name,
                detector_name="ctd",
                inpainter_name="lama_large",
                dilation_offset=0,
                progress=MockProgress(),
            )

        self.assertIsNotNone(out_zip_path)
        self.assertTrue(os.path.exists(out_zip_path))
        self.assertIn("Số trang đã xử lý: 2", summary_text)
        self.assertEqual(len(preview_items), 2)

        # Check output zip contents
        with zipfile.ZipFile(out_zip_path, "r") as zf:
            names = zf.namelist()
            self.assertIn("chapter1/page_1.png", names)
            self.assertIn("chapter1/page_2.png", names)
            self.assertNotIn("chapter1/readme.txt", names)
            self.assertNotIn("__MACOSX/page_1.png", names)

        os.remove(temp_in.name)
        if os.path.exists(out_zip_path):
            os.remove(out_zip_path)


if __name__ == "__main__":
    unittest.main()
