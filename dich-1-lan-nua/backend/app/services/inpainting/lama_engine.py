"""LaMa inpainting engine (manga-finetuned Big-LaMa, PyTorch CPU).

The weights are the ``anime-manga-big-lama.pt`` TorchScript checkpoint that
IOPaint ships as its anime/manga model (approx. 300k manga/anime images of
fine-tuning on top of Big-LaMa).  It fills masked glyph pixels with plausible
line art and screentone instead of a flat patch, which is exactly the case the
OpenCV / texture-fill engines could not win: translucent bubbles, patterned
backgrounds and coloured halos.

Design notes:

* The model is fully convolutional, but CPU inference cost grows with area, so
  the page is never fed whole.  Each cluster of masked glyphs gets its own crop
  with ``margin`` pixels of context, which also gives LaMa the local pattern it
  needs to continue the artwork.
* Crops larger than ``max_side`` are downscaled before inference and the result
  is scaled back, keeping the per-page cost bounded on weak CPUs.
* Only masked pixels are written back, feathered over a couple of pixels, so
  every unmasked pixel of the original page is preserved bit-exactly.

The engine degrades gracefully: without torch or without the checkpoint file it
reports ``is_available() == False`` and callers fall back to the older engines.
"""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np

from app.services.inpainting.base import BaseInpaintingEngine

try:  # torch is optional: the app must keep working without a 200 MB dependency.
    import torch

    TORCH_AVAILABLE = True
except Exception:  # pragma: no cover - import guarded for optional dependency
    torch = None  # type: ignore[assignment]
    TORCH_AVAILABLE = False

BASE_DIR = Path(__file__).resolve().parents[3]  # backend/
MODEL_DIR = BASE_DIR / "models"
DEFAULT_MODEL_PATH = MODEL_DIR / "anime-manga-big-lama.pt"
DOWNLOAD_URL = (
    "https://github.com/Sanster/models/releases/download/"
    "AnimeMangaInpainting/anime-manga-big-lama.pt"
)

#: Context kept around a text cluster, in pixels of the source page.
DEFAULT_MARGIN = int(os.getenv("LAMA_MARGIN", "64"))
#: Longest side sent to the network.  Cost grows with area and the target CPU is
#: a 2-core Pentium: 256 keeps glyph edges legible and runs ~1.6x faster than
#: 320 for no visible difference at 100% zoom.
DEFAULT_MAX_SIDE = int(os.getenv("LAMA_MAX_SIDE", "256"))
#: Mask growth before inference: covers the antialiased glyph edge and the
#: white stroke halo typical of colour manhwa lettering.
DEFAULT_DILATE = int(os.getenv("LAMA_MASK_DILATE", "3"))
#: Below this many masked pixels a diffusion fill is indistinguishable from the
#: network and ~50x cheaper, so the model is skipped entirely.
TINY_MASK_PX = int(os.getenv("LAMA_TINY_MASK_PX", "400"))
#: "auto" uses CUDA when torch reports it (ZeroGPU passes it through), "cpu"
#: forces the old behaviour.
DEVICE_PREF = os.getenv("LAMA_DEVICE", "auto").lower()

_lock = threading.Lock()
_infer_lock = threading.Lock()
_models = {}
_load_error: Optional[str] = None
#: Optional batch backend installed by the Space (``@spaces.GPU`` wrapped).
#: ``fn(list[(crop_rgb, crop_mask, max_side)]) -> list[np.ndarray]``.
_batch_backend = None


def model_path() -> Path:
    """Checkpoint location, overridable with ``LAMA_MODEL_PATH``."""

    override = os.getenv("LAMA_MODEL_PATH")
    return Path(override) if override else DEFAULT_MODEL_PATH


def ensure_model(download: bool = False) -> Optional[Path]:
    """Return a usable checkpoint path.

    ``download`` is only honoured by explicit tooling (``tools/download_lama.py``)
    so a user request never blocks on 200 MB of network traffic.
    """

    global _load_error
    path = model_path()
    if path.is_file() and path.stat().st_size > 50 * 1024 * 1024:
        return path
    if not download:
        return None
    try:
        import urllib.request

        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        print(f"[lama] downloading {DOWNLOAD_URL}", flush=True)
        urllib.request.urlretrieve(DOWNLOAD_URL, tmp)  # noqa: S310 - fixed URL
        tmp.replace(path)
        if path.stat().st_size > 50 * 1024 * 1024:
            _load_error = None
            return path
        _load_error = "downloaded checkpoint is unexpectedly small"
    except Exception as exc:  # pragma: no cover - tooling path
        _load_error = f"download failed: {exc}"
        print(f"[lama] download failed: {exc}", flush=True)
    return None


def pick_device() -> str:
    """Best available device: CUDA when torch sees it and the env allows it."""

    if not TORCH_AVAILABLE or DEVICE_PREF == "cpu":
        return "cpu"
    try:
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def _get_model(device: str = "cpu"):
    """Load the TorchScript generator once per device, under a lock."""

    global _load_error
    if device in _models:
        return _models[device]
    if not TORCH_AVAILABLE:
        _load_error = "torch is not installed"
        return None
    path = ensure_model(download=False)
    if path is None:
        _load_error = f"checkpoint missing at {model_path()}"
        return None
    with _lock:
        if device in _models:
            return _models[device]
        try:
            if hasattr(torch, "set_num_threads"):
                # Leave one logical core for the web server; the G4560 has 4.
                torch.set_num_threads(min(4, max(1, (os.cpu_count() or 2))))
            started = time.perf_counter()
            loaded = torch.jit.load(str(path), map_location="cpu")
            loaded.eval()
            if device != "cpu":
                loaded = loaded.to(device)
            _models[device] = loaded
            _load_error = None
            print(
                f"[lama] loaded {path.name} on {device} in "
                f"{time.perf_counter() - started:.1f}s",
                flush=True,
            )
        except Exception as exc:  # pragma: no cover - depends on local install
            _load_error = f"failed to load checkpoint: {exc}"
            print(f"[lama] {_load_error}", flush=True)
            return None
    return _models[device]


def _load_model():
    """Backwards-compatible helper: the CPU copy of the model."""

    return _get_model("cpu")


def set_batch_backend(fn) -> None:
    """Install a batch inference callable (used by the Space's GPU wrapper)."""

    global _batch_backend
    _batch_backend = fn


def is_available() -> bool:
    """True when torch and the checkpoint are both present (no loading)."""

    if not TORCH_AVAILABLE:
        return False
    path = ensure_model(download=False)
    return path is not None


def status() -> dict:
    path = model_path()
    return {
        "engine": "lama",
        "torch_available": TORCH_AVAILABLE,
        "model_path": str(path),
        "model_present": path.is_file(),
        "model_loaded": bool(_models),
        "device": pick_device(),
        "batch_backend": "custom" if _batch_backend is not None else "local",
        "last_error": _load_error,
    }


def _crop_boxes(mask: np.ndarray, margin: int) -> List[Tuple[int, int, int, int]]:
    """Bounding boxes (x1, y1, x2, y2) of masked clusters, grown by ``margin``.

    Glyphs of one line/bubble end up in the same crop: dilating the mask by
    half the margin and taking connected components is a morphological version
    of single-linkage clustering, and it is a single OpenCV call instead of the
    O(n^2) box merging this used to do for every glyph pair.
    """

    h, w = mask.shape[:2]
    binary = (mask > 0).astype(np.uint8)
    if not binary.any():
        return []
    gap = max(4, margin // 2)
    kernel = np.ones((gap * 2 + 1, gap * 2 + 1), np.uint8)
    grouped = cv2.dilate(binary, kernel)
    count, _, stats, _ = cv2.connectedComponentsWithStats(grouped, connectivity=8)
    pad = max(0, margin - gap)
    boxes: List[Tuple[int, int, int, int]] = []
    for idx in range(1, count):
        x, y, bw, bh, area = stats[idx]
        if area < 2:
            continue
        boxes.append(
            (
                max(0, int(x) - pad),
                max(0, int(y) - pad),
                min(w, int(x + bw) + pad),
                min(h, int(y + bh) + pad),
            )
        )
    return boxes


def _run_crop(
    model,
    crop_rgb: np.ndarray,
    crop_mask: np.ndarray,
    max_side: int,
    device: str = "cpu",
) -> Tuple[np.ndarray, float]:
    """Inpaint a single crop, returning (result at crop resolution, seconds)."""

    padded_rgb, padded_mask, scale, (h, w) = _prepare(crop_rgb, crop_mask, max_side)
    started = time.perf_counter()
    result = _forward(model, padded_rgb, padded_mask, device)
    elapsed = time.perf_counter() - started
    return _finish(result, crop_rgb.shape[:2], scale), elapsed


def _prepare(
    crop_rgb: np.ndarray, crop_mask: np.ndarray, max_side: int
) -> Tuple[np.ndarray, np.ndarray, float, Tuple[int, int]]:
    h, w = crop_rgb.shape[:2]
    scale = min(1.0, float(max_side) / float(max(h, w)))
    if scale < 1.0:
        nw, nh = max(8, int(round(w * scale))), max(8, int(round(h * scale)))
        work_rgb = cv2.resize(crop_rgb, (nw, nh), interpolation=cv2.INTER_AREA)
        work_mask = cv2.resize(crop_mask, (nw, nh), interpolation=cv2.INTER_NEAREST)
    else:
        work_rgb, work_mask = crop_rgb, crop_mask

    binary = (work_mask > 0).astype(np.uint8) * 255
    if DEFAULT_DILATE > 0:
        binary = cv2.dilate(
            binary, np.ones((DEFAULT_DILATE * 2 + 1,) * 2, np.uint8)
        )
    ph = (-work_rgb.shape[0]) % 8
    pw = (-work_rgb.shape[1]) % 8
    padded_rgb = cv2.copyMakeBorder(
        work_rgb, 0, ph, 0, pw, cv2.BORDER_REFLECT_101
    )
    padded_mask = cv2.copyMakeBorder(binary, 0, ph, 0, pw, cv2.BORDER_REPLICATE)
    return padded_rgb, padded_mask, scale, (h, w)


def _forward(
    model, padded_rgb: np.ndarray, padded_mask: np.ndarray, device: str = "cpu"
) -> np.ndarray:
    image_t = torch.from_numpy(
        np.ascontiguousarray(padded_rgb.transpose(2, 0, 1), dtype=np.float32) / 255.0
    )[None].to(device)
    mask_t = torch.from_numpy(
        np.ascontiguousarray(padded_mask[None, None], dtype=np.float32) / 255.0
    ).to(device)
    with torch.inference_mode():
        prediction = model(image_t, mask_t)
    result = prediction[0].clamp(0.0, 1.0).mul(255.0).byte().permute(1, 2, 0)
    return np.ascontiguousarray(result.cpu().numpy())


def _finish(result: np.ndarray, size: Tuple[int, int], scale: float) -> np.ndarray:
    h, w = size
    if scale < 1.0:
        return cv2.resize(result[:, :, :3], (w, h), interpolation=cv2.INTER_CUBIC)
    return np.ascontiguousarray(result[:h, :w, :3])


def _telea_fill(crop_rgb: np.ndarray, crop_mask: np.ndarray) -> np.ndarray:
    """Cheap diffusion fill for a handful of pixels."""

    bgr = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR)
    filled = cv2.inpaint(bgr, (crop_mask > 0).astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)
    return cv2.cvtColor(filled, cv2.COLOR_BGR2RGB)


def _blend(
    target: np.ndarray,
    filled: np.ndarray,
    mask: np.ndarray,
    feather: float = 1.6,
) -> None:
    """Write ``filled`` into ``target`` only where ``mask`` is set, feathered."""

    hard = mask > 0
    alpha = cv2.GaussianBlur(hard.astype(np.float32), (0, 0), feather)
    alpha = np.clip(alpha * 1.6, 0.0, 1.0)
    # Strictly inside the mask: every unmasked pixel stays bit-identical.
    alpha[~hard] = 0.0
    region = target.astype(np.float32)
    np.copyto(
        region,
        region * (1.0 - alpha[..., None]) + filled.astype(np.float32) * alpha[..., None],
        where=alpha[..., None] > 0,
    )
    target[...] = np.clip(region, 0, 255).astype(np.uint8)


class LamaEngine(BaseInpaintingEngine):
    """Big-LaMa (manga fine-tune) inpainting with crop-based orchestration."""

    @property
    def name(self) -> str:
        return "lama"

    def inpaint(
        self,
        image_rgb: np.ndarray,
        mask: np.ndarray,
        radius: int = 3,
        margin: int = DEFAULT_MARGIN,
        max_side: int = DEFAULT_MAX_SIDE,
    ) -> np.ndarray:
        if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
            raise ValueError("image must be HxWx3 RGB")
        if mask.shape[:2] != image_rgb.shape[:2]:
            raise ValueError("mask must match the image size")
        if not mask.any():
            # No-op without touching the checkpoint: this keeps "erase on an
            # empty selection" instant even on a cold process.
            return image_rgb.copy()

        boxes = _crop_boxes(mask, margin)
        if not boxes:
            return image_rgb.copy()

        output = image_rgb.copy()
        jobs = []  # (box, crop, mask, needs_model)
        for box in boxes:
            x1, y1, x2, y2 = box
            crop_rgb = image_rgb[y1:y2, x1:x2]
            crop_mask = mask[y1:y2, x1:x2]
            if not crop_mask.any():
                continue
            needs_model = int((crop_mask > 0).sum()) >= TINY_MASK_PX
            jobs.append((box, crop_rgb, crop_mask, needs_model))

        handled = sum(1 for job in jobs if not job[3])
        if handled:
            print(f"[lama] {handled} tiny cluster(s) filled with Telea", flush=True)

        filled_list: List[Optional[np.ndarray]] = [None] * len(jobs)
        model_index = [i for i, job in enumerate(jobs) if job[3]]
        if model_index:
            outs = self._run_model_jobs([jobs[i] for i in model_index], max_side)
            for i, out in zip(model_index, outs):
                filled_list[i] = out

        for i, (box, crop_rgb, crop_mask, needs_model) in enumerate(jobs):
            filled = filled_list[i]
            if filled is None:
                filled = _telea_fill(crop_rgb, crop_mask)
            x1, y1, x2, y2 = box
            with _infer_lock:
                _blend(output[y1:y2, x1:x2], filled, crop_mask)
        return output

    def _run_model_jobs(self, jobs, max_side: int) -> List[np.ndarray]:
        """Run every crop that needs the network, batched when a backend exists."""

        payload = [(crop, cmask, max_side) for _box, crop, cmask, _n in jobs]

        if _batch_backend is not None:
            try:
                outs = _batch_backend(payload)
                if outs and len(outs) == len(payload):
                    return list(outs)
                print("[lama] batch backend returned no result, falling back", flush=True)
            except Exception as exc:  # e.g. ZeroGPU quota exhausted
                print(f"[lama] GPU backend failed ({exc}); using CPU", flush=True)

        device = pick_device()
        model = _get_model(device)
        if model is None:
            model = _get_model("cpu")
            device = "cpu"
        if model is None:
            raise RuntimeError(_load_error or "LaMa model unavailable")

        results: List[np.ndarray] = []
        for crop, cmask, side in payload:
            filled, _ = _run_crop(model, crop, cmask, side, device=device)
            results.append(filled)
        return results
