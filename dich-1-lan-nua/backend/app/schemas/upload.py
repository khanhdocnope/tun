from pydantic import BaseModel, Field


class ImageValidationResponse(BaseModel):
    """Image validation result metadata."""
    valid: bool = Field(default=True, description="Whether the image passed all validations")
    filename: str = Field(..., description="Original filename of the uploaded image")
    content_type: str = Field(..., description="MIME content type (e.g. image/png)")
    size_bytes: int = Field(..., description="File size in bytes")
    width: int = Field(..., description="Native pixel width")
    height: int = Field(..., description="Native pixel height")
    format: str = Field(..., description="Detected image format: PNG, JPEG, WEBP")
