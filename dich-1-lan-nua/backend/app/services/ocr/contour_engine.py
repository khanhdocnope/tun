import io
import uuid
from typing import List, Optional
import cv2
import numpy as np
from PIL import Image

from app.schemas.ocr import BoundingBoxModel, OCRRegionModel
from app.services.ocr.base import BaseOCREngine


class ContourOCREngine(BaseOCREngine):
    """Fallback / Lightweight CV2-based bubble and high-contrast text detector.

    Detects candidate speech bubble contours and text blocks using connected components
    and morphological thresholding without external deep neural weights.
    """

    @property
    def name(self) -> str:
        return "contour"

    def is_available(self) -> bool:
        return True

    def detect_and_recognize(
        self,
        image_bytes: bytes,
        reading_direction: str = "rtl",
        languages: Optional[List[str]] = None,
    ) -> List[OCRRegionModel]:
        # Decode image using PIL & NumPy
        with Image.open(io.BytesIO(image_bytes)) as pil_img:
            img_rgb = np.array(pil_img.convert("RGB"))

        height, width = img_rgb.shape[:2]
        gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)

        # Adaptive thresholding to capture both light and dark comic text
        thresh = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 8
        )

        # Morphological dilation to connect adjacent character strokes into words/bubbles
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        dilated = cv2.dilate(thresh, kernel, iterations=2)

        contours, _ = cv2.findContours(
            dilated, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE
        )

        detected_boxes: List[BoundingBoxModel] = []
        min_area = 25
        max_area = (width * height) * 0.95  # Ignore exact full page

        for c in contours:
            area = cv2.contourArea(c)
            if min_area <= area <= max_area:
                x, y, w, h = cv2.boundingRect(c)
                # Filter out single line artifacts or full canvas border
                if w >= 6 and h >= 6 and not (w >= width - 2 and h >= height - 2):
                    detected_boxes.append(
                        BoundingBoxModel(
                            x=float(x),
                            y=float(y),
                            width=float(w),
                            height=float(h),
                        )
                    )

        # Non-maximum suppression / deduplication of nested overlapping boxes
        merged_boxes: List[BoundingBoxModel] = []
        for box in detected_boxes:
            # Check if this box is largely duplicate of an existing merged box
            is_dup = False
            for mb in merged_boxes:
                # Calculate IoU or inclusion
                ix1 = max(box.x, mb.x)
                iy1 = max(box.y, mb.y)
                ix2 = min(box.x + box.width, mb.x + mb.width)
                iy2 = min(box.y + box.height, mb.y + mb.height)
                if ix2 > ix1 and iy2 > iy1:
                    inter_area = (ix2 - ix1) * (iy2 - iy1)
                    box_area = box.width * box.height
                    if inter_area / box_area > 0.85:
                        is_dup = True
                        break
            if not is_dup:
                merged_boxes.append(box)

        # Sort boxes by reading direction
        if reading_direction == "rtl":
            merged_boxes.sort(key=lambda b: (b.y // 80, -b.x))
        else:
            merged_boxes.sort(key=lambda b: (b.y // 80, b.x))

        results: List[OCRRegionModel] = []
        for idx, box in enumerate(merged_boxes, start=1):
            results.append(
                OCRRegionModel(
                    id=str(uuid.uuid4()),
                    box=box,
                    polygon=[
                        [box.x, box.y],
                        [box.x + box.width, box.y],
                        [box.x + box.width, box.y + box.height],
                        [box.x, box.y + box.height],
                    ],
                    text="",  # Honest empty text for contour detector
                    confidence=0.85,
                    reading_order=idx,
                    direction="horizontal" if box.width >= box.height else "vertical",
                    language="unknown",
                )
            )

        return results
