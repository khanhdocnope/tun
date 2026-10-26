"""Compare structure boost / sharpening variants on rzZ."""
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.services.inpainting.text_mask import build_combined_mask  # noqa: E402
from app.services.inpainting.texture_fill import pairwise_directional_fill  # noqa: E402

IMG = ROOT / "raw-test" / "rzZIsUpAZ.webp-t.w1280.jpg"
OUT = ROOT / "raw-test" / "bench-out"
REGIONS = [(643, 58, 197, 82), (646, 137, 218, 74)]


def main():
    rgb = np.array(cv2.imread(str(IMG))[:, :, ::-1])
    mask, analyses, _ = build_combined_mask(rgb, REGIONS, dilation=5)
    interior = np.zeros(mask.shape, np.uint8)
    for a in analyses:
        if a.interior is not None:
            interior = cv2.bitwise_or(interior, a.interior)
    for boost, sharp in ((0, 0), (0, 0.55), (1.8, 0.55), (3.0, 0.8)):
        out = pairwise_directional_fill(
            rgb, mask, interior, structure_boost=boost, sharpen=sharp
        )
        c = out[0:340, 520:980]
        c = cv2.resize(c, None, fx=1.6, fy=1.6, interpolation=cv2.INTER_LANCZOS4)
        cv2.imwrite(
            str(OUT / f"v_boost{boost}_sharp{sharp}.png"),
            cv2.cvtColor(c, cv2.COLOR_RGB2BGR),
        )
        print(boost, sharp, "done")


if __name__ == "__main__":
    main()
