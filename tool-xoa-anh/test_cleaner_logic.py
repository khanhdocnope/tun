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


def test_vertical_text_coverage_and_flat_fill():
    img = np.full((500, 500, 3), 220, dtype=np.uint8)
    box = (100.0, 100.0, 200.0, 300.0)
    dets = [Det(CLS_TEXT_BUBBLE, 0.9, box)]

    poly_top = np.array([[120, 80], [180, 80], [180, 120], [120, 120]], dtype=np.float32)
    poly_mid = np.array([[120, 180], [180, 180], [180, 220], [120, 220]], dtype=np.float32)
    poly_bot = np.array([[120, 280], [180, 280], [180, 320], [120, 320]], dtype=np.float32)

    for p in [poly_top, poly_mid, poly_bot]:
        img[int(p[:, 1].min()):int(p[:, 1].max()), int(p[:, 0].min()):int(p[:, 0].max())] = 20

    ms = build_masks_from_polygons(img, [poly_top, poly_mid, poly_bot], dets)

    # All characters must be 100% covered without horizontal clipping
    assert np.count_nonzero(ms.chat_erase[80:120, 120:180]) == 2400
    assert np.count_nonzero(ms.chat_erase[180:220, 120:180]) == 2400
    assert np.count_nonzero(ms.chat_erase[280:320, 120:180]) == 2400

    out_bgr, done = flat_fill_uniform_paper(img, ms.chat_erase, ms.chat_boxes)
    assert np.count_nonzero(done) > 0, "Manga paper (220) must be flat-filled"


def test_translucent_bubble_does_not_turn_into_solid_egg():
    # 600x600 image with character skin/shading (gray 140) and speech bubble over chest
    h, w = 600, 600
    img = np.full((h, w, 3), 140, dtype=np.uint8)
    cv2.ellipse(img, (300, 300), (120, 180), 0, 0, 360, (0, 0, 0), 3) # bubble outline
    cv2.ellipse(img, (300, 300), (117, 177), 0, 0, 360, (200, 200, 200), -1) # translucent background
    # Girl's chest / collar passing through bubble
    img[250:350, 220:380] = 130
    # Text inside bubble
    poly = np.array([[240, 260], [360, 260], [360, 290], [240, 290]], dtype=np.float32)
    img[260:290, 240:360] = 20

    box = (180.0, 120.0, 420.0, 480.0)
    dets = [Det(CLS_TEXT_BUBBLE, 0.9, box)]
    ms = build_masks_from_polygons(img, [poly], dets, dilation_px=4)

    # Girl's chest/collar outside the text line (y=310:340, x=250:350) MUST NOT be erased
    chest_erased = np.count_nonzero(ms.chat_erase[310:340, 250:350])
    assert chest_erased == 0, f"Translucent bubble must NOT turn into a solid egg! (erased {chest_erased} px)"
    # Text itself MUST be erased
    text_erased = np.count_nonzero(ms.chat_erase[260:290, 240:360])
    assert text_erased > 0, "Text inside bubble must be erased"


def test_english_punctuation_and_quotes_covered():
    # Test text containing quotation marks, apostrophe, exclamation mark, and dots
    h, w = 300, 500
    img = np.full((h, w, 3), 255, dtype=np.uint8)
    cv2.putText(img, "WON'T YOU?", (40, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)
    cv2.putText(img, "'YES!' I'M HERE...", (40, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)

    poly1 = np.array([[38, 55], [230, 55], [230, 85], [38, 85]], dtype=np.float32)
    poly2 = np.array([[38, 135], [320, 135], [320, 165], [38, 165]], dtype=np.float32)

    dets = [
        Det(CLS_TEXT_BUBBLE, 0.9, (30.0, 40.0, 240.0, 100.0)),
        Det(CLS_TEXT_BUBBLE, 0.9, (30.0, 120.0, 330.0, 180.0)),
    ]
    ms = build_masks_from_polygons(img, [poly1, poly2], dets, dilation_px=4)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    actual_text = (gray < 220)
    missed = actual_text & (ms.chat_erase == 0)
    assert np.count_nonzero(missed) == 0, f"All punctuation and quotes must be covered (missed {np.count_nonzero(missed)} px)"


def test_adaptive_font_size_dilation():
    # Verify small font lines receive compact dilation while large font lines get wider dilation
    h, w = 300, 500
    img = np.full((h, w, 3), 255, dtype=np.uint8)
    # Small text line (font_size ~15px) at x=50..150
    poly_small = np.array([[50, 40], [150, 40], [150, 55], [50, 55]], dtype=np.float32)
    img[40:55, 50:150] = 20
    # Large text line (font_size ~60px) at x=250..450
    poly_large = np.array([[250, 40], [450, 40], [450, 100], [250, 100]], dtype=np.float32)
    img[40:100, 250:450] = 20

    dets = [
        Det(CLS_TEXT_BUBBLE, 0.9, (40.0, 30.0, 160.0, 70.0)),
        Det(CLS_TEXT_BUBBLE, 0.9, (240.0, 30.0, 460.0, 120.0)),
    ]
    ms = build_masks_from_polygons(img, [poly_small, poly_large], dets, dilation_px=4)

    # In small text: y span of poly is 15px (40..55). Dilated mask should stay compact (<= 28px height).
    small_mask_y = np.where(ms.chat_erase[:, 50:150] > 0)[0]
    small_height = small_mask_y.max() - small_mask_y.min() + 1
    assert small_height <= 28, f"Small font should stay compact! Got height {small_height}"

    # In large text: y span of poly is 60px (40..100). Dilated mask should expand wider (>= 75px height).
    large_mask_y = np.where(ms.chat_erase[:, 250:450] > 0)[0]
    large_height = large_mask_y.max() - large_mask_y.min() + 1
    assert large_height >= 75, f"Large font should get wider dilation! Got height {large_height}"


def test_min_box_size_skips_small_bubbles():
    img = np.full((200, 400, 3), 240, np.uint8)
    # Draw black ink inside both boxes
    img[52:58, 52:58] = 20
    img[55:65, 160:200] = 20

    # Tiny bubble text (12x10 px)
    poly_tiny = np.array([[50, 50], [62, 50], [62, 60], [50, 60]], dtype=np.float32)
    # Normal dialogue text (60x20 px)
    poly_normal = np.array([[150, 50], [210, 50], [210, 70], [150, 70]], dtype=np.float32)
    dets = [
        Det(CLS_TEXT_BUBBLE, 0.9, (45.0, 45.0, 65.0, 65.0)),
        Det(CLS_TEXT_BUBBLE, 0.9, (145.0, 45.0, 215.0, 75.0)),
    ]

    # Without filter (min_box_size=0): both are cleaned
    ms_all = build_masks_from_polygons(img, [poly_tiny, poly_normal], dets, min_box_size=0)
    assert ms_all.chat_erase[:, 45:65].any(), "Tiny box should be cleaned when min_box_size=0"
    assert ms_all.chat_erase[:, 145:215].any(), "Normal box should be cleaned when min_box_size=0"

    # With filter (min_box_size=18): tiny box (12px) is PRESERVED, normal box (60px) is CLEANED
    ms_filtered = build_masks_from_polygons(img, [poly_tiny, poly_normal], dets, min_box_size=18)
    assert not ms_filtered.chat_erase[:, 45:65].any(), "Tiny box MUST NOT be erased when min_box_size=18!"
    assert ms_filtered.chat_erase[:, 145:215].any(), "Normal box MUST be erased when min_box_size=18!"


def test_get_mini_boxes_oriented_box():
    from text_detector import get_mini_boxes
    rect = np.array([[10, 10], [50, 10], [50, 30], [10, 30]], dtype=np.float32)
    box, sside = get_mini_boxes(rect)
    assert 19.0 <= sside <= 21.0, f"Expected short side ~20, got {sside}"
    assert box.shape == (4, 2)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("all mask-logic checks passed")
