from typing import Dict, List, Optional
from app.services.ocr.base import BaseOCREngine
from app.services.ocr.rapidocr_engine import RapidOCREngine
from app.services.ocr.contour_engine import ContourOCREngine


class OCRManager:
    """Singleton manager for OCR engines with model caching across requests."""

    def __init__(self):
        self._engines: Dict[str, BaseOCREngine] = {
            "rapidocr": RapidOCREngine(),
            "contour": ContourOCREngine(),
        }

    def get_available_engines(self) -> List[str]:
        """Return names of available engines."""
        return [
            name for name, engine in self._engines.items() if engine.is_available()
        ]

    def get_engine(self, engine_name: Optional[str] = None) -> BaseOCREngine:
        """Resolve engine by name with fallback to rapidocr or contour."""
        if engine_name and engine_name in self._engines:
            engine = self._engines[engine_name]
            if engine.is_available():
                return engine

        # Default resolution order: rapidocr -> contour
        if self._engines["rapidocr"].is_available():
            return self._engines["rapidocr"]

        return self._engines["contour"]


ocr_manager = OCRManager()
