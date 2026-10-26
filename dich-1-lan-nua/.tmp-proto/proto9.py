"""Prototype 9: optimized PDI with smoothed weights + bilateral seam removal."""
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
    cv2.imwrite(str(OUT / f"p9_{name}.png"), cv2.cvtColor(c, cv2.COLOR_RGB2BGR))


def pdi_fill(rgb, mask, interior, tau=26.0, span_gain=18.0):
    ys, xs = np.where(mask)
    pad = 24
    h, w = mask.shape
    x0 = max(0, xs.min() - pad); y0 = max(0, ys.min() - pad)
    x1 = min(w, xs.max() + pad + 1); y1 = min(h, ys.max() + pad + 1)
    img = rgb[y0:y1, x0:x1].astype(np.float32)
    m = mask[y0:y1, x0:x1] > 0
    clean = (interior[y0:y1, x0:x1] > 0) & ~m
    ch, cw = m.shape
    yy, xx = np.indices((ch, cw)).astype(np.float32)

    def nearest(axis):
        if axis == 0:
            coord = np.arange(ch, dtype=np.int32)[:, None] * np.ones((1, cw), np.int32)
            neg = np.maximum.accumulate(np.where(clean, coord, -1), axis=0)
            pos = np.minimum.accumulate(np.where(clean, coord, ch)[::-1], axis=0)[::-1]
        else:
            coord = np.arange(cw, dtype=np.int32)[None, :] * np.ones((ch, 1), np.int32)
            neg = np.maximum.accumulate(np.where(clean, coord, -1), axis=1)
            pos = np.minimum.accumulate(np.where(clean, coord, cw)[:, ::-1], axis=1)[:, ::-1]
        return neg, pos

    def gather(idx, axis):
        ok = idx >= 0
        if axis == 0:
            vals = img[np.clip(idx, 0, ch - 1), np.arange(cw)[None, :].repeat(ch, 0)]
            dist = np.abs(yy - idx)
        else:
            vals = img[np.arange(ch)[:, None].repeat(cw, 1), np.clip(idx, 0, cw - 1)]
            dist = np.abs(xx - idx)
        return vals, np.where(ok, dist, 0.0), ok

    def pair(a, b):
        (a_v, a_d, a_ok), (b_v, b_d, b_ok) = a, b
        both = a_ok & b_ok
        only_a = a_ok & ~b_ok
        only_b = b_ok & ~a_ok
        denom = np.where(both, a_d + b_d, 1.0)
        est = np.where(both[..., None], (a_v * b_d[..., None] + b_v * a_d[..., None]) / np.maximum(denom, 1e-6)[..., None], 0.0)
        est = np.where(only_a[..., None], a_v, est)
        est = np.where(only_b[..., None], b_v, est)
        span = np.where(both, a_d + b_d, np.where(only_a, a_d, np.where(only_b, b_d, 1e6)))
        diff = np.where(both, np.abs(a_v - b_v).max(axis=2), 6.0)
        return est, span, diff, (a_ok | b_ok)

    V, span_v, dv, ok_v = pair(gather(nearest(0)[0], 0), gather(nearest(0)[1], 0))
    H, span_h, dh, ok_h = pair(gather(nearest(1)[0], 1), gather(nearest(1)[1], 1))

    q_v = np.exp(-(dv / tau) ** 2) / (1.0 + span_v / span_gain)
    q_h = np.exp(-(dh / tau) ** 2) / (1.0 + span_h / span_gain)
    q_v = np.where(ok_v, np.maximum(q_v, 0.02), 0.0)
    q_h = np.where(ok_h, np.maximum(q_h, 0.02), 0.0)
    # spatial smoothing of the direction choice avoids hard rectangular seams
    q_v = cv2.GaussianBlur(q_v, (0, 0), 2.2)
    q_h = cv2.GaussianBlur(q_h, (0, 0), 2.2)
    wsum = q_v + q_h
    est = (V * q_v[..., None] + H * q_h[..., None]) / np.maximum(wsum, 1e-6)[..., None]

    out_crop = img.copy()
    out_crop[m] = est[m]
    out_crop = np.clip(out_crop, 0, 255).astype(np.uint8)
    if m.any():
        bil = cv2.bilateralFilter(out_crop, 7, 14, 7)
        out_crop[m] = bil[m]
    out = rgb.copy()
    out[y0:y1, x0:x1] = out_crop
    return out


def main():
    rgb = np.array(cv2.imread(str(IMG))[:, :, ::-1])
    for dil in (4, 5, 6):
        mask, analyses, _ = build_combined_mask(rgb, REGIONS, dilation=dil)
        interior = np.zeros(mask.shape, np.uint8)
        for a in analyses:
            if a.interior is not None:
                interior = cv2.bitwise_or(interior, a.interior)
        t = time.perf_counter()
        out = pdi_fill(rgb, mask, interior)
        save(f"pdi_d{dil}", out)
        print(dil, round(time.perf_counter() - t, 2))


if __name__ == "__main__":
    main()
