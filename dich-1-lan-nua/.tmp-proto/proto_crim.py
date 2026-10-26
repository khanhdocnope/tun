"""Prototype: Criminisi exemplar inpainting for translucent bubbles."""
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.inpainting.text_mask import build_combined_mask  # noqa: E402
from app.services.inpainting.texture_fill import directional_fill  # noqa: E402

IMG = ROOT / "raw-test" / "rzZIsUpAZ.webp-t.w1280.jpg"
OUT = ROOT / "raw-test" / "bench-out"
REGIONS = [(643, 58, 197, 82), (646, 137, 218, 74)]


def criminisi(rgb, mask, interior, patch=13, search_radius=90, verbose=False):
    started = time.perf_counter()
    h, w = mask.shape
    ys, xs = np.where(mask)
    pad = patch + search_radius + 4
    x1 = max(0, xs.min() - pad); y1 = max(0, ys.min() - pad)
    x2 = min(w, xs.max() + pad + 1); y2 = min(h, ys.max() + pad + 1)
    img = rgb[y1:y2, x1:x2].astype(np.float32)
    fill = mask[y1:y2, x1:x2] > 0
    inside = interior[y1:y2, x1:x2] > 0
    ch, cw = fill.shape

    conf = (~fill).astype(np.float32)
    gray = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    half = patch // 2
    k3 = np.ones((3, 3), np.uint8)
    known_img = img.copy()
    iterations = 0
    # Limit source patches to interior, eroded a little so the outline is not copied.
    src_ok = cv2.erode(inside.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    src_ok &= ~fill
    integral_fill = cv2.integral(fill.astype(np.uint8))
    integral_src = cv2.integral((~src_ok).astype(np.uint8))

    while fill.any():
        # fill front: unknown pixels touching known
        known = (~fill).astype(np.uint8)
        front = fill & (cv2.dilate(known, k3) > 0)
        fy, fx = np.where(front)
        if fy.size == 0:
            break
        best = None
        best_pri = -1.0
        # gradient / normal for data term on the current (partially filled) image
        cur_gray = cv2.cvtColor(np.clip(known_img, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
        gx = cv2.Sobel(cur_gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(cur_gray, cv2.CV_32F, 0, 1, ksize=3)
        for py, px in zip(fy, fx):
            ty1, ty2 = py - half, py + half + 1
            tx1, tx2 = px - half, px + half + 1
            if ty1 < 0 or tx1 < 0 or ty2 > ch or tx2 > cw:
                continue
            km = known[ty1:ty2, tx1:tx2]
            cm = conf[ty1:ty2, tx1:tx2]
            c_term = float(cm[km > 0].sum()) / patch if km.any() else 0.0
            if c_term <= 0:
                continue
            # data term: gradient orthogonal to the front normal
            gy1, gy2 = max(0, py - 2), min(ch, py + 3)
            gx1, gx2 = max(0, px - 2), min(cw, px + 3)
            sub_fill = fill[gy1:gy2, gx1:gx2].astype(np.float32)
            if sub_fill.sum() == 0:
                continue
            n_y, n_x = cv2.Sobel(sub_fill, cv2.CV_32F, 0, 1, ksize=3), cv2.Sobel(sub_fill, cv2.CV_32F, 1, 0, ksize=3)
            iy, ix = py - gy1, px - gx1
            ny, nx = n_y[iy, ix], n_x[iy, ix]
            norm = np.hypot(nx, ny)
            if norm < 1e-6:
                d_term = 0.0
            else:
                nx, ny = nx / norm, ny / norm
                d_term = abs(-gy[py, px] * ny + gx[py, px] * nx) / 255.0
            pri = c_term * (0.15 + d_term)
            if pri > best_pri:
                best_pri = pri
                best = (py, px, c_term)
        if best is None:
            break
        py, px, cterm = best
        ty1, ty2 = py - half, py + half + 1
        tx1, tx2 = px - half, px + half + 1
        if ty1 < 0 or tx1 < 0 or ty2 > ch or tx2 > cw:
            fill[py, px] = False
            continue
        template = known_img[ty1:ty2, tx1:tx2].copy()
        km = (known[ty1:ty2, tx1:tx2] > 0).astype(np.float32)
        if km.sum() < 4:
            fill[py, px] = False
            continue
        # search window
        sy1 = max(0, py - search_radius); sy2 = min(ch, py + search_radius + 1)
        sx1 = max(0, px - search_radius); sx2 = min(cw, px + search_radius + 1)
        search = known_img[sy1:sy2, sx1:sx2]
        if search.shape[0] < patch or search.shape[1] < patch:
            fill[py, px] = False
            continue
        res = cv2.matchTemplate(search, template, cv2.TM_SQDIFF, mask=km)
        # reject candidate patches overlapping the hole or outside interior
        ih, iw = res.shape
        bad = integral_fill[sy1 + patch:sy1 + patch + ih, sx1 + patch:sx1 + patch + iw] \
            - integral_fill[sy1:sy1 + ih, sx1 + patch:sx1 + patch + iw] \
            - integral_fill[sy1 + patch:sy1 + patch + ih, sx1:sx1 + iw] \
            + integral_fill[sy1:sy1 + ih, sx1:sx1 + iw]
        bad2 = integral_src[sy1 + patch:sy1 + patch + ih, sx1 + patch:sx1 + patch + iw] \
            - integral_src[sy1:sy1 + ih, sx1 + patch:sx1 + patch + iw] \
            - integral_src[sy1 + patch:sy1 + patch + ih, sx1:sx1 + iw] \
            + integral_src[sy1:sy1 + ih, sx1:sx1 + iw]
        invalid = (bad > 0) | (bad2 > 0)
        res = res.copy()
        res[invalid] = np.inf
        minv, _, minloc, _ = cv2.minMaxLoc(res)
        if not np.isfinite(minv):
            fill[py, px] = False
            continue
        sx, sy = minloc
        src_patch = known_img[sy1 + sy:sy1 + sy + patch, sx1 + sx:sx1 + sx + patch]
        tgt_fill = fill[ty1:ty2, tx1:tx2]
        known_img[ty1:ty2, tx1:tx2][tgt_fill] = src_patch[tgt_fill]
        fill[ty1:ty2, tx1:tx2] = False
        conf[ty1:ty2, tx1:tx2] = cterm
        iterations += 1
        if verbose and iterations % 50 == 0:
            print("  iter", iterations, "remaining", int(fill.sum()), f"{time.perf_counter()-started:.2f}s")

    out = rgb.copy()
    out[y1:y2, x1:x2][mask[y1:y2, x1:x2] > 0] = np.clip(known_img, 0, 255).astype(np.uint8)[mask[y1:y2, x1:x2] > 0]
    print(f"criminisi: {iterations} iters, {time.perf_counter()-started:.2f}s")
    return out


def main():
    rgb = np.array(cv2.imread(str(IMG))[:, :, ::-1])
    mask, analyses, _ = build_combined_mask(rgb, REGIONS, dilation=5)
    interior = np.zeros(mask.shape, np.uint8)
    for a in analyses:
        if a.interior is not None:
            interior = cv2.bitwise_or(interior, a.interior)
    x1, y1, x2, y2 = 600, 20, 930, 250

    for patch in (11, 15):
        out = criminisi(rgb, mask, interior, patch=patch, search_radius=90, verbose=True)
        c = out[y1:y2, x1:x2]
        c = cv2.resize(c, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        cv2.imwrite(str(OUT / f"proto_crim_{patch}.png"), cv2.cvtColor(c, cv2.COLOR_RGB2BGR))


if __name__ == "__main__":
    main()
