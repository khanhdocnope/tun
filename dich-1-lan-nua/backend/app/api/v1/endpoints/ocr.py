import time
from typing import Optional
from fastapi import APIRouter, File, Form, UploadFile
from PIL import Image
import io

from app.schemas.ocr import OCRDetectResponse
from app.services.image_validator import validate_image_upload
from app.services.ocr.manager import ocr_manager

router = APIRouter(tags=["OCR & Text Detection"])


@router.post("/ocr/detect", response_model=OCRDetectResponse)
async def detect_text(
    file: UploadFile = File(...),
    reading_direction: Optional[str] = Form(None),
    reading_order: Optional[str] = Form(None),
    engine: Optional[str] = Form(None),
    languages: Optional[str] = Form(None),
) -> OCRDetectResponse:
    """Run real OCR detection and dialogue text extraction on a comic image page."""
    start_time = time.perf_counter()
    effective_direction = reading_order or reading_direction or "rtl"

    # Reuse Phase 1 validated upload pipeline (checks 50MB stream limit, bounds 10..16384, format)
    validation_info = await validate_image_upload(file)

    # Reset file cursor to read bytes for OCR
    await file.seek(0)
    image_bytes = await file.read()

    selected_engine = ocr_manager.get_engine(engine)
    lang_list = [lang.strip() for lang in languages.split(",")] if languages else None

    # Execute OCR detection and recognition
    regions = selected_engine.detect_and_recognize(
        image_bytes=image_bytes,
        reading_direction=effective_direction,
        languages=lang_list,
    )

    elapsed_ms = (time.perf_counter() - start_time) * 1000.0

    return OCRDetectResponse(
        success=True,
        regions=regions,
        total_regions=len(regions),
        image_width=validation_info.width,
        image_height=validation_info.height,
        engine=selected_engine.name,
        reading_order=effective_direction,
        processing_time_ms=round(elapsed_ms, 2),
    )
