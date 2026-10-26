"""Prototype 2: robust background estimation for a translucent bubble."""
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


def norm_conv(rgb, clean, kern):
    c = clean.astype(np.float32)
    num = cv2.filter2D(rgb.astype(np.float32) * c[..., None], -1, kern)
    den = cv2.filter2D(c, -1, kern)
    return num / np.maximum(den, 1e-6)[..., None]


def masked_median(rgb, mask, interior, window, step=3):
    """Median over a coarse grid of shifts (approximates a large-window median)."""
    ys, xs = np.where(mask)
    pad = window
    x0 = max(0, xs.min() - pad); y0 = max(0, ys.min() - pad)
    x1 = min(rgb.shape[1], xs.max() + pad + 1); y1 = min(rgb.shape[0], ys.max() + pad + 1)
    orig_rgb = rgb; orig_h, orig_w = rgb.shape[:2]
    rgb = rgb[y0:y1, x0:x1]; mask = mask[y0:y1, x0:x1]; interior = interior[y0:y1, x0:x1]
    clean = (interior > 0) & (mask == 0)
    shifts = np.arange(-window // 2, window // 2 + 1, step)
    h, w = mask.shape
    stack = []
    for dy in shifts:
        for dx in shifts:
            M = np.float32([[1, 0, dx], [0, 1, dy]])
            s = cv2.warpAffine(rgb, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            sc = cv2.warpAffine(clean.astype(np.uint8), M, (w, h), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_REFLECT)
            s = s.astype(np.float32)
            s[sc == 0] = np.nan
            stack.append(s)
    med = np.nanmedian(np.stack(stack), axis=0)
    out = rgb.astype(np.float32).copy()
    out[mask > 0] = np.nan_to_num(med[mask > 0], nan=0)
    result = np.zeros((orig_h, orig_w, 3), np.uint8)
    result[:] = orig_rgb
    result[y0:y1, x0:x1] = np.clip(out, 0, 255).astype(np.uint8)
    return result


def multiscale_fill(rgb, mask, interior, levels=4, final_radius=3):
    """Coarse-to-fine fill: structure at coarse scale, detail blend at fine."""
    h, w = mask.shape
    ys, xs = np.where(mask)
    if xs.size == 0:
        return rgb
    pad = 40
    x1, y1 = max(0, xs.min() - pad), max(0, ys.min() - pad)
    x2, y2 = min(w, xs.max() + pad), min(h, ys.max() + pad)
    img = rgb[y1:y2, x1:x2].astype(np.float32)
    m = (mask[y1:y2, x1:x2] > 0).astype(np.uint8)
    inside = (interior[y1:y2, x1:x2] > 0).astype(np.uint8)

    pyramids = [(img, m, inside)]
    for _ in range(levels):
        im, mm, ins = pyramids[-1]
        if min(im.shape[:2]) < 40:
            break
        im2 = cv2.pyrDown(im)
        mm2 = cv2.resize(mm, (im2.shape[1], im2.shape[0]), interpolation=cv2.INTER_NEAREST)
        ins2 = cv2.resize(ins, (im2.shape[1], im2.shape[0]), interpolation=cv2.INTER_NEAREST)
        # ensure holes survive downsampling
        mm2 = cv2.dilate(mm2, np.ones((3, 3), np.uint8))
        pyramids.append((im2, mm2, ins2))

    # coarsest: normalized convolution with large kernel + Telea cleanup
    im, mm, ins = pyramids[-1]
    clean = (ins > 0) & (mm == 0)
    g = cv2.getGaussianKernel(31, 12).astype(np.float32)
    filled = norm_conv(np.clip(im, 0, 255), clean, np.outer(g, g))
    filled = np.clip(filled, 0, 255)
    filled[mm == 0] = im[mm == 0]
    cur = filled

    for level in range(len(pyramids) - 2, -1, -1):
        im, mm, ins = pyramids[level]
        up = cv2.resize(cur, (im.shape[1], im.shape[0]), interpolation=cv2.INTER_CUBIC)
        clean = (ins > 0) & (mm == 0)
        # detail from known pixels: normalized conv with small sigma
        g = cv2.getGaussianKernel(9, 2.5).astype(np.float32)
        detail_img = np.clip(im, 0, 255)
        smooth = norm_conv(detail_img, clean, np.outer(g, g))
        detail = detail_img - smooth
        gb = cv2.getGaussianKernel(15, 5).astype(np.float32)
        detail = norm_conv(detail + 128, clean, np.outer(gb, gb)) - 128
        cur = up.copy()
        hol = mm > 0
        cur[hol] = up[hol] + detail[hol]
        cur[~hol] = im[~hol]
        cur = np.clip(cur, 0, 255)

    out = rgb.copy()
    out[y1:y2, x1:x2][mask[y1:y2, x1:x2] > 0] = cur.astype(np.uint8)[mask[y1:y2, x1:x2] > 0]
    return out


def guided_refine(fill, rgb, mask, interior, radius=9):
    """Edge-aware refinement: re-estimate hole pixels from clean ones weighted by
    similarity to the current estimate (self-guided normalized convolution)."""
    clean = (interior > 0) & (mask == 0)
    guide = cv2.GaussianBlur(fill.astype(np.float32), (0, 0), 3)
    out = fill.astype(np.float32).copy()
    k = radius
    h, w = mask.shape
    num = np.zeros((h, w, 3), np.float32)
    den = np.zeros((h, w, 1), np.float32)
    for dy in range(-k, k + 1, 2):
        for dx in range(-k, k + 1, 2):
            M = np.float32([[1, 0, dx], [0, 1, dy]])
            s = cv2.warpAffine(rgb, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT).astype(np.float32)
            sc = cv2.warpAffine(clean.astype(np.uint8), M, (w, h), flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_REFLECT) > 0
            gs = cv2.warpAffine(guide, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            d2 = np.sum((gs - guide) ** 2, axis=2)
            wgt = np.exp(-d2 / (2 * 18.0 ** 2)) / (1.0 + dx * dx + dy * dy)
            wgt[~sc] = 0
            num += s * wgt[..., None]
            den += wgt[..., None]
    est = num / np.maximum(den, 1e-6)
    valid = den[..., 0] > 0
    m = mask > 0
    out[m & valid] = est[m & valid]
    return np.clip(out, 0, 255).astype(np.uint8)


def save(name, arr):
    x1, y1, x2, y2 = BOX
    c = arr[y1:y2, x1:x2]
    c = cv2.resize(c, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(OUT / f"p2_{name}.png"), cv2.cvtColor(c, cv2.COLOR_RGB2BGR))


def main():
    rgb = np.array(cv2.imread(str(IMG))[:, :, ::-1])
    for dil in (1, 2, 5):
        mask, analyses, _ = build_combined_mask(rgb, REGIONS, dilation=dil)
        interior = np.zeros(mask.shape, np.uint8)
        for a in analyses:
            if a.interior is not None:
                interior = cv2.bitwise_or(interior, a.interior)
        if dil != 2:
            continue
        t = time.perf_counter(); med = masked_median(rgb, mask, interior, 41); save("median41", med); print("median41", time.perf_counter()-t)
        t = time.perf_counter(); med = masked_median(rgb, mask, interior, 61); save("median61", med); print("median61", time.perf_counter()-t)
        g = cv2.getGaussianKernel(61, 18).astype(np.float32)
        clean = (interior > 0) & (mask == 0)
        nc = norm_conv(rgb, clean, np.outer(g, g))
        o = rgb.copy(); o[mask > 0] = np.clip(nc, 0, 255).astype(np.uint8)[mask > 0]; save("nc61", o)
        t = time.perf_counter(); ms = multiscale_fill(rgb, mask, interior, levels=4); save("multiscale", ms); print("multiscale", time.perf_counter()-t)
        t = time.perf_counter(); gr = guided_refine(ms.astype(np.float32), rgb, mask, interior, radius=11); save("multiscale_guided", gr); print("guided", time.perf_counter()-t)
        print("done dil", dil)


if __name__ == "__main__":
    main()

