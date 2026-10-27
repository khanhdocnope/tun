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
INPAINT_CTX_PX = int(os.getenv("INPAINT_CONTEXT_PX", "64"))       # context kept around every erased region
INPAINT_MOD = 32                                                  # pad crops to a multiple of 32 (fewer distinct shapes)
FULL_PAGE_RATIO = float(os.getenv("FULL_PAGE_RATIO", "0.35"))      # crops cover >= 35% of page -> just do the page
SEG_SIZE = int(os.getenv("SEG_SIZE", "1024"))                     # ComicTextDetector canvas (the ONNX graph is static at 1024)
SEG_LOW_SIZE = int(os.getenv("SEG_LOW_SIZE", "512"))              # resolution the paper gate reads strokes at
GPU_DURATION = int(os.getenv("GPU_DURATION", "8"))                # ZeroGPU window per page (seconds) - optimized to save quota

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


def _plan_crops(mask: np.ndarray, ctx: int = INPAINT_CTX_PX, ds: int = 4) -> List[Tuple[int, int, int, int]]:
    """
    Split the erase mask into a few rectangles (x1, y1, x2, y2), each with >= ctx px of context,
    so LaMa only sees the areas that matter instead of the whole page. Works on a 1/ds mask: cheap
    even for 10000px webtoon strips. Falls back to the whole page when crops would cover most of it.
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
    if not rects or sum((r[2] - r[0]) * (r[3] - r[1]) for r in rects) >= FULL_PAGE_RATIO * h * w:
        return [(0, 0, w, h)]
    rects.sort(key=lambda r: (r[1], r[0]))
    return [tuple(r) for r in rects]  # type: ignore[misc]


def _lama_crop(model, img_rgb: np.ndarray, mask: np.ndarray, dev: str) -> np.ndarray:
    ch, cw = mask.shape[:2]
    pi, pm = pad_img_to_modulo(img_rgb, INPAINT_MOD), pad_img_to_modulo(mask, INPAINT_MOD)
    img_t = torch.from_numpy(norm_img(pi)).unsqueeze(0).to(dev)
    msk_t = torch.from_numpy((norm_img(pm) > 0).astype(np.float32)).unsqueeze(0).to(dev)
    with torch.inference_mode():
        out = model(img_t, msk_t)
    res = np.clip(out[0].permute(1, 2, 0).cpu().numpy() * 255.0, 0, 255).astype(np.uint8)[:ch, :cw]
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
            so.intra_op_num_threads = CPU_THREADS
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
@spaces.GPU(duration=GPU_DURATION)
def _gpu_page_job(
    img_rgb: np.ndarray,
    jobs: List[Tuple[np.ndarray, np.ndarray]],
    model_name: str,
    bubble_thr: float,
) -> Tuple[List[np.ndarray], List[Det], Dict[str, Any]]:
    """
    Everything a page needs from the GPU, in ONE allocation:
      - region detection (RT-DETR `ogkalu/comic-text-bubble-detector`),
      - LaMa inpainting for the crops planned from those boxes.

    Models stay on the device for the whole call and go back to CPU at the end (ZeroGPU is a
    single-GPU tenant), so the per-stage `.to()` round-trips of the old code disappear.
    Crop planning needs the boxes, hence detection must run here, before the inpaint jobs.
    """
    dev = _gpu_device()
    dets: List[Det] = []
    lama_out: List[np.ndarray] = []
    meta: Dict[str, Any] = {"device": dev}

    try:
        _BUBBLE.model.to(dev)
        _assert_model_depth(_BUBBLE.model, dev)
        dets = _BUBBLE.predict_boxes(img_rgb, dev, bubble_thr)
        _BUBBLE.model.cpu()

        if jobs:
            model = get_lama_model(model_name).to(dev)
            try:
                lama_out = [_lama_crop(model, im, mk, dev) for im, mk in jobs]
            finally:
                model.cpu()
    finally:
        if dev != "cpu" and torch.cuda.is_available():
            torch.cuda.empty_cache()
        gc.collect()
    return lama_out, dets, meta


@spaces.GPU(duration=GPU_DURATION)
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
    ) -> Tuple[Image.Image, Image.Image, Dict[str, Any]]:
        """Clean one page. Thread-safe: the whole call is serialised (models are shared)."""
        with MODEL_LOCK:
            return self._clean_locked(image_input, clean_sfx, dilation_px, det_threshold, force_cpu,
                                      user_mask, bubble_threshold, inpaint_model)

    def _clean_locked(self, image_input, clean_sfx, dilation_px, det_threshold, force_cpu,
                      user_mask, bubble_threshold, inpaint_model):
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
        h, w = img_rgb.shape[:2]
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
        _decode_ms = (time.perf_counter() - _t0) * 1000.0

        # ---- manual brush mode: user mask replaces detection entirely
        if user_mask is not None:
            um = np.array(user_mask.convert("L")) if isinstance(user_mask, Image.Image) else np.asarray(user_mask)
            um = ((um > 0).astype(np.uint8)) * 255
            if um.shape[:2] != (h, w):
                um = cv2.resize(um, (w, h), interpolation=cv2.INTER_NEAREST)
            if dilation_px > 0:
                k = max(3, int(dilation_px) * 2 + 1)
                um = cv2.dilate(um, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
            if not um.any():
                return img_pil, Image.fromarray(np.zeros((h, w, 3), np.uint8)), {"status": "Empty mask", "inpaint_model": inpaint_model}
            _t_inp = time.perf_counter()
            out, tag, n_reg = self._inpaint_only(img_rgb, um, force_cpu, inpaint_model)
            _inpaint_ms = (time.perf_counter() - _t_inp) * 1000.0
            _total_ms = (time.perf_counter() - _t_total) * 1000.0
            return (Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB)),
                    Image.fromarray(np.stack([np.zeros_like(um), um, np.zeros_like(um)], -1)),
                    {"engine": tag, "mode": "Manual brush", "inpaint_model": inpaint_model, "inpaint_regions": n_reg,
                     "timings_ms": {"decode": round(_decode_ms, 2), "inpaint": round(_inpaint_ms, 2),
                                    "total": round(_total_ms, 2), "regions": n_reg, "engine": tag}})

        # ---- auto mode
        if not self.bubbles.ready:
            stats = {"mode": "Xóa cả Chat & SFX" if clean_sfx else "Chỉ xóa Chat (giữ SFX)", "chat_count": 0,
                     "sfx_count": 0, "clean_sfx": clean_sfx, "dilation_px": dilation_px,
                     "inpaint_model": inpaint_model, "width": w, "height": h,
                     "status": "Bubble detector unavailable", "error": self.bubbles.error}
            return img_pil, Image.fromarray(np.zeros((h, w, 3), np.uint8)), stats

        timings: Dict[str, Any] = {"decode": round(_decode_ms, 2), "detect": 0.0, "seg": 0.0,
                                   "masks": 0.0, "inpaint": 0.0}
        tag = "none"
        gpu_used = False

        # ONE GPU window per page: region detection and the LaMa crops run back to back, and
        # crop planning needs the boxes, so both happen inside `_gpu_page_job`.
        dets: List[Det] = []
        lama_jobs: List[Tuple[np.ndarray, np.ndarray]] = []
        used_gpu_window = False

        _t_det = time.perf_counter()
        if not force_cpu and HAS_ZEROGPU:
            try:
                lama_jobs, dets, _ = _gpu_page_job(img_rgb, [], "anime-lama", bubble_threshold)
                used_gpu_window = True
            except Exception as exc:  # noqa: BLE001
                logger.warning("ZeroGPU detect failed (%s), CPU fallback", exc)
        if not used_gpu_window:
            dets = self.bubbles.detect(img_rgb, "cpu", bubble_threshold)
        timings["detect"] = round((time.perf_counter() - _t_det) * 1000.0, 2)

        if not any(d.cls in (CLS_TEXT_BUBBLE, CLS_TEXT_FREE) for d in dets):
            stats = self._stats(clean_sfx, dilation_px, inpaint_model, w, h, 0, 0, timings, "No text detected", "none")
            timings["total"] = round((time.perf_counter() - _t_total) * 1000.0, 2)
            return img_pil, Image.fromarray(np.zeros((h, w, 3), np.uint8)), stats

        # Text segmentation & mask generation
        _t_seg = time.perf_counter()
        color_mask = Image.fromarray(np.zeros((h, w, 3), np.uint8))
        n_chat = sum(1 for d in dets if d.cls == CLS_TEXT_BUBBLE)
        n_sfx = sum(1 for d in dets if d.cls == CLS_TEXT_FREE)
        flat_done = np.zeros((h, w), np.uint8)
        out_rgb = img_rgb

        if self.text_backend == "manga_det":
            try:
                polys, seg_full = self.text_det.detect(img_bgr)
            except Exception as exc:  # noqa: BLE001
                text, addr = _asan_report(exc)
                logger.error("manga_det pass failed: %s", text)
                stats = self._stats(clean_sfx, dilation_px, inpaint_model, w, h, 0, 0, timings,
                                    "seg failed", "none")
                stats["error"] = text
                stats["error_address"] = hex(addr) if addr else None
                timings["total"] = round((time.perf_counter() - _t_total) * 1000.0, 2)
                return img_pil, Image.fromarray(np.zeros((h, w, 3), np.uint8)), stats

            timings["seg"] = round((time.perf_counter() - _t_seg) * 1000.0, 2)
            _t_mask = time.perf_counter()
            ms = build_masks_from_polygons(
                img_bgr=img_bgr,
                polygons=polys,
                dets=dets,
                seg_map=seg_full,
                dilation_px=int(dilation_px),
            )
            timings["masks"] = round((time.perf_counter() - _t_mask) * 1000.0, 2)
            target = cv2.bitwise_or(ms.chat_erase, ms.sfx_erase) if clean_sfx else ms.chat_erase
            color_mask = Image.fromarray(self._color_mask(ms, h, w))
            n_chat, n_sfx = len(ms.chat_boxes), len(ms.sfx_boxes)

            if not target.any():
                timings["total"] = round((time.perf_counter() - _t_total) * 1000.0, 2)
                stats = self._stats(clean_sfx, dilation_px, inpaint_model, w, h, n_chat, n_sfx, timings, "No text detected", "none")
                return img_pil, color_mask, stats

            out_bgr, flat_done = flat_fill_uniform_paper(img_bgr=img_bgr, erase=target, boxes=ms.chat_boxes)
            target = cv2.bitwise_and(target, cv2.bitwise_not(flat_done))
            if not target.any():
                timings["total"] = round((time.perf_counter() - _t_total) * 1000.0, 2)
                stats = self._stats(clean_sfx, dilation_px, inpaint_model, w, h, n_chat, n_sfx,
                                    timings, None, "Flat-Fill Bypass (Instant)")
                stats["flat_filled_px"] = int(np.count_nonzero(flat_done))
                return Image.fromarray(cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)), color_mask, stats
            out_rgb = cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)
            rects, jobs = self._plan_jobs(out_rgb, target)
        else:
            # Fallback path: ComicTextDetector
            try:
                strokes = self.ctd.seg_strokes(img_bgr, dets)
            except Exception as exc:  # noqa: BLE001
                text, addr = _asan_report(exc)
                logger.error("seg pass failed: %s", text)
                stats = self._stats(clean_sfx, dilation_px, inpaint_model, w, h, 0, 0, timings,
                                    "seg failed", "none")
                stats["error"] = text
                stats["error_address"] = hex(addr) if addr else None
                timings["total"] = round((time.perf_counter() - _t_total) * 1000.0, 2)
                return img_pil, Image.fromarray(np.zeros((h, w, 3), np.uint8)), stats

            all_boxes = [d.box for d in dets if d.cls in (CLS_TEXT_BUBBLE, CLS_TEXT_FREE)]
            flat_paper = flat_paper_hint(img_bgr, strokes, all_boxes)
            seg_ms = (time.perf_counter() - _t_seg) * 1000.0
            timings["seg"] = round(seg_ms, 2)

            if flat_paper:
                chat_boxes = [d.box for d in dets if d.cls == CLS_TEXT_BUBBLE]
                target = cv2.resize(strokes.astype(np.uint8) * 255, (w, h), interpolation=cv2.INTER_NEAREST)
                target = cv2.bitwise_and(target, rect_mask(h, w, all_boxes if clean_sfx else chat_boxes))
                target = cv2.dilate(target, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
                out_bgr, flat_done = flat_fill_uniform_paper(img_bgr=img_bgr, erase=target, boxes=chat_boxes)
                out_rgb = cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB) if target.any() else img_rgb
                rects = []
                jobs = []
            else:
                _t_mask = time.perf_counter()
                seg_full = self.ctd.seg_map(img_bgr)
                ms = build_masks(img_bgr, seg_full, dets, seg_thr=float(det_threshold), dilation_px=int(dilation_px))
                timings["seg"] = round(seg_ms + (time.perf_counter() - _t_mask) * 1000.0, 2)
                target = cv2.bitwise_or(ms.chat_erase, ms.sfx_erase) if clean_sfx else ms.chat_erase
                color_mask = Image.fromarray(self._color_mask(ms, h, w))
                n_chat, n_sfx = len(ms.chat_boxes), len(ms.sfx_boxes)
                timings["masks"] = round((time.perf_counter() - _t_mask) * 1000.0, 2)
                if not target.any():
                    timings["total"] = round((time.perf_counter() - _t_total) * 1000.0, 2)
                    stats = self._stats(clean_sfx, dilation_px, inpaint_model, w, h, n_chat, n_sfx, timings, "No text detected", "none")
                    return img_pil, color_mask, stats
                out_bgr, flat_done = flat_fill_uniform_paper(img_bgr=img_bgr, erase=target, boxes=ms.chat_boxes)
                target = cv2.bitwise_and(target, cv2.bitwise_not(flat_done))
                if not target.any():
                    timings["total"] = round((time.perf_counter() - _t_total) * 1000.0, 2)
                    stats = self._stats(clean_sfx, dilation_px, inpaint_model, w, h, n_chat, n_sfx,
                                        timings, "No text detected", "Flat-Fill Bypass (Instant)")
                    stats["flat_filled_px"] = int(np.count_nonzero(flat_done))
                    return Image.fromarray(cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)), color_mask, stats
                out_rgb = cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)
                rects, jobs = self._plan_jobs(out_rgb, target)

        n_flat = int(np.count_nonzero(flat_done))
        if jobs:
            _t_inp = time.perf_counter()
            low = inpaint_model.lower()
            if "telea" in low or "ns" in low:
                results = _cpu_classical_jobs(jobs, inpaint_model)
                tag = "OpenCV Telea (CPU)" if "telea" in low else "OpenCV Navier-Stokes (CPU)"
            elif force_cpu or not HAS_ZEROGPU:
                results = _cpu_lama_jobs(jobs, inpaint_model)
                tag = f"{inpaint_model} (CPU)"
            else:
                try:
                    results, dets, _ = _gpu_page_job(out_rgb, jobs, inpaint_model, bubble_threshold)
                    tag, gpu_used = f"{inpaint_model} (ZeroGPU)", True
                except Exception as exc:  # noqa: BLE001
                    logger.warning("ZeroGPU LaMa failed (%s), CPU fallback", exc)
                    results = _cpu_lama_jobs(jobs, inpaint_model)
                    tag = f"{inpaint_model} (CPU fallback)"
            final = self._paste(out_rgb, target, rects, results)
            timings["inpaint"] = round((time.perf_counter() - _t_inp) * 1000.0, 2)
        else:  # flat paper covered everything
            final = cv2.cvtColor(out_rgb, cv2.COLOR_RGB2BGR)
            tag = "Flat-Fill Bypass (paper)"

        if n_flat > 0 and "FlatFill" not in tag:
            tag = f"Hybrid FlatFill+{tag}"
        timings["total"] = round((time.perf_counter() - _t_total) * 1000.0, 2)
        timings["regions"] = len(rects)
        stats = self._stats(clean_sfx, dilation_px, inpaint_model, w, h, n_chat, n_sfx, timings, None, tag)
        stats["flat_filled_px"] = n_flat
        stats["device"] = "gpu" if (gpu_used or used_gpu_window) else "cpu"
        return Image.fromarray(cv2.cvtColor(final, cv2.COLOR_BGR2RGB)), color_mask, stats

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
