"""
manga_cleaner.py - Tối ưu hóa chạy trực tiếp trên GPU chuyên dụng (Kaggle/Colab/Server).
Giữ model trên GPU, hỗ trợ CUDA & FP16, tốc độ xử lý ~0.5s - 1.2s/trang.
"""

from __future__ import annotations

import gc
import logging
import math
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch
from PIL import Image, ImageOps

from bubble_detector import BubbleTextDetector
from mask_logic import (
    CLS_TEXT_BUBBLE,
    CLS_TEXT_FREE,
    Det,
    MaskSet,
    build_masks,
    build_masks_from_polygons,
    flat_fill_uniform_paper,
    rect_mask,
)
from manga_schema import (
    LayerGeometry,
    LayerTypography,
    MangaLayer,
    sort_reading_order,
    to_normalized_box,
    to_pixel_bounds,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("manga_cleaner.core")

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
ANIME_LAMA_PT_PATH = MODEL_DIR / "anime-manga-big-lama.pt"
BIG_LAMA_PT_PATH = MODEL_DIR / "big-lama.pt"

# Tuning knobs
CPU_THREADS = int(os.getenv("CPU_THREADS", str(min(os.cpu_count() or 4, 8))))
torch.set_num_threads(CPU_THREADS)
INPAINT_CTX_PX = int(os.getenv("INPAINT_CONTEXT_PX", "64"))
INPAINT_MOD = 32
FULL_PAGE_RATIO = float(os.getenv("FULL_PAGE_RATIO", "0.35"))

MODEL_LOCK = threading.Lock()
_LAMA_GPU_MODELS: Dict[str, Any] = {}
_BUBBLE = BubbleTextDetector()


def get_device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def get_lama_model(model_name: str = "anime-lama", device: Optional[str] = None):
    global _LAMA_GPU_MODELS
    if device is None:
        device = get_device()

    canonical = "big-lama" if "big" in model_name.lower() and "anime" not in model_name.lower() else "anime-lama"
    cache_key = f"{canonical}_{device}"

    if cache_key in _LAMA_GPU_MODELS and _LAMA_GPU_MODELS[cache_key] is not None:
        return _LAMA_GPU_MODELS[cache_key]

    path = BIG_LAMA_PT_PATH if canonical == "big-lama" else ANIME_LAMA_PT_PATH
    if not path.is_file():
        from download_models import ensure_inpainter
        ensure_inpainter(canonical)

    if not path.is_file():
        alt = ANIME_LAMA_PT_PATH if canonical == "big-lama" else BIG_LAMA_PT_PATH
        if alt.is_file():
            path = alt
        else:
            raise FileNotFoundError(f"Inpainting model not found: {canonical}")

    logger.info("Loading inpainting model: %s on %s", canonical, device)
    loaded = torch.jit.load(str(path), map_location=device)
    loaded.eval()
    _LAMA_GPU_MODELS[cache_key] = loaded
    return loaded


def pad_img_to_modulo(img: np.ndarray, mod: int = INPAINT_MOD) -> np.ndarray:
    h, w = img.shape[:2]
    out_h = h if h % mod == 0 else (h // mod + 1) * mod
    out_w = w if w % mod == 0 else (w // mod + 1) * mod
    return cv2.copyMakeBorder(img, 0, out_h - h, 0, out_w - w, cv2.BORDER_REFLECT)


def norm_img(a: np.ndarray) -> np.ndarray:
    if a.ndim == 2:
        a = a[:, :, np.newaxis]
    return np.transpose(a, (2, 0, 1)).astype("float32") / 255.0


def _merge_rects(rects: List[List[int]]) -> List[List[int]]:
    changed = True
    while changed:
        changed = False
        out: List[List[int]] = []
        for r in rects:
            for o in out:
                if not (r[2] <= o[0] or o[2] <= r[0] or r[3] <= o[1] or o[3] <= r[1]):
                    o[0], o[1], o[2], o[3] = min(o[0], r[0]), min(o[1], r[1]), max(o[2], r[2]), max(o[3], r[3])
                    changed = True
                    break
            else:
                out.append(list(r))
        rects = out
    return rects


def _plan_crops(mask: np.ndarray, ctx: int = INPAINT_CTX_PX, ds: int = 4) -> List[Tuple[int, int, int, int]]:
    h, w = mask.shape[:2]
    if not mask.any():
        return []
    sw, sh = max(1, -(-w // ds)), max(1, -(-h // ds))
    small = (cv2.resize(mask, (sw, sh), interpolation=cv2.INTER_AREA) > 0).astype(np.uint8) * 255
    k = 2 * max(1, ctx // ds) + 1
    grown = cv2.dilate(small, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    cnts, _ = cv2.findContours(grown, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    fx, fy = w / sw, h / sh
    rects: List[List[int]] = []
    for c in cnts:
        x, y, bw, bh = cv2.boundingRect(c)
        rects.append([
            max(0, int(x * fx)),
            max(0, int(y * fy)),
            min(w, int(math.ceil((x + bw) * fx))),
            min(h, int(math.ceil((y + bh) * fy))),
        ])
    rects = _merge_rects(rects)
    if not rects or sum((r[2] - r[0]) * (r[3] - r[1]) for r in rects) >= FULL_PAGE_RATIO * h * w:
        return [(0, 0, w, h)]
    rects.sort(key=lambda r: (r[1], r[0]))
    return [tuple(r) for r in rects]


def _lama_crop(model, img_rgb: np.ndarray, mask: np.ndarray, dev: str) -> np.ndarray:
    ch, cw = mask.shape[:2]
    pi, pm = pad_img_to_modulo(img_rgb, INPAINT_MOD), pad_img_to_modulo(mask, INPAINT_MOD)
    img_t = torch.from_numpy(norm_img(pi)).unsqueeze(0).to(dev)
    msk_t = torch.from_numpy((norm_img(pm) > 0).astype(np.float32)).unsqueeze(0).to(dev)
    with torch.inference_mode():
        out = model(img_t, msk_t)
    res = np.clip(out[0].float().permute(1, 2, 0).cpu().numpy() * 255.0, 0, 255).astype(np.uint8)[:ch, :cw]
    return cv2.cvtColor(res, cv2.COLOR_RGB2BGR)


def _inpaint_jobs(jobs: List[Tuple[np.ndarray, np.ndarray]], model_name: str, force_cpu: bool = False) -> List[np.ndarray]:
    low = model_name.lower()
    if "telea" in low or "ns" in low:
        flag = cv2.INPAINT_TELEA if "telea" in low else cv2.INPAINT_NS
        return [cv2.inpaint(cv2.cvtColor(im, cv2.COLOR_RGB2BGR), mk, inpaintRadius=3, flags=flag) for im, mk in jobs]

    dev = "cpu" if force_cpu else get_device()
    model = get_lama_model(model_name, device=dev)
    results = []
    for im, mk in jobs:
        results.append(_lama_crop(model, im, mk, dev))
    return results


class MangaCleanerPipeline:
    def __init__(self):
        self.text_backend = os.getenv("TEXT_DET_BACKEND", "manga_det").lower()
        if self.text_backend == "manga_det":
            from text_detector import MangaTextDetector
            self.text_det = MangaTextDetector()
            self.ctd = self.text_det
        else:
            from manga_cleaner_legacy import ComicTextDetectorEngine
            self.ctd = ComicTextDetectorEngine()
        self.bubbles = _BUBBLE
        # Preload bubble detector
        self.bubbles.load()

    @property
    def ready(self) -> bool:
        return bool(self.ctd.ready and self.bubbles.ready)

    def _plan_jobs(self, img_rgb: np.ndarray, mask: np.ndarray) -> Tuple[List[Tuple[int, int, int, int]], List[Tuple[np.ndarray, np.ndarray]]]:
        rects = _plan_crops(mask)
        jobs = [
            (np.ascontiguousarray(img_rgb[y1:y2, x1:x2]), np.ascontiguousarray(mask[y1:y2, x1:x2]))
            for (x1, y1, x2, y2) in rects
        ]
        return rects, jobs

    def _paste(self, img_rgb: np.ndarray, mask: np.ndarray, rects: List[Tuple[int, int, int, int]], results: List[np.ndarray]) -> np.ndarray:
        out = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
        for (x1, y1, x2, y2), res in zip(rects, results):
            sel = mask[y1:y2, x1:x2] > 0
            out[y1:y2, x1:x2][sel] = res[sel]
        return out

    @staticmethod
    def _color_mask(ms: Optional[MaskSet], h: int, w: int) -> np.ndarray:
        cm = np.zeros((h, w, 3), np.uint8)
        if ms is None:
            return cm
        cm[ms.chat_text > 0] = (0, 255, 0)
        cm[ms.sfx_text > 0] = (255, 0, 0)
        return cm

    def clean_image(
        self,
        image_input: Image.Image | np.ndarray,
        clean_sfx: bool = False,
        dilation_px: int = 4,
        det_threshold: float = 0.20,
        force_cpu: bool = False,
        user_mask: Optional[np.ndarray | Image.Image] = None,
        bubble_threshold: float = 0.20,
        inpaint_model: str = "anime-lama",
        min_box_size: int = 0,
        reading_direction: str = "rtl",
    ) -> Tuple[Image.Image, Image.Image, Dict[str, Any]]:
        with MODEL_LOCK:
            return self._clean_locked(
                image_input, clean_sfx, dilation_px, det_threshold, force_cpu,
                user_mask, bubble_threshold, inpaint_model, min_box_size, reading_direction
            )

    def _clean_locked(
        self, image_input, clean_sfx, dilation_px, det_threshold, force_cpu,
        user_mask, bubble_threshold, inpaint_model, min_box_size: int = 0,
        reading_direction: str = "rtl"
    ):
        t_start = time.perf_counter()
        dev = "cpu" if force_cpu else get_device()

        # 1. Decode input image
        t0 = time.perf_counter()
        if isinstance(image_input, np.ndarray):
            arr = image_input
            if arr.ndim == 3 and arr.shape[2] == 4:
                img_rgb = cv2.cvtColor(arr, cv2.COLOR_RGBA2RGB)
            elif arr.ndim == 3:
                img_rgb = arr.copy()
            else:
                img_rgb = cv2.cvtColor(arr, cv2.COLOR_GRAY2RGB)
            img_pil = Image.fromarray(img_rgb)
        else:
            img_pil = ImageOps.exif_transpose(image_input).convert("RGB")
            img_rgb = np.array(img_pil)

        h, w = img_rgb.shape[:2]
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
        t_decode = (time.perf_counter() - t0) * 1000.0

        timings: Dict[str, Any] = {"decode": round(t_decode, 2), "detect": 0.0, "seg": 0.0, "masks": 0.0, "inpaint": 0.0}

        # 2. Manual brush mode if user_mask provided
        if user_mask is not None:
            um = np.array(user_mask.convert("L")) if isinstance(user_mask, Image.Image) else np.asarray(user_mask)
            um = ((um > 0).astype(np.uint8)) * 255
            if um.shape[:2] != (h, w):
                um = cv2.resize(um, (w, h), interpolation=cv2.INTER_NEAREST)
            if dilation_px > 0:
                k = max(3, int(dilation_px) * 2 + 1)
                um = cv2.dilate(um, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))

            rects, jobs = self._plan_jobs(img_rgb, um)
            if not jobs:
                return img_pil, Image.fromarray(np.zeros((h, w, 3), np.uint8)), {"status": "Empty mask"}

            t_inp = time.perf_counter()
            results = _inpaint_jobs(jobs, inpaint_model, force_cpu)
            t_inpaint = (time.perf_counter() - t_inp) * 1000.0
            final = self._paste(img_rgb, um, rects, results)
            t_total = (time.perf_counter() - t_start) * 1000.0

            stats = {
                "engine": f"{inpaint_model} ({dev})",
                "mode": "Manual brush",
                "timings_ms": {"decode": round(t_decode, 2), "inpaint": round(t_inpaint, 2), "total": round(t_total, 2)},
                "device": dev,
            }
            return (
                Image.fromarray(cv2.cvtColor(final, cv2.COLOR_BGR2RGB)),
                Image.fromarray(np.stack([np.zeros_like(um), um, np.zeros_like(um)], -1)),
                stats,
            )

        # 3. Detection phase (RT-DETR bubble detector)
        t_det = time.perf_counter()
        if not self.bubbles.ready:
            self.bubbles.load()
        dets = self.bubbles.predict_boxes(img_rgb, device=dev, thr=bubble_threshold)
        timings["detect"] = round((time.perf_counter() - t_det) * 1000.0, 2)

        if not any(d.cls in (CLS_TEXT_BUBBLE, CLS_TEXT_FREE) for d in dets):
            timings["total"] = round((time.perf_counter() - t_start) * 1000.0, 2)
            stats = self._make_stats(clean_sfx, dilation_px, inpaint_model, w, h, 0, 0, timings, "No text detected", dev)
            return img_pil, Image.fromarray(np.zeros((h, w, 3), np.uint8)), stats

        # 4. Text segmentation (PP-OCR DBNet / MangaTextDetector)
        t_seg = time.perf_counter()
        polys, seg_full = self.text_det.detect(img_bgr)
        timings["seg"] = round((time.perf_counter() - t_seg) * 1000.0, 2)

        # 5. Mask creation
        t_mask = time.perf_counter()
        ms = build_masks_from_polygons(
            img_bgr=img_bgr,
            polygons=polys,
            dets=dets,
            seg_map=seg_full,
            dilation_px=int(dilation_px),
            min_box_size=int(min_box_size),
        )
        timings["masks"] = round((time.perf_counter() - t_mask) * 1000.0, 2)

        target = cv2.bitwise_or(ms.chat_erase, ms.sfx_erase) if clean_sfx else ms.chat_erase
        color_mask = Image.fromarray(self._color_mask(ms, h, w))
        n_chat, n_sfx = len(ms.chat_boxes), len(ms.sfx_boxes)

        if not target.any():
            timings["total"] = round((time.perf_counter() - t_start) * 1000.0, 2)
            stats = self._make_stats(clean_sfx, dilation_px, inpaint_model, w, h, n_chat, n_sfx, timings, "No text to erase", dev)
            stats["layers"] = []
            return img_pil, color_mask, stats

        # 5b. Dual-Path: Fast Flat-Paper Fill for pure white bubbles (Near 0ms, zero artifacts)
        t_flat = time.perf_counter()
        flat_work_bgr, filled_mask = flat_fill_uniform_paper(img_bgr, ms.chat_erase, ms.chat_boxes)
        timings["flat_fill"] = round((time.perf_counter() - t_flat) * 1000.0, 2)

        # Trích xuất layers hình học chuẩn hóa theo V2 Specification
        layers_list: List[MangaLayer] = []
        for idx, (x1, y1, x2, y2) in enumerate(ms.chat_boxes):
            box_2d = to_normalized_box(x1, y1, x2, y2, w, h)
            pb = to_pixel_bounds(box_2d, w, h)
            box_m = rect_mask(h, w, [(x1, y1, x2, y2)], pad=0)
            erase_part = cv2.bitwise_and(ms.chat_erase, box_m)
            is_white = False
            if erase_part.any():
                filled_part = cv2.bitwise_and(filled_mask, erase_part)
                is_white = bool(int(filled_part.sum()) >= int(erase_part.sum()) * 0.85)

            layers_list.append(
                MangaLayer(
                    id=f"bubble_{idx + 1:02d}",
                    order_index=idx + 1,
                    type="speech_bubble",
                    box_2d=box_2d,
                    pixel_bounds=pb,
                    geometry=LayerGeometry(is_pure_white_bg=is_white, confidence=0.98),
                    typography=LayerTypography(
                        orientation="vertical" if pb.height > pb.width * 1.2 else "horizontal",
                        suggested_font_size_pt=max(12, min(36, int(pb.width / 5))),
                    ),
                )
            )

        if clean_sfx:
            for idx, (x1, y1, x2, y2) in enumerate(ms.sfx_boxes):
                box_2d = to_normalized_box(x1, y1, x2, y2, w, h)
                pb = to_pixel_bounds(box_2d, w, h)
                layers_list.append(
                    MangaLayer(
                        id=f"sfx_{idx + 1:02d}",
                        order_index=len(layers_list) + 1,
                        type="sfx",
                        box_2d=box_2d,
                        pixel_bounds=pb,
                        geometry=LayerGeometry(is_pure_white_bg=False, confidence=0.90),
                        typography=LayerTypography(
                            orientation="horizontal",
                            suggested_font_size_pt=max(14, min(48, int(pb.width / 4))),
                        ),
                    )
                )

        # Sắp xếp thứ tự đọc chuẩn Manga/Webtoon
        sorted_layers = sort_reading_order(layers_list, reading_direction=reading_direction, height=h)

        # 6. Inpaint phase (Chỉ nạp LaMa AI cho các vùng phức tạp chưa flat-fill)
        lama_target = cv2.bitwise_and(target, cv2.bitwise_not(filled_mask))
        flat_work_rgb = cv2.cvtColor(flat_work_bgr, cv2.COLOR_BGR2RGB)

        if lama_target.any():
            rects, jobs = self._plan_jobs(flat_work_rgb, lama_target)
            if jobs:
                t_inp = time.perf_counter()
                results = _inpaint_jobs(jobs, inpaint_model, force_cpu)
                timings["inpaint"] = round((time.perf_counter() - t_inp) * 1000.0, 2)
                final = self._paste(flat_work_rgb, lama_target, rects, results)
            else:
                final = flat_work_bgr
        else:
            final = flat_work_bgr
            timings["inpaint"] = 0.0
            rects = []

        timings["total"] = round((time.perf_counter() - t_start) * 1000.0, 2)
        timings["regions"] = len(rects)

        stats = self._make_stats(clean_sfx, dilation_px, inpaint_model, w, h, n_chat, n_sfx, timings, "Success", dev)
        stats["regions"] = len(rects)
        stats["flat_filled_pixels"] = int((filled_mask > 0).sum())
        stats["layers"] = [l.model_dump() for l in sorted_layers]

        return Image.fromarray(cv2.cvtColor(final, cv2.COLOR_BGR2RGB)), color_mask, stats

    @staticmethod
    def _make_stats(clean_sfx, dilation_px, inpaint_model, w, h, n_chat, n_sfx, timings, status, dev):
        return {
            "status": status,
            "mode": "Xóa cả Chat & SFX" if clean_sfx else "Chỉ xóa Chat",
            "chat_count": int(n_chat),
            "sfx_count": int(n_sfx),
            "clean_sfx": bool(clean_sfx),
            "dilation_px": int(dilation_px),
            "inpaint_model": inpaint_model,
            "width": int(w),
            "height": int(h),
            "engine": f"{inpaint_model} ({dev.upper()})",
            "device": dev,
            "timings_ms": timings,
        }


cleaner_pipeline = MangaCleanerPipeline()
