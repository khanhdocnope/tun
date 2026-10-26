import io
import json
import time
from typing import Optional

import numpy as np
from fastapi import APIRouter, File, Form, Request, Response, UploadFile
from PIL import Image
from starlette.concurrency import run_in_threadpool

from app.core.errors import InvalidImageException
from app.schemas.inpaint import InpaintRegionRequest, MaskGenerateRequest
from app.services.image_validator import validate_image_upload
from app.services.inpainting.manager import inpainting_manager
from app.services.inpainting.mask_generator import MaskGenerator

router = APIRouter(tags=["Inpainting & Text Erasure"])


def _build_mask_and_inpaint(
    image_bytes: bytes,
    mask_bytes: Optional[bytes],
    regions_payload: Optional[str],
    width: int,
    height: int,
    dilation: int,
    engine_name: str,
    radius: int,
) -> tuple[np.ndarray, np.ndarray]:
    """CPU-bound part of /inpaint/process (executed in the threadpool)."""

    with Image.open(io.BytesIO(image_bytes)) as pil_img:
        img_rgb = np.array(pil_img.convert("RGB"))

    if mask_bytes is not None:
        binary_mask = MaskGenerator.bytes_to_mask(mask_bytes, width, height)
    elif regions_payload:
        parsed = json.loads(regions_payload)
        parsed_regions = [InpaintRegionRequest(**item) for item in parsed]
        binary_mask = MaskGenerator.create_mask_from_regions(
            width, height, parsed_regions, global_dilation_px=dilation
        )
    else:
        raise InvalidImageException(
            "Either 'mask' binary file or 'regions_json' coordinate array must be provided."
        )

    engine = inpainting_manager.get_engine(engine_name)
    cleaned_rgb = engine.inpaint(img_rgb, binary_mask, radius=radius)
    return cleaned_rgb, binary_mask


@router.post("/inpaint/process")
async def process_inpaint(
    image: Optional[UploadFile] = File(None),
    file: Optional[UploadFile] = File(None),
    mask: Optional[UploadFile] = File(None),
    regions_json: Optional[str] = Form(None),
    regions: Optional[str] = Form(None),
    engine: Optional[str] = Form("opencv_telea"),
    dilation_px: Optional[int] = Form(None),
    dilation: Optional[int] = Form(None),
    inpaint_radius: int = Form(3),
) -> Response:
    """Inpaint / erase text from comic image while preserving background artwork."""
    upload_file = file or image
    if upload_file is None:
        raise InvalidImageException("Image file is required (use 'file' or 'image' field).")

    effective_regions_str = regions or regions_json
    effective_dilation = dilation if dilation is not None else (dilation_px if dilation_px is not None else 3)

    # 1. Validate source image (header/size/bounds; the worker decodes it once)
    validation_info = await validate_image_upload(upload_file, full_decode=False)
    width = validation_info.width
    height = validation_info.height

    await upload_file.seek(0)
    image_bytes = await upload_file.read()
    mask_bytes = await mask.read() if mask is not None else None

    if not effective_regions_str and mask_bytes is None:
        raise InvalidImageException(
            "Either 'mask' binary file or 'regions_json' coordinate array must be provided."
        )

    started = time.perf_counter()
    try:
        cleaned_rgb, _binary_mask = await run_in_threadpool(
            _build_mask_and_inpaint,
            image_bytes,
            mask_bytes,
            effective_regions_str,
            width,
            height,
            effective_dilation,
            engine,
            inpaint_radius,
        )
    except InvalidImageException:
        raise
    except Exception as exc:
        raise InvalidImageException(f"Invalid regions JSON format: {exc}") from exc

    # Encode cleaned image to PNG.  Level 1 is much faster than optimize=True
    # on full comic pages and visually lossless.
    cleaned_pil = Image.fromarray(cleaned_rgb, mode="RGB")
    out_buf = io.BytesIO()
    cleaned_pil.save(out_buf, format="PNG", compress_level=1)
    cleaned_bytes = out_buf.getvalue()
    duration_ms = round((time.perf_counter() - started) * 1000.0, 2)

    return Response(
        content=cleaned_bytes,
        media_type="image/png",
        headers={
            "X-Cleaned-Width": str(width),
            "X-Cleaned-Height": str(height),
            "X-Inpaint-Engine": inpainting_manager.get_engine(engine).name,
            "X-Inpaint-Duration-Ms": str(int(round(duration_ms))),
        },
    )


@router.post("/mask/generate")
async def generate_mask(
    request: Request,
    width: Optional[int] = Form(None),
    height: Optional[int] = Form(None),
    regions_json: Optional[str] = Form(None),
    dilation_px: Optional[int] = Form(None),
    dilation: Optional[int] = Form(None),
) -> Response:
    """Generate binary mask preview image (PNG) from bounding boxes (supports JSON or Form)."""
    # Check if request is JSON body
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        body = await request.json()
        req_model = MaskGenerateRequest(**body)
        target_width = req_model.width
        target_height = req_model.height
        target_regions = req_model.regions
        target_dilation = (
            req_model.dilation
            if req_model.dilation is not None
            else (req_model.dilation_px if req_model.dilation_px is not None else 3)
        )
    else:
        # Form body
        if width is None or height is None or not regions_json:
            raise InvalidImageException("Form fields width, height, and regions_json are required.")
        target_width = width
        target_height = height
        try:
            parsed = json.loads(regions_json)
            target_regions = [InpaintRegionRequest(**item) for item in parsed]
        except Exception as exc:
            raise InvalidImageException(f"Invalid regions JSON format: {exc}") from exc
        target_dilation = dilation if dilation is not None else (dilation_px if dilation_px is not None else 3)

    mask_np = MaskGenerator.create_mask_from_regions(
        target_width, target_height, target_regions, global_dilation_px=target_dilation
    )
    mask_png = MaskGenerator.mask_to_png_bytes(mask_np)

    return Response(
        content=mask_png,
        media_type="image/png",
        headers={
            "X-Mask-Width": str(target_width),
            "X-Mask-Height": str(target_height),
        },
    )
