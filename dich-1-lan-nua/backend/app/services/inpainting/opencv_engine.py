import cv2
import numpy as np
from app.services.inpainting.base import BaseInpaintingEngine


class OpenCVTeleaEngine(BaseInpaintingEngine):
    """Fast CPU Inpainting based on the Fast Marching Method (Telea, 2004).

    Iteratively propagates image smooth gradients from boundary inwards.
    Best suited for solid-color speech bubbles, halftone comic screentones,
    and uniform gradients on CPU hardware without neural network dependencies.
    """

    @property
    def name(self) -> str:
        return "opencv_telea"

    def inpaint(
        self,
        image_rgb: np.ndarray,
        mask: np.ndarray,
        radius: int = 3,
    ) -> np.ndarray:
        if mask.dtype != np.uint8:
            mask = mask.astype(np.uint8)

        # Convert RGB to BGR for OpenCV inpainting
        image_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)

        # Execute Fast Marching inpaint
        cleaned_bgr = cv2.inpaint(image_bgr, mask, float(radius), cv2.INPAINT_TELEA)

        # Convert back to RGB
        return cv2.cvtColor(cleaned_bgr, cv2.COLOR_BGR2RGB)


class OpenCVNavierStokesEngine(BaseInpaintingEngine):
    """Fluid dynamics partial differential equation (PDE) inpainting (Bertalmio et al., 2001).

    Propagates isophote lines of equal gray value along the boundaries of the mask.
    Provides alternative diffusion smoothing when Telea produces edge blurring.
    """

    @property
    def name(self) -> str:
        return "opencv_ns"

    def inpaint(
        self,
        image_rgb: np.ndarray,
        mask: np.ndarray,
        radius: int = 3,
    ) -> np.ndarray:
        if mask.dtype != np.uint8:
            mask = mask.astype(np.uint8)

        image_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)
        cleaned_bgr = cv2.inpaint(image_bgr, mask, float(radius), cv2.INPAINT_NS)
        return cv2.cvtColor(cleaned_bgr, cv2.COLOR_BGR2RGB)
