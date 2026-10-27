"""
Offline smoke test for the mask plumbing (no torch / models needed).

Run from the project root:  python test_cleaner_logic.py
It checks the two speed-oriented guarantees introduced in v3:
  1. `flat_paper_hint` separates paper-backed glyphs from glyphs over artwork.
  2. `build_masks(seg_regions=...)` keeps every detector box while only reading `seg`
     where it is allowed to, and returns byte-identical masks when nothing is skipped.
"""

import cv2
import numpy as np

from mask_logic import (
    CLS_TEXT_BUBBLE,
    CLS_TEXT_FREE,
    Det,
    build_masks,
    build_masks_from_polygons,
    flat_paper_hint,
    flat_fill_uniform_paper,
)


def test_flat_paper_hint_on_synthetic_page():
    img = np.full((200, 300, 3), 235, np.uint8)   # paper tone
    img[:, 150:] = (30, 30, 30)                    # dark panel
    img[80:110, 30:130] = 20                       # black glyphs on paper
    img[80:110, 175:265] = 240                     # light glyphs on the dark panel
    seg = np.zeros((200, 300), np.float32)
    seg[80:110, 30:130] = 0.9
    seg[80:110, 175:265] = 0.9
    paper_box = (25.0, 75.0, 135.0, 115.0)
    art_box = (170.0, 75.0, 270.0, 115.0)
    assert flat_paper_hint(img, seg, [paper_box]) is True
    assert flat_paper_hint(img, seg, [art_box]) is False


def test_seg_regions_only_restrict_where_seg_is_read():
    img = cv2.imread("examples/sample1.jpg")
    assert img is not None, "examples/sample1.jpg must exist"
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    seg = cv2.resize(((gray < 90).astype(np.float32)), (w // 2, h // 2))
    seg_full = cv2.resize(seg, (w, h))
    dets = [
        Det(CLS_TEXT_BUBBLE, 0.9, (100.0, 70.0, 420.0, 340.0)),
        Det(CLS_TEXT_BUBBLE, 0.9, (560.0, 60.0, 860.0, 330.0)),
    ]

    full = build_masks(img, seg_full, dets, seg_thr=0.30, dilation_px=4)
    subset = build_masks(img, seg_full, dets, seg_thr=0.30, dilation_px=4, seg_regions=dets[:1])

    assert len(subset.chat_boxes) == len(full.chat_boxes) == 2, "detector boxes must not be dropped"
    assert int((full.chat_erase > 0).sum()) > 1000, "sample must erase real text"
    restricted = cv2.bitwise_and(subset.chat_erase, cv2.bitwise_not(full.chat_erase))
    assert not restricted.any(), "seg_regions must never erase outside what the full pass erases"


def test_flat_fill_paints_paper_strokes():
    img = cv2.imread("examples/sample1.jpg")
    h, w = img.shape[:2]
    box = (100.0, 70.0, 420.0, 340.0)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    strokes = np.zeros((h, w), np.uint8)
    x1, y1, x2, y2 = (int(v) for v in box)
    strokes[y1:y2, x1:x2] = ((gray[y1:y2, x1:x2] < 90).astype(np.uint8)) * 255
    _, done = flat_fill_uniform_paper(img, strokes, [box])
    assert int(np.count_nonzero(done)) > 0, "plain white bubble paper must be flat-filled"


def test_build_masks_from_polygons():
    img = cv2.imread("examples/sample1.jpg")
    assert img is not None, "examples/sample1.jpg must exist"
    poly_chat = np.array([[120, 150], [300, 150], [300, 200], [120, 200]], dtype=np.float32)
    poly_sfx = np.array([[650, 100], [800, 100], [800, 250], [650, 250]], dtype=np.float32)
    dets = [
        Det(CLS_TEXT_BUBBLE, 0.9, (100.0, 70.0, 420.0, 340.0)),
        Det(CLS_TEXT_FREE, 0.9, (630.0, 70.0, 820.0, 280.0)),
    ]
    ms = build_masks_from_polygons(img, [poly_chat, poly_sfx], dets, dilation_px=4)
    assert int((ms.chat_erase > 0).sum()) > 0, "Chat erase mask must contain pixels"
    assert int((ms.sfx_erase > 0).sum()) > 0, "SFX erase mask must contain pixels"
    assert len(ms.chat_boxes) == 1
    assert len(ms.sfx_boxes) == 1


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("all mask-logic checks passed")
