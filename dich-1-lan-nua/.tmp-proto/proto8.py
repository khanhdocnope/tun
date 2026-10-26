"""Prototype 8: pairwise directional interpolation (structure-aware)."""
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
    cv2.imwrite(str(OUT / f"p8_{name}.png"), cv2.cvtColor(c, cv2.COLOR_RGB2BGR))


def norm_conv(rgb, clean, sigma):
    c = clean.astype(np.float32)
    num = cv2.GaussianBlur(rgb.astype(np.float32) * c[..., None], (0, 0), sigma)
    den = cv2.GaussianBlur(c, (0, 0), sigma)
    return num / np.maximum(den, 1e-6)[..., None]


def nearest_indices(clean, axis):
    """Nearest clean index along axis, in negative and positive directions."""
    h, w = clean.shape
    if axis == 0:
        coord = np.arange(h, dtype=np.int32)[:, None] * np.ones((1, w), np.int32)
        neg = np.where(clean, coord, -1)
        neg = np.maximum.accumulate(neg, axis=0)
        pos = np.where(clean, coord, h)
        pos = np.minimum.accumulate(pos[::-1], axis=0)[::-1]
    else:
        coord = np.arange(w, dtype=np.int32)[None, :] * np.ones((h, 1), np.int32)
        neg = np.where(clean, coord, -1)
        neg = np.maximum.accumulate(neg, axis=1)
        pos = np.where(clean, coord, w)
        pos = np.minimum.accumulate(pos[:, ::-1], axis=1)[:, ::-1]
    return neg, pos


def pairwise_fill(rgb, mask, interior, tau=26.0, span_gain=18.0, fallback=None):
    h, w = mask.shape
    clean = (interior > 0) & (mask == 0)
    img = rgb.astype(np.float32)
    ys, xs = np.indices((h, w)).astype(np.float32)

    def gather(idx, axis):
        v = idx >= 0
        if axis == 0:
            safe = np.clip(idx, 0, h - 1)
            vals = img[safe, np.arange(w)[None, :].repeat(h, 0)]
            dist = np.abs(ys - idx)
        else:
            safe = np.clip(idx, 0, w - 1)
            vals = img[np.arange(h)[:, None].repeat(w, 1), safe]
            dist = np.abs(xs - idx)
        dist = np.where(v, dist, 0)
        return vals, dist, v

    up_v, up_d, up_ok = gather(nearest_indices(clean, 0)[0], 0)
    dn_v, dn_d, dn_ok = gather(nearest_indices(clean, 0)[1], 0)
    lf_v, lf_d, lf_ok = gather(nearest_indices(clean, 1)[0], 1)
    rt_v, rt_d, rt_ok = gather(nearest_indices(clean, 1)[1], 1)

    def combine(a_v, a_d, a_ok, b_v, b_d, b_ok):
        both = a_ok & b_ok
        only_a = a_ok & ~b_ok
        only_b = b_ok & ~a_ok
        wsum = np.where(both, a_d + b_d, 1.0)
        est = np.where(both[..., None],
                       (a_v * b_d[..., None] + b_v * a_d[..., None]) / np.maximum(wsum, 1e-6)[..., None],
                       0.0)
        est = np.where(only_a[..., None], a_v, est)
        est = np.where(only_b[..., None], b_v, est)
        span = np.where(both, a_d + b_d, np.where(only_a, a_d, np.where(only_b, b_d, 1e6)))
        diff = np.abs(a_v - b_v).max(axis=2) if both.any() else np.zeros((h, w), np.float32)
        diff = np.where(both, diff, 6.0)
        valid = a_ok | b_ok
        return est, span, diff, valid

    V, span_v, dv, ok_v = combine(up_v, up_d, up_ok, dn_v, dn_d, dn_ok)
    H, span_h, dh, ok_h = combine(lf_v, lf_d, lf_ok, rt_v, rt_d, rt_ok)

    q_v = np.exp(-(dv / tau) ** 2) / (1.0 + span_v / span_gain)
    q_h = np.exp(-(dh / tau) ** 2) / (1.0 + span_h / span_gain)
    q_v = np.where(ok_v, np.maximum(q_v, 0.02), 0.0)
    q_h = np.where(ok_h, np.maximum(q_h, 0.02), 0.0)
    wsum = q_v + q_h
    est = (V * q_v[..., None] + H * q_h[..., None]) / np.maximum(wsum, 1e-6)[..., None]

    m = mask > 0
    no = m & (wsum <= 1e-5)
    if no.any() and fallback is not None:
        est[no] = fallback[no]

    out = rgb.astype(np.float32).copy()
    out[m] = est[m]
    return np.clip(out, 0, 255), wsum, dv, dh


def feather(out, rgb, mask, radius=2):
    m = (mask > 0).astype(np.float32)
    soft = cv2.GaussianBlur(m, (0, 0), radius)[..., None]
    keep = m > 0
    res = out.copy()
    res[keep] = out[keep] * soft[keep] + rgb.astype(np.float32)[keep] * (1 - soft[keep])
    return np.clip(res, 0, 255).astype(np.uint8)


def main():
    rgb = np.array(cv2.imread(str(IMG))[:, :, ::-1])
    base, analyses, _ = build_combined_mask(rgb, REGIONS, dilation=1)
    interior = np.zeros(base.shape, np.uint8)
    for a in analyses:
        if a.interior is not None:
            interior = cv2.bitwise_or(interior, a.interior)
    clean = (interior > 0) & (base == 0)
    fallback = np.clip(norm_conv(rgb, clean, 10.0), 0, 255)
    for r in (4, 6, 8):
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
        mask = cv2.bitwise_and(cv2.dilate(base, k), interior)
        t = time.perf_counter()
        out, wsum, dv, dh = pairwise_fill(rgb, mask, interior, fallback=fallback)
        out = feather(out, rgb, mask, radius=1.5)
        save(f"pdi_d{r}", out)
        print(r, round(time.perf_counter() - t, 2), "mask", int((mask > 0).sum()))


if __name__ == "__main__":
    main()
