"""Prototype 4: halo-aware mask expansion + robust background fill."""
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
    cv2.imwrite(str(OUT / f"p4_{name}.png"), cv2.cvtColor(c, cv2.COLOR_RGB2BGR))


def norm_conv(rgb, clean, sigma):
    c = clean.astype(np.float32)
    num = cv2.GaussianBlur(rgb.astype(np.float32) * c[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(c, (0, 0), sigma)
    return num / np.maximum(den, 1e-6)[..., None]


def halo_mask(rgb, core, interior, radius=7, thresh=5.0):
    """Grow the mask into the bright JPEG/AA halo around glyphs."""
    clean = (interior > 0) & (core == 0)
    coarse = norm_conv(rgb.astype(np.uint8), clean, 10.0)
    seed = rgb.astype(np.float32).copy()
    seed[core > 0] = coarse[core > 0]
    seed = np.clip(seed, 0, 255).astype(np.uint8)
    bg = cv2.medianBlur(seed, 51)
    resid = rgb.astype(np.float32) - bg.astype(np.float32)
    lum = resid.mean(axis=2)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    near = cv2.dilate(core, k) > 0
    halo = near & (np.abs(lum) > thresh) & (interior > 0)
    out = cv2.bitwise_or(core, halo.astype(np.uint8) * 255)
    return out, bg, resid


def feather_fill(rgb, mask, fill, radius=2):
    """Feather the synthetic pixels into the untouched neighbourhood."""
    out = fill.astype(np.float32).copy()
    m = (mask > 0).astype(np.float32)
    soft = cv2.GaussianBlur(m, (0, 0), radius)
    soft = np.clip(soft, 0, 1)[..., None]
    orig = rgb.astype(np.float32)
    blended = out * soft + orig * (1 - soft)
    keep = (mask > 0) | (cv2.dilate(mask, np.ones((5, 5), np.uint8)) > 0)
    res = orig.copy()
    res[keep] = blended[keep]
    return np.clip(res, 0, 255).astype(np.uint8)


def main():
    rgb = np.array(cv2.imread(str(IMG))[:, :, ::-1])
    core, analyses, _ = build_combined_mask(rgb, REGIONS, dilation=2)
    interior = np.zeros(core.shape, np.uint8)
    for a in analyses:
        if a.interior is not None:
            interior = cv2.bitwise_or(interior, a.interior)

    t = time.perf_counter()
    mask, bg, resid = halo_mask(rgb, core, interior, radius=7, thresh=5.0)
    print("halo mask", round(time.perf_counter() - t, 2), "core", int((core > 0).sum()), "expanded", int((mask > 0).sum()))
    vis = rgb.copy(); vis[mask > 0] = [255, 0, 0]
    save("mask", vis)

    # seed with no text (coarse NC) then median
    clean = (interior > 0) & (mask == 0)
    coarse = np.clip(norm_conv(rgb, clean, 10.0), 0, 255)
    seed = rgb.astype(np.float32).copy()
    seed[mask > 0] = coarse[mask > 0]
    seed = np.clip(seed, 0, 255).astype(np.uint8)

    for k in (41, 61):
        t = time.perf_counter()
        mb = cv2.medianBlur(seed, k)
        out = rgb.copy()
        out[mask > 0] = mb[mask > 0]
        out = feather_fill(rgb, mask, out, radius=2)
        save(f"halo_med{k}", out)
        print("median", k, round(time.perf_counter() - t, 2))

    # normalized convolution with large sigma
    for s in (10, 16):
        t = time.perf_counter()
        nc = np.clip(norm_conv(rgb, clean, s), 0, 255)
        out = rgb.copy()
        out[mask > 0] = nc[mask > 0]
        out = feather_fill(rgb, mask, out, radius=2)
        save(f"halo_nc{s}", out)
        print("nc", s, round(time.perf_counter() - t, 2))

    # median + detail transfer from clean neighbourhood
    mb = cv2.medianBlur(seed, 61)
    img = rgb.astype(np.float32)
    base = cv2.GaussianBlur(img, (0, 0), 1.2)
    detail = img - base
    cl = ((interior > 0) & (mask == 0)).astype(np.float32)
    g = cv2.GaussianKernel = cv2.getGaussianKernel(13, 3.5).astype(np.float32)
    kk = np.outer(g, g)
    num = cv2.filter2D(detail * cl[..., None], -1, kk)
    den = cv2.filter2D(cl, -1, kk)
    d = num / np.maximum(den, 1e-6)[..., None]
    out = mb.astype(np.float32)
    out[mask > 0] += d[mask > 0] * 0.8
    out = np.clip(out, 0, 255).astype(np.uint8)
    out = feather_fill(rgb, mask, out, radius=2)
    save("halo_med61_detail", out)
    print("done")


if __name__ == "__main__":
    main()
