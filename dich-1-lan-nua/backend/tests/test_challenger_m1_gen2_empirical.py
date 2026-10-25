"""Adversarial Empirical Verification Harness - Challenger M1 Gen 2.

This test script independently and rigorously attacks the backend image validator
to verify all 4 specific requirements from the dispatch:
1. Malformed PNG missing IDAT chunk -> HTTP 400 INVALID_IMAGE_FORMAT (NOT 500).
2. Extreme dimensions (15000x15000 & 16000x16000 triggering DecompressionBombError) -> HTTP 400 (NOT 500).
3. Out of bounds dimension (16385x10) -> HTTP 400 with detail "exceed maximum allowed".
4. Oversized payload > 50MB (and boundary tests) -> HTTP 413 FILE_TOO_LARGE.
5. Zero 500 errors leak across all adversarial attacks.
"""

import io
import struct
import zlib
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.core.config import settings
from app.main import app
from app.schemas.error import ErrorResponse
from tests.conftest import generate_test_image


@pytest.fixture
async def challenger_client() -> AsyncClient:
    """AsyncClient fixture with raise_app_exceptions=False to capture unhandled 500s."""
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _craft_png_raw(width: int, height: int, idat_data: bytes = None, include_idat: bool = True) -> bytes:
    """Craft raw PNG byte stream with fine-grained control over IDAT chunk."""
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_data + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr_data))
    chunks = [sig, ihdr]
    if include_idat:
        if idat_data is None:
            # Generate valid deflate stream for width x height RGB
            raw_scanlines = b"\x00" * ((width * 3 + 1) * height)
            idat_data = zlib.compress(raw_scanlines)
        idat = struct.pack(">I", len(idat_data)) + b"IDAT" + idat_data + struct.pack(">I", zlib.crc32(b"IDAT" + idat_data))
        chunks.append(idat)
    iend = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
    chunks.append(iend)
    return b"".join(chunks)


# ==============================================================================
# VECTOR 1: Malformed PNG Missing IDAT Chunk
# ==============================================================================

@pytest.mark.asyncio
@pytest.mark.parametrize("width,height", [
    (10, 10),
    (50, 50),
    (100, 100),
    (1024, 768),
])
async def test_adversarial_malformed_png_missing_idat(challenger_client: AsyncClient, width: int, height: int):
    """Verify PNG missing IDAT chunk returns HTTP 400 INVALID_IMAGE_FORMAT, NEVER 500."""
    payload = _craft_png_raw(width, height, include_idat=False)
    
    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": (f"no_idat_{width}x{height}.png", payload, "image/png")}
        resp = await challenger_client.post(endpoint, files=files)
        
        # Rigorous assertions: must be 400, strictly not 500
        assert resp.status_code == 400, f"Expected HTTP 400, got {resp.status_code} (body: {resp.text})"
        assert resp.headers.get("content-type", "").startswith("application/json")
        data = resp.json()
        assert data["error_code"] == "INVALID_IMAGE_FORMAT"
        assert data["status_code"] == 400
        assert "Invalid or corrupt image" in data["detail"]


@pytest.mark.asyncio
async def test_adversarial_malformed_png_empty_idat(challenger_client: AsyncClient):
    """Verify PNG with 0-byte IDAT chunk returns HTTP 400 INVALID_IMAGE_FORMAT, NEVER 500."""
    payload = _craft_png_raw(50, 50, idat_data=b"", include_idat=True)
    
    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": ("empty_idat.png", payload, "image/png")}
        resp = await challenger_client.post(endpoint, files=files)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert data["error_code"] == "INVALID_IMAGE_FORMAT"
        assert data["status_code"] == 400


@pytest.mark.asyncio
async def test_adversarial_malformed_png_corrupt_idat_stream(challenger_client: AsyncClient):
    """Verify PNG with corrupted zlib IDAT chunk returns HTTP 400 INVALID_IMAGE_FORMAT, NEVER 500."""
    payload = _craft_png_raw(50, 50, idat_data=b"NOT_A_VALID_ZLIB_STREAM", include_idat=True)
    
    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": ("corrupt_idat.png", payload, "image/png")}
        resp = await challenger_client.post(endpoint, files=files)
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert data["error_code"] == "INVALID_IMAGE_FORMAT"
        assert data["status_code"] == 400


# ==============================================================================
# VECTOR 2: Extreme Dimensions Triggering DecompressionBombError
# ==============================================================================

@pytest.mark.asyncio
@pytest.mark.parametrize("dim", [15000, 16000])
async def test_adversarial_decompression_bomb_png(challenger_client: AsyncClient, dim: int):
    """Verify PNG with 15000x15000 and 16000x16000 dimensions returns HTTP 400, NEVER 500."""
    payload = _craft_png_raw(dim, dim, include_idat=False)
    
    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": (f"bomb_png_{dim}x{dim}.png", payload, "image/png")}
        resp = await challenger_client.post(endpoint, files=files)
        
        assert resp.status_code == 400, f"Expected HTTP 400, got {resp.status_code} (body: {resp.text})"
        assert resp.headers.get("content-type", "").startswith("application/json")
        data = resp.json()
        assert data["error_code"] == "INVALID_IMAGE_FORMAT"
        assert data["status_code"] == 400
        assert "Invalid or corrupt image" in data["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize("dim", [15000, 16000])
async def test_adversarial_decompression_bomb_jpeg(challenger_client: AsyncClient, dim: int):
    """Verify JPEG with 15000x15000 and 16000x16000 SOF0 declarations returns HTTP 400, NEVER 500."""
    soi = b"\xff\xd8"
    sof0_payload = struct.pack(">BHHB", 8, dim, dim, 3) + b"\x01\x11\x00\x02\x11\x00\x03\x11\x00"
    sof0 = b"\xff\xc0" + struct.pack(">H", len(sof0_payload) + 2) + sof0_payload
    eoi = b"\xff\xd9"
    payload = soi + sof0 + eoi
    
    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": (f"bomb_jpeg_{dim}x{dim}.jpg", payload, "image/jpeg")}
        resp = await challenger_client.post(endpoint, files=files)
        
        assert resp.status_code == 400, f"Expected HTTP 400, got {resp.status_code} (body: {resp.text})"
        data = resp.json()
        assert data["error_code"] == "INVALID_IMAGE_FORMAT"
        assert data["status_code"] == 400


@pytest.mark.asyncio
@pytest.mark.parametrize("dim", [15000, 16000])
async def test_adversarial_decompression_bomb_webp(challenger_client: AsyncClient, dim: int):
    """Verify WebP with 15000x15000 and 16000x16000 canvas dimensions returns HTTP 400, NEVER 500."""
    vp8x_payload = struct.pack("<I", 0) + struct.pack("<I", dim - 1)[:3] + struct.pack("<I", dim - 1)[:3]
    payload = (
        b"RIFF"
        + struct.pack("<I", len(vp8x_payload) + 12)
        + b"WEBPVP8X"
        + struct.pack("<I", len(vp8x_payload))
        + vp8x_payload
    )
    
    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": (f"bomb_webp_{dim}x{dim}.webp", payload, "image/webp")}
        resp = await challenger_client.post(endpoint, files=files)
        
        assert resp.status_code == 400, f"Expected HTTP 400, got {resp.status_code} (body: {resp.text})"
        data = resp.json()
        assert data["error_code"] == "INVALID_IMAGE_FORMAT"
        assert data["status_code"] == 400


# ==============================================================================
# VECTOR 3: Out of Bounds Dimensions (16385x10, etc.)
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_dimension_16385x10(challenger_client: AsyncClient):
    """Verify dimension 16385x10 returns HTTP 400 with detail containing 'exceed maximum allowed'."""
    img_bytes = generate_test_image(format="PNG", width=16385, height=10)
    files = {"file": ("oob_16385x10.png", img_bytes, "image/png")}
    
    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        resp = await challenger_client.post(endpoint, files=files)
        assert resp.status_code == 400, f"Expected HTTP 400, got {resp.status_code}"
        data = resp.json()
        assert data["error_code"] == "INVALID_IMAGE_FORMAT"
        assert data["status_code"] == 400
        assert "exceed maximum allowed" in data["detail"], (
            f"Expected 'exceed maximum allowed' in detail, got: {data['detail']}"
        )
        assert "16385x10" in data["detail"]


@pytest.mark.asyncio
async def test_adversarial_dimension_10x16385(challenger_client: AsyncClient):
    """Verify dimension 10x16385 returns HTTP 400 with detail containing 'exceed maximum allowed'."""
    img_bytes = generate_test_image(format="PNG", width=10, height=16385)
    files = {"file": ("oob_10x16385.png", img_bytes, "image/png")}
    
    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        resp = await challenger_client.post(endpoint, files=files)
        assert resp.status_code == 400, f"Expected HTTP 400, got {resp.status_code}"
        data = resp.json()
        assert data["error_code"] == "INVALID_IMAGE_FORMAT"
        assert data["status_code"] == 400
        assert "exceed maximum allowed" in data["detail"]
        assert "10x16385" in data["detail"]


@pytest.mark.asyncio
async def test_adversarial_dimension_boundary_16384(challenger_client: AsyncClient):
    """Verify that exact boundary dimensions (16384x10 and 10x16384) are permitted."""
    wide_bytes = generate_test_image(format="PNG", width=16384, height=10)
    tall_bytes = generate_test_image(format="PNG", width=10, height=16384)
    
    resp_wide = await challenger_client.post("/api/v1/images/validate", files={"file": ("boundary_wide.png", wide_bytes, "image/png")})
    assert resp_wide.status_code == 200
    assert resp_wide.json()["width"] == 16384
    assert resp_wide.json()["height"] == 10

    resp_tall = await challenger_client.post("/api/v1/images/validate", files={"file": ("boundary_tall.png", tall_bytes, "image/png")})
    assert resp_tall.status_code == 200
    assert resp_tall.json()["width"] == 10
    assert resp_tall.json()["height"] == 16384


# ==============================================================================
# VECTOR 4: Oversized Payload > 50MB
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_payload_exceeding_50mb(challenger_client: AsyncClient):
    """Empirically verify payload > 50MB triggers HTTP 413 FILE_TOO_LARGE.
    
    We construct a payload of 50MB + 1024 bytes (52,429,824 bytes) and stream it
    to test the chunked upload threshold.
    """
    fifty_mb = 50 * 1024 * 1024
    oversized_size = fifty_mb + 1024  # 50MB + 1KB
    
    # We use a memory-efficient generator to avoid allocating giant buffers in test process
    class StreamBuffer(io.RawIOBase):
        def __init__(self, size: int):
            self.remaining = size
            self.total = size
            
        def read(self, size=-1):
            if self.remaining <= 0:
                return b""
            chunk_len = min(self.remaining, size if size > 0 else 65536)
            self.remaining -= chunk_len
            return b"A" * chunk_len
            
        def readable(self):
            return True

    stream = StreamBuffer(oversized_size)
    files = {"file": ("massive_51mb.png", stream, "image/png")}
    
    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        stream.remaining = oversized_size  # Reset stream position
        resp = await challenger_client.post(endpoint, files=files)
        
        assert resp.status_code == 413, f"Expected HTTP 413, got {resp.status_code} (body: {resp.text})"
        assert resp.headers.get("content-type", "").startswith("application/json")
        data = resp.json()
        assert data["error_code"] == "FILE_TOO_LARGE"
        assert data["status_code"] == 413
        assert "exceeds the 50MB limit" in data["detail"]


@pytest.mark.asyncio
async def test_adversarial_payload_size_boundary_precision(challenger_client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    """Verify precise byte-boundary enforcement on upload limits."""
    # Temporarily set max upload to 2MB to test exact byte boundary
    monkeypatch.setattr(settings, "MAX_UPLOAD_SIZE_MB", 2)
    max_bytes = 2 * 1024 * 1024  # 2,097,152 bytes

    # 1 byte over limit
    over_limit_bytes = b"X" * (max_bytes + 1)
    files = {"file": ("over_limit.png", over_limit_bytes, "image/png")}
    resp = await challenger_client.post("/api/v1/images/validate", files=files)
    assert resp.status_code == 413
    assert resp.json()["error_code"] == "FILE_TOO_LARGE"


# ==============================================================================
# VECTOR 5: Zero 500 Errors Leak Confirmation
# ==============================================================================

@pytest.mark.asyncio
@pytest.mark.parametrize("payload,filename,mime", [
    (b"", "empty.png", "image/png"),
    (b"not an image", "garbage.png", "image/png"),
    (b"\x00" * 100, "zeros.jpg", "image/jpeg"),
    (b"\xff\xd8\xff\xdb" + b"\x00" * 50, "truncated_dqt.jpg", "image/jpeg"),
    (b"RIFF\x20\x00\x00\x00WEBPVP8 \x10\x00\x00\x00" + b"\x00" * 16, "corrupt_vp8.webp", "image/webp"),
    (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\xff" * 17, "corrupt_ihdr.png", "image/png"),
    (b"\x89PNG\r\n\x1a\n\x00\x00\x00\x04tEXt" + b"malicious", "out_of_order_chunks.png", "image/png"),
])
async def test_adversarial_zero_500_leak(challenger_client: AsyncClient, payload: bytes, filename: str, mime: str):
    """Assert that arbitrary malicious and corrupt payloads NEVER leak HTTP 500."""
    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": (filename, payload, mime)}
        resp = await challenger_client.post(endpoint, files=files)
        
        # NEVER return 500
        assert resp.status_code != 500, f"CRITICAL: HTTP 500 leaked for payload {filename}: {resp.text}"
        # Must be 400
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        data = resp.json()
        assert data["error_code"] == "INVALID_IMAGE_FORMAT"


# ==============================================================================
# VECTOR 6: Mid-Stream Raster Bitstream Corruption & Concurrency Stress
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_raster_corrupted_midstream(challenger_client: AsyncClient):
    """Verify image with valid PNG header but corrupted raster bits is caught during load()."""
    valid_bytes = generate_test_image(format="PNG", width=100, height=100)
    # Corrupt the last 20% of bytes (raster data) without corrupting header
    corrupted = valid_bytes[: len(valid_bytes) - 50] + b"\xff" * 50
    
    files = {"file": ("corrupt_raster.png", corrupted, "image/png")}
    resp = await challenger_client.post("/api/v1/images/validate", files=files)
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "INVALID_IMAGE_FORMAT"


@pytest.mark.asyncio
async def test_adversarial_multipart_field_variations(challenger_client: AsyncClient):
    """Verify missing or invalid multipart field names return structured 422, NEVER 500."""
    # Field named 'wrong_field' instead of 'file'
    files = {"wrong_field": ("test.png", b"\x89PNG\r\n\x1a\n", "image/png")}
    resp = await challenger_client.post("/api/v1/images/validate", files=files)
    assert resp.status_code == 422
    data = resp.json()
    assert data["status_code"] == 422
    assert data["error_code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_adversarial_concurrent_barrage(challenger_client: AsyncClient):
    """Hammer endpoints concurrently with valid, bomb, malformed, and oversize requests."""
    import asyncio

    valid_png = generate_test_image(format="PNG", width=50, height=50)
    bomb_png = _craft_png_raw(16000, 16000, include_idat=False)
    no_idat_png = _craft_png_raw(50, 50, include_idat=False)
    corrupt_bytes = b"CORRUPT_NOT_IMAGE"

    async def send_valid():
        return await challenger_client.post(
            "/api/v1/images/validate",
            files={"file": ("valid.png", valid_png, "image/png")}
        )

    async def send_bomb():
        return await challenger_client.post(
            "/api/v1/images/validate",
            files={"file": ("bomb.png", bomb_png, "image/png")}
        )

    async def send_no_idat():
        return await challenger_client.post(
            "/api/v1/images/validate",
            files={"file": ("no_idat.png", no_idat_png, "image/png")}
        )

    async def send_corrupt():
        return await challenger_client.post(
            "/api/v1/images/validate",
            files={"file": ("corrupt.png", corrupt_bytes, "image/png")}
        )

    # 40 concurrent tasks mixing all vectors
    tasks = []
    for _ in range(10):
        tasks.extend([send_valid(), send_bomb(), send_no_idat(), send_corrupt()])

    results = await asyncio.gather(*tasks)
    
    assert len(results) == 40
    for resp in results:
        # Zero 500 errors allowed!
        assert resp.status_code != 500, f"HTTP 500 leaked under concurrency: {resp.text}"
        assert resp.status_code in (200, 400), f"Unexpected status {resp.status_code}"

