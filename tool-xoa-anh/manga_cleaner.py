"""
Manga Cleaner core (v2).

Chat vs SFX is decided by a dedicated region detector (ogkalu RT-DETR-v2:
text_bubble vs text_free), NOT by colour / ray-casting heuristics.
Pixels come from ComicTextDetector's `seg` head, limited to those regions.
Bubble outlines are protected by a connected-component barrier, uniform white
bubbles are flat-filled (no AI), everything else goes through Big-LaMa.
"""

from __future__ import annotations

import gc
import logging
import math
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch
from PIL import Image, ImageOps

from bubble_detector import BubbleTextDetector
from mask_logic import CLS_TEXT_BUBBLE, CLS_TEXT_FREE, Det, MaskSet, build_masks, flat_fill_uniform_paper

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
INPAINT_CTX_PX = int(os.getenv("INPAINT_CONTEXT_PX", "96"))      # context kept around every erased region
INPAINT_MOD = 32                                                  # pad crops to a multiple of 32 (fewer distinct shapes)
FULL_PAGE_RATIO = 0.6                                             # crops cover >= 60% of page -> just do the page
DETECT_ON_GPU = os.getenv("DETECT_ON_GPU", "auto").lower()        # "0" | "1" | "auto" (GPU only for tall strips)
TALL_DETECT_RATIO = 3.0


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


def _inpaint_forward(img_rgb: np.ndarray, mask: np.ndarray, dev: str, model_name: str = "anime-lama") -> np.ndarray:
    # 1. OpenCV Classical Methods (Fast & Instant CPU)
    if "telea" in model_name.lower():
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
        return cv2.inpaint(img_bgr, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
    elif "ns" in model_name.lower():
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
        return cv2.inpaint(img_bgr, mask, inpaintRadius=3, flags=cv2.INPAINT_NS)

    # 2. Deep Learning TorchScript LaMa Models
    model = get_lama_model(model_name).to(dev)
    try:
        img_t = torch.from_numpy(norm_img(img_rgb)).unsqueeze(0).to(dev)
        msk_t = torch.from_numpy((norm_img(mask) > 0).astype(np.float32)).unsqueeze(0).to(dev)
        with torch.inference_mode():
            out = model(img_t, msk_t)
        res = np.clip(out[0].permute(1, 2, 0).cpu().numpy() * 255.0, 0, 255).astype(np.uint8)
        return cv2.cvtColor(res, cv2.COLOR_RGB2BGR)
    finally:
        if dev != "cpu":
            model.to("cpu")
            torch.cuda.empty_cache()
        gc.collect()


def cpu_lama_forward(img_rgb: np.ndarray, mask: np.ndarray, model_name: str = "anime-lama") -> np.ndarray:
    return _inpaint_forward(img_rgb, mask, "cpu", model_name=model_name)


@spaces.GPU(duration=15)
def zero_gpu_lama_forward(img_rgb: np.ndarray, mask: np.ndarray, model_name: str = "anime-lama") -> np.ndarray:
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    return _inpaint_forward(img_rgb, mask, dev, model_name=model_name)



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


def _inpaint_crop(model, img_rgb: np.ndarray, mask: np.ndarray, dev: str) -> np.ndarray:
    ch, cw = mask.shape[:2]
    pi, pm = pad_img_to_modulo(img_rgb, INPAINT_MOD), pad_img_to_modulo(mask, INPAINT_MOD)
    img_t = torch.from_numpy(norm_img(pi)).unsqueeze(0).to(dev)
    msk_t = torch.from_numpy((norm_img(pm) > 0).astype(np.float32)).unsqueeze(0).to(dev)
    with torch.inference_mode():
        out = model(img_t, msk_t)
    res = np.clip(out[0].permute(1, 2, 0).cpu().numpy() * 255.0, 0, 255).astype(np.uint8)[:ch, :cw]
    return cv2.cvtColor(res, cv2.COLOR_RGB2BGR)


def _inpaint_jobs_forward(jobs: List[Tuple[np.ndarray, np.ndarray]], dev: str, model_name: str) -> List[np.ndarray]:
    """Inpaint every (crop_rgb, crop_mask) job. Returns BGR crops. One model move per page, not per crop."""
    low = model_name.lower()
    if "telea" in low or "ns" in low:
        flag = cv2.INPAINT_TELEA if "telea" in low else cv2.INPAINT_NS
        return [cv2.inpaint(cv2.cvtColor(im, cv2.COLOR_RGB2BGR), mk, inpaintRadius=3, flags=flag) for im, mk in jobs]
    model = get_lama_model(model_name).to(dev)
    try:
        return [_inpaint_crop(model, im, mk, dev) for im, mk in jobs]
    finally:
        if dev != "cpu":
            model.to("cpu")
            torch.cuda.empty_cache()
        gc.collect()


@spaces.GPU(duration=20)
def zero_gpu_inpaint_jobs(jobs: List[Tuple[np.ndarray, np.ndarray]], model_name: str = "anime-lama") -> List[np.ndarray]:
    """ONE ZeroGPU allocation per page, however many regions it has."""
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    return _inpaint_jobs_forward(jobs, dev, model_name)


# ---------------------------------------------------------------- bubble detector (GPU-capable)
_BUBBLE = BubbleTextDetector()


@spaces.GPU(duration=10)
def zero_gpu_detect(img_rgb: np.ndarray, thr: float) -> List[Det]:
    return _BUBBLE.detect(img_rgb, "cuda" if torch.cuda.is_available() else "cpu", thr)


# ------------------------------------------------------------------ CTD: seg head only
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

    def seg_map(self, img_bgr: np.ndarray, size: int = 1024) -> np.ndarray:
        h, w = img_bgr.shape[:2]
        if not self.ready:
            return np.zeros((h, w), np.float32)
        r = min(size / h, size / w)
        nw, nh = max(1, int(round(w * r))), max(1, int(round(h * r)))
        im = cv2.resize(img_bgr, (nw, nh), interpolation=cv2.INTER_AREA if r < 1 else cv2.INTER_LINEAR)
        im = cv2.copyMakeBorder(im, 0, size - nh, 0, size - nw, cv2.BORDER_CONSTANT, value=(0, 0, 0))
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
            comb = np.maximum(seg_prob, det_prob)
        elif seg_prob is not None:
            comb = seg_prob
        elif det_prob is not None:
            comb = det_prob
        else:
            return np.zeros((h, w), np.float32)
        return cv2.resize(comb[:nh, :nw], (w, h), interpolation=cv2.INTER_LINEAR)


# ----------------------------------------------------------------------------- pipeline
class MangaCleanerPipeline:
    def __init__(self):
        self.ctd = ComicTextDetectorEngine()
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
    def _detect_regions(self, img_rgb: np.ndarray, thr: float, force_cpu: bool) -> List[Det]:
        h, w = img_rgb.shape[:2]
        if DETECT_ON_GPU == "1":
            use_gpu = True
        elif DETECT_ON_GPU == "0":
            use_gpu = False
        else:  # auto: a GPU allocation costs more than CPU RT-DETR on a normal page; strips need many tiles
            use_gpu = (h / max(w, 1)) > TALL_DETECT_RATIO
        if force_cpu or not HAS_ZEROGPU or not use_gpu:
            return self.bubbles.detect(img_rgb, "cpu", thr)
        try:
            return zero_gpu_detect(img_rgb, thr)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ZeroGPU detect failed (%s), CPU fallback", exc)
            return self.bubbles.detect(img_rgb, "cpu", thr)

    def _inpaint_masked(self, img_rgb: np.ndarray, mask: np.ndarray, force_cpu: bool,
                        model_name: str = "anime-lama") -> Tuple[np.ndarray, str, int]:
        """
        Inpaint only the regions around `mask` pixels and paste them back.
        Returns (final BGR page, engine tag, number of regions). Pixels outside the mask are untouched.
        """
        model_name = (model_name or "anime-lama").strip()
        low = model_name.lower()
        classical = "telea" in low or "ns" in low
        rects = _plan_crops(mask)
        jobs = [(np.ascontiguousarray(img_rgb[y1:y2, x1:x2]), np.ascontiguousarray(mask[y1:y2, x1:x2]))
                for (x1, y1, x2, y2) in rects]

        if classical:
            results = _inpaint_jobs_forward(jobs, "cpu", "opencv-telea" if "telea" in low else "opencv-ns")
            tag = "OpenCV Telea (CPU)" if "telea" in low else "OpenCV Navier-Stokes (CPU)"
        elif force_cpu or not HAS_ZEROGPU:
            results, tag = _inpaint_jobs_forward(jobs, "cpu", model_name), f"{model_name} (CPU)"
        else:
            try:
                results, tag = zero_gpu_inpaint_jobs(jobs, model_name), f"{model_name} (ZeroGPU)"
            except Exception as exc:  # noqa: BLE001
                logger.warning("ZeroGPU LaMa failed (%s), CPU fallback", exc)
                results, tag = _inpaint_jobs_forward(jobs, "cpu", model_name), f"{model_name} (CPU fallback)"

        out = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
        for (x1, y1, x2, y2), res in zip(rects, results):
            sel = mask[y1:y2, x1:x2] > 0
            out[y1:y2, x1:x2][sel] = res[sel]
        return out, tag, len(rects)

    @staticmethod
    def _color_mask(ms: MaskSet, h: int, w: int) -> np.ndarray:
        cm = np.zeros((h, w, 3), np.uint8)
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
            out, tag, n_reg = self._inpaint_masked(img_rgb, um, force_cpu, model_name=inpaint_model)
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

        _t_det = time.perf_counter()
        dets = self._detect_regions(img_rgb, bubble_threshold, force_cpu)
        _detect_ms = (time.perf_counter() - _t_det) * 1000.0

        _seg_ms = 0.0
        _masks_ms = 0.0
        if any(d.cls in (CLS_TEXT_BUBBLE, CLS_TEXT_FREE) for d in dets):
            _t_seg = time.perf_counter()
            seg = self.ctd.seg_map(img_bgr)
            _seg_ms = (time.perf_counter() - _t_seg) * 1000.0

            _t_mask = time.perf_counter()
            ms = build_masks(img_bgr, seg, dets, seg_thr=float(det_threshold), dilation_px=int(dilation_px))
            _masks_ms = (time.perf_counter() - _t_mask) * 1000.0

            color_mask = Image.fromarray(self._color_mask(ms, h, w))
            target = cv2.bitwise_or(ms.chat_erase, ms.sfx_erase) if clean_sfx else ms.chat_erase
            n_chat, n_sfx = len(ms.chat_boxes), len(ms.sfx_boxes)
        else:  # blank page / splash art: no text regions -> skip the 1024px CTD pass entirely
            color_mask = Image.fromarray(np.zeros((h, w, 3), np.uint8))
            target = np.zeros((h, w), np.uint8)
            n_chat = n_sfx = 0

        stats: Dict[str, Any] = {
            "mode": "Xóa cả Chat & SFX" if clean_sfx else "Chỉ xóa Chat (giữ SFX)",
            "chat_count": n_chat,
            "sfx_count": n_sfx,
            "clean_sfx": clean_sfx,
            "dilation_px": dilation_px,
            "inpaint_model": inpaint_model,
            "width": w,
            "height": h,
        }
        if not target.any():
            _total_ms = (time.perf_counter() - _t_total) * 1000.0
            stats.update(status="No text detected", engine="none")
            stats["timings_ms"] = {
                "decode": round(_decode_ms, 2), "detect": round(_detect_ms, 2),
                "seg": round(_seg_ms, 2), "masks": round(_masks_ms, 2),
                "inpaint": 0.0, "total": round(_total_ms, 2),
                "regions": 0, "engine": "none",
            }
            return img_pil, color_mask, stats

        # Inpaint only around the erased text (crops with context), paste back under the mask
        _t_inp = time.perf_counter()
        out_bgr, tag, n_reg = self._inpaint_masked(img_rgb, target, force_cpu, model_name=inpaint_model)
        _inpaint_ms = (time.perf_counter() - _t_inp) * 1000.0
        _total_ms = (time.perf_counter() - _t_total) * 1000.0

        stats["engine"] = f"Inpaint ({tag})"
        stats["inpaint_regions"] = n_reg
        stats["timings_ms"] = {
            "decode": round(_decode_ms, 2), "detect": round(_detect_ms, 2),
            "seg": round(_seg_ms, 2), "masks": round(_masks_ms, 2),
            "inpaint": round(_inpaint_ms, 2), "total": round(_total_ms, 2),
            "regions": n_reg, "engine": tag,
        }
        return Image.fromarray(cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)), color_mask, stats


cleaner_pipeline = MangaCleanerPipeline()
