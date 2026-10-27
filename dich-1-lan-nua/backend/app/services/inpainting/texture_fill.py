"""Structure-aware reconstruction for translucent / patterned speech bubbles.

Diffusion inpainting (Telea/NS) smears a grid or screentone, a solid fill
leaves a text-shaped colour patch, and a blind directional fill pulls colour
across pattern edges.  The eraser must instead *continue* the artwork behind
the glyphs.

Two ideas make that possible on CPU without a neural network:

``pairwise_directional_fill``
    For every masked pixel, look at the nearest clean pixel above/below and
    left/right.  Each **pair** is interpolated along its own axis, so the
    colour is continued instead of averaged from four unrelated neighbours.
    The pair whose two ends agree in colour is trusted (a vertical lattice bar
    has matching colours above and below the text) and the other pair is
    down-weighted (looking left/right would cross the bar edge).  The direction
    weights are smoothed before blending, which turns hard rectangular seams
    into a continuous ramp.

``reconstruct_texture``
    Adds back high-frequency detail (screentone dots, paper grain) by
    normalised-convolving the residual of nearby clean pixels into the hole.
    Smooth artwork (large flat lattice bars) has almost no residual, so this
    stage is a no-op there and cannot invent texture.

Everything is OpenCV/NumPy, runs on a crop around the mask, and never touches
pixels outside the text mask or the bubble interior.
"""

from __future__ import annotations

from typing import Optional, Tuple

import cv2
import numpy as np


def _bbox(mask: np.ndarray, pad: int) -> Optional[Tuple[int, int, int, int]]:
    ys, xs = np.where(mask)
    if xs.size == 0:
        return None
    h, w = mask.shape[:2]
    x1 = max(0, int(xs.min()) - pad)
    y1 = max(0, int(ys.min()) - pad)
    x2 = min(w, int(xs.max()) + pad + 1)
    y2 = min(h, int(ys.max()) + pad + 1)
    return x1, y1, x2, y2


def _nearest_clean(clean: np.ndarray, axis: int) -> Tuple[np.ndarray, np.ndarray]:
    """Index of the nearest clean pixel in the negative / positive direction."""

    h, w = clean.shape
    if axis == 0:
        coord = np.arange(h, dtype=np.int32)[:, None] * np.ones((1, w), np.int32)
        neg = np.maximum.accumulate(np.where(clean, coord, -1), axis=0)
        pos = np.minimum.accumulate(np.where(clean, coord, h)[::-1], axis=0)[::-1]
    else:
        coord = np.arange(w, dtype=np.int32)[None, :] * np.ones((h, 1), np.int32)
        neg = np.maximum.accumulate(np.where(clean, coord, -1), axis=1)
        pos = np.minimum.accumulate(np.where(clean, coord, w)[:, ::-1], axis=1)[:, ::-1]
    return neg, pos


def _gather(
    img: np.ndarray, idx: np.ndarray, axis: int, yy: np.ndarray, xx: np.ndarray
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    h, w = img.shape[:2]
    ok = idx >= 0
    if axis == 0:
        safe = np.clip(idx, 0, h - 1)
        values = img[safe, np.arange(w, dtype=np.int32)[None, :]]
        distance = np.abs(yy - idx)
    else:
        safe = np.clip(idx, 0, w - 1)
        values = img[np.arange(h, dtype=np.int32)[:, None], safe]
        distance = np.abs(xx - idx)
    return values, np.where(ok, distance, 0.0), ok


def _pair(
    a: Tuple[np.ndarray, np.ndarray, np.ndarray],
    b: Tuple[np.ndarray, np.ndarray, np.ndarray],
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Linear interpolation between two opposite clean pixels."""

    a_v, a_d, a_ok = a
    b_v, b_d, b_ok = b
    both = a_ok & b_ok
    only_a = a_ok & ~b_ok
    only_b = b_ok & ~a_ok
    denom = np.where(both, a_d + b_d, 1.0)
    est = np.where(
        both[..., None],
        (a_v * b_d[..., None] + b_v * a_d[..., None])
        / np.maximum(denom, 1e-6)[..., None],
        0.0,
    )
    est = np.where(only_a[..., None], a_v, est)
    est = np.where(only_b[..., None], b_v, est)
    span = np.where(both, a_d + b_d, np.where(only_a, a_d, np.where(only_b, b_d, 1e6)))
    diff = np.where(both, np.abs(a_v - b_v).max(axis=2), 6.0)
    return est.astype(np.float32), span.astype(np.float32), diff, (a_ok | b_ok)


def _normalised_convolution(
    rgb: np.ndarray, clean: np.ndarray, sigma: float
) -> np.ndarray:
    weight = clean.astype(np.float32)
    numerator = cv2.GaussianBlur(
        rgb.astype(np.float32) * weight[..., None], (0, 0), sigma
    )
    denominator = cv2.GaussianBlur(weight, (0, 0), sigma)
    return numerator / np.maximum(denominator, 1e-6)[..., None]


def pairwise_directional_fill(
    rgb: np.ndarray,
    mask: np.ndarray,
    interior: Optional[np.ndarray] = None,
    tau: float = 26.0,
    span_gain: float = 18.0,
    pad: int = 24,
    structure_boost: float = 1.8,
    sharpen: float = 0.45,
) -> np.ndarray:
    """Continue the local structure through the text mask.

    ``mask`` is the text-only pixel mask, ``interior`` the bubble interior
    (mask pixels are never sampled from the bubble outline).  Both are full
    size uint8 arrays.  Returns a new RGB image.
    """

    if not mask.any():
        return rgb
    bbox = _bbox(mask, pad)
    if bbox is None:
        return rgb
    x1, y1, x2, y2 = bbox
    img = rgb[y1:y2, x1:x2].astype(np.float32)
    m = mask[y1:y2, x1:x2] > 0
    if interior is not None:
        inside = interior[y1:y2, x1:x2] > 0
    else:
        inside = np.ones(m.shape, dtype=bool)
    clean = inside & ~m
    if int(clean.sum()) < 32:
        # Too little artwork left to sample from; caller decides the fallback.
        return rgb

    h, w = m.shape
    yy, xx = np.indices((h, w)).astype(np.float32)

    neg_y, pos_y = _nearest_clean(clean, 0)
    neg_x, pos_x = _nearest_clean(clean, 1)
    up = _gather(img, neg_y, 0, yy, xx)
    down = _gather(img, pos_y, 0, yy, xx)
    left = _gather(img, neg_x, 1, yy, xx)
    right = _gather(img, pos_x, 1, yy, xx)

    vertical, span_v, diff_v, ok_v = _pair(up, down)
    horizontal, span_h, diff_h, ok_h = _pair(left, right)

    # A pair whose two ends have the same colour is following the artwork;
    # a pair that straddles an edge gets almost no weight.  Short spans are
    # preferred, but only mildly: continuity matters more than distance.
    q_v = np.exp(-((diff_v / tau) ** 2)) / (1.0 + span_v / span_gain)
    q_h = np.exp(-((diff_h / tau) ** 2)) / (1.0 + span_h / span_gain)
    q_v = np.where(ok_v, np.maximum(q_v, 0.02), 0.0).astype(np.float32)
    q_h = np.where(ok_h, np.maximum(q_h, 0.02), 0.0).astype(np.float32)

    if structure_boost > 0:
        # Local orientation from a coarse, text-free estimate.  A vertical
        # lattice bar has a horizontal gradient, so the vertical pair should be
        # preferred there (and vice versa for horizontal bars).
        coarse = _normalised_convolution(img, clean, 5.0)
        gray = cv2.cvtColor(np.clip(coarse, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
        gray = gray.astype(np.float32)
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        sxx = cv2.GaussianBlur(gx * gx, (0, 0), 4.0)
        syy = cv2.GaussianBlur(gy * gy, (0, 0), 4.0)
        sxy = cv2.GaussianBlur(gx * gy, (0, 0), 4.0)
        theta = 0.5 * np.arctan2(2.0 * sxy, sxx - syy)
        coherence = np.sqrt((sxx - syy) ** 2 + 4.0 * sxy ** 2) / np.maximum(
            sxx + syy, 1e-6
        )
        coherence = np.clip(coherence, 0.0, 1.0)
        q_v *= 1.0 + structure_boost * coherence * (np.cos(theta) ** 2)
        q_h *= 1.0 + structure_boost * coherence * (np.sin(theta) ** 2)

    # Smooth the direction choice: hard per-pixel switching leaves visible
    # rectangular seams inside wide glyph blobs.
    q_v = cv2.GaussianBlur(q_v, (0, 0), 2.2)
    q_h = cv2.GaussianBlur(q_h, (0, 0), 2.2)

    total = q_v + q_h
    estimate = (vertical * q_v[..., None] + horizontal * q_h[..., None]) / np.maximum(
        total, 1e-6
    )[..., None]

    fallback = _normalised_convolution(img, clean, 8.0)
    unsupported = m & (total <= 1e-5)
    if unsupported.any():
        estimate[unsupported] = fallback[unsupported]
    estimate = np.nan_to_num(estimate, nan=0.0, posinf=255.0, neginf=0.0)

    if sharpen > 0:
        # Sharpen only the interior of the hole: applying it right at the mask
        # boundary would turn the faint residual halo into a bright outline.
        soft = cv2.GaussianBlur(estimate, (0, 0), 1.4)
        sharpened = np.clip(estimate + sharpen * (estimate - soft), 0, 255)
        core = cv2.erode(
            m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        ) > 0
        estimate[core] = sharpened[core]

    out_crop = img.copy()
    out_crop[m] = estimate[m]
    out_crop = np.clip(out_crop, 0, 255).astype(np.uint8)
    if m.any():
        # Remove any residual interpolation seams without softening real edges
        # outside the mask.
        smooth = cv2.bilateralFilter(out_crop, 7, 14, 7)
        out_crop[m] = smooth[m]

    output = rgb.copy()
    output[y1:y2, x1:x2] = out_crop
    return output


def _texture_energy(rgb: np.ndarray, clean: np.ndarray) -> float:
    if not clean.any():
        return 0.0
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    residual = np.abs(gray - cv2.GaussianBlur(gray, (0, 0), 1.4))
    values = residual[clean]
    return float(values.mean()) if values.size else 0.0


def add_texture_detail(
    rgb: np.ndarray,
    filled: np.ndarray,
    mask: np.ndarray,
    interior: Optional[np.ndarray],
    strength: float = 0.75,
) -> np.ndarray:
    """Restore high-frequency grain / screentone inside the filled hole.

    Only the residual (image minus a small Gaussian) is transferred, so the
    low-frequency structure comes from the pairwise fill and this stage cannot
    darken or brighten the patch.  It is skipped for nearly smooth artwork.
    """

    bbox = _bbox(mask, 20)
    if bbox is None:
        return filled
    x1, y1, x2, y2 = bbox
    img = rgb[y1:y2, x1:x2].astype(np.float32)
    m = mask[y1:y2, x1:x2] > 0
    inside = (
        (interior[y1:y2, x1:x2] > 0)
        if interior is not None
        else np.ones(m.shape, dtype=bool)
    )
    clean = inside & ~m
    if int(clean.sum()) < 64:
        return filled
    if _texture_energy(img, clean) < 3.0:
        return filled

    residual = img - cv2.GaussianBlur(img, (0, 0), 1.4)
    weight = clean.astype(np.float32)
    kernel = cv2.getGaussianKernel(13, 3.5).astype(np.float32)
    kernel = np.outer(kernel, kernel)
    numerator = cv2.filter2D(residual * weight[..., None], -1, kernel)
    denominator = cv2.filter2D(weight, -1, kernel)
    detail = numerator / np.maximum(denominator, 1e-6)[..., None]

    out_crop = filled[y1:y2, x1:x2].astype(np.float32)
    out_crop[m] += detail[m] * strength
    output = filled.copy()
    output[y1:y2, x1:x2] = np.clip(out_crop, 0, 255).astype(np.uint8)
    return output


def reconstruct_texture(
    rgb: np.ndarray,
    mask: np.ndarray,
    interior: Optional[np.ndarray] = None,
    fallback_color: Optional[np.ndarray] = None,
) -> np.ndarray:
    """Reconstruct the artwork under ``mask`` (never a flat colour patch)."""

    if not mask.any():
        return rgb
    filled = pairwise_directional_fill(rgb, mask, interior)
    if fallback_color is not None:
        # Pixels with no clean support at all (rare: a bubble almost fully
        # covered by text) keep the sampled local background; the pairwise
        # fill leaves them untouched, so only those pixels are affected.
        if interior is not None:
            covered = (mask > 0) & (interior > 0)
            unchanged = np.all(filled == rgb, axis=2) & covered
            if unchanged.any():
                filled[unchanged] = fallback_color
    filled = add_texture_detail(rgb, filled, mask, interior)
    return filled


def directional_fill(rgb: np.ndarray, mask: np.ndarray, pad: int = 12) -> np.ndarray:
    """Backward-compatible wrapper around the pairwise structure fill."""

    return pairwise_directional_fill(rgb, mask, interior=None, pad=pad)
