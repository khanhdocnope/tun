from typing import List, Optional
from pydantic import BaseModel, Field


class SmartEraseRequest(BaseModel):
    engine: Optional[str] = Field(default="lama", description="lama | opencv_telea | opencv_ns")
    dilation: int = Field(default=6, ge=0, le=50)
    region: Optional[List[int]] = Field(default=None, description="[x, y, w, h]")


class SmartEraseResponse(BaseModel):
    success: bool = True
    engine: str
    text_boxes: int
    mask_coverage_pct: float = 0.0
    elapsed_ms: float = 0.0
    status: str = "ok"