import json
import time
from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile
from starlette.concurrency import run_in_threadpool

from app.schemas.ocr import OCRDetectResponse
from app.services.image_validator import validate_image_upload
from app.services.ocr.manager import ocr_manager

router = APIRouter(tags=["OCR & Text Detection"])


def _parse_languages(raw: Optional[str]) -> Optional[list[str]]:
    if not raw:
        return None
    raw = raw.strip()
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip()]
        except Exception:
            pass
    return [item.strip() for item in raw.split(",") if item.strip()]


@router.post("/ocr/detect", response_model=OCRDetectResponse)
async def detect_text(
    file: UploadFile = File(...),
    reading_direction: Optional[str] = Form(None),
    reading_order: Optional[str] = Form(None),
    engine: Optional[str] = Form(None),
    languages: Optional[str] = Form(None),
) -> OCRDetectResponse:
    """Run OCR detection and dialogue text extraction on a comic image page.

    CPU-heavy inference runs in the threadpool so the API event loop stays
    responsive (health checks and concurrent erase requests keep working).
    """

    start_time = time.perf_counter()
    effective_direction = reading_order or reading_direction or "rtl"

    # Reuse Phase 1 validated upload pipeline (50MB stream limit, bounds, format)
    validation_info = await validate_image_upload(file)
    await file.seek(0)
    image_bytes = await file.read()

    # Model initialisation can download/cache weights on first use; do it off
    # the event loop as well.
    selected_engine = await run_in_threadpool(ocr_manager.get_engine, engine)
    lang_list = _parse_languages(languages)

    regions = await run_in_threadpool(
        selected_engine.detect_and_recognize,
        image_bytes,
        effective_direction,
        lang_list,
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
