"""Empirical Adversarial Stress Test Suite - Milestone 1 Image Validation.

This module probes:
1. Truncated bitstreams (PNG, JPEG, WebP at multiple truncation points).
2. Decompression bombs / decompression limits / zip bombs.
3. Polyglot files (HTML+PNG, ZIP+JPEG, GIF+PNG, PDF+JPEG, PHP+JPEG).
4. Extreme aspect ratios (1x16000, 16000x1, 10x16384, 16384x10, out-of-bounds).
5. Corrupted EXIF data (malformed APP1, recursive IFD, out-of-bounds offsets, huge tag counts).
6. Cross-endpoint verification (/api/v1/images/validate and /api/v1/upload/validate).

Requirement:
All invalid files MUST be gracefully rejected with structured JSON errors (HTTP 400 or 413)
and NEVER cause unhandled Python exceptions (HTTP 500 or process crashes).
"""

import io
import struct
import zipfile
import zlib
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.main import app
from app.schemas.error import ErrorResponse
from app.schemas.upload import ImageValidationResponse
from tests.conftest import generate_test_image


@pytest.fixture
async def adv_client() -> AsyncClient:
    """AsyncClient fixture with raise_app_exceptions=False to capture HTTP 500s if any occur."""
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _assert_error_response(response, expected_status: int, expected_code: str = None) -> ErrorResponse:
    """Assert response is an ErrorResponse with given status and expected code, never HTML."""
    assert response.status_code == expected_status, (
        f"Expected status {expected_status}, got {response.status_code}: {response.text}"
    )
    content_type = response.headers.get("content-type", "")
    assert "application/json" in content_type, (
        f"Expected application/json header, got '{content_type}' with body: {response.text}"
    )
    data = response.json()
    assert isinstance(data, dict), f"Response body is not a JSON dict: {data}"
    assert "detail" in data, f"Missing 'detail' in error envelope: {data}"
    assert "error_code" in data, f"Missing 'error_code' in error envelope: {data}"
    assert "status_code" in data, f"Missing 'status_code' in error envelope: {data}"
    assert data["status_code"] == expected_status
    if expected_code:
        assert data["error_code"] == expected_code, (
            f"Expected error_code {expected_code}, got {data['error_code']}"
        )
    return ErrorResponse.model_validate(data)


# =====================================================================
# 1. TRUNCATED BITSTREAMS
# =====================================================================

@pytest.mark.asyncio
@pytest.mark.parametrize("fmt,ext,mime", [
    ("PNG", "png", "image/png"),
    ("JPEG", "jpg", "image/jpeg"),
    ("WEBP", "webp", "image/webp"),
])
@pytest.mark.parametrize("pct", [10, 25, 50, 75, 90])
async def test_truncated_raster_streams(adv_client: AsyncClient, fmt: str, ext: str, mime: str, pct: int):
    """Test images cut off at varying percentages of their valid byte payload."""
    valid_bytes = generate_test_image(format=fmt, width=100, height=100)
    cutoff = max(1, int(len(valid_bytes) * (pct / 100.0)))
    truncated = valid_bytes[:cutoff]

    # Test both endpoints
    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": (f"trunc_{pct}.{ext}", truncated, mime)}
        resp = await adv_client.post(endpoint, files=files)
        _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_png_header_only_no_idat(adv_client: AsyncClient):
    """Valid PNG signature + IHDR chunk + IEND, but no IDAT image data."""
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 50, 50, 8, 2, 0, 0, 0)
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_data + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr_data))
    iend = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
    payload = sig + ihdr + iend

    resp = await adv_client.post("/api/v1/images/validate", files={"file": ("no_idat.png", payload, "image/png")})
    _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_jpeg_header_only_no_sos(adv_client: AsyncClient):
    """Valid JPEG SOI and SOF0 headers, but truncated before Start of Scan (SOS)."""
    soi = b"\xff\xd8"
    # SOF0: length=17, precision=8, height=100, width=100, 3 components
    sof0_payload = struct.pack(">BHHB", 8, 100, 100, 3) + b"\x01\x11\x00\x02\x11\x00\x03\x11\x00"
    sof0 = b"\xff\xc0" + struct.pack(">H", len(sof0_payload) + 2) + sof0_payload
    eoi = b"\xff\xd9"
    payload = soi + sof0 + eoi

    resp = await adv_client.post("/api/v1/images/validate", files={"file": ("no_sos.jpg", payload, "image/jpeg")})
    _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


# =====================================================================
# 2. EXTREME ASPECT RATIOS
# =====================================================================

@pytest.mark.asyncio
@pytest.mark.parametrize("w,h,should_pass", [
    (1, 16000, False),    # Extreme tall: width < MIN_DIMENSION (10)
    (16000, 1, False),    # Extreme wide: height < MIN_DIMENSION (10)
    (1, 1, False),        # 1x1 below minimum
    (9, 9, False),        # 9x9 below minimum
    (9, 16000, False),    # width 9 below minimum
    (16000, 9, False),    # height 9 below minimum
    (10, 16384, True),    # Extreme tall at boundary (valid)
    (16384, 10, True),    # Extreme wide at boundary (valid)
    (16385, 10, False),   # width exceeds MAX_DIMENSION (16384)
    (10, 16385, False),   # height exceeds MAX_DIMENSION (16384)
])
async def test_extreme_aspect_ratios_png(adv_client: AsyncClient, w: int, h: int, should_pass: bool):
    """Test extreme aspect ratios against the dimension constraints (10 <= W, H <= 16384)."""
    img_bytes = generate_test_image(format="PNG", width=w, height=h)
    files = {"file": (f"ratio_{w}x{h}.png", img_bytes, "image/png")}

    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        resp = await adv_client.post(endpoint, files=files)
        if should_pass:
            assert resp.status_code == 200
            data = resp.json()
            assert data["valid"] is True
            assert data["width"] == w
            assert data["height"] == h
            ImageValidationResponse.model_validate(data)
        else:
            _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


# =====================================================================
# 3. DECOMPRESSION BOMBS & LIMITS
# =====================================================================

@pytest.mark.asyncio
async def test_png_decompression_bomb(adv_client: AsyncClient):
    """Crafted PNG with declared header dimensions 16000x16000 (256M pixels > PIL limit).
    
    Must be gracefully rejected with HTTP 400 (or 413) and NEVER trigger an unhandled 500 error.
    """
    sig = b"\x89PNG\r\n\x1a\n"
    # 16000 x 16000 = 256,000,000 pixels (exceeds PIL 178,956,970 limit)
    ihdr_data = struct.pack(">IIBBBBB", 16000, 16000, 8, 2, 0, 0, 0)
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_data + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr_data))
    iend = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
    bomb_payload = sig + ihdr + iend

    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": ("decompression_bomb.png", bomb_payload, "image/png")}
        resp = await adv_client.post(endpoint, files=files)
        _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_jpeg_decompression_bomb(adv_client: AsyncClient):
    """Crafted JPEG with SOF0 declaring 16000x16000 pixels."""
    soi = b"\xff\xd8"
    sof0_payload = struct.pack(">BHHB", 8, 16000, 16000, 3) + b"\x01\x11\x00\x02\x11\x00\x03\x11\x00"
    sof0 = b"\xff\xc0" + struct.pack(">H", len(sof0_payload) + 2) + sof0_payload
    eoi = b"\xff\xd9"
    payload = soi + sof0 + eoi

    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": ("decompression_bomb.jpg", payload, "image/jpeg")}
        resp = await adv_client.post(endpoint, files=files)
        _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_webp_decompression_bomb(adv_client: AsyncClient):
    """Crafted WebP VP8X header declaring 16000x16000 canvas dimensions."""
    w, h = 16000, 16000
    vp8x_payload = struct.pack("<I", 0) + struct.pack("<I", w - 1)[:3] + struct.pack("<I", h - 1)[:3]
    payload = (
        b"RIFF"
        + struct.pack("<I", len(vp8x_payload) + 12)
        + b"WEBPVP8X"
        + struct.pack("<I", len(vp8x_payload))
        + vp8x_payload
    )

    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": ("decompression_bomb.webp", payload, "image/webp")}
        resp = await adv_client.post(endpoint, files=files)
        _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
@pytest.mark.parametrize("fmt,ext,mime", [
    ("JPEG", "jpg", "image/jpeg"),
    ("WEBP", "webp", "image/webp"),
])
@pytest.mark.parametrize("w,h,should_pass", [
    (1, 16000, False),   # Extreme tall: width < 10
    (16000, 1, False),   # Extreme wide: height < 10
    (10, 16000, True),   # Tall within limits
    (16000, 10, True),   # Wide within limits
])
async def test_extreme_aspect_ratios_jpeg_webp(adv_client: AsyncClient, fmt: str, ext: str, mime: str, w: int, h: int, should_pass: bool):
    """Test extreme aspect ratios for JPEG and WebP formats."""
    img_bytes = generate_test_image(format=fmt, width=w, height=h)
    files = {"file": (f"extreme_{w}x{h}.{ext}", img_bytes, mime)}

    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        resp = await adv_client.post(endpoint, files=files)
        if should_pass:
            assert resp.status_code == 200
            data = resp.json()
            assert data["valid"] is True
            assert data["width"] == w
            assert data["height"] == h
        else:
            _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_zip_archive_disguised_as_png(adv_client: AsyncClient):
    """ZIP file with .png extension containing nested files."""
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("test.txt", "A" * 10000)
    zip_bytes = zip_buf.getvalue()

    files = {"file": ("archive.png", zip_bytes, "image/png")}
    resp = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_gzip_stream_disguised_as_png(adv_client: AsyncClient):
    """GZIP compressed data stream uploaded with image/png MIME."""
    import gzip
    gz_buf = io.BytesIO()
    with gzip.GzipFile(fileobj=gz_buf, mode="wb") as gz:
        gz.write(b"NOT AN IMAGE")
    gz_bytes = gz_buf.getvalue()

    files = {"file": ("stream.png", gz_bytes, "image/png")}
    resp = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


# =====================================================================
# 4. POLYGLOT FILES
# =====================================================================

@pytest.mark.asyncio
async def test_html_png_polyglot(adv_client: AsyncClient):
    """HTML script prepended before PNG magic header."""
    valid_png = generate_test_image(format="PNG", width=50, height=50)
    polyglot = b"<html><head><script>alert('xss')</script></head><body>" + valid_png

    files = {"file": ("polyglot.png", polyglot, "image/png")}
    resp = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_php_jpeg_polyglot(adv_client: AsyncClient):
    """PHP script prepended before JPEG SOI marker."""
    valid_jpeg = generate_test_image(format="JPEG", width=50, height=50)
    polyglot = b"<?php echo 'malicious php'; phpinfo(); ?>" + valid_jpeg

    files = {"file": ("polyglot.jpg", polyglot, "image/jpeg")}
    resp = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_pdf_jpeg_polyglot(adv_client: AsyncClient):
    """PDF document header with .jpg extension."""
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"
    files = {"file": ("document.jpg", pdf_bytes, "image/jpeg")}
    resp = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_gif_disguised_as_png(adv_client: AsyncClient):
    """GIF file uploaded with .png filename and image/png content type."""
    gif_buf = io.BytesIO()
    Image.new("RGB", (50, 50), color="blue").save(gif_buf, format="GIF")
    gif_bytes = gif_buf.getvalue()

    files = {"file": ("fake_png.png", gif_bytes, "image/png")}
    resp = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


# =====================================================================
# 5. CORRUPTED EXIF DATA
# =====================================================================

def _make_jpeg_with_app1(app1_data: bytes) -> bytes:
    """Helper to assemble a valid JPEG containing a custom APP1 marker payload."""
    soi = b"\xff\xd8"
    app1_marker = b"\xff\xe1" + struct.pack(">H", len(app1_data) + 2) + app1_data
    # Use real JPEG raster payload from valid image
    base = generate_test_image(format="JPEG", width=50, height=50)
    # base starts with \xff\xd8, insert APP1 right after SOI
    return soi + app1_marker + base[2:]


@pytest.mark.asyncio
async def test_jpeg_corrupted_exif_truncated_tiff_header(adv_client: AsyncClient):
    """JPEG with APP1 marker having incomplete TIFF header (fewer than 8 bytes)."""
    # Exif\x00\x00 followed by truncated TIFF header
    app1_payload = b"Exif\x00\x00" + b"II*\x00"  # Missing 4-byte IFD offset
    payload = _make_jpeg_with_app1(app1_payload)

    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": ("corrupt_exif.jpg", payload, "image/jpeg")}
        resp = await adv_client.post(endpoint, files=files)
        # Must either reject gracefully with 400 or handle safely without 500
        assert resp.status_code in (200, 400), f"Unexpected status {resp.status_code}: {resp.text}"
        if resp.status_code == 400:
            _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_jpeg_corrupted_exif_out_of_bounds_ifd_offset(adv_client: AsyncClient):
    """JPEG with EXIF TIFF header pointing to an IFD offset far beyond file bounds."""
    # II (little endian), magic 42, IFD0 offset = 0x7FFFFFFF (huge out of bounds offset)
    tiff_header = b"II" + struct.pack("<H", 42) + struct.pack("<I", 0x7FFFFFFF)
    app1_payload = b"Exif\x00\x00" + tiff_header
    payload = _make_jpeg_with_app1(app1_payload)

    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": ("oob_ifd.jpg", payload, "image/jpeg")}
        resp = await adv_client.post(endpoint, files=files)
        assert resp.status_code in (200, 400), f"Unexpected status {resp.status_code}: {resp.text}"
        if resp.status_code == 400:
            _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_jpeg_corrupted_exif_huge_tag_count(adv_client: AsyncClient):
    """JPEG with EXIF IFD declaring 65535 directory entries with empty body."""
    # II, magic 42, offset 8 (points immediately to entry count)
    tiff_header = b"II" + struct.pack("<H", 42) + struct.pack("<I", 8)
    # Entry count = 65535, followed by truncated tags
    ifd = struct.pack("<H", 65535) + b"\x00" * 12
    app1_payload = b"Exif\x00\x00" + tiff_header + ifd
    payload = _make_jpeg_with_app1(app1_payload)

    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": ("huge_tags.jpg", payload, "image/jpeg")}
        resp = await adv_client.post(endpoint, files=files)
        assert resp.status_code in (200, 400), f"Unexpected status {resp.status_code}: {resp.text}"
        if resp.status_code == 400:
            _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")


@pytest.mark.asyncio
async def test_jpeg_exif_recursive_pointer_cycle(adv_client: AsyncClient):
    """JPEG with EXIF IFD pointing back to offset 8 in a cyclical loop."""
    tiff_header = b"II" + struct.pack("<H", 42) + struct.pack("<I", 8)
    # 1 tag (12 bytes), next IFD offset = 8 (points back to start of IFD)
    single_tag = struct.pack("<HHII", 0x0100, 3, 1, 100)  # Tag 0x0100 (ImageWidth), SHORT, count 1, value 100
    next_ifd_offset = struct.pack("<I", 8)  # Recursive loop to offset 8
    ifd = struct.pack("<H", 1) + single_tag + next_ifd_offset
    app1_payload = b"Exif\x00\x00" + tiff_header + ifd
    payload = _make_jpeg_with_app1(app1_payload)

    for endpoint in ["/api/v1/images/validate", "/api/v1/upload/validate"]:
        files = {"file": ("cycle_ifd.jpg", payload, "image/jpeg")}
        resp = await adv_client.post(endpoint, files=files)
        assert resp.status_code in (200, 400), f"Unexpected status {resp.status_code}: {resp.text}"
        if resp.status_code == 400:
            _assert_error_response(resp, 400, "INVALID_IMAGE_FORMAT")
