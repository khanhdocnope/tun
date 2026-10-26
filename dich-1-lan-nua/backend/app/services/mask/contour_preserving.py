"""Contour-preserving mask helpers ported from tool-xoa-anh/mask_logic.py.

Pure OpenCV/numpy, no neural nets. Used by smart_erase to keep mask from
leaking across bubble outlines / line art.
"""

from typing import Sequence, Tuple

import cv2
import numpy as np

Box = Tuple[float, float, float, float]


def _ellipse(k: int) -> np.ndarray:
    k = max(3, int(k) | 1)
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))


def rect_mask(h: int, w: int, boxes: Sequence[Box], pad: int = 0) -> np.ndarray:
    m = np.zeros((h, w), dtype=np.uint8)
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
    min_area: int = 25,
    edge_thr1: int = 40,
    edge_thr2: int = 130,
    barrier_grow: int = 2,
) -> np.ndarray:
    """Extract bubble outlines / line art as a protective barrier mask."""
    h, w = gray.shape[:2]
    clean_gray = gray.copy()
    if text_mask.any():
        clean_gray[text_mask > 0] = 255

    ink = (clean_gray < ink_thr).astype(np.uint8) * 255
    blurred = cv2.GaussianBlur(clean_gray, (3, 3), 0)
    edges = cv2.Canny(blurred, edge_thr1, edge_thr2)
    raw_barrier = cv2.bitwise_or(ink, edges)

    n, lab, stats, _ = cv2.connectedComponentsWithStats(raw_barrier, connectivity=8)
    if n <= 1:
        return np.zeros((h, w), dtype=np.uint8)
    areas = stats[:, cv2.CC_STAT_AREA]
    keep = areas >= min_area
    keep[0] = False
    barrier = (keep[lab].astype(np.uint8)) * 255

    if barrier_grow > 0:
        k = 2 * barrier_grow + 1
        return cv2.dilate(barrier, _ellipse(k))
    return barrier


def contour_preserving_dilate(
    mask: np.ndarray,
    barrier: np.ndarray,
    dilation_px: int,
) -> np.ndarray:
    """Wavefront dilation 1px/step, blocked by barrier. Never breaches contour."""
    if dilation_px <= 0 or not mask.any():
        return mask.copy()
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
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
    """Snap white stroke/halo around text in colored/tinted bubbles into mask."""
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
        non_text = roi_gray[roi_mask == 0]
        if len(non_text) < 20 or float(np.median(non_text)) >= bg_dark_thr:
            continue
        bright_candidates = (roi_gray >= bright_thr).astype(np.uint8) * 255
        reach = cv2.dilate(roi_mask, _ellipse(2 * max_halo_radius + 1))
        local_bright = cv2.bitwise_and(bright_candidates, reach)
        combined = cv2.bitwise_or(roi_mask, local_bright)
        n, lab, _, _ = cv2.connectedComponentsWithStats(combined, connectivity=8)
        if n <= 1:
            continue
        text_labels = np.unique(lab[roi_mask > 0])
        text_labels = text_labels[text_labels != 0]
        snapped_roi = np.isin(lab, text_labels).astype(np.uint8) * 255
        out_mask[by1:by2, bx1:bx2] = cv2.bitwise_or(out_mask[by1:by2, bx1:bx2], snapped_roi)
    return out_mask