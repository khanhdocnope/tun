"""Prototype 3: median / normalized-convolution background estimates."""
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
    cv2.imwrite(str(OUT / f"p3_{name}.png"), cv2.cvtColor(c, cv2.COLOR_RGB2BGR))


def crop(mask, pad):
    ys, xs = np.where(mask)
    h, w = mask.shape
    return (max(0, xs.min() - pad), max(0, ys.min() - pad),
            min(w, xs.max() + pad + 1), min(h, ys.max() + pad + 1))


def median_fill(rgb, mask, ksize):
    blur = cv2.medianBlur(rgb, ksize)
    out = rgb.copy()
    out[mask > 0] = blur[mask > 0]
    return out


def clean_median(rgb, mask, interior, window=41, step=2):
    """Median of clean pixels only, sampled on a dense grid around the mask."""
    x0, y0, x1, y1 = crop(mask, window + 4)
    img = rgb[y0:y1, x0:x1]
    m = mask[y0:y1, x0:x1] > 0
    ins = interior[y0:y1, x0:x1]
    clean = (ins > 0) & (m == 0)
    h, w = m.shape
    r = window // 2
    vals = [cv2.copyMakeBorder(img, r, r, r, r, cv2.BORDER_REFLECT)]
    cm = [cv2.copyMakeBorder(clean.astype(np.uint8), r, r, r, r, cv2.BORDER_REFLECT)]
    stack = []
    for dy in range(-r, r + 1, step):
        for dx in range(-r, r + 1, step):
            s = cv2.warpAffine(img, np.float32([[1, 0, dx], [0, 1, dy]]), (w, h),
                               flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT).astype(np.float32)
            sc = cv2.warpAffine(clean.astype(np.uint8), np.float32([[1, 0, dx], [0, 1, dy]]), (w, h),
                                flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_REFLECT)
            s[sc == 0] = np.nan
            stack.append(s)
    med = np.nanmedian(np.stack(stack), axis=0)
    filled = img.astype(np.float32).copy()
    filled[m] = np.nan_to_num(med[m], nan=0)
    out = rgb.copy()
    out[y0:y1, x0:x1] = np.clip(filled, 0, 255).astype(np.uint8)
    return out


def add_detail(fill, rgb, mask, interior, sigma=2.0):
    """Transfer high-frequency detail from nearest clean pixels onto the fill."""
    clean = ((interior > 0) & (mask == 0)).astype(np.float32)
    img = rgb.astype(np.float32)
    base = cv2.GaussianBlur(img, (0, 0), sigma)
    detail = img - base
    # normalized conv of detail with a moderate kernel
    g = cv2.getGaussianKernel(15, 4).astype(np.float32)
    k = np.outer(g, g)
    num = cv2.filter2D(detail * clean[..., None], -1, k)
    den = cv2.filter2D(clean, -1, k)
    d = num / np.maximum(den, 1e-6)[..., None]
    out = fill.astype(np.float32).copy()
    out[mask > 0] += d[mask > 0]
    return np.clip(out, 0, 255).astype(np.uint8)


def main():
    rgb = np.array(cv2.imread(str(IMG))[:, :, ::-1])
    for dil in (3, 5):
        mask, analyses, _ = build_combined_mask(rgb, REGIONS, dilation=dil)
        interior = np.zeros(mask.shape, np.uint8)
        for a in analyses:
            if a.interior is not None:
                interior = cv2.bitwise_or(interior, a.interior)
        tag = f"d{dil}"
        for k in (31, 51, 61):
            t = time.perf_counter(); out = median_fill(rgb, mask, k); save(f"{tag}_mb{k}", out); print(tag, "mb", k, round(time.perf_counter()-t, 2))
        t = time.perf_counter(); cm = clean_median(rgb, mask, interior, 51, step=2); save(f"{tag}_cmed51", cm); print(tag, "cmed51", round(time.perf_counter()-t, 2))
        det = add_detail(cm, rgb, mask, interior); save(f"{tag}_cmed51_detail", det)
    print("done")


if __name__ == "__main__":
    main()

