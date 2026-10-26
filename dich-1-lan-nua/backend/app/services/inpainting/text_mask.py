"""Pixel-accurate text masks for speech-bubble cleaning.

The old smart-erase pipeline asked OCR for text boxes and then painted the
whole box (or an OCR-derived rectangle) with OpenCV inpainting.  Two problems
followed: OCR misses text, and Telea/NS smear the antialiased glyph edges into
grey ghosts on a flat white bubble.

This module works in the opposite direction: within each user region it finds
the actual ink pixels, keeps glyph-sized components, and remembers the local
bubble background colour.  Flat regions can then be filled with that exact
colour, which is both faster and visually cleaner than diffusion inpainting.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Sequence, Tuple

import cv2
import numpy as np

Region = Tuple[int, int, int, int]


@dataclass
class TextMaskResult:
    mask: np.ndarray  # full-size uint8 mask (0 / 255)
    background: np.ndarray  # RGB colour of the local bubble background
    flat: bool  # background is uniform enough for a solid fill
    coverage: float  # fraction of the processed crop covered by the mask
    components: int
    bubble_box: Tuple[int, int, int, int] | None = None
    interior: np.ndarray | None = None  # full-size bubble interior (0/255)


def _dominant_color(pixels: np.ndarray) -> np.ndarray:
    """Robust modal colour for a small RGB pixel set."""

    if pixels.size == 0:
        return np.array([255, 255, 255], dtype=np.uint8)
    if pixels.shape[0] > 40000:
        step = max(1, pixels.shape[0] // 40000)
        pixels = pixels[::step]
    quant = (pixels.astype(np.int32) // 16).astype(np.int32)
    keys = (quant[:, 0] << 8) | (quant[:, 1] << 4) | quant[:, 2]
    values, counts = np.unique(keys, return_counts=True)
    best = values[int(np.argmax(counts))]
    r = (best >> 8) & 0xF
    g = (best >> 4) & 0xF
    b = best & 0xF
    lo = np.array([r << 4, g << 4, b << 4], dtype=np.int32)
    hi = lo + 15
    in_bin = np.all((pixels >= lo) & (pixels <= hi), axis=1)
    if not in_bin.any():
        return pixels.mean(axis=0).round().astype(np.uint8)
    return pixels[in_bin].mean(axis=0).round().astype(np.uint8)


def _fill_holes(component: np.ndarray) -> np.ndarray:
    contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(component)
    if contours:
        cv2.drawContours(filled, contours, -1, 255, thickness=cv2.FILLED)
    return filled


def _bubble_interior(color_like: np.ndarray) -> np.ndarray:
    """Return the likely bubble interior (holes filled, outline excluded)."""

    h, w = color_like.shape
    area = float(h * w)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        color_like, connectivity=8
    )
    if count <= 1:
        return np.full((h, w), 255, dtype=np.uint8)

    candidates = []
    for idx in range(1, count):
        x, y, bw, bh, comp_area = stats[idx]
        if comp_area < area * 0.12:
            continue
        touches = x <= 1 or y <= 1 or x + bw >= w - 1 or y + bh >= h - 1
        candidates.append((comp_area, idx, touches))

    if not candidates:
        return np.full((h, w), 255, dtype=np.uint8)

    # Prefer a component fully enclosed by the crop (a complete bubble); if
    # the crop is already inside a bubble, its white component touches the
    # border, which is fine too.
    enclosed = [item for item in candidates if not item[2]]
    chosen = max(enclosed or candidates, key=lambda item: item[0])
    component = (labels == chosen[1]).astype(np.uint8) * 255
    interior = _fill_holes(component)
    # Erode just enough to keep the black bubble outline out of the mask.
    radius = max(2, int(round(min(h, w) * 0.006)))
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)
    )
    interior = cv2.erode(interior, kernel)
    if not interior.any():
        return np.full((h, w), 255, dtype=np.uint8)
    return interior


def _locate_bubble(
    image_rgb: np.ndarray, region: Region
) -> Tuple[Tuple[int, int, int, int], np.ndarray, np.ndarray] | None:
    """Expand a line selection to the enclosing speech bubble, if any.

    Comic bubbles are closed white (or flat coloured) shapes.  Selecting a text
    line inside one and then growing the window until that flat component is
    fully enclosed gives us the whole bubble.  This lets the eraser remove text
    lines that OCR missed, while still preserving the bubble outline.
    """

    h_img, w_img = image_rgb.shape[:2]
    rx, ry, rw, rh = region
    region_area = float(max(1, rw * rh))
    base = image_rgb[ry : ry + rh, rx : rx + rw]
    if base.size == 0:
        return None
    background = _dominant_color(base.reshape(-1, 3))

    for factor in (1.5, 2.1, 2.9, 4.0, 6.0):
        # A narrow OCR line box can sit in a much wider bubble, so the search
        # window also has a minimum size in both axes.
        ex_w = min(w_img, max(200, int(round(rw * factor)) + 48))
        ex_h = min(h_img, max(200, int(round(rh * factor)) + 48))
        cx = rx + rw // 2
        cy = ry + rh // 2
        x1 = max(0, cx - ex_w // 2)
        y1 = max(0, cy - ex_h // 2)
        x2 = min(w_img, x1 + ex_w)
        y2 = min(h_img, y1 + ex_h)
        if x2 - x1 < rw or y2 - y1 < rh:
            continue
        crop = image_rgb[y1:y2, x1:x2]
        diff = np.max(
            np.abs(crop.astype(np.int16) - background.astype(np.int16)), axis=2
        )
        color_like = (diff <= 34).astype(np.uint8)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(
            color_like, connectivity=8
        )
        if count <= 1:
            continue

        # Count all labels inside the region in one vectorised pass.  A crop
        # can easily contain thousands of screentone components, so looping
        # per label and slicing the image is prohibitively slow.
        roi_x1 = max(0, rx - x1)
        roi_y1 = max(0, ry - y1)
        roi_x2 = min(x2 - x1, rx + rw - x1)
        roi_y2 = min(y2 - y1, ry + rh - y1)
        if roi_x2 <= roi_x1 or roi_y2 <= roi_y1:
            continue
        counts = np.bincount(
            labels[roi_y1:roi_y2, roi_x1:roi_x2].ravel(), minlength=count
        )
        counts[0] = 0
        best_label = int(np.argmax(counts))
        best_overlap = int(counts[best_label])
        if best_label == 0 or best_overlap < region_area * 0.45:
            continue

        bx, by, bw, bh, area = stats[best_label]
        cut = (
            (bx <= 1 and x1 > 0)
            or (by <= 1 and y1 > 0)
            or (bx + bw >= (x2 - x1) - 1 and x2 < w_img)
            or (by + bh >= (y2 - y1) - 1 and y2 < h_img)
        )
        if cut:
            continue
        if bw * bh <= region_area * 1.15:
            continue
        # Do not mistake a whole white manga panel for a speech bubble.  Panels
        # are large, rectangular and fill their bounding box almost completely;
        # bubbles are small and rounded.
        image_area = float(h_img * w_img)
        if bw * bh > image_area * 0.09:
            continue
        if bw > w_img * 0.5 or bh > h_img * 0.45:
            continue
        if area / float(max(1, bw * bh)) > 0.9:
            continue

        component = (labels == best_label).astype(np.uint8) * 255
        interior = _fill_holes(component)
        radius = max(2, int(round(min(bw, bh) * 0.006)))
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)
        )
        interior = cv2.erode(interior, kernel)
        if not interior.any():
            continue
        bubble_bg = _dominant_color(crop[interior > 0])
        interior_full = np.zeros((h_img, w_img), dtype=np.uint8)
        interior_full[y1:y2, x1:x2] = interior
        bbox = (
            max(0, x1 + bx - 2),
            max(0, y1 + by - 2),
            min(w_img, x1 + bx + bw + 2) - max(0, x1 + bx - 2),
            min(h_img, y1 + by + bh + 2) - max(0, y1 + by - 2),
        )
        return bbox, interior_full, bubble_bg
    return None


def _locate_bubble_luma(
    image_rgb: np.ndarray, region: Region
) -> Tuple[Tuple[int, int, int, int], np.ndarray, np.ndarray] | None:
    """Locate a translucent / patterned speech bubble by luminance.

    Flat white bubbles are handled by ``_locate_bubble`` using colour.  A
    semi-transparent bubble over artwork does not have one colour, but it is
    usually a large bright (or dark) blob separated from the panel background
    by its outline.  Otsu + largest-overlap component recovers that blob.
    """

    h_img, w_img = image_rgb.shape[:2]
    rx, ry, rw, rh = region
    region_area = float(max(1, rw * rh))

    for factor in (1.5, 2.1, 2.9, 4.0):
        ex_w = min(w_img, max(200, int(round(rw * factor)) + 48))
        ex_h = min(h_img, max(200, int(round(rh * factor)) + 48))
        cx, cy = rx + rw // 2, ry + rh // 2
        x1, y1 = max(0, cx - ex_w // 2), max(0, cy - ex_h // 2)
        x2, y2 = min(w_img, x1 + ex_w), min(h_img, y1 + ex_h)
        if x2 - x1 < rw or y2 - y1 < rh:
            continue
        crop = image_rgb[y1:y2, x1:x2]
        gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        if float(gray.std()) < 6:
            continue
        _thr, bright = cv2.threshold(
            gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        if bright.mean() > 200:
            bright = 255 - bright

        for polarity in (bright, 255 - bright):
            count, labels, stats, _ = cv2.connectedComponentsWithStats(
                (polarity > 0).astype(np.uint8), connectivity=8
            )
            if count <= 1:
                continue
            roi_x1, roi_y1 = max(0, rx - x1), max(0, ry - y1)
            roi_x2 = min(x2 - x1, rx + rw - x1)
            roi_y2 = min(y2 - y1, ry + rh - y1)
            if roi_x2 <= roi_x1 or roi_y2 <= roi_y1:
                continue
            counts = np.bincount(
                labels[roi_y1:roi_y2, roi_x1:roi_x2].ravel(), minlength=count
            )
            counts[0] = 0
            best = int(np.argmax(counts))
            if best == 0 or counts[best] < region_area * 0.4:
                continue
            bx, by, bw, bh, area = stats[best]
            cut = (
                (bx <= 1 and x1 > 0)
                or (by <= 1 and y1 > 0)
                or (bx + bw >= (x2 - x1) - 1 and x2 < w_img)
                or (by + bh >= (y2 - y1) - 1 and y2 < h_img)
            )
            if cut:
                continue
            if bw * bh <= region_area * 1.15:
                continue
            # A large transparent bubble can cover 10-15% of the page; a white
            # panel is more rectangular (fill ratio near 1), a bubble is
            # rounded (typically 0.55-0.85).
            if bw * bh > h_img * w_img * 0.2:
                continue
            if bw > w_img * 0.6 or bh > h_img * 0.55:
                continue
            if area / float(max(1, bw * bh)) > 0.88:
                continue
            component = (labels == best).astype(np.uint8) * 255
            interior = _fill_holes(component)
            radius = max(2, int(round(min(bw, bh) * 0.006)))
            interior = cv2.erode(
                interior,
                cv2.getStructuringElement(
                    cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1)
                ),
            )
            if not interior.any():
                continue
            inside = gray[interior > 0].astype(np.float32)
            outside = gray[component == 0].astype(np.float32)
            if abs(float(inside.mean()) - float(outside.mean())) < 12:
                continue
            interior_full = np.zeros((h_img, w_img), dtype=np.uint8)
            interior_full[y1:y2, x1:x2] = interior
            bbox = (
                max(0, x1 + bx - 2),
                max(0, y1 + by - 2),
                min(w_img, x1 + bx + bw + 2) - max(0, x1 + bx - 2),
                min(h_img, y1 + by + bh + 2) - max(0, y1 + by - 2),
            )
            background = _dominant_color(crop[interior > 0])
            return bbox, interior_full, background
    return None


def build_region_mask(
    image_rgb: np.ndarray,
    region: Region,
    dilation: int = 2,
    pad_ratio: float = 0.08,
) -> TextMaskResult:
    """Build a text-pixel mask inside ``region`` (x, y, w, h).

    If the selection sits inside a closed speech bubble, the mask grows to the
    whole bubble so missed text lines do not survive the erase.
    """

    h_img, w_img = image_rgb.shape[:2]
    rx, ry, rw, rh = (int(v) for v in region)
    rx = max(0, min(w_img - 1, rx))
    ry = max(0, min(h_img - 1, ry))
    rw = max(1, min(w_img - rx, rw))
    rh = max(1, min(h_img - ry, rh))

    located = _locate_bubble(image_rgb, (rx, ry, rw, rh))
    if located is None:
        located = _locate_bubble_luma(image_rgb, (rx, ry, rw, rh))
    bubble_box: Tuple[int, int, int, int] | None = None
    interior_full: np.ndarray | None = None
    if located is not None:
        (x1, y1, bw, bh), interior_full, background = located
        x2, y2 = x1 + bw, y1 + bh
        crop = image_rgb[y1:y2, x1:x2]
        ch, cw = crop.shape[:2]
        interior = interior_full[y1:y2, x1:x2]
        bubble_box = (x1, y1, bw, bh)
    else:
        pad = max(6, int(round(max(rw, rh) * pad_ratio)))
        x1 = max(0, rx - pad)
        y1 = max(0, ry - pad)
        x2 = min(w_img, rx + rw + pad)
        y2 = min(h_img, ry + rh + pad)
        crop = image_rgb[y1:y2, x1:x2]
        ch, cw = crop.shape[:2]
        interior = None
        background = None
    if ch < 4 or cw < 4:
        return TextMaskResult(
            np.zeros((h_img, w_img), dtype=np.uint8),
            np.array([255, 255, 255], dtype=np.uint8),
            True,
            0.0,
            0,
        )

    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)

    # Background colour is estimated from the whole crop; the modal colour of
    # a speech bubble is its paper/white colour even when the crop also
    # contains an outline or screentone.
    if background is None:
        background = _dominant_color(crop.reshape(-1, 3))
    diff = np.max(np.abs(crop.astype(np.int16) - background.astype(np.int16)), axis=2)
    if interior is None:
        color_like = (diff <= 34).astype(np.uint8)
        interior = _bubble_interior(color_like)

    # Ink candidate: follow the text polarity of the bubble.  Using absolute
    # colour distance also selects light grid/pattern lines on a translucent
    # bubble, which then get "erased" as large patches.  If the bubble is
    # light, text is dark; if dark, text is light.
    bg_gray = float(
        0.299 * float(background[0])
        + 0.587 * float(background[1])
        + 0.114 * float(background[2])
    )
    # Otsu inside the interior adapts to translucent backgrounds where the
    # grid/pattern sits between the paper colour and the black glyphs.  A fixed
    # "background - 35" threshold would also select dark pattern lines.
    interior_values = gray[interior > 0]
    if interior_values.size > 0:
        otsu_threshold, _ = cv2.threshold(
            interior_values, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
    else:
        otsu_threshold = bg_gray
    if bg_gray >= 110:
        threshold = min(bg_gray - 25, max(35.0, float(otsu_threshold)))
        ink = (gray.astype(np.float32) < threshold).astype(np.uint8) * 255
    else:
        threshold = max(bg_gray + 25, min(220.0, float(otsu_threshold)))
        ink = (gray.astype(np.float32) > threshold).astype(np.uint8) * 255
    ink = cv2.bitwise_and(ink, interior)

    # Low-contrast / unusual lettering: fall back to the old contrast union if
    # polarity found almost nothing.
    if float((ink > 0).sum()) < 0.0015 * ch * cw:
        adaptive = cv2.adaptiveThreshold(
            gray,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            15,
            8,
        )
        ink = cv2.bitwise_or((diff > 42).astype(np.uint8) * 255, adaptive)
        ink = cv2.bitwise_and(ink, interior)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    mask = np.zeros_like(ink)
    area_crop = float(ch * cw)
    kept = 0
    for idx in range(1, count):
        x, y, bw, bh, area = stats[idx]
        if area < 4:
            continue
        if area > area_crop * 0.16:
            continue
        if bw >= cw * 0.97 and bh >= ch * 0.97:
            continue
        if max(bw, bh) / float(max(1, min(bw, bh))) > 20 and min(bw, bh) <= 3:
            continue
        # A closed bubble outline has a very small ink/contour-area ratio.
        component = (labels == idx).astype(np.uint8)
        contours, _ = cv2.findContours(
            component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        contour_area = sum(cv2.contourArea(c) for c in contours)
        if contour_area > area * 5 and max(bw, bh) > 0.35 * max(cw, ch):
            continue
        # Components that hug the crop border and are large are usually the
        # bubble outline or a panel border, not text.
        touches = x <= 1 or y <= 1 or x + bw >= cw - 1 or y + bh >= ch - 1
        if touches and area > area_crop * 0.02:
            continue
        mask[labels == idx] = 255
        kept += 1

    mask = cv2.morphologyEx(
        mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    )
    if dilation > 0:
        ksize = 2 * int(dilation) + 1
        mask = cv2.dilate(
            mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize, ksize))
        )
    # Never grow over the bubble outline.
    mask = cv2.bitwise_and(mask, interior)

    # Flatness: fraction of the clean interior that stays close to the modal
    # background colour.  Flat bubbles get a solid fill; textured ones go to
    # an inpainting engine.
    # Measure texture on a border-safe zone, not only on the modal-colour
    # component: the grid/pattern on a translucent bubble is deliberately not
    # part of that component, but it is exactly what makes a solid fill look
    # wrong.  Very dark pixels (panel background / outline) are excluded.
    edges = cv2.Canny(gray, 40, 120)
    zone = np.zeros_like(gray, dtype=bool)
    margin = 5
    if ch > margin * 2 + 4 and cw > margin * 2 + 4:
        zone[margin : ch - margin, margin : cw - margin] = True
    zone &= mask == 0
    # Only measure the bubble interior, not the screentone/art in the corners
    # of its bounding box.
    if interior is not None:
        zone &= interior > 0
    # Ignore the anti-aliased halo around glyphs; otherwise every bubble looks
    # textured simply because text edges are nearby.
    if mask.any():
        zone &= (
            cv2.dilate(
                mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
            )
            == 0
        )
    zone &= gray.astype(np.float32) > max(20.0, bg_gray * 0.45)
    clean = (interior > 0) & (mask == 0)
    if zone.sum() >= 50:
        clean_pixels = crop[zone]
        close = np.mean(
            np.max(np.abs(clean_pixels.astype(np.int16) - background.astype(np.int16)), axis=1)
            <= 18
        )
        clean_gray = gray[zone]
        luminance_std = float(clean_gray.std())
        edge_density = float((edges[zone] > 0).mean())
        # White manga bubbles tolerate a little JPEG/paper texture; a solid
        # fill is both cleaner and faster there.  Coloured/translucent bubbles
        # need a much stricter test because their pattern must be preserved.
        is_white = int(np.min(background)) >= 235
        if is_white:
            flat = bool(
                close >= 0.85
                and luminance_std < 8.0
                and edge_density < 0.02
            )
        else:
            flat = bool(
                close >= 0.95
                and luminance_std < 4.0
                and edge_density < 0.008
            )
    else:
        clean_pixels = crop[clean] if clean.any() else crop.reshape(-1, 3)
        flat = True
    if clean_pixels.size:
        background = _dominant_color(clean_pixels.reshape(-1, 3))

    full = np.zeros((h_img, w_img), dtype=np.uint8)
    full[y1:y2, x1:x2] = mask
    if interior_full is None and interior is not None:
        interior_full = np.zeros((h_img, w_img), dtype=np.uint8)
        interior_full[y1:y2, x1:x2] = interior
    coverage = float((mask > 0).sum()) / float(ch * cw)
    return TextMaskResult(
        mask=full,
        background=background.astype(np.uint8),
        flat=flat,
        coverage=coverage,
        components=int(kept),
        bubble_box=bubble_box,
        interior=interior_full,
    )


def build_combined_mask(
    image_rgb: np.ndarray,
    regions: Sequence[Region],
    dilation: int = 2,
) -> Tuple[np.ndarray, List[TextMaskResult], np.ndarray]:
    """Combine all region masks and build a per-pixel fill colour map."""

    h, w = image_rgb.shape[:2]
    combined = np.zeros((h, w), dtype=np.uint8)
    fill_map = np.zeros((h, w, 3), dtype=np.uint8)
    analyses: List[TextMaskResult] = []
    # Multiple OCR lines often share one bubble.  Analysing every line repeats
    # the bubble search and mask extraction; reuse the first result when a
    # subsequent region is fully inside an already-detected bubble.
    bubble_cache: List[TextMaskResult] = []
    for region in regions:
        rx, ry, rw, rh = region
        cached = None
        for item in bubble_cache:
            if item.bubble_box is None:
                continue
            bx, by, bw, bh = item.bubble_box
            if (
                rx >= bx
                and ry >= by
                and rx + rw <= bx + bw
                and ry + rh <= by + bh
            ):
                cached = item
                break
        if cached is not None:
            continue
        result = build_region_mask(image_rgb, region, dilation=dilation)
        if result.bubble_box is not None:
            bubble_cache.append(result)
        analyses.append(result)
        combined = cv2.bitwise_or(combined, result.mask)
        fill_map[result.mask > 0] = result.background
    return combined, analyses, fill_map
