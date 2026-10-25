import io
import struct
import zlib
import pytest
from httpx import AsyncClient
from PIL import Image

from app.core.config import settings
from app.schemas.upload import ImageValidationResponse
from tests.conftest import generate_test_image


@pytest.mark.asyncio
async def test_validate_valid_png(client: AsyncClient, valid_png_bytes: bytes) -> None:
    """Test validation of a valid PNG image file."""
    files = {"file": ("manga_page_01.png", valid_png_bytes, "image/png")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 200

    data = response.json()
    validated = ImageValidationResponse.model_validate(data)
    assert validated.valid is True
    assert validated.filename == "manga_page_01.png"
    assert validated.content_type == "image/png"
    assert validated.format == "PNG"
    assert validated.width == 120
    assert validated.height == 180
    assert validated.size_bytes == len(valid_png_bytes)


@pytest.mark.asyncio
async def test_validate_valid_jpeg(client: AsyncClient, valid_jpeg_bytes: bytes) -> None:
    """Test validation of a valid JPEG image file."""
    files = {"file": ("cover.jpg", valid_jpeg_bytes, "image/jpeg")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 200

    data = response.json()
    validated = ImageValidationResponse.model_validate(data)
    assert validated.valid is True
    assert validated.filename == "cover.jpg"
    assert validated.content_type == "image/jpeg"
    assert validated.format == "JPEG"
    assert validated.width == 150
    assert validated.height == 200


@pytest.mark.asyncio
async def test_validate_valid_webp(client: AsyncClient, valid_webp_bytes: bytes) -> None:
    """Test validation of a valid WebP image file."""
    files = {"file": ("webtoon_01.webp", valid_webp_bytes, "image/webp")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 200

    data = response.json()
    validated = ImageValidationResponse.model_validate(data)
    assert validated.valid is True
    assert validated.filename == "webtoon_01.webp"
    assert validated.content_type == "image/webp"
    assert validated.format == "WEBP"
    assert validated.width == 80
    assert validated.height == 120


@pytest.mark.asyncio
async def test_validate_alias_endpoint(client: AsyncClient, valid_png_bytes: bytes) -> None:
    """Test that alias endpoint /api/v1/upload/validate behaves identically."""
    files = {"file": ("alias_test.png", valid_png_bytes, "image/png")}
    response = await client.post("/api/v1/upload/validate", files=files)
    assert response.status_code == 200

    data = response.json()
    assert data["valid"] is True
    assert data["filename"] == "alias_test.png"


@pytest.mark.asyncio
async def test_validate_corrupt_image(client: AsyncClient, corrupt_image_bytes: bytes) -> None:
    """Test that corrupt image binary is rejected with HTTP 400."""
    files = {"file": ("corrupt.png", corrupt_image_bytes, "image/png")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 400

    data = response.json()
    assert data["status_code"] == 400
    assert data["error_code"] == "INVALID_IMAGE_FORMAT"
    assert "Invalid or corrupt image" in data["detail"]


@pytest.mark.asyncio
async def test_validate_text_file_disguised_as_image(
    client: AsyncClient, text_file_bytes: bytes
) -> None:
    """Test that text file renamed to .png is caught and rejected with HTTP 400."""
    files = {"file": ("fake.png", text_file_bytes, "image/png")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 400

    data = response.json()
    assert data["status_code"] == 400
    assert data["error_code"] == "INVALID_IMAGE_FORMAT"


@pytest.mark.asyncio
async def test_validate_empty_file(client: AsyncClient) -> None:
    """Test that an empty 0-byte file is rejected with HTTP 400."""
    files = {"file": ("empty.png", b"", "image/png")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 400

    data = response.json()
    assert data["status_code"] == 400
    assert data["error_code"] == "INVALID_IMAGE_FORMAT"


@pytest.mark.asyncio
async def test_validate_unsupported_format(client: AsyncClient) -> None:
    """Test that unsupported formats like GIF/BMP are rejected with HTTP 400."""
    # Generate a valid GIF
    img = Image.new("RGB", (50, 50), color=(100, 100, 100))
    buf = io.BytesIO()
    img.save(buf, format="GIF")
    gif_bytes = buf.getvalue()

    files = {"file": ("animation.gif", gif_bytes, "image/gif")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 400

    data = response.json()
    assert data["status_code"] == 400
    assert data["error_code"] == "INVALID_IMAGE_FORMAT"
    assert "Only PNG, JPEG, and WebP are allowed" in data["detail"]


@pytest.mark.asyncio
async def test_validate_dimensions_too_small(client: AsyncClient) -> None:
    """Test that an image smaller than 10x10 is rejected with HTTP 400."""
    small_img_bytes = generate_test_image(format="PNG", width=5, height=5)
    files = {"file": ("tiny.png", small_img_bytes, "image/png")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 400

    data = response.json()
    assert data["status_code"] == 400
    assert data["error_code"] == "INVALID_IMAGE_FORMAT"
    assert "too small" in data["detail"]


@pytest.mark.asyncio
async def test_validate_file_too_large(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that files exceeding MAX_UPLOAD_SIZE_MB trigger HTTP 413 FILE_TOO_LARGE."""
    # Lower limit to 1MB temporarily to test size limit efficiently
    monkeypatch.setattr(settings, "MAX_UPLOAD_SIZE_MB", 1)

    # 1.5MB dummy bytes
    oversized_bytes = b"X" * (int(1.5 * 1024 * 1024))
    files = {"file": ("giant.png", oversized_bytes, "image/png")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 413

    data = response.json()
    assert data["status_code"] == 413
    assert data["error_code"] == "FILE_TOO_LARGE"
    assert "exceeds" in data["detail"]


def _build_png_chunk_stream(width: int, height: int, include_idat: bool = False) -> bytes:
    """Helper to craft lightweight PNG chunk payloads."""
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_data + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr_data))
    chunks = [sig, ihdr]
    if include_idat:
        raw_data = zlib.compress(b"\x00" * ((width * 3 + 1) * height))
        idat = struct.pack(">I", len(raw_data)) + b"IDAT" + raw_data + struct.pack(">I", zlib.crc32(b"IDAT" + raw_data))
        chunks.append(idat)
    iend = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
    chunks.append(iend)
    return b"".join(chunks)


@pytest.mark.asyncio
async def test_validate_malformed_png_missing_idat(client: AsyncClient) -> None:
    """Test that a PNG with missing IDAT chunk (raising IndexError in PIL verify()) is rejected with HTTP 400."""
    payload = _build_png_chunk_stream(50, 50, include_idat=False)
    files = {"file": ("missing_idat.png", payload, "image/png")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 400

    data = response.json()
    assert data["status_code"] == 400
    assert data["error_code"] == "INVALID_IMAGE_FORMAT"
    assert "Invalid or corrupt image" in data["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize("dim", [15000, 16000])
async def test_validate_decompression_bomb_extreme_dimensions(
    client: AsyncClient, dim: int
) -> None:
    """Test that extreme dimension images (15000x15000 and 16000x16000 triggering DecompressionBombError) are rejected with HTTP 400."""
    bomb_payload = _build_png_chunk_stream(dim, dim, include_idat=False)
    files = {"file": (f"bomb_{dim}x{dim}.png", bomb_payload, "image/png")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 400

    data = response.json()
    assert data["status_code"] == 400
    assert data["error_code"] == "INVALID_IMAGE_FORMAT"
    assert "Invalid or corrupt image" in data["detail"]


@pytest.mark.asyncio
async def test_validate_dimensions_too_large(client: AsyncClient) -> None:
    """Test that an image exceeding MAX_DIMENSION (16384) is rejected with HTTP 400."""
    large_img_bytes = generate_test_image(format="PNG", width=16385, height=10)
    files = {"file": ("too_wide.png", large_img_bytes, "image/png")}
    response = await client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 400

    data = response.json()
    assert data["status_code"] == 400
    assert data["error_code"] == "INVALID_IMAGE_FORMAT"
    assert "exceed maximum allowed" in data["detail"]
