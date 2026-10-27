"""
Deterministic mask logic for Manga Cleaner (no neural nets in here, fully unit-testable).

Upgrades implemented:
1. Contour-Preserving Dilation (Wavefront propagation with barrier stop)
   - Iteratively grows mask pixel-by-pixel, blocking immediately at the dark bubble outline.
   - Completely eliminates mask leakage/smearing onto black bubble contours and line art.
2. Dual-Gate Bubble Filter (Chat vs SFX separation)
   - Text inside speech bubbles (CLS_TEXT_BUBBLE / CLS_BUBBLE) is Chat -> sanitized.
   - Free-floating text outside bubbles (CLS_TEXT_FREE) is SFX -> 100% preserved in default mode.
3. Flat-Fill Uniform Paper Bypass
   - Detects flat paper background inside bubbles and fills immediately with median paper color.
   - Ultra-fast, zero-artifact, 100% razor-sharp bubble contour preservation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import cv2
import numpy as np

CLS_BUBBLE = 0       # speech-bubble outline / region
CLS_TEXT_BUBBLE = 1  # text inside a bubble  -> Chat
CLS_TEXT_FREE = 2    # text outside a bubble -> SFX / narration

Box = Tuple[float, float, float, float]  # x1, y1, x2, y2 in page pixels


@dataclass
class Det:
    cls: int
    score: float
    box: Box


@dataclass
class MaskSet:
    chat_text: np.ndarray    # uint8 0/255  pixels of dialogue strokes
    sfx_text: np.ndarray     # uint8 0/255  pixels of SFX strokes
    chat_erase: np.ndarray   # uint8 0/255  what to erase for Chat (contour-safe wavefront dilated)
    sfx_erase: np.ndarray    # uint8 0/255  what to erase for SFX (only used in "clean all")
    barrier: np.ndarray      # uint8 0/255  protected bubble outline / line art barrier
    chat_boxes: List[Box]
    sfx_boxes: List[Box]


def _ellipse(k: int) -> np.ndarray:
    k = max(3, int(k) | 1)
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))


def rect_mask(h: int, w: int, boxes: Sequence[Box], pad: int = 0) -> np.ndarray:
    m = np.zeros((h, w), np.uint8)
    for x1, y1, x2, y2 in boxes:
        m[max(0, int(y1) - pad): min(h, int(y2) + pad + 1),
          max(0, int(x1) - pad): min(w, int(x2) + pad + 1)] = 255
    return m


def remove_specks(mask: np.ndarray, min_area: int) -> np.ndarray:
    if min_area <= 1 or not mask.any():
        return mask
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = stats[:, cv2.CC_STAT_AREA] >= min_area
    keep[0] = False
    return (keep[lab].astype(np.uint8)) * 255


def extract_contour_barrier(
    gray: np.ndarray,
    text_mask: np.ndarray,
    ink_thr: int = 120,
    min_area: int = 30,
    edge_thr1: int = 40,
    edge_thr2: int = 130,
    barrier_grow: int = 2,
) -> np.ndarray:
    """
    Extracts high-confidence ink contours and structural lines (bubble outlines,
    panel frames, line art) while strictly protecting text strokes from being erased.
    
    Crucial fix: We only mask out text_mask itself (not the entire bounding box rectangle),
    so bubble borders close to or intersecting text boxes remain fully preserved.
    """
    h, w = gray.shape[:2]
    clean_gray = gray.copy()
    if text_mask.any():
        clean_gray[text_mask > 0] = 255

    # 1. Dark ink threshold (bubble borders and panel outlines are black ink)
    ink = (clean_gray < ink_thr).astype(np.uint8) * 255

    # 2. Canny edge detector for sharp gradient contours (anti-aliased borders)
    blurred = cv2.GaussianBlur(clean_gray, (3, 3), 0)
    edges = cv2.Canny(blurred, edge_thr1, edge_thr2)
    raw_barrier = cv2.bitwise_or(ink, edges)

    # 3. Filter out tiny specks / screentone halftone dots
    n, lab, stats, _ = cv2.connectedComponentsWithStats(raw_barrier, connectivity=8)
    if n <= 1:
        return np.zeros((h, w), dtype=np.uint8)

    areas = stats[:, cv2.CC_STAT_AREA]
    keep = areas >= min_area
    keep[0] = False
    barrier = (keep[lab].astype(np.uint8)) * 255

    # Slight dilation to create a protective cushion buffer around the contour
    if barrier_grow > 0:
        k = 2 * barrier_grow + 1
        return cv2.dilate(barrier, _ellipse(k))
    return barrier


def contour_preserving_dilate(
    mask: np.ndarray,
    barrier: np.ndarray,
    dilation_px: int,
) -> np.ndarray:
    """
    Contour-Preserving Wavefront Propagation:
    Dilates `mask` iteratively 1 pixel at a time, immediately blocking any expansion
    that touches `barrier`.
    
    Because propagation is step-by-step, the mask CANNOT jump across or breach the
    dark bubble contour even with high dilation settings (e.g. 10-15px).
    """
    if dilation_px <= 0 or not mask.any():
        return mask.copy()

    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    # Barrier cannot include initial mask strokes (so glyphs don't block themselves)
    effective_barrier = cv2.bitwise_and(barrier, cv2.bitwise_not(mask))

    cur = mask.copy()
    for _ in range(int(dilation_px)):
        expanded = cv2.dilate(cur, k3)
        cur = cv2.bitwise_and(expanded, cv2.bitwise_not(effective_barrier))
        cur = cv2.bitwise_or(cur, mask)

    return cur


def snap_white_halo(
    text_mask: np.ndarray,
    gray: np.ndarray,
    boxes: Sequence[Box],
    max_halo_radius: int = 8,
    bright_thr: int = 215,
    bg_dark_thr: int = 225,
) -> np.ndarray:
    """
    White-Halo Snapping for Color Comics (Manhwa/Webtoon):
    In color/tinted bubbles or background art, text often has a thick white stroke/halo
    around dark glyphs. Because ComicTextDetector only detects the dark glyph core,
    the white outline is left behind, causing ghost text or white blotches.

    This function automatically snaps connected bright pixels (>= bright_thr) that touch
    the text glyphs into the text mask, ensuring both the letter core and its white stroke
    are cleanly covered and erased by inpainting without needing excessive dilation.
    """
    if not text_mask.any() or not boxes:
        return text_mask

    h, w = text_mask.shape[:2]
    out_mask = text_mask.copy()

    for x1, y1, x2, y2 in boxes:
        bx1, by1 = max(0, int(x1) - 10), max(0, int(y1) - 10)
        bx2, by2 = min(w, int(x2) + 10), min(h, int(y2) + 10)

        roi_mask = text_mask[by1:by2, bx1:bx2]
        if not roi_mask.any():
            continue

        roi_gray = gray[by1:by2, bx1:bx2]

        # Check background brightness outside text in this box:
        # If the background is already pure white paper (median >= bg_dark_thr), no white stroke needed
        non_text = roi_gray[roi_mask == 0]
        if len(non_text) < 20 or float(np.median(non_text)) >= bg_dark_thr:
            continue

        # Background is tinted / colored / gray, and text has potential white halo!
        bright_candidates = (roi_gray >= bright_thr).astype(np.uint8) * 255

        # Only bright pixels within `max_halo_radius` of the text
        reach = cv2.dilate(roi_mask, _ellipse(2 * max_halo_radius + 1))
        local_bright = cv2.bitwise_and(bright_candidates, reach)

        # Keep only bright components connected to the text glyphs
        combined = cv2.bitwise_or(roi_mask, local_bright)
        n, lab, _, _ = cv2.connectedComponentsWithStats(combined, connectivity=8)
        if n <= 1:
            continue

        text_labels = np.unique(lab[roi_mask > 0])
        text_labels = text_labels[text_labels != 0]

        snapped_roi = np.isin(lab, text_labels).astype(np.uint8) * 255
        out_mask[by1:by2, bx1:bx2] = cv2.bitwise_or(out_mask[by1:by2, bx1:bx2], snapped_roi)

    return out_mask


def flat_paper_hint(
    img_bgr: np.ndarray,
    strokes: np.ndarray,
    boxes: Sequence[Box],
    paper_min: int = 225,
    min_bright: float = 0.40,
    min_ring: int = 50,
) -> bool:
    """
    Cheap "are these glyphs sitting on bright paper?" test that runs on the LOW-res `seg` map,
    before a full-resolution mask exists: text on paper *is* the ink, so a thin ring around the
    strokes reads the surrounding paper.

    A True answer means flat-fill can paint every box with one solid colour
    (`flat_fill_uniform_paper` still applies its own, stricter, opaque-white gate on the real
    erase mask), so the heavy full-resolution `seg` pass can be skipped for this page.
    """
    if not boxes:
        return False
    h, w = img_bgr.shape[:2]
    if strokes.shape[:2] != (h, w):  # low-res `seg` map -> scale boxes down instead of upsampling ink
        fx, fy = strokes.shape[1] / w, strokes.shape[0] / h
        boxes = [(x1 * fx, y1 * fy, x2 * fx, y2 * fy) for x1, y1, x2, y2 in boxes]
    sh, sw = strokes.shape[:2]
    win = np.zeros((sh, sw), np.uint8)
    for x1, y1, x2, y2 in boxes:
        win[max(0, int(y1) - 3):min(sh, int(y2) + 3), max(0, int(x1) - 3):min(sw, int(x2) + 3)] = 255
    m = cv2.bitwise_and((strokes > 0).astype(np.uint8) * 255, win)
    if not m.any():
        return False
    ring = cv2.bitwise_and(cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))),
                           cv2.bitwise_not(m))
    if int(ring.sum()) < min_ring:
        return False
    sel = ring > 0
    small = cv2.resize(img_bgr, (sw, sh), interpolation=cv2.INTER_AREA)
    small_gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    paper = sel & (small_gray >= 235) & (small.std(axis=2) <= 6)
    if float(paper.sum()) / max(1, int(sel.sum())) < min_bright:
        return False
    return float(small_gray[paper].mean()) >= paper_min


def _eligible_regions(
    dets: Sequence[Det],
    seg_regions: Optional[Sequence[Det]],
) -> Tuple[Sequence[Box], Sequence[Box]]:
    """
    Where the `seg` head has to be read from. `seg_regions`, when given, wins; otherwise every
    detector box of that class.
    """
    if seg_regions is None:
        return ([d.box for d in dets if d.cls == CLS_TEXT_BUBBLE],
                [d.box for d in dets if d.cls == CLS_TEXT_FREE])
    return [d.box for d in seg_regions], []


def build_masks(
    img_bgr: np.ndarray,
    seg_map: np.ndarray,
    dets: Sequence[Det],
    seg_thr: float = 0.30,
    dilation_px: int = 4,
    box_pad: int = 6,
    min_speck: int = 4,
    seg_regions: Optional[Sequence[Det]] = None,
) -> MaskSet:
    """
    Constructs Chat and SFX masks using Dual-Gate Filtering & Contour-Preserving Barrier.

    `chat_boxes` / `sfx_boxes` in the result stay the FULL detector boxes (flat-fill and the
    reports need them). `seg_regions`, when given, only restricts where `seg` is read from.
    """
    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    chat_boxes = [d.box for d in dets if d.cls == CLS_TEXT_BUBBLE]
    sfx_boxes = [d.box for d in dets if d.cls == CLS_TEXT_FREE]
    seg_chat_boxes, seg_sfx_boxes = _eligible_regions(dets, seg_regions)

    box_pad = max(10, box_pad)
    chat_core_box = rect_mask(h, w, chat_boxes, 0)
    chat_region = rect_mask(h, w, seg_chat_boxes, box_pad)
    # Dual-gate filter: SFX must be strictly outside dialogue core boxes
    sfx_region = cv2.bitwise_and(rect_mask(h, w, seg_sfx_boxes, box_pad), cv2.bitwise_not(chat_core_box))

    seg_bin = (seg_map > seg_thr).astype(np.uint8) * 255
    chat_text = remove_specks(cv2.bitwise_and(seg_bin, chat_region), min_speck)
    sfx_text = remove_specks(cv2.bitwise_and(seg_bin, sfx_region), max(min_speck, 12))

    # Auto-snap white halo / stroke around text in colored/tinted bubbles
    chat_text = snap_white_halo(chat_text, gray, seg_chat_boxes, max_halo_radius=8)
    sfx_text = snap_white_halo(sfx_text, gray, seg_sfx_boxes, max_halo_radius=8)

    # All text strokes
    all_text = cv2.bitwise_or(chat_text, sfx_text)

    # Extract contour barrier (bubble contours, panel borders, character line art)
    barrier = extract_contour_barrier(gray, all_text, ink_thr=120, min_area=25, barrier_grow=2)

    r = max(0, int(dilation_px))
    chat_limit = rect_mask(h, w, chat_boxes, box_pad + r + 4)

    # Contour-Preserving Dilation for Dialogue Text
    if r > 0:
        chat_erase = contour_preserving_dilate(chat_text, barrier, dilation_px=r)
    else:
        chat_erase = chat_text.copy()

    chat_erase = cv2.bitwise_and(chat_erase, chat_limit)
    chat_erase = cv2.bitwise_or(chat_erase, chat_text)  # Original glyphs always erased

    # SFX Dilation (only used when user chooses "clean all" / clean_sfx=True)
    sfx_limit = rect_mask(h, w, sfx_boxes, box_pad + r + 2)
    if r > 0 and sfx_text.any():
        sfx_erase = cv2.dilate(sfx_text, _ellipse(2 * (r + 2) + 1))
        sfx_erase = cv2.bitwise_and(sfx_erase, sfx_limit)
    else:
        sfx_erase = sfx_text.copy()

    return MaskSet(chat_text, sfx_text, chat_erase, sfx_erase, barrier, chat_boxes, sfx_boxes)


def build_masks_from_polygons(
    img_bgr: np.ndarray,
    polygons: Sequence[np.ndarray],
    dets: Sequence[Det],
    seg_map: Optional[np.ndarray] = None,
    dilation_px: int = 4,
    box_pad: int = 6,
    min_speck: int = 4,
    seg_regions: Optional[Sequence[Det]] = None,
) -> MaskSet:
    """
    Constructs Chat and SFX masks from detected text polygons (and optional probability map).

    1. Classifies polygons into Chat vs SFX:
       - Checks intersection with bubble boxes (CLS_TEXT_BUBBLE, CLS_BUBBLE).
       - Checks background paper brightness around polygons.
       - Expands chat_boxes with the true polygon bounds to avoid clipping vertical text lines.
    2. Combines polygon raster with per-pixel probability map and dark ink to form crisp text masks.
    3. Runs snap_white_halo and contour_preserving_dilate using barrier protection.
    """
    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    bubble_boxes: List[Box] = [d.box for d in dets if d.cls in (CLS_TEXT_BUBBLE, CLS_BUBBLE)]
    sfx_boxes: List[Box] = [d.box for d in dets if d.cls == CLS_TEXT_FREE]

    near_pad = 35.0
    chat_polys: List[np.ndarray] = []
    sfx_polys: List[np.ndarray] = []

    for p in polygons:
        if len(p) < 3:
            continue
        cx = float(np.mean(p[:, 0]))
        cy = float(np.mean(p[:, 1]))
        min_x = float(np.min(p[:, 0]))
        max_x = float(np.max(p[:, 0]))
        min_y = float(np.min(p[:, 1]))
        max_y = float(np.max(p[:, 1]))

        # Find closest matching bubble box
        matched_bubble_idx = -1
        for idx, b in enumerate(bubble_boxes):
            if ((b[0] - near_pad) <= cx <= (b[2] + near_pad) and
                (b[1] - near_pad) <= cy <= (b[3] + near_pad)):
                matched_bubble_idx = idx
                break

        is_chat = (matched_bubble_idx >= 0)

        # If not clearly near a bubble, check if sitting on bright paper
        if not is_chat:
            is_sfx_explicit = any(b[0] <= cx <= b[2] and b[1] <= cy <= b[3] for b in sfx_boxes)
            if not is_sfx_explicit:
                rx1, ry1 = max(0, int(min_x) - 10), max(0, int(min_y) - 10)
                rx2, ry2 = min(w, int(max_x) + 10), min(h, int(max_y) + 10)
                roi_g = gray[ry1:ry2, rx1:rx2]
                bright_pixels = roi_g[roi_g >= 200]
                if len(bright_pixels) >= 15 and float(np.median(bright_pixels)) >= 210:
                    is_chat = True

        p_int = p.astype(np.int32)
        poly_box: Box = (
            max(0.0, min_x - 12.0),
            max(0.0, min_y - 12.0),
            min(float(w), max_x + 12.0),
            min(float(h), max_y + 12.0),
        )

        if is_chat or not sfx_boxes:
            chat_polys.append(p_int)
            if matched_bubble_idx >= 0:
                b = bubble_boxes[matched_bubble_idx]
                bubble_boxes[matched_bubble_idx] = (
                    min(b[0], poly_box[0]),
                    min(b[1], poly_box[1]),
                    max(b[2], poly_box[2]),
                    max(b[3], poly_box[3]),
                )
            else:
                bubble_boxes.append(poly_box)
        else:
            sfx_polys.append(p_int)
            matched_sfx_idx = -1
            for idx, b in enumerate(sfx_boxes):
                if ((b[0] - near_pad) <= cx <= (b[2] + near_pad) and
                    (b[1] - near_pad) <= cy <= (b[3] + near_pad)):
                    matched_sfx_idx = idx
                    break
            if matched_sfx_idx >= 0:
                b = sfx_boxes[matched_sfx_idx]
                sfx_boxes[matched_sfx_idx] = (
                    min(b[0], poly_box[0]),
                    min(b[1], poly_box[1]),
                    max(b[2], poly_box[2]),
                    max(b[3], poly_box[3]),
                )
            else:
                sfx_boxes.append(poly_box)

    chat_boxes = bubble_boxes

    chat_poly_mask = np.zeros((h, w), dtype=np.uint8)
    if chat_polys:
        cv2.fillPoly(chat_poly_mask, chat_polys, 255)

    sfx_poly_mask = np.zeros((h, w), dtype=np.uint8)
    if sfx_polys:
        cv2.fillPoly(sfx_poly_mask, sfx_polys, 255)

    # Initial text candidate mask
    ink = (gray < 210).astype(np.uint8) * 255
    if seg_map is not None:
        seg_bin = (seg_map > 0.15).astype(np.uint8) * 255
        chat_region = rect_mask(h, w, chat_boxes, max(12, box_pad))
        sfx_region = rect_mask(h, w, sfx_boxes, max(12, box_pad))
        chat_cand = cv2.bitwise_or(chat_poly_mask, cv2.bitwise_and(seg_bin, chat_region))
        sfx_cand = cv2.bitwise_or(sfx_poly_mask, cv2.bitwise_and(seg_bin, sfx_region))
        high_prob = (seg_map > 0.25).astype(np.uint8) * 255
        chat_text = cv2.bitwise_and(chat_cand, cv2.bitwise_or(ink, high_prob))
        sfx_text = cv2.bitwise_and(sfx_cand, cv2.bitwise_or(ink, high_prob))
    else:
        chat_text = cv2.bitwise_and(chat_poly_mask, ink)
        sfx_text = cv2.bitwise_and(sfx_poly_mask, ink)

    chat_text = remove_specks(chat_text, min_speck)
    sfx_text = remove_specks(sfx_text, max(min_speck, 12))

    # Auto-snap white halo / stroke around text in colored/tinted bubbles
    chat_text = snap_white_halo(chat_text, gray, chat_boxes, max_halo_radius=8)
    sfx_text = snap_white_halo(sfx_text, gray, sfx_boxes, max_halo_radius=8)

    # All text strokes
    all_text = cv2.bitwise_or(chat_text, sfx_text)

    # Extract contour barrier (bubble contours, panel borders, character line art)
    barrier = extract_contour_barrier(gray, all_text, ink_thr=120, min_area=25, barrier_grow=2)

    r = max(0, int(dilation_px))
    chat_limit = rect_mask(h, w, chat_boxes, max(15, box_pad + r + 10))

    # Contour-Preserving Dilation for Dialogue Text
    if r > 0:
        chat_erase = contour_preserving_dilate(chat_text, barrier, dilation_px=r)
    else:
        chat_erase = chat_text.copy()

    chat_erase = cv2.bitwise_and(chat_erase, chat_limit)
    chat_erase = cv2.bitwise_or(chat_erase, chat_text)

    # SFX Dilation (only used when user chooses "clean all" / clean_sfx=True)
    sfx_limit = rect_mask(h, w, sfx_boxes, max(15, box_pad + r + 10))
    if r > 0 and sfx_text.any():
        sfx_erase = cv2.dilate(sfx_text, _ellipse(2 * (r + 2) + 1))
        sfx_erase = cv2.bitwise_and(sfx_erase, sfx_limit)
    else:
        sfx_erase = sfx_text.copy()

    return MaskSet(chat_text, sfx_text, chat_erase, sfx_erase, barrier, chat_boxes, sfx_boxes)


def flat_fill_uniform_paper(
    img_bgr: np.ndarray,
    erase: np.ndarray,
    boxes: Sequence[Box],
    margin: int = 24,
    own_pad: int = 14,
    paper_min: int = 210,
    max_std: float = 6.0,
    min_ring: int = 50,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    For each dialogue box: if the paper just around the erased strokes is an
    actual flat, opaque white paper bubble, paint it with that colour instead of
    calling LaMa.
    
    CRITICAL SAFETY GATE:
    If the bubble is transparent, semi-transparent, tinted, or has artwork/lines passing
    through (typical in color manhwa / webtoons), this function returns done=0,
    ensuring it falls through to Big-LaMa for deep-learning reconstruction instead
    of stamping an ugly opaque white patch over the line art.
    """
    h, w = erase.shape
    out = img_bgr.copy()
    done = np.zeros((h, w), np.uint8)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    k_in, k_out = _ellipse(5), _ellipse(17)

    for x1, y1, x2, y2 in boxes:
        X1, Y1 = max(0, int(x1) - margin), max(0, int(y1) - margin)
        X2, Y2 = min(w, int(x2) + margin + 1), min(h, int(y2) + margin + 1)
        owner = rect_mask(h, w, [(x1, y1, x2, y2)], own_pad)[Y1:Y2, X1:X2]
        m = cv2.bitwise_and(erase[Y1:Y2, X1:X2], owner)
        if not m.any():
            continue
        ring = cv2.bitwise_and(cv2.dilate(m, k_out), cv2.bitwise_not(cv2.dilate(m, k_in)))
        # Only true white paper pixels in the ring
        ok = (ring > 0) & (gray[Y1:Y2, X1:X2] >= paper_min)
        if int(ok.sum()) < min_ring:
            continue
        px = img_bgr[Y1:Y2, X1:X2][ok]
        if float(px.std(axis=0).max()) > max_std:
            continue
        color = np.median(px, axis=0).astype(np.uint8)
        # Safety Gate: Paper must be bright paper tone (>= 210 on all channels)
        # If the background is tinted, pastel, or semi-transparent, reject flat fill!
        if float(color.min()) < 210:
            continue
        sel = m > 0
        roi_out = out[Y1:Y2, X1:X2]
        roi_out[sel] = color
        done[Y1:Y2, X1:X2][sel] = 255
    return out, done
