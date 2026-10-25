from typing import List, Optional
from pydantic import BaseModel, Field, model_validator
from app.schemas.ocr import BoundingBoxModel


class InpaintRegionRequest(BaseModel):
    id: Optional[str] = None
    box: Optional[BoundingBoxModel] = None
    x: Optional[float] = None
    y: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    polygon: Optional[List[List[float]]] = None
    dilation_px: Optional[int] = Field(
        default=3, ge=0, le=50, description="Mask dilation margin in pixels"
    )

    @model_validator(mode="after")
    def populate_box(self) -> "InpaintRegionRequest":
        if self.box is None:
            if self.x is not None and self.y is not None and self.width is not None and self.height is not None:
                self.box = BoundingBoxModel(
                    x=self.x,
                    y=self.y,
                    width=self.width,
                    height=self.height,
                )
            else:
                raise ValueError("Either 'box' or 'x, y, width, height' must be provided.")
        return self


class InpaintProcessRequest(BaseModel):
    engine: Optional[str] = Field(
        default="opencv_telea",
        description="Inpainting engine: opencv_telea or opencv_ns",
    )
    dilation_px: int = Field(
        default=3, ge=0, le=50, description="Global mask dilation margin"
    )
    inpaint_radius: int = Field(
        default=3, ge=1, le=20, description="Inpaint neighborhood radius for Telea/NS"
    )
    regions: Optional[List[InpaintRegionRequest]] = Field(
        default=None, description="Explicit list of bounding boxes to erase"
    )


class MaskGenerateRequest(BaseModel):
    width: int
    height: int
    dilation_px: Optional[int] = Field(
        default=3, ge=0, le=50, description="Dilation kernel margin in pixels"
    )
    dilation: Optional[int] = None
    regions: List[InpaintRegionRequest] = Field(
        ..., description="List of bounding boxes to convert into binary mask"
    )
