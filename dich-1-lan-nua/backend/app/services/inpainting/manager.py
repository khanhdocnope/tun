from typing import Dict, List, Optional
from app.services.inpainting.base import BaseInpaintingEngine
from app.services.inpainting.opencv_engine import (
    OpenCVTeleaEngine,
    OpenCVNavierStokesEngine,
)


class InpaintingManager:
    """Singleton manager for configurable Inpainting engines."""

    def __init__(self):
        self._engines: Dict[str, BaseInpaintingEngine] = {
            "opencv_telea": OpenCVTeleaEngine(),
            "opencv_ns": OpenCVNavierStokesEngine(),
        }

    def get_available_engines(self) -> List[str]:
        return list(self._engines.keys())

    def get_engine(self, engine_name: Optional[str] = None) -> BaseInpaintingEngine:
        if engine_name and engine_name in self._engines:
            return self._engines[engine_name]
        return self._engines["opencv_telea"]


inpainting_manager = InpaintingManager()
