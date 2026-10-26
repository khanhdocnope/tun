"""LaMa inpainting engine (optional, requires torch + model file).

On Hugging Face ZeroGPU, torch is available and models are cached.
On local dev without torch, this engine reports unavailable and callers
fall back to OpenCV Telea/NS.
"""

import os
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

try:
    import torch
    TORCH_AVAILABLE = True
except Exception:
    torch = None
    TORCH_AVAILABLE = False

BASE_DIR = Path(__file__).resolve().parents[3]  # backend/
MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
ANIME_LAMA_PATH = MODEL_DIR / "anime-manga-big-lama.pt"

_LAMA_CACHE = {}


LAST_ERROR = None


def _ensure_model() -> Optional[Path]:
    global LAST_ERROR
    if ANIME_LAMA_PATH.is_file():
        return ANIME_LAMA_PATH
    alt = BASE_DIR / "weights" / "anime-manga-big-lama.pt"
    if alt.is_file():
        try:
            ANIME_LAMA_PATH.write_bytes(alt.read_bytes())
            return ANIME_LAMA_PATH
        except Exception as e:
            LAST_ERROR = f"copy legacy failed: {e}"
            return alt
    urls = [
        "https://github.com/Sanster/models/releases/download/AnimeMangaInpainting/anime-manga-big-lama.pt",
        "https://huggingface.co/kzome/manga-cleaner/resolve/main/data/anime-manga-big-lama.pt",
    ]
    for url in urls:
        try:
            print(f"[lama] trying {url}", flush=True)
            import torch as _t
            _t.hub.download_url_to_file(url, str(ANIME_LAMA_PATH), progress=True)
            print(f"[lama] downloaded size={ANIME_LAMA_PATH.stat().st_size if ANIME_LAMA_PATH.is_file() else 0}", flush=True)
            if ANIME_LAMA_PATH.is_file() and ANIME_LAMA_PATH.stat().st_size > 50 * 1024 * 1024:
                LAST_ERROR = None
                return ANIME_LAMA_PATH
            LAST_ERROR = f"downloaded but too small: {ANIME_LAMA_PATH.stat().st_size if ANIME_LAMA_PATH.is_file() else 0}"
        except Exception as e:
            print(f"[lama] FAILED {url}: {e}", flush=True)
            LAST_ERROR = f"{url} -> {e}"
            if ANIME_LAMA_PATH.is_file():
                try:
                    ANIME_LAMA_PATH.unlink()
                except Exception:
                    pass
    print(f"[lama] giving up, last_error={LAST_ERROR}", flush=True)
    return None


def _existing_model_path() -> Optional[Path]:
    """Return an already-downloaded model path without triggering a download."""

    if ANIME_LAMA_PATH.is_file():
        return ANIME_LAMA_PATH
    alt = BASE_DIR / "weights" / "anime-manga-big-lama.pt"
    if alt.is_file():
        return alt
    return None


def _load_model():
    if not TORCH_AVAILABLE:
        return None
    if "model" in _LAMA_CACHE:
        return _LAMA_CACHE["model"]
    # Never download a 200MB checkpoint on a user request.  Use the explicit
    # debug/download helper instead, then restart (or call _ensure_model once).
    path = _existing_model_path()
    if path is None or not path.is_file():
        _LAMA_CACHE["model"] = None
        return None
    try:
        m = torch.jit.load(str(path), map_location="cpu")
        m.eval()
        _LAMA_CACHE["model"] = m
        return m
    except Exception:
        _LAMA_CACHE["model"] = None
        return None


def _norm_img(a):
    if a.ndim == 2:
        a = a[:, :, np.newaxis]
    return np.transpose(a, (2, 0, 1)).astype("float32") / 255.0


def _ceil_modulo(x, mod=8):
    return x if x % mod == 0 else (x // mod + 1) * mod


def _pad(img, mod=8):
    if img.ndim == 2:
        img = img[:, :, np.newaxis]
    h, w = img.shape[:2]
    return np.pad(img, ((0, _ceil_modulo(h, mod) - h), (0, _ceil_modulo(w, mod) - w), (0, 0)), mode="symmetric")


def is_available() -> bool:
    return TORCH_AVAILABLE and _load_model() is not None


class LamaEngine:
    @property
    def name(self) -> str:
        return "lama"

    def inpaint(self, image_rgb, mask, radius=3):
        model = _load_model()
        if model is None:
            # Fallback to OpenCV Telea
            bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
            out = cv2.inpaint(bgr, mask.astype(np.uint8), 3, cv2.INPAINT_TELEA)
            return cv2.cvtColor(out, cv2.COLOR_BGR2RGB)
        ch, cw = mask.shape[:2]
        pi = _pad(image_rgb)
        pm = _pad(mask)
        img_t = torch.from_numpy(_norm_img(pi)).unsqueeze(0)
        msk_t = torch.from_numpy((_norm_img(pm) > 0).astype(np.float32)).unsqueeze(0)
        with torch.inference_mode():
            out = model(img_t, msk_t)
        res = np.clip(out[0].permute(1, 2, 0).cpu().numpy() * 255.0, 0, 255).astype(np.uint8)[:ch, :cw]
        return res