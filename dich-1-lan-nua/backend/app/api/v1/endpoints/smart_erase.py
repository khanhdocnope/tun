import json
from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from app.core.errors import InvalidImageException
from app.services.image_validator import validate_image_upload
from app.services.inpainting.smart_erase import smart_erase

router = APIRouter(tags=["Smart Erase"])


def _parse_regions(raw: str) -> list[tuple[int, int, int, int]]:
    parsed = json.loads(raw)
    if isinstance(parsed, list) and len(parsed) == 4 and not isinstance(parsed[0], list):
        parsed = [parsed]
    if not (
        isinstance(parsed, list)
        and parsed
        and all(isinstance(item, list) and len(item) == 4 for item in parsed)
    ):
        raise ValueError("regions must be [x,y,w,h] or [[x,y,w,h],...]")
    return [tuple(int(v) for v in item) for item in parsed]  # type: ignore[misc]


@router.post("/erase-text-in-region")
async def erase_text_in_region(
    file: UploadFile = File(...),
    regions: Optional[str] = Form(None),  # JSON "[[x,y,w,h], ...]" or "[x,y,w,h]"
    region: Optional[str] = Form(None),  # legacy single region
    engine: Optional[str] = Form("auto"),
    dilation: Optional[int] = Form(5),
    output_format: Optional[str] = Form("png"),
) -> Response:
    """Erase text pixels inside one or more selected regions.

    The eraser works from a pixel mask (not OCR boxes), fills flat bubbles with
    their exact background colour and only falls back to diffusion inpainting
    for textured backgrounds.
    """

    raw = regions or region
    if not raw:
        raise InvalidImageException("Missing 'regions' form field.")

    try:
        region_list = _parse_regions(raw)
    except Exception as exc:
        raise InvalidImageException(f"Invalid regions JSON: {exc}") from exc

    await validate_image_upload(file, full_decode=False)
    await file.seek(0)
    image_bytes = await file.read()

    fmt = (output_format or "png").lower()
    if fmt in ("jpg", "jpeg", "image/jpeg"):
        fmt = "jpeg"
    elif fmt in ("webp", "image/webp"):
        fmt = "webp"
    else:
        fmt = "png"
    media_type = {
        "png": "image/png",
        "webp": "image/webp",
        "jpeg": "image/jpeg",
    }[fmt]

    try:
        cleaned_bytes, stats = await run_in_threadpool(
            smart_erase,
            image_bytes,
            region_list,
            max(0, min(int(dilation or 0), 12)),
            engine or "auto",
            24,
            fmt,
        )
    except Exception as exc:
        raise InvalidImageException(
            "Invalid or corrupt image file. Only PNG, JPEG, and WebP are allowed."
        ) from exc

    return Response(
        content=cleaned_bytes,
        media_type=media_type,
        headers={
            "X-SmartErase-Engine": str(stats.get("engine_used", engine or "auto")),
            "X-SmartErase-Text-Boxes": str(stats.get("text_boxes", 0)),
            "X-SmartErase-Mask-Components": str(stats.get("mask_components", 0)),
            "X-SmartErase-Mask-Coverage": str(stats.get("mask_coverage_pct", 0.0)),
            "X-SmartErase-Elapsed-Ms": str(stats.get("elapsed_ms", 0.0)),
            "X-SmartErase-Status": str(stats.get("status", "ok")),
            "X-SmartErase-Flat-Regions": str(stats.get("flat_regions", 0)),
            "X-SmartErase-Textured-Regions": str(stats.get("textured_regions", 0)),
            "X-SmartErase-Analyzed-Regions": str(stats.get("analyzed_regions", 0)),
            "X-SmartErase-Format": media_type,
        },
    )
