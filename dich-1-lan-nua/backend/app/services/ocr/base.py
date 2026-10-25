from abc import ABC, abstractmethod
from typing import List, Optional
from app.schemas.ocr import OCRRegionModel


class BaseOCREngine(ABC):
    """Abstract base class for all OCR and Text Detection Engines."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Identifier name of the OCR engine."""
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """Returns True if the engine dependencies and models are loaded and ready."""
        ...

    @abstractmethod
    def detect_and_recognize(
        self,
        image_bytes: bytes,
        reading_direction: str = "rtl",
        languages: Optional[List[str]] = None,
    ) -> List[OCRRegionModel]:
        """Detect text regions and extract text.

        Args:
            image_bytes: Raw binary image payload.
            reading_direction: 'rtl' for Japanese manga, 'ltr' for webtoons/comics.
            languages: Optional list of target language codes.

        Returns:
            List of detected OCRRegionModel sorted in logical reading order.
        """
        ...
