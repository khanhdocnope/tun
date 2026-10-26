import io
from typing import Tuple
from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError
import numpy as np

from app.core.config import settings
from app.core.errors import (
    AppException,
    FileTooLargeException,
    InvalidImageException,
)
from app.schemas.upload import ImageValidationResponse

# Allowed PIL formats to MIME content types
FORMAT_TO_MIME = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
}

MIN_DIMENSION = 10
MAX_DIMENSION = 16384


async def validate_image_upload(
    file: UploadFile, full_decode: bool = True
) -> ImageValidationResponse:
    """Validate an uploaded image file for size, format, dimensions, and integrity.

    Args:
        file: UploadFile from multipart/form-data request.
        full_decode: When True (default, used by /images/validate) the complete
            raster is decoded to reject truncated bitstreams.  OCR and inpainting
            callers set this to False because they decode the image once themselves,
            which avoids a redundant full-image decode on large webtoon pages.

    Returns:
        ImageValidationResponse containing image metadata if valid.

    Raises:
        FileTooLargeException: If file size exceeds MAX_UPLOAD_SIZE_MB.
        InvalidImageException: If file is empty, corrupt, unsupported, or out-of-bounds.
    """
    max_bytes = settings.max_upload_size_bytes
    chunk_size = 1024 * 1024  # 1MB
    chunks = []
    total_size = 0

    # Stream file in chunks to enforce maximum upload size without runaway memory allocation
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total_size += len(chunk)
        if total_size > max_bytes:
            raise FileTooLargeException(
                f"File size exceeds the {settings.MAX_UPLOAD_SIZE_MB}MB limit."
            )
        chunks.append(chunk)

    file_bytes = b"".join(chunks)

    if not file_bytes:
        raise InvalidImageException(
            "Invalid or corrupt image file. Only PNG, JPEG, and WebP are allowed."
        )

    # Validate image header, format, and dimensions using PIL
    try:
        with Image.open(io.BytesIO(file_bytes)) as img:
            img_format = (img.format or "").upper()
            width, height = img.size

            if img_format not in FORMAT_TO_MIME:
                raise InvalidImageException(
                    "Invalid or corrupt image file. Only PNG, JPEG, and WebP are allowed."
                )

            if width < MIN_DIMENSION or height < MIN_DIMENSION:
                raise InvalidImageException(
                    f"Image dimensions too small ({width}x{height}). Minimum is {MIN_DIMENSION}x{MIN_DIMENSION}."
                )

            if width > MAX_DIMENSION or height > MAX_DIMENSION:
                raise InvalidImageException(
                    f"Image dimensions exceed maximum allowed ({width}x{height} > {MAX_DIMENSION}x{MAX_DIMENSION})."
                )

            # verify() checks header integrity
            img.verify()
    except AppException:
        raise
    except Exception as exc:
        raise InvalidImageException(
            "Invalid or corrupt image file. Only PNG, JPEG, and WebP are allowed."
        ) from exc

    # Perform full raster decode to detect corrupt/truncated bitstreams.  The
    # OCR/inpaint endpoints skip this step because they decode the image again
    # in their own worker anyway.
    if full_decode:
        try:
            with Image.open(io.BytesIO(file_bytes)) as full_img:
                full_img.load()
        except AppException:
            raise
        except Exception as exc:
            raise InvalidImageException(
                "Invalid or corrupt image file. Only PNG, JPEG, and WebP are allowed."
            ) from exc

    filename = file.filename or "unknown_image"
    content_type = FORMAT_TO_MIME[img_format]

    return ImageValidationResponse(
        valid=True,
        filename=filename,
        content_type=content_type,
        size_bytes=len(file_bytes),
        width=width,
        height=height,
        format=img_format,
    )
