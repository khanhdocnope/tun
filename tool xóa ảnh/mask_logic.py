"""
Deterministic mask logic for Manga Cleaner (no neural nets in here, fully unit-testable).

Idea: the *region* comes from the bubble/text detector (ogkalu RT-DETR-v2:
text_bubble = dialogue, text_free = SFX / narration), the *pixels* come from
the ComicTextDetector `seg` head. A seg pixel only counts if it lies inside a
detector region, so screentone / speedlines / clothes folds can never become
text, and Chat vs SFX is decided by the detector class, not by colour tricks.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Sequence, Tuple

import cv2
import numpy as np

CLS_BUBBLE = 0       # empty speech-bubble outline (ignored)
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
    chat_erase: np.ndarray   # uint8 0/255  what to erase for Chat (dilated, border-safe)
    sfx_erase: np.ndarray    # uint8 0/255  what to erase for SFX (only used in "clean all")
    barrier: np.ndarray      # uint8 0/255  protected bubble outline / line art
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


def protected_ink(gray: np.ndarray, text_core: np.ndarray, ink_thr: int = 110,
                  min_area: int = 60, grow: int = 2) -> np.ndarray:
    """
    Pixels that are dark ink but NOT text: bubble outlines, panel borders, line art.
    A dark connected component is 'structure' when it is big and mostly not text
    (letters are small components that are mostly seg-text). Letters touching the
    outline merge into the outline component, so their own pixels are subtracted
    (they stay erasable) and the rest of the outline is kept, then grown by `grow` px.
    """
    ink = (gray < ink_thr).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    if n <= 1:
        return np.zeros_like(gray, dtype=np.uint8)
    text_px = np.bincount(lab[text_core > 0], minlength=n).astype(np.float32)
    areas = stats[:, cv2.CC_STAT_AREA].astype(np.float32)
    structure = (areas >= min_area) & ((text_px / np.maximum(areas, 1.0)) < 0.5)
    structure[0] = False
    struct_px = structure[lab] & (text_core == 0)
    barrier = struct_px.astype(np.uint8) * 255
    return cv2.dilate(barrier, _ellipse(2 * grow + 1)) if grow > 0 else barrier


def build_masks(
    img_bgr: np.ndarray,
    seg_map: np.ndarray,
    dets: Sequence[Det],
    seg_thr: float = 0.30,
    dilation_px: int = 4,
    box_pad: int = 4,
    min_speck: int = 4,
) -> MaskSet:
    h, w = img_bgr.shape[:2]
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    chat_boxes = [d.box for d in dets if d.cls == CLS_TEXT_BUBBLE]
    sfx_boxes = [d.box for d in dets if d.cls == CLS_TEXT_FREE]

    box_pad = max(10, box_pad)
    chat_core_box = rect_mask(h, w, chat_boxes, 0)
    chat_region = rect_mask(h, w, chat_boxes, box_pad)
    sfx_region = cv2.bitwise_and(rect_mask(h, w, sfx_boxes, box_pad), cv2.bitwise_not(chat_core_box))

    seg_bin = (seg_map > seg_thr).astype(np.uint8) * 255
    chat_text = remove_specks(cv2.bitwise_and(seg_bin, chat_region), min_speck)
    sfx_text = remove_specks(cv2.bitwise_and(seg_bin, sfx_region), max(min_speck, 12))

    # Mask out chat_core_box so text itself/shadows are never mistaken for bubble outline barrier
    gray_clean = gray.copy()
    gray_clean[chat_core_box > 0] = 255
    text_core = cv2.dilate(cv2.bitwise_or(chat_text, sfx_text), _ellipse(3))
    barrier = protected_ink(gray_clean, text_core)

    r = max(0, int(dilation_px))
    chat_limit = rect_mask(h, w, chat_boxes, box_pad + r + 4)
    if r > 0:
        halo = cv2.dilate(chat_text, _ellipse(2 * r + 1))
    else:
        halo = chat_text
    chat_erase = cv2.bitwise_and(halo, cv2.bitwise_not(barrier))
    chat_erase = cv2.bitwise_or(chat_erase, chat_text)          # strokes always erased
    chat_erase = cv2.bitwise_and(chat_erase, chat_limit)

    sfx_limit = rect_mask(h, w, sfx_boxes, box_pad + r + 2)
    sfx_erase = cv2.dilate(sfx_text, _ellipse(2 * (r + 2) + 1)) if sfx_text.any() else sfx_text
    sfx_erase = cv2.bitwise_and(sfx_erase, sfx_limit)

    return MaskSet(chat_text, sfx_text, chat_erase, sfx_erase, barrier, chat_boxes, sfx_boxes)


def flat_fill_uniform_paper(
    img_bgr: np.ndarray,
    erase: np.ndarray,
    boxes: Sequence[Box],
    margin: int = 24,
    own_pad: int = 10,
    paper_min: int = 200,
    max_std: float = 5.0,
    min_ring: int = 60,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    For each dialogue box: if the paper just around the erased strokes is a flat
    colour (typical white bubble), paint it with that colour instead of calling
    LaMa. Instant, artifact-free. Anything textured / toned falls through to LaMa.
    Returns (image, mask_of_pixels_already_filled).
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
        ok = (ring > 0) & (gray[Y1:Y2, X1:X2] >= paper_min)
        if int(ok.sum()) < min_ring:
            continue
        px = img_bgr[Y1:Y2, X1:X2][ok]
        if float(px.std(axis=0).max()) > max_std:
            continue
        color = np.median(px, axis=0).astype(np.uint8)
        sel = m > 0
        roi_out = out[Y1:Y2, X1:X2]
        roi_out[sel] = color
        done[Y1:Y2, X1:X2][sel] = 255
    return out, done
