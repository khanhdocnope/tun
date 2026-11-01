"""
Manga Cleaner core (v3) - chat/SFX aware text removal.

Pipeline per page:
  1. RT-DETR region gate (ogkalu/comic-text-bubble-detector) -> chat vs SFX boxes. GPU.
  2. ONE ZeroGPU window runs the whole page: region detect (unless already done), the
     ComicTextDetector `seg` head and the LaMa inpainting crops. The old layout moved the
     detectors to CPU and paid ~40 s per page for `seg`.
  3. Low-resolution `seg` first: if every bubble sits on bright paper, flat-fill paints them
     with a solid colour and the full-resolution `seg` pass is skipped entirely.
  4. Bubble outlines are protected by the ink barrier in `mask_logic`; anything that is not
     flat paper goes through LaMa on small crops around the erased strokes.
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
    flat_paper_hint,
    preserve_white_balloons,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger("manga_cleaner.core")

try:
    import spaces

    HAS_ZEROGPU = True
except ImportError:
    HAS_ZEROGPU = False

    class _DummySpaces:
        def GPU(self, duration: int = 60):
            def deco(fn):
                return fn
            return deco

    spaces = _DummySpaces()

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
COMIC_ONNX_PATH = MODEL_DIR / "comictextdetector.pt.onnx"
ANIME_LAMA_PT_PATH = MODEL_DIR / "anime-manga-big-lama.pt"
BIG_LAMA_PT_PATH = MODEL_DIR / "big-lama.pt"

_LAMA_CPU_MODELS: Dict[str, Any] = {}


def _detect_cpu_threads() -> int:
    env_threads = os.getenv("CPU_THREADS")
    if env_threads:
        try:
            return max(1, int(env_threads))
        except ValueError:
            pass

    # Detect container cgroup CPU quota (HF Spaces, Docker, Kubernetes)
    # CFS quota = quota_us / period_us gives actual assigned vCPUs
    for q_path, p_path in [
        ("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", "/sys/fs/cgroup/cpu/cpu.cfs_period_us"),
        ("/sys/fs/cgroup/cpu.cfs_quota_us", "/sys/fs/cgroup/cpu.cfs_period_us"),
    ]:
        try:
            qp, pp = Path(q_path), Path(p_path)
            if qp.is_file() and pp.is_file():
                q = int(qp.read_text().strip())
                p = int(pp.read_text().strip())
                if q > 0 and p > 0:
                    return min(max(1, q // p), 4)
        except Exception:
            pass

    # cgroup v2: cpu.max has "quota period" (e.g. "200000 100000")
    for max_path in ["/sys/fs/cgroup/cpu.max", "/sys/fs/cgroup/cpu/cpu.max"]:
        try:
            mp = Path(max_path)
            if mp.is_file():
                parts = mp.read_text().strip().split()
                if len(parts) == 2 and parts[0] != "max":
                    return min(max(1, int(parts[0]) // int(parts[1])), 4)
        except Exception:
            pass

    try:
        if hasattr(os, "sched_getaffinity"):
            return max(1, min(len(os.sched_getaffinity(0)), 4))
    except Exception:
        pass

    return max(1, min(os.cpu_count() or 2, 4))


# ------------------------------------------------------------------ tuning knobs (env overridable)
CPU_THREADS = _detect_cpu_threads()
torch.set_num_threads(CPU_THREADS)
INPAINT_CTX_PX = int(os.getenv("INPAINT_CONTEXT_PX", "96"))       # context kept around every erased region (margin = 96px)
INPAINT_MOD = 32                                                  # pad crops to a multiple of 32 (fewer distinct shapes)
FULL_PAGE_RATIO = float(os.getenv("FULL_PAGE_RATIO", "0.35"))      # crops cover >= 35% of page
SEG_SIZE = int(os.getenv("SEG_SIZE", "1024"))                     # ComicTextDetector canvas (the ONNX graph is static at 1024)
SEG_LOW_SIZE = int(os.getenv("SEG_LOW_SIZE", "512"))              # resolution the paper gate reads strokes at
GPU_DURATION = int(os.getenv("GPU_DURATION", "30"))                # ZeroGPU window per page (seconds) - 30s single allocation
MAX_PAGE_DIM = 2048                                               # OOM Guard: max dimension before downscaling

# One page at a time: the detectors / LaMa are process-wide singletons and moving them
# between devices while another request is mid-flight corrupts results.
MODEL_LOCK = threading.Lock()


# ----------------------------------------------------------------------------- Multi-model Inpainting
def get_lama_model(model_name: str = "anime-lama"):
    global _LAMA_CPU_MODELS
    canonical = "big-lama" if "big" in model_name.lower() and "anime" not in model_name.lower() else "anime-lama"
    if canonical in _LAMA_CPU_MODELS and _LAMA_CPU_MODELS[canonical] is not None:
        return _LAMA_CPU_MODELS[canonical]

    path = BIG_LAMA_PT_PATH if canonical == "big-lama" else ANIME_LAMA_PT_PATH
    if not path.is_file():
        alt = BASE_DIR / "weights" / path.name
        path = alt if alt.is_file() else path
    if not path.is_file():
        from download_models import ensure_inpainter
        ensure_inpainter(canonical)
    if not path.is_file():
        # Fallback to alternate if primary missing
        alt = ANIME_LAMA_PT_PATH if canonical == "big-lama" else BIG_LAMA_PT_PATH
        if alt.is_file():
            path = alt
        else:
            raise FileNotFoundError(f"Inpainting model file not found: {canonical}")

    logger.info("Loading inpainting model: %s (%s)", canonical, path.name)
    loaded = torch.jit.load(str(path), map_location="cpu")
    loaded.eval()
    _LAMA_CPU_MODELS[canonical] = loaded
    return loaded


def _ceil_modulo(x: int, mod: int = 8) -> int:
    return x if x % mod == 0 else (x // mod + 1) * mod


def pad_img_to_modulo(img: np.ndarray, mod: int = 8) -> np.ndarray:
    if img.ndim == 2:
        img = img[:, :, np.newaxis]
    h, w = img.shape[:2]
    return np.pad(img, ((0, _ceil_modulo(h, mod) - h), (0, _ceil_modulo(w, mod) - w), (0, 0)), mode="symmetric")


def norm_img(a: np.ndarray) -> np.ndarray:
    if a.ndim == 2:
        a = a[:, :, np.newaxis]
    return np.transpose(a, (2, 0, 1)).astype("float32") / 255.0


def _cpu_lama_jobs(jobs: List[Tuple[np.ndarray, np.ndarray]], model_name: str) -> List[np.ndarray]:
    """CPU path for LaMa (no GPU available / ZeroGPU refused the job). Returns BGR crops."""
    model = get_lama_model(model_name)
    out: List[np.ndarray] = []
    try:
        with torch.inference_mode():
            for img, mask in jobs:
                ch, cw = mask.shape[:2]
                pi, pm = pad_img_to_modulo(img, INPAINT_MOD), pad_img_to_modulo(mask, INPAINT_MOD)
                img_t = torch.from_numpy(norm_img(pi)).unsqueeze(0)
                msk_t = torch.from_numpy((norm_img(pm) > 0).astype(np.float32)).unsqueeze(0)
                res = np.clip(model(img_t, msk_t)[0].permute(1, 2, 0).cpu().numpy() * 255.0, 0, 255)
                out.append(cv2.cvtColor(res.astype(np.uint8)[:ch, :cw], cv2.COLOR_RGB2BGR))
    finally:
        gc.collect()
    return out


# ------------------------------------------------------------------ region-based inpainting
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


def _plan_crops(mask: np.ndarray, ctx: int = 96, ds: int = 4, max_crop_dim: int = 512) -> List[Tuple[int, int, int, int]]:
    """
    Split the erase mask into compact local crops (x1, y1, x2, y2) with margin=96px,
    so LaMa only sees the areas that matter instead of the whole page.
    CPU LaMa only processes small slices around 256x256 or 512x512, avoiding choking on 4M pixel pages.
    """
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
        rects.append([max(0, int(x * fx)), max(0, int(y * fy)),
                      min(w, int(math.ceil((x + bw) * fx))), min(h, int(math.ceil((y + bh) * fy)))])
    rects = _merge_rects(rects)

    final_rects: List[Tuple[int, int, int, int]] = []
    for r in rects:
        rx1, ry1, rx2, ry2 = r
        rw = rx2 - rx1
        rh = ry2 - ry1
        if rw <= max_crop_dim and rh <= max_crop_dim:
            final_rects.append((rx1, ry1, rx2, ry2))
        else:
            # Subdivide large crops into manageable <= max_crop_dim crops
            x_steps = max(1, math.ceil(rw / max_crop_dim))
            y_steps = max(1, math.ceil(rh / max_crop_dim))
            step_w = rw // x_steps
            step_h = rh // y_steps
            for xi in range(x_steps):
                for yi in range(y_steps):
                    cx1 = rx1 + xi * step_w
                    cy1 = ry1 + yi * step_h
                    cx2 = rx1 + (xi + 1) * step_w if xi < x_steps - 1 else rx2
                    cy2 = ry1 + (yi + 1) * step_h if yi < y_steps - 1 else ry2
                    if mask[cy1:cy2, cx1:cx2].any():
                        cx1_p = max(0, cx1 - ctx // 2)
                        cy1_p = max(0, cy1 - ctx // 2)
                        cx2_p = min(w, cx2 + ctx // 2)
                        cy2_p = min(h, cy2 + ctx // 2)
                        final_rects.append((cx1_p, cy1_p, cx2_p, cy2_p))

    if not final_rects:
        ys, xs = np.where(mask > 0)
        if len(xs) > 0:
            bx1 = max(0, int(xs.min()) - ctx)
            by1 = max(0, int(ys.min()) - ctx)
            bx2 = min(w, int(xs.max()) + ctx + 1)
            by2 = min(h, int(ys.max()) + ctx + 1)
            final_rects = [(bx1, by1, bx2, by2)]
        else:
            return []

    final_rects.sort(key=lambda r: (r[1], r[0]))
    return final_rects


def _lama_crop(model, img_rgb: np.ndarray, mask: np.ndarray, dev: str) -> np.ndarray:
    ch, cw = mask.shape[:2]
    pi, pm = pad_img_to_modulo(img_rgb, INPAINT_MOD), pad_img_to_modulo(mask, INPAINT_MOD)
    img_t = torch.from_numpy(norm_img(pi)).unsqueeze(0).to(dev)
    msk_t = torch.from_numpy((norm_img(pm) > 0).astype(np.float32)).unsqueeze(0).to(dev)
    with torch.inference_mode():
        out = model(img_t, msk_t)
    res = np.clip(out[0].float().permute(1, 2, 0).cpu().numpy() * 255.0, 0, 255).astype(np.uint8)[:ch, :cw]
    return cv2.cvtColor(res, cv2.COLOR_RGB2BGR)


def _cpu_classical_jobs(jobs: List[Tuple[np.ndarray, np.ndarray]], model_name: str) -> List[np.ndarray]:
    flag = cv2.INPAINT_TELEA if "telea" in model_name.lower() else cv2.INPAINT_NS
    return [cv2.inpaint(cv2.cvtColor(im, cv2.COLOR_RGB2BGR), mk, inpaintRadius=3, flags=flag) for im, mk in jobs]


# ---------------------------------------------------------------- bubble detector (shared instances)
_BUBBLE = BubbleTextDetector()


def _gpu_device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


# ------------------------------------------------------------------ CTD: seg head
class ComicTextDetectorEngine:
    """ComicTextDetector used ONLY for its pixel-level `seg` head (character strokes)."""

    def __init__(self, model_path: Path = COMIC_ONNX_PATH):
        self.model_path = Path(model_path)
        self.net = None
        self.session = None
        self.ready = False
        self._input_name = None
        self._output_names = None

        if not self.model_path.is_file():
            alt = BASE_DIR / "weights" / "comic-text-detector.onnx"
            if alt.is_file():
                self.model_path = alt
        if not self.model_path.is_file():
            from download_models import ensure_models
            ensure_models()
        if not self.model_path.is_file():
            return
        # ONNX Runtime is usually much faster than cv2.dnn on CPU when threads are properly tuned
        try:
            import onnxruntime as ort

            so = ort.SessionOptions()
            so.add_session_config_entry("session.set_denormal_as_zero", "1")
            so.intra_op_num_threads = min(8, os.cpu_count() or 8)
            so.inter_op_num_threads = 1
            so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            so.enable_cpu_mem_arena = True
            so.enable_mem_pattern = True

            self.session = ort.InferenceSession(str(self.model_path), sess_options=so, providers=["CPUExecutionProvider"])
            self._input_name = self.session.get_inputs()[0].name
            all_out = [o.name for o in self.session.get_outputs()]
            needed = [name for name in all_out if "blk" not in name.lower()]
            self._output_names = needed if needed else None

            self.ready = True
            logger.info("ComicTextDetector (seg) ready: ONNX Runtime, %d threads", CPU_THREADS)
            return
        except Exception as exc:  # noqa: BLE001
            logger.warning("ONNX Runtime unavailable (%s) -> cv2.dnn fallback", exc)
        try:
            self.net = cv2.dnn.readNetFromONNX(str(self.model_path))
            self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
            self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
            self.ready = True
        except Exception as exc:  # noqa: BLE001
            logger.warning("ComicTextDetector init failed: %s", exc)

    def _forward(self, im: np.ndarray, size: int) -> np.ndarray:
        """Raw seg/det probabilities for a padded `im` (1, 3, size, size), squeezed to size x size."""
        if self.session is not None:
            blob = np.ascontiguousarray(im.transpose(2, 0, 1)[None], dtype=np.float32)
            blob *= (1.0 / 255.0)
            in_name = self._input_name or self.session.get_inputs()[0].name
            outputs = self.session.run(self._output_names, {in_name: blob})
        else:
            self.net.setInput(cv2.dnn.blobFromImage(im, 1.0 / 255.0, (size, size), swapRB=False, crop=False))
            outputs = self.net.forward(self.net.getUnconnectedOutLayersNames())
        seg_prob = None
        det_prob = None
        for out in outputs:
            if out.ndim == 4 and out.shape[1] == 1:
                seg_prob = out[0, 0]
            elif out.ndim == 4 and out.shape[1] == 2:
                det_prob = out[0, 0]
        if seg_prob is not None and det_prob is not None:
            return np.maximum(seg_prob, det_prob)
        if seg_prob is not None:
            return seg_prob
        if det_prob is not None:
            return det_prob
        return np.zeros((size, size), np.float32)

    def _require_size(self, size: int) -> int:
        """
        The ONNX graph exported from `comictextdetector.pt.onnx` has a STATIC input size
        (1024x1024) - feeding 512 raises "Got: 512 Expected: 1024". Reading the fixed size from
        the session keeps the cheap 512px gate working only where the graph allows it.
        """
        if self.session is None:
            return size
        try:
            shape = self.session.get_inputs()[0].shape
            fixed = int(shape[-1])
            if fixed != size:
                logger.debug("ComicTextDetector input is fixed at %d, requested %d", fixed, size)
            return fixed
        except (TypeError, ValueError, IndexError):
            return size

    def seg_map(self, img_bgr: np.ndarray, size: int = SEG_SIZE) -> np.ndarray:
        h, w = img_bgr.shape[:2]
        if not self.ready:
            return np.zeros((h, w), np.float32)
        size = self._require_size(size)
        r = min(size / h, size / w)
        nw, nh = max(1, int(round(w * r))), max(1, int(round(h * r)))
        im = cv2.resize(img_bgr, (nw, nh), interpolation=cv2.INTER_AREA if r < 1 else cv2.INTER_LINEAR)
        im = cv2.copyMakeBorder(im, 0, size - nh, 0, size - nw, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        comb = self._forward(im, size)
        return cv2.resize(comb[:nh, :nw], (w, h), interpolation=cv2.INTER_LINEAR)

    def seg_strokes(self, img_bgr: np.ndarray, dets: List[Det]) -> np.ndarray:
        """
        Boolean stroke map at LOW resolution, restricted to the detector boxes.

        This is the cheap paper gate: the graph needs one 1024 pass (its input is static), so we
        feed a downscaled copy of the page into that same canvas and read strokes back at the
        low resolution - the result is ~10x smaller to process, while the model still sees only
        one page, exactly like the full-resolution path.
        """
        if not self.ready or not dets:
            return np.zeros(img_bgr.shape[:2], np.bool_)
        h, w = img_bgr.shape[:2]
        canvas = self._require_size(SEG_SIZE)          # 1024 for the exported static graph
        size = min(int(SEG_LOW_SIZE), canvas)
        r = min(size / h, size / w)
        nw, nh = max(1, int(round(w * r))), max(1, int(round(h * r)))
        im = cv2.resize(img_bgr, (nw, nh), interpolation=cv2.INTER_AREA)
        im = cv2.copyMakeBorder(im, 0, canvas - nh, 0, canvas - nw, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        seg = self._forward(im, canvas)[:nh, :nw]
        ok = seg > 0.5
        mask = np.zeros((nh, nw), np.bool_)
        for d in dets:
            x1, y1 = max(0, int(d.box[0] * r)), max(0, int(d.box[1] * r))
            x2, y2 = min(nw, int(math.ceil(d.box[2] * r))), min(nh, int(math.ceil(d.box[3] * r)))
            if x2 > x1 and y2 > y1:
                mask[y1:y2, x1:x2] = ok[y1:y2, x1:x2]
        return mask

    @property
    def device(self) -> str:
        return "cpu"


def _asan_report(exc: BaseException) -> Tuple[str, Optional[int]]:
    """
    ONNX Runtime rarely says WHY it aborted. With `ORT_LOG_SEVERITY_LEVEL=verbose` an abort
    message mentions the offending address, e.g. "WRITE of size 4 at 0x... thread T0" - mapping
    that address into /proc/self/maps tells us whether the writer was torch/CUDA, OpenCV or ORT
    itself, which is otherwise guesswork.
    """
    text = f"{type(exc).__name__}: {exc}"
    import re

    m = re.search(r"at 0x([0-9a-fA-F]+)", text)
    if not m:
        return text, None
    addr = int(m.group(1), 16)
    try:
        with open("/proc/self/maps", "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) < 6:
                    continue
                start, end = (int(x, 16) for x in parts[0].split("-"))
                if start <= addr < end:
                    return f"{text} | 0x{addr:x} is inside {parts[-1]}", addr
    except Exception:  # noqa: BLE001
        pass
    return text, addr


def _assert_model_depth(model, expected: str) -> None:
    """Catch a silently CPU-bound model: this is what made `seg` cost ~40 s per page."""
    try:
        param = next(model.parameters())
    except (StopIteration, AttributeError):
        return
    actual = str(param.device)
    if expected.startswith("cuda") and not actual.startswith("cuda"):
        raise RuntimeError(f"model is on {actual}, expected {expected}")


# ------------------------------------------------------------- one ZeroGPU window = one page
def _clean_page_core(
    img_rgb: np.ndarray,
    clean_sfx: bool,
    dilation_px: int,
    det_threshold: float,
    inpaint_model: str,
    min_box_size: int,
    bubble_threshold: float,
    dev: str,
    text_backend: str,
    text_det_engine: Any,
) -> Tuple[np.ndarray, MaskSet, Dict[str, Any], str, int, np.ndarray]:
    """
    Core pipeline: Detection (GPU) + Seg/Mask (CPU) + 0.1ms White Balloon Flat-Fill + LaMa Inpaint (GPU/CPU).
    """
    h, w = img_rgb.shape[:2]
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    timings: Dict[str, Any] = {"detect": 0.0, "seg": 0.0, "masks": 0.0, "flat_fill": 0.0, "inpaint": 0.0}

    # 1. Bubble detection
    _t_det = time.perf_counter()
    if dev.startswith("cuda"):
        _BUBBLE.model.to(dev)
        _assert_model_depth(_BUBBLE.model, dev)
        dets = _BUBBLE.predict_boxes(img_rgb, dev, bubble_threshold)
        _BUBBLE.model.cpu()
    else:
        dets = _BUBBLE.detect(img_rgb, "cpu", bubble_threshold)
    timings["detect"] = round((time.perf_counter() - _t_det) * 1000.0, 2)

    empty_ms = MaskSet(
        np.zeros((h, w), np.uint8), np.zeros((h, w), np.uint8),
        np.zeros((h, w), np.uint8), np.zeros((h, w), np.uint8),
        np.zeros((h, w), np.uint8), [], []
    )

    if not any(d.cls in (CLS_TEXT_BUBBLE, CLS_TEXT_FREE) for d in dets):
        return img_rgb, empty_ms, timings, "No text detected", 0, np.zeros((h, w), np.uint8)

    # 2. Text segmentation & mask generation
    _t_seg = time.perf_counter()
    if text_backend == "manga_det":
        try:
            polys, seg_full = text_det_engine.detect(img_bgr)
        except Exception as exc:  # noqa: BLE001
            text, addr = _asan_report(exc)
            logger.error("manga_det pass failed: %s", text)
            return img_rgb, empty_ms, timings, f"seg failed: {text}", 0, np.zeros((h, w), np.uint8)

        timings["seg"] = round((time.perf_counter() - _t_seg) * 1000.0, 2)
        _t_mask = time.perf_counter()
        ms = build_masks_from_polygons(
            img_bgr=img_bgr,
            polygons=polys,
            dets=dets,
            seg_map=seg_full,
            dilation_px=int(dilation_px),
            min_box_size=int(min_box_size),
        )
    else:
        try:
            strokes = text_det_engine.seg_strokes(img_bgr, dets)
            seg_full = text_det_engine.seg_map(img_bgr)
        except Exception as exc:  # noqa: BLE001
            text, addr = _asan_report(exc)
            logger.error("seg pass failed: %s", text)
            return img_rgb, empty_ms, timings, f"seg failed: {text}", 0, np.zeros((h, w), np.uint8)

        timings["seg"] = round((time.perf_counter() - _t_seg) * 1000.0, 2)
        _t_mask = time.perf_counter()
        ms = build_masks(img_bgr, seg_full, dets, seg_thr=float(det_threshold), dilation_px=int(dilation_px))

    timings["masks"] = round((time.perf_counter() - _t_mask) * 1000.0, 2)
    target = cv2.bitwise_or(ms.chat_erase, ms.sfx_erase) if clean_sfx else ms.chat_erase

    if not target.any():
        return img_rgb, ms, timings, "No text detected", 0, np.zeros((h, w), np.uint8)

    # 3. Preserve White Balloons in 0.1ms (BulganRdn algorithm)
    # Identifies standard pure white balloons (median >= 242) and flat-fills them instantly,
    # stripping them from remaining_target so LaMa never has to inpaint them!
    _t_flat = time.perf_counter()
    filled_bgr, remaining_target, n_flat = preserve_white_balloons(
        img_bgr, target, luminance_threshold=242.0, ring_radius=9
    )
    flat_done_mask = cv2.bitwise_and(target, cv2.bitwise_not(remaining_target))
    timings["flat_fill"] = round((time.perf_counter() - _t_flat) * 1000.0, 2)
    out_rgb = cv2.cvtColor(filled_bgr, cv2.COLOR_BGR2RGB)

    # 4. Inpainting on remaining target mask (only for non-flat regions!)
    _t_inp = time.perf_counter()
    tag = "none"
    if remaining_target.any():
        rects = _plan_crops(remaining_target, ctx=96)
        jobs = [(np.ascontiguousarray(out_rgb[y1:y2, x1:x2]), np.ascontiguousarray(remaining_target[y1:y2, x1:x2]))
                for (x1, y1, x2, y2) in rects]

        low = inpaint_model.lower()
        if "telea" in low or "ns" in low:
            results = _cpu_classical_jobs(jobs, inpaint_model)
            tag = "OpenCV Telea (CPU)" if "telea" in low else "OpenCV Navier-Stokes (CPU)"
        elif dev.startswith("cuda"):
            model = get_lama_model(inpaint_model).to(dev)
            try:
                results = [_lama_crop(model, im, mk, dev) for im, mk in jobs]
            finally:
                model.cpu()
            tag = f"{inpaint_model} (ZeroGPU)"
        else:
            results = _cpu_lama_jobs(jobs, inpaint_model)
            tag = f"{inpaint_model} (CPU)"

        out_bgr_final = cv2.cvtColor(out_rgb, cv2.COLOR_RGB2BGR)
        for (x1, y1, x2, y2), res in zip(rects, results):
            sel = remaining_target[y1:y2, x1:x2] > 0
            out_bgr_final[y1:y2, x1:x2][sel] = res[sel]
        final_rgb = cv2.cvtColor(out_bgr_final, cv2.COLOR_BGR2RGB)
    else:
        final_rgb = out_rgb
        tag = f"flat-fill-only ({n_flat} white balloons preserved in 0.1ms)"

    timings["inpaint"] = round((time.perf_counter() - _t_inp) * 1000.0, 2)
    return final_rgb, ms, timings, tag, n_flat, flat_done_mask


def _gpu_page_job(
    img_rgb: np.ndarray,
    clean_sfx: bool,
    dilation_px: int,
    det_threshold: float,
    inpaint_model: str,
    min_box_size: int,
    bubble_threshold: float,
    text_backend: str,
    text_det_engine: Any,
) -> Tuple[np.ndarray, MaskSet, Dict[str, Any], str, int, np.ndarray]:
    """
    Entire page pipeline executed in ONE single ZeroGPU window:
    RT-DETR Detection -> Text Segmentation -> White Balloon Flat-Fill -> LaMa Inpaint.
    Guarantees quota preservation and thorough VRAM cleanup in finally block.
    """
    dev = _gpu_device()
    try:
        return _clean_page_core(
            img_rgb=img_rgb,
            clean_sfx=clean_sfx,
            dilation_px=dilation_px,
            det_threshold=det_threshold,
            inpaint_model=inpaint_model,
            min_box_size=min_box_size,
            bubble_threshold=bubble_threshold,
            dev=dev,
            text_backend=text_backend,
            text_det_engine=text_det_engine,
        )
    finally:
        if dev != "cpu" and torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
        gc.collect()


def _cpu_page_job(
    img_rgb: np.ndarray,
    clean_sfx: bool,
    dilation_px: int,
    det_threshold: float,
    inpaint_model: str,
    min_box_size: int,
    bubble_threshold: float,
    text_backend: str,
    text_det_engine: Any,
) -> Tuple[np.ndarray, MaskSet, Dict[str, Any], str, int, np.ndarray]:
    """Pure CPU pipeline using DAZ SIMD acceleration and local crop inpainting."""
    try:
        return _clean_page_core(
            img_rgb=img_rgb,
            clean_sfx=clean_sfx,
            dilation_px=dilation_px,
            det_threshold=det_threshold,
            inpaint_model=inpaint_model,
            min_box_size=min_box_size,
            bubble_threshold=bubble_threshold,
            dev="cpu",
            text_backend=text_backend,
            text_det_engine=text_det_engine,
        )
    finally:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
        gc.collect()



def _gpu_lama_only(jobs: List[Tuple[np.ndarray, np.ndarray]], model_name: str) -> List[np.ndarray]:
    """LaMa only (manual brush / known-region path). No detector call, no wasted GPU seconds."""
    dev = _gpu_device()
    model = get_lama_model(model_name).to(dev)
    try:
        return [_lama_crop(model, im, mk, dev) for im, mk in jobs]
    finally:
        model.cpu()
        if dev != "cpu" and torch.cuda.is_available():
            torch.cuda.empty_cache()
        gc.collect()


# ----------------------------------------------------------------------------- pipeline
class MangaCleanerPipeline:
    def __init__(self):
        self.text_backend = os.getenv("TEXT_DET_BACKEND", "manga_det").lower()
        if self.text_backend == "manga_det":
            from text_detector import MangaTextDetector
            self.text_det = MangaTextDetector()
            self.ctd = self.text_det  # alias for backward-compatibility (.ready, .seg_map)
        else:
            self.ctd = ComicTextDetectorEngine()
            self.text_det = self.ctd
        self.bubbles = _BUBBLE
        self.bubbles.load()

    @property
    def detector(self):
        """Kept for app.py (/health uses `.ready`)."""
        return self

    @property
    def ready(self) -> bool:
        return bool(self.ctd.ready and self.bubbles.ready)

    # -- helpers
    def _plan_jobs(self, img_rgb: np.ndarray, mask: np.ndarray) -> Tuple[List[Tuple[int, int, int, int]], List[Tuple[np.ndarray, np.ndarray]]]:
        rects = _plan_crops(mask)
        jobs = [(np.ascontiguousarray(img_rgb[y1:y2, x1:x2]), np.ascontiguousarray(mask[y1:y2, x1:x2]))
                for (x1, y1, x2, y2) in rects]
        return rects, jobs

    def _paste(self, img_rgb: np.ndarray, mask: np.ndarray, rects: List[Tuple[int, int, int, int]],
               results: List[np.ndarray]) -> np.ndarray:
        out = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
        for (x1, y1, x2, y2), res in zip(rects, results):
            sel = mask[y1:y2, x1:x2] > 0
            out[y1:y2, x1:x2][sel] = res[sel]
        return out

    def _inpaint_only(self, img_rgb: np.ndarray, mask: np.ndarray, force_cpu: bool,
                      model_name: str) -> Tuple[np.ndarray, str, int]:
        """Inpaint a known `mask` (manual brush). Never calls the region detector."""
        rects, jobs = self._plan_jobs(img_rgb, mask)
        low = model_name.lower()
        if not jobs:
            return cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR), "none", 0

        if "telea" in low or "ns" in low:
            results = _cpu_classical_jobs(jobs, model_name)
            tag = "OpenCV Telea (CPU)" if "telea" in low else "OpenCV Navier-Stokes (CPU)"
        elif force_cpu or not HAS_ZEROGPU:
            results = _cpu_lama_jobs(jobs, model_name)
            tag = f"{model_name} (CPU)"
        else:
            try:
                results = _gpu_lama_only(jobs, model_name)
                tag = f"{model_name} (ZeroGPU)"
            except Exception as exc:  # noqa: BLE001
                logger.warning("ZeroGPU LaMa failed (%s), CPU fallback", exc)
                results = _cpu_lama_jobs(jobs, model_name)
                tag = f"{model_name} (CPU fallback)"
        return self._paste(img_rgb, mask, rects, results), tag, len(rects)

    @staticmethod
    def _color_mask(ms: Optional[MaskSet], h: int, w: int) -> np.ndarray:
        cm = np.zeros((h, w, 3), np.uint8)
        if ms is None:
            return cm
        cm[ms.chat_text > 0] = (0, 255, 0)   # green = Chat
        cm[ms.sfx_text > 0] = (255, 0, 0)    # red   = SFX
        return cm

    # -- main entry
    def clean_image(
        self,
        image_input: Image.Image | np.ndarray,
        clean_sfx: bool = False,
        dilation_px: int = 4,
        det_threshold: float = 0.30,
        force_cpu: bool = False,
        user_mask: Optional[np.ndarray | Image.Image] = None,
        bubble_threshold: float = 0.30,
        inpaint_model: str = "anime-lama",
        min_box_size: int = 0,
    ) -> Tuple[Image.Image, Image.Image, Dict[str, Any]]:
        """Clean one page. Thread-safe: the whole call is serialised (models are shared)."""
        with MODEL_LOCK:
            return self._clean_locked(image_input, clean_sfx, dilation_px, det_threshold, force_cpu,
                                      user_mask, bubble_threshold, inpaint_model, min_box_size)

    def _clean_locked(self, image_input, clean_sfx, dilation_px, det_threshold, force_cpu,
                      user_mask, bubble_threshold, inpaint_model, min_box_size: int = 0):
        _t_total = time.perf_counter()

        # ---- decode input
        _t0 = time.perf_counter()
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
        orig_h, orig_w = img_rgb.shape[:2]
        _decode_ms = (time.perf_counter() - _t0) * 1000.0

        # ---- OOM Guard: Downscale if longest dimension exceeds 2048px
        max_dim = max(orig_h, orig_w)
        if max_dim > MAX_PAGE_DIM:
            scale = float(MAX_PAGE_DIM) / float(max_dim)
            proc_w = int(round(orig_w * scale))
            proc_h = int(round(orig_h * scale))
            img_rgb_proc = cv2.resize(img_rgb, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
            downscaled = True
            logger.info("OOM Guard triggered: downscaled from %dx%d to %dx%d for inpainting", orig_w, orig_h, proc_w, proc_h)
        else:
            img_rgb_proc = img_rgb
            proc_w, proc_h = orig_w, orig_h
            downscaled = False

        try:
            # ---- manual brush mode: user mask replaces detection entirely
            if user_mask is not None:
                um = np.array(user_mask.convert("L")) if isinstance(user_mask, Image.Image) else np.asarray(user_mask)
                um = ((um > 0).astype(np.uint8)) * 255
                if um.shape[:2] != (orig_h, orig_w):
                    um = cv2.resize(um, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)
                if dilation_px > 0:
                    k = max(3, int(dilation_px) * 2 + 1)
                    um = cv2.dilate(um, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
                if not um.any():
                    return img_pil, Image.fromarray(np.zeros((orig_h, orig_w, 3), np.uint8)), {"status": "Empty mask", "inpaint_model": inpaint_model}

                # Scale user mask if downscaled
                um_proc = cv2.resize(um, (proc_w, proc_h), interpolation=cv2.INTER_NEAREST) if downscaled else um

                _t_inp = time.perf_counter()
                out_proc, tag, n_reg = self._inpaint_only(img_rgb_proc, um_proc, force_cpu, inpaint_model)
                _inpaint_ms = (time.perf_counter() - _t_inp) * 1000.0
                _total_ms = (time.perf_counter() - _t_total) * 1000.0

                if downscaled:
                    out_up = cv2.resize(out_proc, (orig_w, orig_h), interpolation=cv2.INTER_LANCZOS4)
                    final_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
                    final_bgr[um > 0] = out_up[um > 0]
                else:
                    final_bgr = out_proc

                return (Image.fromarray(cv2.cvtColor(final_bgr, cv2.COLOR_BGR2RGB)),
                        Image.fromarray(np.stack([np.zeros_like(um), um, np.zeros_like(um)], -1)),
                        {"engine": tag, "mode": "Manual brush", "inpaint_model": inpaint_model, "inpaint_regions": n_reg,
                         "timings_ms": {"decode": round(_decode_ms, 2), "inpaint": round(_inpaint_ms, 2),
                                        "total": round(_total_ms, 2), "regions": n_reg, "engine": tag}})

            # ---- auto mode
            if not self.bubbles.ready:
                stats = {"mode": "Xóa cả Chat & SFX" if clean_sfx else "Chỉ xóa Chat (giữ SFX)", "chat_count": 0,
                         "sfx_count": 0, "clean_sfx": clean_sfx, "dilation_px": dilation_px,
                         "inpaint_model": inpaint_model, "width": orig_w, "height": orig_h,
                         "status": "Bubble detector unavailable", "error": self.bubbles.error}
                return img_pil, Image.fromarray(np.zeros((orig_h, orig_w, 3), np.uint8)), stats

            gpu_used = False
            # ONE ZeroGPU window runs the whole page pipeline in a single allocation!
            if not force_cpu and HAS_ZEROGPU:
                try:
                    final_proc_rgb, ms, pipe_timings, tag, n_flat, flat_done = _gpu_page_job(
                        img_rgb=img_rgb_proc,
                        clean_sfx=clean_sfx,
                        dilation_px=dilation_px,
                        det_threshold=det_threshold,
                        inpaint_model=inpaint_model,
                        min_box_size=min_box_size,
                        bubble_threshold=bubble_threshold,
                        text_backend=self.text_backend,
                        text_det_engine=self.text_det,
                    )
                    gpu_used = True
                except Exception as exc:  # noqa: BLE001
                    logger.warning("ZeroGPU page execution failed (%s), CPU fallback", exc)
                    final_proc_rgb, ms, pipe_timings, tag, n_flat, flat_done = _cpu_page_job(
                        img_rgb=img_rgb_proc,
                        clean_sfx=clean_sfx,
                        dilation_px=dilation_px,
                        det_threshold=det_threshold,
                        inpaint_model=inpaint_model,
                        min_box_size=min_box_size,
                        bubble_threshold=bubble_threshold,
                        text_backend=self.text_backend,
                        text_det_engine=self.text_det,
                    )
                    tag += " (CPU fallback)"
            else:
                final_proc_rgb, ms, pipe_timings, tag, n_flat, flat_done = _cpu_page_job(
                    img_rgb=img_rgb_proc,
                    clean_sfx=clean_sfx,
                    dilation_px=dilation_px,
                    det_threshold=det_threshold,
                    inpaint_model=inpaint_model,
                    min_box_size=min_box_size,
                    bubble_threshold=bubble_threshold,
                    text_backend=self.text_backend,
                    text_det_engine=self.text_det,
                )

            # Upscale and composite back if downscaled
            target_proc = cv2.bitwise_or(ms.chat_erase, ms.sfx_erase) if clean_sfx else ms.chat_erase
            if downscaled:
                if target_proc.any():
                    target_up = cv2.resize(target_proc, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)
                    final_up = cv2.resize(final_proc_rgb, (orig_w, orig_h), interpolation=cv2.INTER_LANCZOS4)
                    final_rgb = img_rgb.copy()
                    final_rgb[target_up > 0] = final_up[target_up > 0]
                else:
                    final_rgb = img_rgb.copy()

                cm_proc = self._color_mask(ms, proc_h, proc_w)
                color_mask_arr = cv2.resize(cm_proc, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)
                color_mask = Image.fromarray(color_mask_arr)
            else:
                final_rgb = final_proc_rgb
                color_mask = Image.fromarray(self._color_mask(ms, orig_h, orig_w))

            timings: Dict[str, Any] = {
                "decode": round(_decode_ms, 2),
                "detect": pipe_timings.get("detect", 0.0),
                "seg": pipe_timings.get("seg", 0.0),
                "masks": pipe_timings.get("masks", 0.0),
                "flat_fill": pipe_timings.get("flat_fill", 0.0),
                "inpaint": pipe_timings.get("inpaint", 0.0),
                "total": round((time.perf_counter() - _t_total) * 1000.0, 2),
            }

            stats = self._stats(
                clean_sfx, dilation_px, inpaint_model, orig_w, orig_h,
                len(ms.chat_boxes), len(ms.sfx_boxes), timings, None, tag,
            )
            stats["flat_filled_count"] = n_flat
            stats["flat_filled_px"] = int(np.count_nonzero(flat_done))
            stats["downscaled"] = downscaled
            stats["device"] = "gpu" if gpu_used else "cpu"

            return Image.fromarray(final_rgb), color_mask, stats

        finally:
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
            gc.collect()

    @staticmethod
    def _stats(clean_sfx, dilation_px, inpaint_model, w, h, n_chat, n_sfx, timings, status, engine):
        stats: Dict[str, Any] = {
            "mode": "Xóa cả Chat & SFX" if clean_sfx else "Chỉ xóa Chat (giữ SFX)",
            "chat_count": int(n_chat),
            "sfx_count": int(n_sfx),
            "clean_sfx": bool(clean_sfx),
            "dilation_px": dilation_px,
            "inpaint_model": inpaint_model,
            "width": int(w),
            "height": int(h),
            "engine": engine,
            "timings_ms": timings,
        }
        if status:
            stats["status"] = status
        return stats


def rect_all(h: int, w: int, boxes) -> np.ndarray:
    m = np.zeros((h, w), np.uint8)
    for x1, y1, x2, y2 in boxes:
        m[max(0, int(y1)):min(h, int(y2) + 1), max(0, int(x1)):min(w, int(x2) + 1)] = 255
    return m


_PIPELINE: Optional[MangaCleanerPipeline] = None
_PIPELINE_LOCK = threading.Lock()


class _LazyPipeline:
    """Proxy so `from manga_cleaner import cleaner_pipeline` still works without loading models."""

    def __init__(self):
        self._obj: Optional[MangaCleanerPipeline] = None

    def _get(self) -> MangaCleanerPipeline:
        if self._obj is None:
            self._obj = get_pipeline()
        return self._obj

    def __getattr__(self, item):
        return getattr(self._get(), item)

    @property
    def ready(self) -> bool:
        return self._get().ready


def get_pipeline() -> MangaCleanerPipeline:
    """Lazy singleton: importing this module must not download/load models."""
    global _PIPELINE
    if _PIPELINE is None:
        with _PIPELINE_LOCK:
            if _PIPELINE is None:
                _PIPELINE = MangaCleanerPipeline()
    return _PIPELINE


# Backwards-compatible attribute used by app.py / bench_clean.py.
cleaner_pipeline = _LazyPipeline()
