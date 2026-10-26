"""Detect text regions inside a user-selected ROI.

Uses the shared, already-warmed RapidOCR engine (never instantiate a new model
per region - that used to reload the ONNX weights on every call).  Returns
boxes in full-image coordinates.
"""

import io
from typing import List, Tuple

from PIL import Image

from app.services.ocr.manager import ocr_manager


def _intersect(a, b) -> bool:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    return not (ax2 <= bx1 or bx2 <= ax1 or ay2 <= by1 or by2 <= ay1)


def detect_text_in_region(
    image_bytes: bytes,
    region: Tuple[int, int, int, int],
    padding: int = 24,
) -> List[Tuple[int, int, int, int]]:
    """Return list of (x, y, w, h) text boxes inside ``region`` (x,y,w,h)."""

    rx, ry, rw, rh = region
    rx1, ry1, rx2, ry2 = rx, ry, rx + rw, ry + rh

    try:
        with Image.open(io.BytesIO(image_bytes)) as pil:
            width, height = pil.size
            x0 = max(0, rx - padding)
            y0 = max(0, ry - padding)
            x1 = min(width, rx2 + padding)
            y1 = min(height, ry2 + padding)
            roi = pil.crop((x0, y0, x1, y1)).convert("RGB")
        buffer = io.BytesIO()
        roi.save(buffer, format="PNG")
    except Exception:
        return []

    engine = ocr_manager.get_engine("rapidocr")
    regions = engine.detect_and_recognize(buffer.getvalue(), reading_direction="ltr")
    out: List[Tuple[int, int, int, int]] = []
    for item in regions:
        box = item.box
        bx, by = int(box.x + x0), int(box.y + y0)
        bw, bh = int(box.width), int(box.height)
        if _intersect((bx, by, bx + bw, by + bh), (rx1, ry1, rx2, ry2)):
            out.append((bx, by, bw, bh))
    return out
