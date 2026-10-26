"""RapidOCR engine tuned for comic / manga lettering.

Key improvements over the stock RapidOCR defaults:

* Detection runs with ``limit_type=max`` and a larger working resolution.  The
  default ``limit_type=min`` aggressively upscales small crops and misses large
  vertical manga lettering; on the bundled test page it finds only 7 boxes while
  this configuration finds 35-37.
* Vertical text columns are rotated 90 degrees counter-clockwise before
  recognition.  PP-OCR recognition models are trained on horizontal lines;
  without this rotation kana are dropped or mistaken for kanji.
* Recognition uses the PP-OCRv5 multilingual model, which explicitly covers
  Japanese kana, instead of the older Chinese-only dictionary.  The model can
  be fetched once and cached, and the engine falls back to the wheel model.
* Nearby fragments are merged, clipped columns are extended, and boxes are
  grouped by speech bubble before assigning reading order.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image

from app.schemas.ocr import BoundingBoxModel, OCRRegionModel
from app.services.ocr import model_store
from app.services.ocr.base import BaseOCREngine

logger = logging.getLogger(__name__)

try:  # pragma: no cover - depends on the installed wheel layout
    from rapidocr_onnxruntime.ch_ppocr_v3_det.text_detect import (
        TextDetector as _RapidTextDetector,
    )
    from rapidocr_onnxruntime.ch_ppocr_v3_rec import (
        TextRecognizer as _RapidTextRecognizer,
    )

    _HAS_RAPID_INTERNALS = True
except Exception:  # pragma: no cover
    _RapidTextDetector = None  # type: ignore[assignment]
    _RapidTextRecognizer = None  # type: ignore[assignment]
    _HAS_RAPID_INTERNALS = False

try:
    from rapidocr_onnxruntime import RapidOCR

    RAPIDOCR_AVAILABLE = True
except ImportError:  # pragma: no cover
    RapidOCR = None  # type: ignore[assignment]
    RAPIDOCR_AVAILABLE = False


# Detection resolution.  A single 1600px pass gives the best recall on manga
# pages; 1280 is noticeably faster with nearly identical recall.  Larger images
# are tiled so webtoon strips keep a readable text size.  All values can be
# overridden without a code change for slower CPU-only hosts.
_DET_LIMIT_SIDE = int(os.getenv("OCR_DET_LIMIT_SIDE", "1600"))
_TILE_SIZE = int(os.getenv("OCR_TILE_SIZE", "1800"))
_TILE_OVERLAP = int(os.getenv("OCR_TILE_OVERLAP", "192"))
_MAX_SINGLE_PASS = int(os.getenv("OCR_MAX_SINGLE_PASS", "2400"))
_REC_BATCH = int(os.getenv("OCR_REC_BATCH", "4"))
_MAX_BOXES = int(os.getenv("OCR_MAX_BOXES", "220"))
# Detector post-processing thresholds (PP-OCR DB defaults are too strict for
# thin vertical kana strokes).
_DET_THRESH = float(os.getenv("OCR_DET_THRESH", "0.2"))
_DET_BOX_THRESH = float(os.getenv("OCR_DET_BOX_THRESH", "0.3"))
_DET_UNCLIP = float(os.getenv("OCR_DET_UNCLIP", "2.0"))


@dataclass
class _Line:
    box: Tuple[int, int, int, int]  # x1, y1, x2, y2
    vertical: bool
    text: str = ""
    score: float = 0.0
    bubble: int = -1


class RapidOCREngine(BaseOCREngine):
    """Fast CPU OCR with manga-aware detection and reading order."""

    def __init__(self) -> None:
        self._detector = None
        self._recognizer = None
        self._fallback = None
        self._init_lock = threading.Lock()
        self._det_lock = threading.Lock()
        self._initialized = False
        self._mode = "uninitialized"
        self._last_error: Optional[str] = None

    @property
    def name(self) -> str:
        return "rapidocr"

    def is_available(self) -> bool:
        # Availability only means the dependency is importable.  Model loading
        # (and any first-run download) happens on the first OCR request inside
        # the threadpool, never during a capabilities/health check.
        return bool(RAPIDOCR_AVAILABLE or _HAS_RAPID_INTERNALS)

    # ------------------------------------------------------------------ setup
    def _ensure_initialized(self) -> None:
        if self._initialized:
            return
        with self._init_lock:
            if self._initialized:
                return
            self._initialized = True
            if _HAS_RAPID_INTERNALS:
                try:
                    # The wheel already ships the detector, so never wait on a
                    # download for it.  The multilingual recognizer is the one
                    # that adds value; fetch it once and cache it.
                    det_path = model_store.bundled_det_model() or model_store.get_model("det")
                    rec_path = model_store.get_model("rec") or model_store.bundled_rec_model()
                    if det_path is not None and rec_path is not None:
                        self._detector = _RapidTextDetector(
                            {
                                "model_path": str(det_path),
                                "use_cuda": False,
                                "limit_side_len": _DET_LIMIT_SIDE,
                                "limit_type": "max",
                                "thresh": _DET_THRESH,
                                "box_thresh": _DET_BOX_THRESH,
                                "max_candidates": 2000,
                                "unclip_ratio": _DET_UNCLIP,
                                "use_dilation": True,
                                "score_mode": "fast",
                            }
                        )
                        self._recognizer = _RapidTextRecognizer(
                            {
                                "model_path": str(rec_path),
                                "use_cuda": False,
                                "rec_img_shape": [3, 48, 320],
                                "rec_batch_num": _REC_BATCH,
                            }
                        )
                        self._mode = (
                            "v5-multilingual"
                            if "v5" in rec_path.name.lower()
                            else "v3-fallback"
                        )
                        logger.info(
                            "RapidOCR ready (mode=%s, det=%s, rec=%s)",
                            self._mode,
                            det_path.name,
                            rec_path.name,
                        )
                except Exception as exc:  # pragma: no cover - defensive
                    self._last_error = str(exc)
                    logger.exception("Failed to initialise tuned RapidOCR models: %s", exc)

            if self._detector is None or self._recognizer is None:
                self._init_stock_fallback()

    def _init_stock_fallback(self) -> None:
        """Fallback to the public RapidOCR wrapper (still with better defaults)."""

        if not RAPIDOCR_AVAILABLE:
            return
        try:
            self._fallback = RapidOCR(
                det_limit_side_len=_DET_LIMIT_SIDE,
                det_limit_type="max",
                det_thresh=0.2,
                det_box_thresh=0.3,
                det_unclip_ratio=2.0,
                det_use_dilation=True,
                use_angle_cls=False,
                text_score=0.25,
                rec_batch_num=_REC_BATCH,
            )
            self._mode = "stock"
            logger.warning("Using stock RapidOCR fallback: %s", self._last_error)
        except Exception as exc:  # pragma: no cover - defensive
            self._last_error = str(exc)
            logger.exception("Stock RapidOCR fallback failed: %s", exc)

    def warmup(self) -> bool:
        """Force model loading (used by the API lifespan / diagnostics)."""

        try:
            self._ensure_initialized()
            if self._detector is None and self._fallback is None:
                return False
            dummy = np.full((64, 160, 3), 255, dtype=np.uint8)
            cv2.putText(
                dummy,
                "A",
                (10, 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.4,
                (0, 0, 0),
                2,
                cv2.LINE_AA,
            )
            self.detect_and_recognize(dummy.tobytes(), "ltr")
            return True
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("OCR warmup failed: %s", exc)
            return False

    @property
    def mode(self) -> str:
        self._ensure_initialized()
        return self._mode

    # -------------------------------------------------------------- public API
    def detect_and_recognize(
        self,
        image_bytes: bytes,
        reading_direction: str = "rtl",
        languages: Optional[List[str]] = None,
    ) -> List[OCRRegionModel]:
        started = time.perf_counter()
        self._ensure_initialized()

        rgb = self._decode(image_bytes)
        if rgb is None:
            return []
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

        if self._detector is not None and self._recognizer is not None:
            boxes = self._detect_boxes(bgr)
            lines = self._recognise(bgr, boxes)
        else:
            lines = self._run_stock(bgr)

        lines = [line for line in lines if not self._is_noise(line)]
        self._assign_reading_order(bgr, lines, reading_direction)
        regions = self._to_regions(lines, reading_direction)

        logger.debug(
            "OCR page %dx%d -> %d lines in %.0f ms (mode=%s)",
            bgr.shape[1],
            bgr.shape[0],
            len(regions),
            (time.perf_counter() - started) * 1000.0,
            self._mode,
        )
        return regions

    @staticmethod
    def _decode(image_bytes: bytes) -> Optional[np.ndarray]:
        try:
            with Image.open(__import__("io").BytesIO(image_bytes)) as pil:
                return np.array(pil.convert("RGB"))
        except Exception:
            return None

    # -------------------------------------------------------------- detection
    def _detect_boxes(self, bgr: np.ndarray) -> List[Tuple[int, int, int, int]]:
        h, w = bgr.shape[:2]
        raw: List[Tuple[float, float, float, float]] = []

        for tile, ox, oy in self._iter_tiles(bgr):
            dt_boxes, _elapsed = self._detect_tile(tile)
            if dt_boxes is None:
                continue
            for pts in dt_boxes:
                xs = pts[:, 0]
                ys = pts[:, 1]
                raw.append(
                    (
                        float(np.min(xs) + ox),
                        float(np.min(ys) + oy),
                        float(np.max(xs) + ox),
                        float(np.max(ys) + oy),
                    )
                )

        boxes: List[Tuple[int, int, int, int]] = []
        for x1, y1, x2, y2 in raw:
            ix1 = max(0, int(round(x1)))
            iy1 = max(0, int(round(y1)))
            ix2 = min(w, int(round(x2)))
            iy2 = min(h, int(round(y2)))
            bw, bh = ix2 - ix1, iy2 - iy1
            if bw < 6 or bh < 6:
                continue
            if bw * bh < 36:
                continue
            if bw >= w * 0.94 and bh >= h * 0.94:
                continue
            if max(bw, bh) / max(1, min(bw, bh)) > 28:
                continue
            boxes.append((ix1, iy1, ix2, iy2))

        boxes = self._dedupe(boxes)
        boxes = self._merge_fragments(boxes)
        boxes = self._refine_boxes(bgr, boxes)
        boxes = self._separate_overlaps(boxes)
        boxes = self._dedupe(boxes)
        boxes.sort(key=lambda b: (b[1], b[0]))
        return boxes[:_MAX_BOXES]

    def _iter_tiles(
        self, bgr: np.ndarray
    ) -> Iterable[Tuple[np.ndarray, int, int]]:
        h, w = bgr.shape[:2]
        if max(h, w) <= _MAX_SINGLE_PASS:
            yield bgr, 0, 0
            return
        step = _TILE_SIZE - _TILE_OVERLAP
        y = 0
        while y < h:
            x = 0
            while x < w:
                tile = bgr[y : min(y + _TILE_SIZE, h), x : min(x + _TILE_SIZE, w)]
                if tile.shape[0] >= 8 and tile.shape[1] >= 8:
                    yield tile, x, y
                if x + _TILE_SIZE >= w:
                    break
                x += step
            if y + _TILE_SIZE >= h:
                break
            y += step

    def _detect_tile(self, tile: np.ndarray):
        """Run detection with a size-aware input limit.

        Upscaling a 1075x1518 page to 1600px costs time without adding detail;
        only small crops (where the text would otherwise be tiny) need the full
        1600px canvas.  The detector's resize operator is mutable, so guard it
        while concurrent requests share the model.
        """

        max_side = max(tile.shape[:2])
        limit = _DET_LIMIT_SIDE if max_side < 1200 else min(_DET_LIMIT_SIDE, max_side)
        with self._det_lock:
            try:
                preprocess = self._detector.preprocess_op
                if preprocess and hasattr(preprocess[0], "limit_side_len"):
                    preprocess[0].limit_side_len = limit
            except Exception:
                pass
            return self._detector(tile)

    @staticmethod
    def _iou(a: Sequence[int], b: Sequence[int]) -> float:
        ax1, ay1, ax2, ay2 = a
        bx1, by1, bx2, by2 = b
        ix1, iy1 = max(ax1, bx1), max(ay1, by1)
        ix2, iy2 = min(ax2, bx2), min(ay2, by2)
        if ix2 <= ix1 or iy2 <= iy1:
            return 0.0
        inter = (ix2 - ix1) * (iy2 - iy1)
        area_a = (ax2 - ax1) * (ay2 - ay1)
        area_b = (bx2 - bx1) * (by2 - by1)
        return inter / float(max(1, area_a + area_b - inter))

    @classmethod
    def _dedupe(
        cls, boxes: List[Tuple[int, int, int, int]]
    ) -> List[Tuple[int, int, int, int]]:
        # Prefer larger boxes: tiled detection can return a clipped duplicate.
        ordered = sorted(
            boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True
        )
        kept: List[Tuple[int, int, int, int]] = []
        for box in ordered:
            duplicate = False
            for existing in kept:
                if cls._iou(box, existing) > 0.55:
                    duplicate = True
                    break
                # containment
                ix1, iy1 = max(box[0], existing[0]), max(box[1], existing[1])
                ix2, iy2 = min(box[2], existing[2]), min(box[3], existing[3])
                if ix2 > ix1 and iy2 > iy1:
                    inter = (ix2 - ix1) * (iy2 - iy1)
                    small = min(
                        (box[2] - box[0]) * (box[3] - box[1]),
                        (existing[2] - existing[0]) * (existing[3] - existing[1]),
                    )
                    if small > 0 and inter / small > 0.9:
                        duplicate = True
                        break
            if not duplicate:
                kept.append(box)
        return kept

    @staticmethod
    def _merge_fragments(
        boxes: List[Tuple[int, int, int, int]]
    ) -> List[Tuple[int, int, int, int]]:
        """Join vertically stacked pieces of the same text column."""

        boxes = list(boxes)
        changed = True
        rounds = 0
        while changed and rounds < 4:
            changed = False
            rounds += 1
            result: List[Tuple[int, int, int, int]] = []
            used = [False] * len(boxes)
            for i, a in enumerate(boxes):
                if used[i]:
                    continue
                ax1, ay1, ax2, ay2 = a
                for j in range(i + 1, len(boxes)):
                    if used[j]:
                        continue
                    bx1, by1, bx2, by2 = boxes[j]
                    aw, ah = ax2 - ax1, ay2 - ay1
                    bw, bh = bx2 - bx1, by2 - by1
                    if ah <= aw * 1.15 or bh <= bw * 1.15:
                        continue
                    overlap_x = max(0, min(ax2, bx2) - max(ax1, bx1))
                    if overlap_x / float(max(1, min(aw, bw))) < 0.55:
                        continue
                    gap = max(by1 - ay2, ay1 - by2, 0)
                    if gap > max(6, int(0.18 * min(ah, bh))):
                        continue
                    # Merge columns that are stacked directly above/below.
                    if abs(bx1 - ax1) > max(aw, bw) * 0.8:
                        continue
                    ax1, ay1 = min(ax1, bx1), min(ay1, by1)
                    ax2, ay2 = max(ax2, bx2), max(ay2, by2)
                    used[j] = True
                    changed = True
                used[i] = True
                result.append((ax1, ay1, ax2, ay2))
            boxes = result
        return boxes

    @staticmethod
    def _refine_boxes(
        bgr: np.ndarray, boxes: List[Tuple[int, int, int, int]]
    ) -> List[Tuple[int, int, int, int]]:
        """Recover clipped text columns using the ink component they belong to.

        PP-OCR occasionally returns only the top half of a long vertical column.
        A bounded projection/closing around the detected box lets us recover the
        complete glyph run without touching neighbouring bubbles or screentone.
        """

        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        h_img, w_img = gray.shape[:2]
        refined: List[Tuple[int, int, int, int]] = []

        for x1, y1, x2, y2 in boxes:
            bw, bh = x2 - x1, y2 - y1
            vertical = bh > bw * 1.15

            # Generous but bounded context window.
            if vertical:
                pad_x = max(6, int(round(bw * 0.5)))
                pad_y = max(10, int(round(bh * 0.9)))
            else:
                pad_x = max(10, int(round(bw * 0.5)))
                pad_y = max(6, int(round(bh * 0.6)))

            rx1 = max(0, x1 - pad_x)
            ry1 = max(0, y1 - pad_y)
            rx2 = min(w_img, x2 + pad_x)
            ry2 = min(h_img, y2 + pad_y)
            if rx2 - rx1 < 8 or ry2 - ry1 < 8:
                refined.append((x1, y1, x2, y2))
                continue

            patch = gray[ry1:ry2, rx1:rx2]
            dark = float(np.mean(patch < 128))
            light = float(np.mean(patch > 200))
            ink = (patch < 150 if dark >= light else patch > 175).astype(np.uint8)
            if not ink.any():
                refined.append((x1, y1, x2, y2))
                continue

            # Drop bubble / panel outlines that touch the context window border;
            # joining those with the text column would grow the box to the edge
            # of the image and later erase the bubble outline.
            n_ink, ink_labels, ink_stats, _ = cv2.connectedComponentsWithStats(
                ink, connectivity=8
            )
            border = set(ink_labels[0, :].tolist())
            border.update(ink_labels[-1, :].tolist())
            border.update(ink_labels[:, 0].tolist())
            border.update(ink_labels[:, -1].tolist())
            border.discard(0)
            for label in border:
                if ink_stats[label, cv2.CC_STAT_AREA] > 0.01 * ink.size:
                    ink[ink_labels == label] = 0
            if not ink.any():
                refined.append((x1, y1, x2, y2))
                continue

            kernel_len = max(5, min(80, int(round((bh if vertical else bw) * 0.45))) | 1)
            if vertical:
                kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, kernel_len))
            else:
                kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (kernel_len, 3))
            joined = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, kernel)

            # Pick the component that covers the detected box best.
            count, labels, stats, _ = cv2.connectedComponentsWithStats(
                joined, connectivity=8
            )
            bx1, by1 = max(0, x1 - rx1), max(0, y1 - ry1)
            bx2, by2 = min(rx2 - rx1, x2 - rx1), min(ry2 - ry1, y2 - ry1)
            if bx2 <= bx1 or by2 <= by1:
                refined.append((x1, y1, x2, y2))
                continue
            sub = labels[by1:by2, bx1:bx2]
            if sub.size == 0:
                refined.append((x1, y1, x2, y2))
                continue
            counts = np.bincount(sub.ravel(), minlength=count)
            counts[0] = 0
            label = int(np.argmax(counts))
            if label <= 0:
                refined.append((x1, y1, x2, y2))
                continue

            cx, cy, cw, ch, _area = stats[label]
            nx1, ny1 = rx1 + int(cx), ry1 + int(cy)
            nx2, ny2 = nx1 + int(cw), ny1 + int(ch)

            # Sanity gates: do not let a stray line-art component swallow the
            # bubble.  Union with the original box so antialiased pixels survive.
            if vertical:
                reasonable = (ny2 - ny1) >= bh * 0.8 and (ny2 - ny1) <= bh * 2.6
            else:
                reasonable = (nx2 - nx1) >= bw * 0.8 and (nx2 - nx1) <= bw * 2.6
            if not reasonable:
                refined.append((x1, y1, x2, y2))
                continue

            ux1, uy1 = min(x1, nx1), min(y1, ny1)
            ux2, uy2 = max(x2, nx2), max(y2, ny2)
            # Breathing room for ascenders / anti-aliasing.
            ux1, uy1 = max(0, ux1 - 2), max(0, uy1 - 2)
            ux2, uy2 = min(w_img, ux2 + 2), min(h_img, uy2 + 2)
            if ux2 - ux1 >= 6 and uy2 - uy1 >= 6:
                refined.append((ux1, uy1, ux2, uy2))
            else:
                refined.append((x1, y1, x2, y2))
        return refined

    @staticmethod
    def _separate_overlaps(
        boxes: List[Tuple[int, int, int, int]]
    ) -> List[Tuple[int, int, int, int]]:
        """Trim partially overlapping columns so crops do not bleed together."""

        result = [list(b) for b in boxes]
        for _ in range(2):
            for i in range(len(result)):
                if result[i][2] - result[i][0] < 6:
                    continue
                for j in range(i + 1, len(result)):
                    a, b = result[i], result[j]
                    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
                    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
                    if ix2 <= ix1 or iy2 <= iy1:
                        continue
                    aw, ah = a[2] - a[0], a[3] - a[1]
                    bw, bh = b[2] - b[0], b[3] - b[1]
                    overlap = (ix2 - ix1) * (iy2 - iy1)
                    if overlap / float(max(1, min(aw * ah, bw * bh))) < 0.12:
                        continue
                    a_vert = ah > aw * 1.15
                    b_vert = bh > bw * 1.15
                    if a_vert and b_vert and ix2 - ix1 < min(aw, bw) * 0.95:
                        mid = (ix1 + ix2) // 2
                        a_center = (a[0] + a[2]) // 2
                        b_center = (b[0] + b[2]) // 2
                        if a_center <= b_center:
                            a[2] = min(a[2], mid)
                            b[0] = max(b[0], mid)
                        else:
                            a[0] = max(a[0], mid)
                            b[2] = min(b[2], mid)
                    elif (not a_vert) and (not b_vert) and iy2 - iy1 < min(ah, bh) * 0.95:
                        mid = (iy1 + iy2) // 2
                        a_center = (a[1] + a[3]) // 2
                        b_center = (b[1] + b[3]) // 2
                        if a_center <= b_center:
                            a[3] = min(a[3], mid)
                            b[1] = max(b[1], mid)
                        else:
                            a[1] = max(a[1], mid)
                            b[3] = min(b[3], mid)
        cleaned: List[Tuple[int, int, int, int]] = []
        for x1, y1, x2, y2 in result:
            if x2 - x1 >= 6 and y2 - y1 >= 6:
                cleaned.append((int(x1), int(y1), int(x2), int(y2)))
        return cleaned

    # ------------------------------------------------------------- recognition
    def _recognise(
        self, bgr: np.ndarray, boxes: List[Tuple[int, int, int, int]]
    ) -> List[_Line]:
        if not boxes:
            return []

        crops: List[np.ndarray] = []
        directions: List[bool] = []
        for x1, y1, x2, y2 in boxes:
            crop = bgr[y1:y2, x1:x2]
            if crop.size == 0:
                continue
            bh, bw = crop.shape[:2]
            vertical = bh > bw * 1.15
            if vertical:
                # Rotate the column so the horizontal recognizer sees a line
                # read from left to right, top-to-bottom of the original.
                crop = cv2.rotate(crop, cv2.ROTATE_90_COUNTERCLOCKWISE)
            # Recognizers expect dark text on a light background.
            if float(np.mean(crop)) < 100:
                crop = cv2.bitwise_not(crop)
            crops.append(crop)
            directions.append(vertical)

        if not crops:
            return []

        try:
            results, _elapsed = self._recognizer(crops)
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("OCR recognition failed: %s", exc)
            return []

        lines: List[_Line] = []
        for box, vertical, (text, score) in zip(boxes, directions, results):
            cleaned = self._clean_text(text)
            if not cleaned:
                continue
            lines.append(
                _Line(
                    box=box,
                    vertical=vertical,
                    text=cleaned,
                    score=float(max(0.0, min(1.0, score))),
                )
            )
        return lines

    @staticmethod
    def _clean_text(text: str) -> str:
        if not text:
            return ""
        cleaned = str(text).replace("\n", " ").replace("\r", " ")
        cleaned = " ".join(cleaned.split())
        return cleaned.strip()

    @staticmethod
    def _is_noise(line: "_Line") -> bool:
        text = line.text.strip()
        if not text:
            return True
        if line.score < 0.28:
            return True
        # Single Latin glyphs are almost always detector bleed-through unless
        # they are very confident (e.g. a stylised "!" is punctuation, not a
        # letter, so it is unaffected).
        if len(text) == 1 and text.isascii() and text.isalpha() and line.score < 0.7:
            return True
        return False

    def _run_stock(self, bgr: np.ndarray) -> List[_Line]:
        if self._fallback is None:
            return []
        try:
            results, _elapsed = self._fallback(bgr)
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Stock RapidOCR inference failed: %s", exc)
            return []
        if not results:
            return []
        lines: List[_Line] = []
        for item in results:
            pts, text, score = item[0], item[1], item[2]
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            x1, y1 = int(min(xs)), int(min(ys))
            x2, y2 = int(max(xs)), int(max(ys))
            cleaned = self._clean_text(str(text))
            if not cleaned:
                continue
            lines.append(
                _Line(
                    box=(x1, y1, x2, y2),
                    vertical=(y2 - y1) > (x2 - x1) * 1.15,
                    text=cleaned,
                    score=float(score),
                )
            )
        return lines

    # ------------------------------------------------------------ reading order
    def _assign_reading_order(
        self, bgr: np.ndarray, lines: List[_Line], reading_direction: str
    ) -> None:
        if not lines:
            return
        labels, valid = self._bubble_labels(bgr)
        for line in lines:
            line.bubble = self._line_bubble_label(labels, valid, line.box)

        rtl = reading_direction != "ltr"
        groups: dict = {}
        for line in lines:
            key = line.bubble if line.bubble >= 0 else ("solo", line.box[1] // 90, line.box[0])
            groups.setdefault(key, []).append(line)

        def group_anchor(items: List[_Line]) -> Tuple[int, int, int]:
            top = min(item.box[1] for item in items)
            left = min(item.box[0] for item in items)
            right = max(item.box[2] for item in items)
            return (top // 90, -right if rtl else left, top)

        ordered_groups = sorted(groups.values(), key=group_anchor)
        order = 1
        for group in ordered_groups:
            vertical_votes = sum(1 for item in group if item.vertical)
            if vertical_votes * 2 >= len(group):
                group.sort(key=lambda item: ((-item.box[0]) if rtl else item.box[0], item.box[1]))
            else:
                group.sort(key=lambda item: (item.box[1], item.box[0] if not rtl else -item.box[0]))
            for item in group:
                item.rank = order  # type: ignore[attr-defined]
                order += 1

    @staticmethod
    def _bubble_labels(gray: np.ndarray) -> Tuple[np.ndarray, set]:
        if gray.ndim == 3:
            gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape[:2]
        white = (gray >= 205).astype(np.uint8)
        count, labels, stats, _centroids = cv2.connectedComponentsWithStats(
            white, connectivity=8
        )
        valid = set()
        for idx in range(1, count):
            x, y, bw, bh, area = stats[idx]
            if x <= 1 or y <= 1 or x + bw >= w - 1 or y + bh >= h - 1:
                continue
            if area < 400 or area > 0.3 * w * h:
                continue
            if bw < 12 or bh < 12:
                continue
            if area / float(max(1, bw * bh)) < 0.2:
                continue
            valid.add(idx)
        return labels, valid

    @staticmethod
    def _line_bubble_label(
        labels: np.ndarray, valid: set, box: Tuple[int, int, int, int]
    ) -> int:
        if not valid:
            return -1
        x1, y1, x2, y2 = box
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        points = [(cx, cy), (x1 + 2, y1 + 2), (x2 - 2, y1 + 2), (x1 + 2, y2 - 2), (x2 - 2, y2 - 2)]
        counts: dict = {}
        for px, py in points:
            px = max(0, min(labels.shape[1] - 1, px))
            py = max(0, min(labels.shape[0] - 1, py))
            label = int(labels[py, px])
            if label in valid:
                counts[label] = counts.get(label, 0) + 1
        if not counts:
            return -1
        return max(counts.items(), key=lambda item: item[1])[0]

    # ------------------------------------------------------------------ output
    @staticmethod
    def _to_regions(
        lines: List[_Line], reading_direction: str
    ) -> List[OCRRegionModel]:
        regions: List[OCRRegionModel] = []
        import uuid

        for line in sorted(lines, key=lambda item: getattr(item, "rank", 10**9)):
            x1, y1, x2, y2 = line.box
            direction = "vertical" if line.vertical else "horizontal"
            regions.append(
                OCRRegionModel(
                    id=str(uuid.uuid4()),
                    box=BoundingBoxModel(
                        x=float(x1),
                        y=float(y1),
                        width=float(x2 - x1),
                        height=float(y2 - y1),
                    ),
                    polygon=[
                        [float(x1), float(y1)],
                        [float(x2), float(y1)],
                        [float(x2), float(y2)],
                        [float(x1), float(y2)],
                    ],
                    text=line.text,
                    confidence=line.score,
                    reading_order=len(regions) + 1,
                    direction=direction,
                    language="ja" if (line.vertical or reading_direction != "ltr") else "en",
                )
            )
        return regions
