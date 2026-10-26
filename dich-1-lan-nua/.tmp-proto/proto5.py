"""Prototype 5: hard dilation vs halo mask, hard fill, no blend."""
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
    cv2.imwrite(str(OUT / f"p5_{name}.png"), cv2.cvtColor(c, cv2.COLOR_RGB2BGR))


def norm_conv(rgb, clean, sigma):
    c = clean.astype(np.float32)
    num = cv2.GaussianBlur(rgb.astype(np.float32) * c[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(c, (0, 0), sigma)
    return num / np.maximum(den, 1e-6)[..., None]


def fill_median(rgb, mask, interior, k=61):
    clean = (interior > 0) & (mask == 0)
    coarse = np.clip(norm_conv(rgb, clean, 9.0), 0, 255).astype(np.uint8)
    seed = rgb.copy()
    seed[mask > 0] = coarse[mask > 0]
    mb = cv2.medianBlur(seed, k)
    out = rgb.copy()
    out[mask > 0] = mb[mask > 0]
    return out


def main():
    rgb = np.array(cv2.imread(str(IMG))[:, :, ::-1])
    base, analyses, _ = build_combined_mask(rgb, REGIONS, dilation=1)
    interior = np.zeros(base.shape, np.uint8)
    for a in analyses:
        if a.interior is not None:
            interior = cv2.bitwise_or(interior, a.interior)
    for r, k in ((6, 61), (8, 71), (10, 81)):
        mk = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
        mask = cv2.dilate(base, mk)
        mask = cv2.bitwise_and(mask, interior)
        t = time.perf_counter()
        out = fill_median(rgb, mask, interior, k=k)
        save(f"hard_d{r}_k{k}", out)
        print(r, k, round(time.perf_counter() - t, 2), "mask", int((mask > 0).sum()))
    print("done")


if __name__ == "__main__":
    main()
