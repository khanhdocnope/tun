"""
text_detector.py - Ultra-fast text detector for Manga & Webtoon.
Powered by Kellenok/PP-OCRv6_manga (DBNet fine-tuned on Manga109-s + AnimeText).
Runs on CPU via ONNX Runtime in ~100-350ms, replacing the 31-second ComicTextDetector.
"""

from __future__ import annotations

import logging
import math
import os
import urllib.request
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger("manga_cleaner.text_detector")

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"

MANGA_DET_FP32 = MODEL_DIR / "manga_det_v0.2.onnx"
MANGA_DET_FP16 = MODEL_DIR / "manga_det_v0.2_fp16.onnx"

MANGA_DET_URLS = [
    "https://huggingface.co/Kellenok/PP-OCRv6_manga/resolve/main/det/manga_det_v0.2.onnx",
    "https://hf-mirror.com/Kellenok/PP-OCRv6_manga/resolve/main/det/manga_det_v0.2.onnx",
    "https://huggingface.co/Kellenok/PP-OCRv6_manga/resolve/main/det/manga_det_v0.2_fp16.onnx",
    "https://hf-mirror.com/Kellenok/PP-OCRv6_manga/resolve/main/det/manga_det_v0.2_fp16.onnx",
]

CPU_THREADS = int(os.getenv("CPU_THREADS", "4"))


def _download_file(urls: List[str], dest: Path, min_bytes: int = 500_000) -> bool:
    """Resilient single-file download with fallback mirrors and atomic rename."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file() and dest.stat().st_size >= min_bytes:
        return True

    tmp_path = dest.with_suffix(".tmp")
    for url in urls:
        try:
            logger.info("Downloading %s from %s ...", dest.name, url)
            req = urllib.request.Request(url, headers={"User-Agent": "MangaCleaner/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp, open(tmp_path, "wb") as out_f:
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    out_f.write(chunk)
            if tmp_path.is_file() and tmp_path.stat().st_size >= min_bytes:
                if dest.is_file():
                    dest.unlink()
                tmp_path.rename(dest)
                logger.info("Downloaded %s (%d KB)", dest.name, dest.stat().st_size // 1024)
                return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Download failed for %s (%s): %s", dest.name, url, exc)
            if tmp_path.is_file():
                try:
                    tmp_path.unlink()
                except Exception:
                    pass
    return False


def ensure_manga_det_model() -> Path:
    """Ensure at least one manga_det model exists locally, downloading if necessary."""
    if MANGA_DET_FP32.is_file() and MANGA_DET_FP32.stat().st_size >= 1_000_000:
        return MANGA_DET_FP32
    if MANGA_DET_FP16.is_file() and MANGA_DET_FP16.stat().st_size >= 500_000:
        return MANGA_DET_FP16

    # Attempt downloading FP32 (fastest & most compatible on CPU)
    if _download_file(MANGA_DET_URLS[:2], MANGA_DET_FP32, min_bytes=1_000_000):
        return MANGA_DET_FP32
    # Fallback to FP16
    if _download_file(MANGA_DET_URLS[2:], MANGA_DET_FP16, min_bytes=500_000):
        return MANGA_DET_FP16

    raise FileNotFoundError("Could not find or download manga_det ONNX model")


def box_score_fast(pred: np.ndarray, box: np.ndarray) -> float:
    """Compute mean confidence of the prediction map inside polygon `box`."""
    h, w = pred.shape[:2]
    b = box.copy().astype(np.int32)
    xmin = int(np.clip(np.floor(b[:, 0].min()), 0, w - 1))
    xmax = int(np.clip(np.ceil(b[:, 0].max()), 0, w - 1))
    ymin = int(np.clip(np.floor(b[:, 1].min()), 0, h - 1))
    ymax = int(np.clip(np.ceil(b[:, 1].max()), 0, h - 1))
    if xmax <= xmin or ymax <= ymin:
        return 0.0
    score_mask = np.zeros((ymax - ymin + 1, xmax - xmin + 1), dtype=np.uint8)
    b[:, 0] -= xmin
    b[:, 1] -= ymin
    cv2.fillPoly(score_mask, [b.reshape(-1, 2)], 1)
    return float(cv2.mean(pred[ymin:ymax + 1, xmin:xmax + 1], score_mask)[0])


def unclip(box: np.ndarray, unclip_ratio: float = 1.4) -> Optional[np.ndarray]:
    """
    PaddleOCR / DBNet unclip: expands contour by a constant offset proportional to area/perimeter.
    Compensates for DB binarization kernel shrinkage.
    """
    try:
        import pyclipper
    except ImportError:
        logger.warning("pyclipper not installed, unclip polygon disabled")
        return box

    x, y = box[:, 0], box[:, 1]
    area = 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
    perimeter = np.linalg.norm(np.roll(box, -1, axis=0) - box, axis=1).sum()
    if area <= 0 or perimeter <= 0:
        return None

    offset = pyclipper.PyclipperOffset()
    offset.AddPath(box.tolist(), pyclipper.JT_ROUND, pyclipper.ET_CLOSEDPOLYGON)
    paths = offset.Execute(area * unclip_ratio / perimeter)
    return np.asarray(paths[0], dtype=np.float32) if len(paths) == 1 else None


class MangaTextDetector:
    """
    Ultra-fast Manga Text Detector using PP-OCRv6_manga via ONNX Runtime on CPU.
    Drop-in replacement for ComicTextDetectorEngine, reducing seg time from ~31s to ~0.3s.
    """

    def __init__(self, model_path: Optional[Path] = None, cpu_threads: int = CPU_THREADS):
        self.session = None
        self.ready = False
        self._input_name = None
        self._output_name = None

        target_path = Path(model_path) if model_path else None
        if target_path is None or not target_path.is_file():
            try:
                target_path = ensure_manga_det_model()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Could not locate or download manga_det: %s", exc)
                return

        self.model_path = target_path
        try:
            import onnxruntime as ort

            so = ort.SessionOptions()
            so.intra_op_num_threads = cpu_threads
            so.inter_op_num_threads = 1
            so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            so.enable_cpu_mem_arena = True
            so.enable_mem_pattern = True

            self.session = ort.InferenceSession(str(self.model_path), sess_options=so, providers=["CPUExecutionProvider"])
            self._input_name = self.session.get_inputs()[0].name
            self._output_name = self.session.get_outputs()[0].name
            self.ready = True
            logger.info("MangaTextDetector ready: %s (%d threads)", self.model_path.name, cpu_threads)
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to initialize MangaTextDetector ORT session: %s", exc)

    def detect(
        self,
        img_bgr: np.ndarray,
        thresh: float = 0.15,
        box_thresh: float = 0.25,
        unclip_ratio: float = 1.4,
    ) -> Tuple[List[np.ndarray], np.ndarray]:
        """
        Detect text lines in page image.
        Returns:
            boxes: List of 4-point rotated bounding boxes [[x1, y1], [x2, y2], [x3, y3], [x4, y4]] in page coords.
            pred_full: Full-resolution text probability heatmap [H, W] in float32 [0.0, 1.0].
        """
        h, w = img_bgr.shape[:2]
        if not self.ready:
            return [], np.zeros((h, w), np.float32)

        # Dynamic ratio rule: webtoon strips vs standard page
        if max(h, w) / min(h, w) > 2.0:
            ratio = min(1.0, (0.75 * 960.0 * 960.0 / (h * w)) ** 0.5)
        else:
            ratio = 960.0 / max(h, w)

        rh = max(int(round(h * ratio / 32) * 32), 32)
        rw = max(int(round(w * ratio / 32) * 32), 32)

        inp = cv2.resize(img_bgr, (rw, rh)).astype(np.float32) / 255.0
        inp = (inp - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array([0.229, 0.224, 0.225], dtype=np.float32)
        blob = inp.transpose((2, 0, 1))[np.newaxis, ...]

        outputs = self.session.run([self._output_name], {self._input_name: blob})
        pred_map = outputs[0][0, 0]  # shape [rh, rw]
        pred_full = cv2.resize(pred_map, (w, h), interpolation=cv2.INTER_LINEAR)

        # DB post-processing
        mask = (pred_map > thresh)
        contours, _ = cv2.findContours((mask * 255).astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        boxes: List[np.ndarray] = []

        for cnt in contours:
            pts = cnt.squeeze(1)
            if pts.ndim != 2 or pts.shape[0] < 4:
                continue
            if box_score_fast(pred_map, pts) < box_thresh:
                continue
            unclipped = unclip(pts, unclip_ratio)
            if unclipped is None or len(unclipped) < 3:
                continue
            poly = unclipped.astype(np.float32)
            poly[:, 0] = np.clip(np.round(poly[:, 0] / rw * w), 0, w)
            poly[:, 1] = np.clip(np.round(poly[:, 1] / rh * h), 0, h)
            boxes.append(poly)

        return boxes, pred_full

    def seg_map(self, img_bgr: np.ndarray) -> np.ndarray:
        """Drop-in replacement for ComicTextDetectorEngine.seg_map: returns full-page probability map."""
        _boxes, pred_full = self.detect(img_bgr)
        return pred_full

    def seg_strokes(self, img_bgr: np.ndarray, dets: Sequence[Any]) -> np.ndarray:
        """Boolean stroke map for fast paper-gate checks."""
        h, w = img_bgr.shape[:2]
        _boxes, pred_full = self.detect(img_bgr)
        strokes = (pred_full > 0.20)
        return strokes

    @property
    def device(self) -> str:
        return "cpu"
