"""Smart text erasing with pixel masks and flat-colour bubble filling.

This replaces the previous OCR-box + Telea approach, which was slow (it loaded
an OCR model once per region) and left grey ghosts from antialiased glyphs.
"""

from __future__ import annotations

import logging
import time
from typing import List, Tuple

import cv2
import numpy as np
from PIL import Image

from app.services.inpainting.text_mask import build_combined_mask
from app.services.inpainting.texture_fill import reconstruct_texture
from app.services.inpainting.opencv_engine import (
    OpenCVNavierStokesEngine,
    OpenCVTeleaEngine,
)

logger = logging.getLogger(__name__)

try:  # LaMa is optional (torch + model file); never download on the hot path.
    from app.services.inpainting.lama_engine import (
        LamaEngine,
        is_available as lama_available,
    )
except Exception:  # pragma: no cover
    LamaEngine = None  # type: ignore[assignment]

    def lama_available() -> bool:  # type: ignore[misc]
        return False


_REGION_PAD_RATIO = 0.08


def _decode(image_bytes: bytes) -> np.ndarray:
    with Image.open(__import__("io").BytesIO(image_bytes)) as pil:
        return np.array(pil.convert("RGB"))


def _encode(rgb: np.ndarray, output_format: str = "png") -> bytes:
    """Encode the cleaned page.

    PNG is the compatibility default and is lossless.  WebP uses OpenCV's
    lossless mode (quality 101), so it preserves every pixel while cutting a
    1.1-1.4 MB page to roughly 0.6-0.8 MB.  JPEG is available at quality 98
    for clients that explicitly ask for it, but it is lossy and not recommended
    for line art.
    """

    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    fmt = (output_format or "png").lower()
    if fmt in ("webp", "image/webp"):
        # OpenCV maps quality 101 to WebP lossless mode (pixel-identical).
        ok, buffer = cv2.imencode(
            ".webp", bgr, [int(cv2.IMWRITE_WEBP_QUALITY), 101]
        )
    elif fmt in ("jpg", "jpeg", "image/jpeg"):
        ok, buffer = cv2.imencode(
            ".jpg", bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 98]
        )
    else:
        ok, buffer = cv2.imencode(
            ".png", bgr, [int(cv2.IMWRITE_PNG_COMPRESSION), 1]
        )
    if not ok:
        raise RuntimeError(f"Image encoding failed ({fmt})")
    return buffer.tobytes()


def _normalise_regions(
    regions: List[Tuple[int, int, int, int]], width: int, height: int
) -> List[Tuple[int, int, int, int]]:
    normalised: List[Tuple[int, int, int, int]] = []
    for raw in regions or []:
        try:
            rx, ry, rw, rh = (int(v) for v in raw)
        except (TypeError, ValueError):
            continue
        x1 = max(0, rx)
        y1 = max(0, ry)
        x2 = min(width, rx + rw)
        y2 = min(height, ry + rh)
        if x2 - x1 >= 2 and y2 - y1 >= 2:
            normalised.append((x1, y1, x2 - x1, y2 - y1))
    return normalised


def _inpaint_engine(name: str):
    lowered = (name or "").lower()
    if lowered in ("opencv_ns", "ns", "navier_stokes"):
        return OpenCVNavierStokesEngine()
    return OpenCVTeleaEngine()


def smart_erase(
    image_bytes: bytes,
    regions: List[Tuple[int, int, int, int]],
    dilation: int = 5,
    engine_name: str = "auto",
    padding: int = 24,
    output_format: str = "png",
) -> Tuple[bytes, dict]:
    """Erase text inside one or more user-selected regions.

    Returns ``(png_bytes, stats)``.  ``engine_name`` accepts:

    * ``auto`` (default) - exact flat fill for solid bubbles, manga-tuned LaMa
      for translucent / patterned bubbles when it is installed, structure-aware
      reconstruction otherwise (never a flat patch on textured artwork)
    * ``flat`` - solid-fill every region (best for clean manga bubbles)
    * ``texture`` - structure-aware reconstruction (preserves grid/stripes)
    * ``flatten`` - turn a translucent/patterned bubble into a solid colour;
      deliberately lossy, kept only as an explicit manual choice
    * ``opencv_telea`` / ``opencv_ns`` - classical diffusion for the whole mask
    * ``lama`` - neural inpainting for the whole mask when the optional model
      is installed, otherwise the same safe fallback as ``auto``
    """

    started = time.perf_counter()
    rgb = _decode(image_bytes)
    height, width = rgb.shape[:2]

    norm_regions = _normalise_regions(regions, width, height)
    stats: dict = {
        "regions": len(norm_regions),
        "text_boxes": 0,
        "engine": engine_name or "auto",
        "dilation": dilation,
    }
    if not norm_regions:
        stats.update(
            status="no_regions",
            elapsed_ms=round((time.perf_counter() - started) * 1000.0, 2),
            engine_used="none",
        )
        return _encode(rgb, output_format), stats

    safe_dilation = max(0, min(int(dilation or 0), 8))
    mask, analyses, fill_map = build_combined_mask(
        rgb, norm_regions, dilation=safe_dilation
    )
    components = sum(item.components for item in analyses)
    # "text_boxes" is the number of regions/bubbles actually processed (what
    # the UI reports); individual glyph components are exposed separately.
    stats["text_boxes"] = len(analyses)
    stats["mask_components"] = components
    stats["analyzed_regions"] = len(analyses)
    stats["flat_regions"] = sum(1 for item in analyses if item.flat)
    stats["textured_regions"] = len(analyses) - stats["flat_regions"]

    if not mask.any():
        stats.update(
            status="no_text_detected",
            elapsed_ms=round((time.perf_counter() - started) * 1000.0, 2),
            engine_used="none",
        )
        return _encode(rgb, output_format), stats

    lowered = (engine_name or "auto").lower()
    if lowered == "flatten":
        # Deliberately turn a translucent / patterned bubble into a clean
        # solid-colour bubble.  This is the safest option when the artwork
        # behind the text cannot be reconstructed faithfully on CPU.
        output = rgb.copy()
        used_full_bubble = False
        for item in analyses:
            if (
                item.bubble_box is not None
                and item.interior is not None
                and item.interior.any()
            ):
                output[item.interior > 0] = item.background
                used_full_bubble = True
            else:
                output = reconstruct_texture(
                    output, item.mask, item.interior, fallback_color=item.background
                )
        stats["mask_coverage_pct"] = round(
            100.0 * float((mask > 0).sum()) / float(height * width), 3
        )
        stats["elapsed_ms"] = round((time.perf_counter() - started) * 1000.0, 2)
        stats["engine_used"] = "flatten"
        stats["format"] = (output_format or "png").lower()
        stats["status"] = "ok"
        return _encode(output, output_format), stats

    output = rgb.copy()
    engine_used = "flat"

    if lowered in ("opencv_telea", "opencv_ns", "ns"):
        engine = _inpaint_engine(lowered)
        output = engine.inpaint(output, mask, radius=3)
        engine_used = engine.name
    elif lowered == "lama" and lama_available():
        try:
            output = LamaEngine().inpaint(output, mask, radius=3)  # type: ignore[misc]
            engine_used = "lama"
        except Exception as exc:  # pragma: no cover - optional dependency
            logger.warning("LaMa inpainting failed, falling back: %s", exc)
            lowered = "auto"
    elif lowered in ("flat", "flat_fill"):
        output[mask > 0] = fill_map[mask > 0]
        engine_used = "flat"
    elif lowered in ("texture", "texture_fill", "reconstruct"):
        for item in analyses:
            output = reconstruct_texture(
                output,
                item.mask,
                item.interior,
                fallback_color=item.background,
            )
        engine_used = "texture"
    else:
        # auto: solid bubbles get an exact colour fill; translucent and
        # patterned bubbles go through the neural engine when it is installed,
        # because that is the artwork a flat patch cannot reproduce.  Without
        # LaMa they fall back to reconstruction from their own texture.  A flat
        # patch is never used for the latter - that is what produced the
        # text-shaped "ghost" users rejected.
        #
        # All textured regions are batched into a single engine call: a text
        # cluster costs ~10 s on CPU, and the lines of one bubble share the
        # same crop, so calling the engine per OCR line was 4x the work.
        textured_mask = np.zeros_like(mask)
        textured_items = []
        for item in analyses:
            if item.flat:
                output[item.mask > 0] = item.background
            else:
                textured_items.append(item)
                textured_mask = cv2.bitwise_or(textured_mask, item.mask)

        used_flat = bool(analyses) and len(textured_items) < len(analyses)
        used_lama = False
        used_texture = False
        if textured_items:
            if lama_available():
                try:
                    output = LamaEngine().inpaint(output, textured_mask)  # type: ignore[misc]
                    used_lama = True
                except Exception as exc:  # pragma: no cover - optional dependency
                    logger.warning("LaMa region failed, using texture fill: %s", exc)
            if not used_lama:
                for item in textured_items:
                    output = reconstruct_texture(
                        output,
                        item.mask,
                        item.interior,
                        fallback_color=item.background,
                    )
                used_texture = True

        if used_flat and used_lama:
            engine_used = "flat+lama"
        elif used_lama:
            engine_used = "lama"
        elif used_texture and used_flat:
            engine_used = "flat+texture"
        elif used_texture:
            engine_used = "texture"
        else:
            engine_used = "flat"

    stats["mask_coverage_pct"] = round(
        100.0 * float((mask > 0).sum()) / float(height * width), 3
    )
    stats["elapsed_ms"] = round((time.perf_counter() - started) * 1000.0, 2)
    stats["engine_used"] = engine_used
    stats["format"] = (output_format or "png").lower()
    stats["status"] = "ok"
    return _encode(output, output_format), stats
