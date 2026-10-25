import io
import uuid
from typing import List, Optional
import numpy as np
from PIL import Image

from app.schemas.ocr import BoundingBoxModel, OCRRegionModel
from app.services.ocr.base import BaseOCREngine

try:
    from rapidocr_onnxruntime import RapidOCR
    RAPIDOCR_AVAILABLE = True
except ImportError:
    RAPIDOCR_AVAILABLE = False


class RapidOCREngine(BaseOCREngine):
    """PaddleOCR inference powered by ONNXRuntime for fast CPU-only execution.

    Lightweight, high-accuracy multilingual character recognition for Manga,
    Manhwa, and Webtoons. Supports horizontal and vertical text layouts.
    """

    def __init__(self):
        self._engine = None

    @property
    def name(self) -> str:
        return "rapidocr"

    def is_available(self) -> bool:
        return RAPIDOCR_AVAILABLE

    def _get_engine(self):
        if not RAPIDOCR_AVAILABLE:
            raise RuntimeError(
                "rapidocr-onnxruntime is not installed. Please install with: "
                "pip install rapidocr-onnxruntime onnxruntime"
            )
        if self._engine is None:
            self._engine = RapidOCR()
        return self._engine

    def detect_and_recognize(
        self,
        image_bytes: bytes,
        reading_direction: str = "rtl",
        languages: Optional[List[str]] = None,
    ) -> List[OCRRegionModel]:
        engine = self._get_engine()

        # Load image via PIL to handle PNG, JPEG, WebP reliably
        with Image.open(io.BytesIO(image_bytes)) as pil_img:
            img_rgb = np.array(pil_img.convert("RGB"))

        ocr_results, _ = engine(img_rgb)
        if not ocr_results:
            return []

        regions: List[OCRRegionModel] = []
        parsed_items = []

        for item in ocr_results:
            # item format: [ [[x1, y1], [x2, y2], [x3, y3], [x4, y4]], "text", 0.95 ]
            pts = item[0]
            text = str(item[1]).strip()
            confidence = float(item[2])

            xs = [float(p[0]) for p in pts]
            ys = [float(p[1]) for p in pts]
            min_x = max(0.0, min(xs))
            min_y = max(0.0, min(ys))
            box_w = max(4.0, max(xs) - min_x)
            box_h = max(4.0, max(ys) - min_y)

            parsed_items.append({
                "pts": [[float(p[0]), float(p[1])] for p in pts],
                "box": BoundingBoxModel(x=min_x, y=min_y, width=box_w, height=box_h),
                "text": text,
                "confidence": max(0.0, min(1.0, confidence)),
                "direction": "vertical" if box_h > box_w * 1.3 else "horizontal",
            })

        # Comic Reading Order Sorting:
        # Manga (RTL): Group by vertical bands (approx 120px) then right-to-left (-x)
        # Webtoon (LTR): Group by vertical bands then left-to-right (x)
        if reading_direction == "rtl":
            parsed_items.sort(key=lambda item: (item["box"].y // 120, -item["box"].x))
        else:
            parsed_items.sort(key=lambda item: (item["box"].y // 120, item["box"].x))

        for idx, item in enumerate(parsed_items, start=1):
            regions.append(
                OCRRegionModel(
                    id=str(uuid.uuid4()),
                    box=item["box"],
                    polygon=item["pts"],
                    text=item["text"],
                    confidence=item["confidence"],
                    reading_order=idx,
                    direction=item["direction"],
                    language="ja" if reading_direction == "rtl" else "en",
                )
            )

        return regions
