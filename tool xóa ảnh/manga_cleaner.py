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
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch
from PIL import Image, ImageOps

from bubble_detector import BubbleTextDetector
from mask_logic import Det, MaskSet, build_masks, flat_fill_uniform_paper

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
        self.ready = False
        if not self.model_path.is_file():
            alt = BASE_DIR / "weights" / "comic-text-detector.onnx"
            if alt.is_file():
                self.model_path = alt
        if not self.model_path.is_file():
            from download_models import ensure_models
            ensure_models()
        if self.model_path.is_file():
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
        nw, nh = int(round(w * r)), int(round(h * r))
        im = cv2.resize(img_bgr, (nw, nh), interpolation=cv2.INTER_LINEAR)
        im = cv2.copyMakeBorder(im, 0, size - nh, 0, size - nw, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        self.net.setInput(cv2.dnn.blobFromImage(im, 1.0 / 255.0, (size, size), swapRB=False, crop=False))
        seg_prob = None
        det_prob = None
        for out in self.net.forward(self.net.getUnconnectedOutLayersNames()):
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
        return cv2.resize(comb[:nh, :nw], (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32)


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
        if force_cpu or not HAS_ZEROGPU:
            return self.bubbles.detect(img_rgb, "cpu", thr)
        try:
            return zero_gpu_detect(img_rgb, thr)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ZeroGPU detect failed (%s), CPU fallback", exc)
            return self.bubbles.detect(img_rgb, "cpu", thr)

    def _lama(self, img_rgb: np.ndarray, mask: np.ndarray, force_cpu: bool, model_name: str = "anime-lama") -> Tuple[np.ndarray, str]:
        h, w = mask.shape
        model_name = (model_name or "anime-lama").strip()
        if "telea" in model_name.lower():
            return cpu_lama_forward(img_rgb, mask, model_name="opencv-telea"), "OpenCV Telea (CPU)"
        if "ns" in model_name.lower():
            return cpu_lama_forward(img_rgb, mask, model_name="opencv-ns"), "OpenCV Navier-Stokes (CPU)"

        pi, pm = pad_img_to_modulo(img_rgb), pad_img_to_modulo(mask)
        if force_cpu or not HAS_ZEROGPU:
            return cpu_lama_forward(pi, pm, model_name=model_name)[:h, :w], f"{model_name} (CPU)"
        try:
            return zero_gpu_lama_forward(pi, pm, model_name=model_name)[:h, :w], f"{model_name} (ZeroGPU)"
        except Exception as exc:  # noqa: BLE001
            logger.warning("ZeroGPU LaMa failed (%s), CPU fallback", exc)
            return cpu_lama_forward(pi, pm, model_name=model_name)[:h, :w], f"{model_name} (CPU fallback)"

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
            res_bgr, tag = self._lama(img_rgb, um, force_cpu, model_name=inpaint_model)
            m = (um.astype(np.float32) / 255.0)[:, :, None]
            out = (res_bgr.astype(np.float32) * m + img_bgr.astype(np.float32) * (1 - m)).clip(0, 255).astype(np.uint8)
            return (Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB)),
                    Image.fromarray(np.stack([np.zeros_like(um), um, np.zeros_like(um)], -1)),
                    {"engine": tag, "mode": "Manual brush", "inpaint_model": inpaint_model})

        # ---- auto mode
        dets = self._detect_regions(img_rgb, bubble_threshold, force_cpu)
        seg = self.ctd.seg_map(img_bgr)
        ms = build_masks(img_bgr, seg, dets, seg_thr=float(det_threshold), dilation_px=int(dilation_px))
        color_mask = Image.fromarray(self._color_mask(ms, h, w))

        target = cv2.bitwise_or(ms.chat_erase, ms.sfx_erase) if clean_sfx else ms.chat_erase
        stats: Dict[str, Any] = {
            "mode": "Xóa cả Chat & SFX" if clean_sfx else "Chỉ xóa Chat (giữ SFX)",
            "chat_count": len(ms.chat_boxes),
            "sfx_count": len(ms.sfx_boxes),
            "clean_sfx": clean_sfx,
            "dilation_px": dilation_px,
            "inpaint_model": inpaint_model,
            "width": w,
            "height": h,
        }
        if not self.bubbles.ready:
            stats.update(status="Bubble detector unavailable", error=self.bubbles.error)
            return img_pil, color_mask, stats
        if not target.any():
            stats.update(status="No text detected", engine="none")
            return img_pil, color_mask, stats

        # Direct AI inpainting on full target mask (seamless texture/gradient reconstruction)
        work_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        res_bgr, tag = self._lama(work_rgb, target, force_cpu, model_name=inpaint_model)
        m = (target.astype(np.float32) / 255.0)[:, :, None]
        out_bgr = (res_bgr.astype(np.float32) * m + img_bgr.astype(np.float32) * (1 - m)).clip(0, 255).astype(np.uint8)
        stats["engine"] = f"Inpaint ({tag})"
        return Image.fromarray(cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)), color_mask, stats


cleaner_pipeline = MangaCleanerPipeline()
