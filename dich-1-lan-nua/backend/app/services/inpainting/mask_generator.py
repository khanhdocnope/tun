import io
from typing import List, Optional
import cv2
import numpy as np
from PIL import Image

from app.schemas.inpaint import InpaintRegionRequest


class MaskGenerator:
    """Generates and refines binary inpainting masks from bounding boxes and polygons."""

    @staticmethod
    def create_mask_from_regions(
        width: int,
        height: int,
        regions: List[InpaintRegionRequest],
        global_dilation_px: int = 3,
    ) -> np.ndarray:
        """Create a single-channel binary uint8 mask (0 = keep, 255 = inpaint)."""
        mask = np.zeros((height, width), dtype=np.uint8)

        for region in regions:
            box = region.box
            dilation = region.dilation_px if region.dilation_px is not None else global_dilation_px

            # Compute pixel boundaries clamped to image dimensions
            x1 = max(0, int(np.floor(box.x - dilation)))
            y1 = max(0, int(np.floor(box.y - dilation)))
            x2 = min(width, int(np.ceil(box.x + box.width + dilation)))
            y2 = min(height, int(np.ceil(box.y + box.height + dilation)))

            if x2 > x1 and y2 > y1:
                mask[y1:y2, x1:x2] = 255

        # If global dilation requested beyond box bounds, apply morphological expansion
        if global_dilation_px > 0:
            kernel_size = max(3, (global_dilation_px * 2) + 1)
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
            mask = cv2.dilate(mask, kernel, iterations=1)

        return mask

    @staticmethod
    def mask_to_png_bytes(mask: np.ndarray) -> bytes:
        """Encode binary mask array into PNG image bytes."""
        pil_img = Image.fromarray(mask, mode="L")
        out_buf = io.BytesIO()
        pil_img.save(out_buf, format="PNG")
        return out_buf.getvalue()

    @staticmethod
    def bytes_to_mask(mask_bytes: bytes, target_width: int, target_height: int) -> np.ndarray:
        """Decode binary mask bytes into uint8 numpy array with dimension validation."""
        with Image.open(io.BytesIO(mask_bytes)) as pil_img:
            mask_gray = pil_img.convert("L")
            if mask_gray.size != (target_width, target_height):
                mask_gray = mask_gray.resize((target_width, target_height), Image.Resampling.NEAREST)
            mask_np = np.array(mask_gray, dtype=np.uint8)
            # Threshold to strict binary (0 or 255)
            _, binary_mask = cv2.threshold(mask_np, 127, 255, cv2.THRESH_BINARY)
            return binary_mask
