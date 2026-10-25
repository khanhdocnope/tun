from abc import ABC, abstractmethod
import numpy as np


class BaseInpaintingEngine(ABC):
    """Abstract base class for Inpainting and text background erasure engines."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Engine identifier."""
        ...

    @abstractmethod
    def inpaint(
        self,
        image_rgb: np.ndarray,
        mask: np.ndarray,
        radius: int = 3,
    ) -> np.ndarray:
        """Inpaint regions covered by mask (255) using background textures.

        Args:
            image_rgb: Source image as RGB numpy array of shape (H, W, 3) and uint8 type.
            mask: Binary mask of shape (H, W) where 255 indicates regions to inpaint.
            radius: Inpaint neighborhood radius parameter.

        Returns:
            Cleaned image as RGB numpy array of shape (H, W, 3).
        """
        ...
