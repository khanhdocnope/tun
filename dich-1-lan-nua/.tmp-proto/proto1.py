"""Prototype reconstruction strategies for the translucent-bubble case."""
import sys
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


def norm_conv(rgb, clean, kernel):
    """Normalized convolution of clean pixels only."""
    weight = clean.astype(np.float32)
    num = cv2.filter2D(rgb.astype(np.float32) * weight[..., None], -1, kernel)
    den = cv2.filter2D(weight, -1, kernel)
    out = num / np.maximum(den, 1e-6)[..., None]
    return out


def local_median_fill(rgb, mask, interior, window=33):
    """Large-window median computed from clean pixels, hole-only application."""
    h, w = mask.shape
    clean = (interior > 0) & (mask == 0)
    padded = cv2.copyMakeBorder(rgb, 0, 0, 0, 0, cv2.BORDER_REPLICATE)
    # cv2.medianBlur ignores the mask; emulate by medians of a shifted stack.
    step = max(1, window // 6)
    stack = []
    for dy in range(-window // 2, window // 2 + 1, step):
        for dx in range(-window // 2, window // 2 + 1, step):
            m = np.float32([[1, 0, dx], [0, 1, dy]])
            shifted = cv2.warpAffine(padded, m, (w, h), borderMode=cv2.BORDER_REFLECT)
            shifted_clean = cv2.warpAffine(
                clean.astype(np.uint8), m, (w, h), borderMode=cv2.BORDER_REPLICATE
            )
            shifted[shifted_clean == 0] = np.nan
            stack.append(shifted)
    stack = np.stack(stack, axis=0)
    med = np.nanmedian(stack, axis=0)
    out = rgb.copy()
    out[mask > 0] = np.nan_to_num(med[mask > 0]).astype(np.uint8)
    return out


def oriented_fill(rgb, mask, interior, angles=(0, 45, 90, 135), length=41, width=5):
    """Normalized convolution with elongated kernels, blended by orientation."""
    h, w = mask.shape
    clean = ((interior > 0) & (mask == 0)).astype(np.float32)
    rgb_f = rgb.astype(np.float32)

    fills = []
    for ang in angles:
        rad = np.deg2rad(ang)
        ky = cv2.getGaussianKernel(length, length / 4.0).astype(np.float32)
        kx = cv2.getGaussianKernel(width, width / 2.0).astype(np.float32)
        kern = np.outer(ky, kx)
        # rotate kernel so its long axis points along `ang`
        size = max(kern.shape)
        M = cv2.getRotationMatrix2D((size / 2 - 0.5, size / 2 - 0.5), ang, 1.0)
        kern = cv2.warpAffine(kern, M, (size, size))
        s = kern.sum()
        if s <= 0:
            continue
        kern /= s
        num = cv2.filter2D(rgb_f * clean[..., None], -1, kern)
        den = cv2.filter2D(clean, -1, kern)
        fills.append(num / np.maximum(den, 1e-6)[..., None])

    # Orientation from coarse fill: structure tensor of a blurred estimate.
    g = cv2.getGaussianKernel(31, 10).astype(np.float32)
    coarse = norm_conv(rgb, clean, np.outer(g, g))
    gray = cv2.cvtColor(np.clip(coarse, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    sxx = cv2.GaussianBlur(gx * gx, (0, 0), 6)
    syy = cv2.GaussianBlur(gy * gy, (0, 0), 6)
    sxy = cv2.GaussianBlur(gx * gy, (0, 0), 6)
    # dominant gradient direction
    theta = 0.5 * np.arctan2(2 * sxy, sxx - syy)
    # isophote (edge) direction is gradient + 90deg = the direction we want to
    # smooth along.  Kernel long axis is `ang`; weight = |cos(ang - iso)|.
    iso = theta + np.pi / 2
    coh = np.sqrt((sxx - syy) ** 2 + 4 * sxy ** 2) / np.maximum(sxx + syy, 1e-6)

    weights = []
    for ang in angles:
        delta = np.deg2rad(ang) - iso
        weights.append(np.abs(np.cos(delta)) ** 2 + 0.05)
    wstack = np.stack(weights, axis=0)
    wstack /= wstack.sum(axis=0, keepdims=True)
    fstack = np.stack(fills, axis=0)
    blended = (fstack * wstack[..., None]).sum(axis=0)

    out = rgb.astype(np.float32).copy()
    m = mask > 0
    out[m] = blended[m]
    return np.clip(out, 0, 255).astype(np.uint8), coarse


def save(name, arr, box=(560, 0, 980, 330)):
    x1, y1, x2, y2 = box
    crop = arr[y1:y2, x1:x2]
    crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(OUT / f"proto_{name}.png"), cv2.cvtColor(crop, cv2.COLOR_RGB2BGR))


def main():
    rgb = np.array(cv2.imread(str(IMG))[:, :, ::-1])
    mask, analyses, fill_map = build_combined_mask(rgb, REGIONS, dilation=5)
    interior = np.zeros(mask.shape, np.uint8)
    for a in analyses:
        if a.interior is not None:
            interior = cv2.bitwise_or(interior, a.interior)
    print("mask px", int((mask > 0).sum()), "interior", int((interior > 0).sum()))
    save("mask", cv2.cvtColor(mask, cv2.COLOR_GRAY2RGB))

    # current directional
    out = directional_fill(rgb, mask)
    save("directional", out)

    out2, coarse = oriented_fill(rgb, mask, interior)
    save("oriented", out2)
    x1, y1, x2, y2 = 560, 0, 980, 330
    cv2.imwrite(str(OUT / "proto_coarse.png"), cv2.cvtColor(coarse[y1:y2, x1:x2].astype(np.uint8), cv2.COLOR_RGB2BGR))

    # median then oriented
    med = local_median_fill(rgb, mask, interior, window=33)
    save("median", med)
    med_f = med.astype(np.float32)
    out3 = med_f.copy()
    out3[mask > 0] = out2[mask > 0]
    save("oriented_blend", np.clip(out3, 0, 255).astype(np.uint8))


if __name__ == "__main__":
    main()
