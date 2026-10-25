from typing import List, Optional, Tuple
from pydantic import BaseModel, Field


class BoundingBoxModel(BaseModel):
    x: float = Field(..., description="Top-left X coordinate in image pixel space")
    y: float = Field(..., description="Top-left Y coordinate in image pixel space")
    width: float = Field(..., description="Width in image pixel space")
    height: float = Field(..., description="Height in image pixel space")


class OCRRegionModel(BaseModel):
    id: str = Field(..., description="Unique ID for region (e.g. UUID)")
    box: BoundingBoxModel = Field(..., description="Normalized axis-aligned bounding box")
    polygon: Optional[List[List[float]]] = Field(
        default=None, description="Optional polygon contour coordinates [[x, y], ...]"
    )
    text: str = Field(..., description="Extracted raw dialogue text")
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="OCR detection/recognition confidence score"
    )
    reading_order: int = Field(
        ..., ge=1, description="1-indexed sequence order in reading layout"
    )
    direction: str = Field(
        default="horizontal", description="Orientation: horizontal or vertical"
    )
    language: Optional[str] = Field(
        default="unknown", description="Detected or requested language ISO code"
    )


class OCRDetectResponse(BaseModel):
    success: bool = True
    regions: List[OCRRegionModel] = Field(
        default_factory=list, description="Detected text regions in reading order"
    )
    total_regions: int = Field(..., description="Total count of text regions found")
    image_width: int = Field(..., description="Image width in pixels")
    image_height: int = Field(..., description="Image height in pixels")
    engine: str = Field(..., description="OCR engine utilized (e.g. rapidocr, contour)")
    reading_order: str = Field(default="rtl", description="Reading layout order (rtl or ltr)")
    processing_time_ms: float = Field(..., description="Execution time in milliseconds")
