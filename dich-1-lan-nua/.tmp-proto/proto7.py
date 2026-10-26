"""Prototype 7: contrast-restored NC + Perona-Malik inpainting."""
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
    cv2.imwrite(str(OUT / f"p7_{name}.png"), cv2.cvtColor(c, cv2.COLOR_RGB2BGR))


def norm_conv(rgb, clean, sigma):
    c = clean.astype(np.float32)
    num = cv2.GaussianBlur(rgb.astype(np.float32) * c[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(c, (0, 0), sigma)
    return num / np.maximum(den, 1e-6)[..., None]


def hist_match(src, ref_values, mask):
    """Map src channel-wise so its distribution on `mask` matches ref_values."""
    out = src.copy()
    qs = np.linspace(0, 100, 257)
    for c in range(src.shape[2]):
        s_vals = src[..., c][mask]
        r_vals = ref_values[..., c][mask]
        if s_vals.size < 32:
            continue
        s_q = np.percentile(s_vals, qs)
        r_q = np.percentile(r_vals, qs)
        # monotone mapping
        out[..., c] = np.interp(src[..., c], s_q, r_q)
    return out


def pm_inpaint(img, mask, iters=120, kappa=18.0, lam=0.24):
    """Perona-Malik anisotropic diffusion, boundary fixed outside the mask."""
    u = img.astype(np.float32).copy()
    m = (mask > 0)
    for _ in range(iters):
        up = np.pad(u, ((1, 1), (1, 1), (0, 0)), mode="edge")
        n = up[0:-2, 1:-1]; s = up[2:, 1:-1]; w = up[1:-1, 0:-2]; e = up[1:-1, 2:]
        gn = np.exp(-((n - u) ** 2).sum(axis=2, keepdims=True) / kappa ** 2)
        gs = np.exp(-((s - u) ** 2).sum(axis=2, keepdims=True) / kappa ** 2)
        gw = np.exp(-((w - u) ** 2).sum(axis=2, keepdims=True) / kappa ** 2)
        ge = np.exp(-((e - u) ** 2).sum(axis=2, keepdims=True) / kappa ** 2)
        lap = gn * (n - u) + gs * (s - u) + gw * (w - u) + ge * (e - u)
        u = u + lam * lap
        # keep outside fixed
        u[~m] = img[~m]
    return u


def main():
    rgb = np.array(cv2.imread(str(IMG))[:, :, ::-1])
    base, analyses, _ = build_combined_mask(rgb, REGIONS, dilation=1)
    interior = np.zeros(base.shape, np.uint8)
    for a in analyses:
        if a.interior is not None:
            interior = cv2.bitwise_or(interior, a.interior)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))
    mask = cv2.bitwise_and(cv2.dilate(base, k), interior)
    clean = (interior > 0) & (mask == 0)
    print("mask", int((mask > 0).sum()), "clean", int(clean.sum()))

    for sigma in (8, 12):
        coarse = np.clip(norm_conv(rgb, clean, sigma), 0, 255)
        matched = np.clip(hist_match(coarse, rgb.astype(np.float32), clean), 0, 255)
        # only use matched values inside the mask
        out = rgb.astype(np.float32).copy()
        out[mask > 0] = matched[mask > 0]
        save(f"nc{sigma}_match", np.clip(out, 0, 255).astype(np.uint8))
        t = time.perf_counter()
        pm = pm_inpaint(out, mask, iters=80)
        save(f"nc{sigma}_match_pm", np.clip(pm, 0, 255).astype(np.uint8))
        print("sigma", sigma, "pm", round(time.perf_counter() - t, 2))


if __name__ == "__main__":
    main()
