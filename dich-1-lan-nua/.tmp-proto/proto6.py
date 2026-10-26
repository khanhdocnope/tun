"""Prototype 6: directional morphological closing background."""
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.services.inpainting.text_mask import build_combined_mask  # noqa: E402

IMG = ROOT / "raw-test" / "rzZIsUpAZ.webp-t.w1280.jpg"
OUT = ROOT / "raw-test" / "bench-out"
REGIONS = [(643, 58, 197, 82), (646, 137, 218, 74)]
BOX = (600, 20, 930, 260)


def save(name, arr, scale=2):
    x1, y1, x2, y2 = BOX
    c = arr[y1:y2, x1:x2]
    c = cv2.resize(c, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(OUT / f"p6_{name}.png"), cv2.cvtColor(c, cv2.COLOR_RGB2BGR))


def line_closing(img, length, horizontal):
    if horizontal:
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (length, 1))
    else:
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (1, length))
    return cv2.morphologyEx(img, cv2.MORPH_CLOSE, k)


def directional_bg(img, length=31, dark_text=True):
    a = line_closing(img, length, True)
    b = line_closing(img, length, False)
    return np.maximum(a, b) if dark_text else np.minimum(a, b)


def main():
    rgb = np.array(cv2.imread(str(IMG))[:, :, ::-1])
    base, analyses, _ = build_combined_mask(rgb, REGIONS, dilation=1)
    interior = np.zeros(base.shape, np.uint8)
    for a in analyses:
        if a.interior is not None:
            interior = cv2.bitwise_or(interior, a.interior)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask = cv2.bitwise_and(cv2.dilate(base, k), interior)
    print("mask", int((mask > 0).sum()))
    for length in (21, 31, 41, 51):
        t = time.perf_counter()
        bg = directional_bg(rgb, length)
        out = rgb.copy()
        out[mask > 0] = bg[mask > 0]
        save(f"close{length}", out)
        print(length, round(time.perf_counter() - t, 2))
        if length == 31:
            bgg = bg
            save("bg31", bgg)
    # blend two lengths to reduce over-brightening
    bg = directional_bg(rgb, 31)
    med = cv2.medianBlur(rgb, 51)
    mix = (bg.astype(np.float32) * 0.7 + med.astype(np.float32) * 0.3).astype(np.uint8)
    out = rgb.copy(); out[mask > 0] = mix[mask > 0]
    save("close31_med", out)


if __name__ == "__main__":
    main()
