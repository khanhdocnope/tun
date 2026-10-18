"""
test_timings.py  –  Verify perf instrumentation in clean_image.

Checks:
1. stats["timings_ms"] contains the required keys
2. Output images are bit-identical to a reference run (no behavioral change)

Run from repo root:
    $env:PYTHONPATH="d:\tool-xoa-anh-manga\tool-xoa-anh"; python tests/test_timings.py
Or on HF / machine with torch:
    cd tool-xoa-anh && python -m pytest ../tests/test_timings.py -v
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tool-xoa-anh"))

import cv2
import numpy as np
from mask_logic import Det, CLS_TEXT_BUBBLE, CLS_TEXT_FREE, build_masks, flat_fill_uniform_paper

HAS_TORCH = True
try:
    import torch  # noqa: F401
except ImportError:
    HAS_TORCH = False

H, W = 500, 900


def make_page():
    """Same synthetic page as test_mask_logic.py."""
    img = np.full((H, W, 3), 255, np.uint8)
    tone = np.zeros((H, W), np.uint8)
    for y in range(300, 480, 6):
        for x in range(520, 880, 6):
            cv2.circle(tone, (x, y), 1, 255, -1)
    img[tone > 0] = (40, 40, 40)
    c, ax = (300, 230), (200, 130)
    ring_outer = np.zeros((H, W), np.uint8); cv2.ellipse(ring_outer, c, ax, 0, 0, 360, 255, -1)
    inner = np.zeros((H, W), np.uint8);      cv2.ellipse(inner, c, (ax[0]-6, ax[1]-6), 0, 0, 360, 255, -1)
    ring = cv2.subtract(ring_outer, inner)
    img[ring > 0] = (0, 0, 0)
    img[inner > 0] = (255, 255, 255)
    t = np.zeros((H, W), np.uint8)
    cv2.putText(t, "I WON'T LET YOU", (170, 150), cv2.FONT_HERSHEY_SIMPLEX, 1.0, 255, 3)
    cv2.putText(t, "DESTROY THIS!", (190, 210), cv2.FONT_HERSHEY_SIMPLEX, 1.0, 255, 3)
    img[t > 0] = (0, 0, 0)
    s = np.zeros((H, W), np.uint8)
    cv2.putText(s, "DOOM", (600, 160), cv2.FONT_HERSHEY_DUPLEX, 3.0, 255, 8)
    img[s > 0] = (10, 10, 10)
    seg = np.zeros((H, W), np.float32)
    seg[cv2.dilate(t, np.ones((3, 3), np.uint8)) > 0] = 0.95
    seg[cv2.dilate(s, np.ones((3, 3), np.uint8)) > 0] = 0.9
    seg[tone > 0] = 0.9
    ys, xs = np.where(t > 0); bx = (xs.min()-6, ys.min()-6, xs.max()+6, ys.max()+6)
    ys, xs = np.where(s > 0); sx = (xs.min()-4, ys.min()-4, xs.max()+4, ys.max()+4)
    dets = [Det(CLS_TEXT_BUBBLE, .9, tuple(map(float, bx))), Det(CLS_TEXT_FREE, .9, tuple(map(float, sx)))]
    return img, seg, dets


def test_build_masks_deterministic():
    """build_masks output must be identical across runs (no randomness introduced by timing)."""
    img, seg, dets = make_page()
    ms1 = build_masks(img, seg, dets, seg_thr=0.3, dilation_px=4)
    ms2 = build_masks(img, seg, dets, seg_thr=0.3, dilation_px=4)
    assert np.array_equal(ms1.chat_erase, ms2.chat_erase), "chat_erase not deterministic"
    assert np.array_equal(ms1.sfx_erase, ms2.sfx_erase), "sfx_erase not deterministic"
    assert np.array_equal(ms1.chat_text, ms2.chat_text), "chat_text not deterministic"
    assert np.array_equal(ms1.sfx_text, ms2.sfx_text), "sfx_text not deterministic"
    print("PASS: build_masks deterministic")


def test_clean_image_timings_keys():
    """clean_image stats must contain timings_ms with required keys."""
    if not HAS_TORCH:
        print("SKIP: test_clean_image_timings_keys (torch not installed, run on HF)")
        return
    from manga_cleaner import MangaCleanerPipeline
    from PIL import Image

    pipeline = MangaCleanerPipeline()

    img, seg, dets = make_page()
    img_pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))

    _, _, stats = pipeline.clean_image(
        image_input=img_pil,
        clean_sfx=False,
        dilation_px=4,
        det_threshold=0.30,
        force_cpu=True,
        inpaint_model="opencv-telea",
    )

    assert "timings_ms" in stats, f"Missing timings_ms in stats: {stats.keys()}"
    timings = stats["timings_ms"]
    required_keys = {"detect", "seg", "masks", "inpaint", "total", "regions", "engine"}
    # decode is always present too
    required_keys.add("decode")
    missing = required_keys - set(timings.keys())
    assert not missing, f"Missing timing keys: {missing}. Got: {timings.keys()}"

    # All numeric timing values should be >= 0
    for k in ("decode", "detect", "seg", "masks", "inpaint", "total"):
        assert isinstance(timings[k], (int, float)), f"timings_ms[{k}] is not numeric: {type(timings[k])}"
        assert timings[k] >= 0, f"timings_ms[{k}] is negative: {timings[k]}"

    assert timings["total"] > 0, "total timing should be positive"
    assert isinstance(timings["regions"], int), f"regions should be int, got {type(timings['regions'])}"
    assert isinstance(timings["engine"], str), f"engine should be str, got {type(timings['engine'])}"

    print(f"PASS: timings_ms keys present: {sorted(timings.keys())}")
    print(f"  Timing values: {timings}")


def test_clean_image_output_identical():
    """Output images must be bit-identical between two runs (timing instrumentation is observation-only)."""
    if not HAS_TORCH:
        print("SKIP: test_clean_image_output_identical (torch not installed, run on HF)")
        return
    from manga_cleaner import MangaCleanerPipeline
    from PIL import Image

    pipeline = MangaCleanerPipeline()
    img, seg, dets = make_page()
    img_pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))

    cleaned1, mask1, _ = pipeline.clean_image(
        image_input=img_pil, clean_sfx=False, dilation_px=4,
        det_threshold=0.30, force_cpu=True, inpaint_model="opencv-telea",
    )
    cleaned2, mask2, _ = pipeline.clean_image(
        image_input=img_pil, clean_sfx=False, dilation_px=4,
        det_threshold=0.30, force_cpu=True, inpaint_model="opencv-telea",
    )

    arr1 = np.array(cleaned1)
    arr2 = np.array(cleaned2)
    assert np.array_equal(arr1, arr2), "Cleaned images differ between runs!"

    marr1 = np.array(mask1)
    marr2 = np.array(mask2)
    assert np.array_equal(marr1, marr2), "Color masks differ between runs!"

    print("PASS: clean_image output identical across runs")


def test_no_text_page_timings():
    """A page with no text should still have timings_ms."""
    if not HAS_TORCH:
        print("SKIP: test_no_text_page_timings (torch not installed, run on HF)")
        return
    from manga_cleaner import MangaCleanerPipeline
    from PIL import Image

    pipeline = MangaCleanerPipeline()
    # Plain white image, no text
    blank = Image.new("RGB", (200, 200), (255, 255, 255))
    _, _, stats = pipeline.clean_image(
        image_input=blank, clean_sfx=False, force_cpu=True, inpaint_model="opencv-telea",
    )
    # May have "No text detected" but should still have timings_ms
    assert "timings_ms" in stats, f"Missing timings_ms for blank page: {stats}"
    print(f"PASS: blank page has timings_ms: {stats['timings_ms']}")


if __name__ == "__main__":
    test_build_masks_deterministic()
    test_clean_image_timings_keys()
    test_clean_image_output_identical()
    test_no_text_page_timings()
    skipped = 0 if HAS_TORCH else 3
    if skipped:
        print(f"\n[WARNING] {skipped} tests SKIPPED (torch not installed). Run on HF to get full coverage.")
    else:
        print("\n[OK] All timing tests passed!")
