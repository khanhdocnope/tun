from fastapi import APIRouter, File, UploadFile
from app.schemas.upload import ImageValidationResponse
from app.services.image_validator import validate_image_upload

router = APIRouter(tags=["Upload & Validation"])


@router.post("/images/validate", response_model=ImageValidationResponse)
@router.post("/upload/validate", response_model=ImageValidationResponse)
async def validate_image(file: UploadFile = File(...)) -> ImageValidationResponse:
    """Validate uploaded image integrity, dimensions, and supported format (PNG, JPEG, WebP)."""
    return await validate_image_upload(file)
