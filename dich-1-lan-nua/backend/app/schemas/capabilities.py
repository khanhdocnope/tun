from typing import List
from pydantic import BaseModel, Field


class OCROptions(BaseModel):
    """OCR engine options and supported languages."""
    available_engines: List[str] = Field(default_factory=lambda: ["easyocr", "contour", "mock"])
    default_engine: str = Field(default="easyocr")
    languages: List[str] = Field(default_factory=lambda: ["en", "ja", "ko", "ch_sim"])


class InpaintingOptions(BaseModel):
    """Inpainting engine options."""
    available_engines: List[str] = Field(default_factory=lambda: ["opencv_telea", "opencv_ns", "lama"])
    default_engine: str = Field(default="opencv_telea")


class TranslationOptions(BaseModel):
    """Translation provider options."""
    available_providers: List[str] = Field(default_factory=lambda: ["openrouter", "openai"])
    default_provider: str = Field(default="openrouter")


class LimitsOptions(BaseModel):
    """System upload limits and supported formats."""
    max_upload_size_mb: int = Field(default=50)
    supported_image_types: List[str] = Field(
        default_factory=lambda: ["image/png", "image/jpeg", "image/webp"]
    )


class CapabilitiesResponse(BaseModel):
    """System capabilities response schema."""
    ocr: OCROptions
    inpainting: InpaintingOptions
    translation: TranslationOptions
    limits: LimitsOptions
