"""Adversarial stress-testing suite for Milestone 1 Backend Foundation.

This module probes edge cases, unexpected HTTP methods, boundary conditions,
malformed headers, protocol violations, and concurrency stress to empirically
verify that the API never leaks raw 500 HTML or crashes the server process.
"""

import asyncio
import io
from typing import List
import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.core.config import settings
from app.main import app
from app.schemas.capabilities import CapabilitiesResponse
from app.schemas.error import ErrorResponse
from app.schemas.health import HealthResponse
from app.schemas.upload import ImageValidationResponse
from tests.conftest import generate_test_image


@pytest.fixture
async def adv_client() -> AsyncClient:
    """AsyncClient fixture with raise_app_exceptions=False to capture all responses."""
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _assert_valid_error_envelope(response, expected_status: int, expected_code: str = None) -> ErrorResponse:
    """Helper to assert that a response strictly adheres to the ErrorResponse schema and JSON content-type."""
    assert response.status_code == expected_status, f"Expected status {expected_status}, got {response.status_code}: {response.text}"
    content_type = response.headers.get("content-type", "")
    assert "application/json" in content_type, f"Expected application/json header, got '{content_type}' with body: {response.text}"
    
    data = response.json()
    assert isinstance(data, dict), f"Response body is not a JSON object: {data}"
    assert "detail" in data, f"Missing 'detail' in error envelope: {data}"
    assert "error_code" in data, f"Missing 'error_code' in error envelope: {data}"
    assert "status_code" in data, f"Missing 'status_code' in error envelope: {data}"
    assert data["status_code"] == expected_status
    if expected_code:
        assert data["error_code"] == expected_code, f"Expected error_code {expected_code}, got {data['error_code']}"
    
    # Strictly validate against Pydantic schema
    validated = ErrorResponse.model_validate(data)
    return validated


# =====================================================================
# VECTOR 1: UNEXPECTED AND EXOTIC HTTP METHODS
# =====================================================================

@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["put", "post", "delete", "patch"])
async def test_disallowed_methods_on_health(adv_client: AsyncClient, method: str) -> None:
    """Ensure disallowed HTTP methods on /api/v1/health return standard 405 error envelope."""
    req_fn = getattr(adv_client, method)
    response = await req_fn("/api/v1/health")
    _assert_valid_error_envelope(response, 405, "METHOD_NOT_ALLOWED")


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["put", "post", "delete", "patch"])
async def test_disallowed_methods_on_capabilities(adv_client: AsyncClient, method: str) -> None:
    """Ensure disallowed HTTP methods on /api/v1/capabilities return standard 405 error envelope."""
    req_fn = getattr(adv_client, method)
    response = await req_fn("/api/v1/capabilities")
    _assert_valid_error_envelope(response, 405, "METHOD_NOT_ALLOWED")


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["get", "put", "delete", "patch"])
async def test_disallowed_methods_on_upload_validate(adv_client: AsyncClient, method: str) -> None:
    """Ensure disallowed HTTP methods on /api/v1/images/validate return standard 405 error envelope."""
    req_fn = getattr(adv_client, method)
    response = await req_fn("/api/v1/images/validate")
    _assert_valid_error_envelope(response, 405, "METHOD_NOT_ALLOWED")


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["post", "put", "delete", "patch"])
async def test_disallowed_methods_on_root(adv_client: AsyncClient, method: str) -> None:
    """Ensure disallowed HTTP methods on root / return standard 405 error envelope."""
    req_fn = getattr(adv_client, method)
    response = await req_fn("/")
    _assert_valid_error_envelope(response, 405, "METHOD_NOT_ALLOWED")


@pytest.mark.asyncio
async def test_head_method_on_endpoints(adv_client: AsyncClient) -> None:
    """FastAPI APIRouter returns 405 for HEAD when not explicitly enabled, with compliant empty body."""
    resp_health = await adv_client.head("/api/v1/health")
    assert resp_health.status_code == 405
    assert resp_health.content == b""  # HEAD requests must not return a body per RFC 7231
    assert "application/json" in resp_health.headers.get("content-type", "")

    resp_cap = await adv_client.head("/api/v1/capabilities")
    assert resp_cap.status_code == 405
    assert resp_cap.content == b""

    resp_validate = await adv_client.head("/api/v1/images/validate")
    assert resp_validate.status_code == 405
    assert resp_validate.content == b""




# =====================================================================
# VECTOR 2: MALFORMED HEADERS & PROTOCOL VIOLATIONS
# =====================================================================

@pytest.mark.asyncio
async def test_multipart_missing_boundary_header(adv_client: AsyncClient) -> None:
    """Probing /api/v1/images/validate with 'multipart/form-data' but omitting boundary parameter."""
    response = await adv_client.post(
        "/api/v1/images/validate",
        headers={"Content-Type": "multipart/form-data"},
        content=b"arbitrary-raw-binary-data",
    )
    _assert_valid_error_envelope(response, 400, "BAD_REQUEST")


@pytest.mark.asyncio
async def test_wrong_content_type_json(adv_client: AsyncClient) -> None:
    """Probing /api/v1/images/validate with application/json instead of multipart."""
    response = await adv_client.post(
        "/api/v1/images/validate",
        json={"file": "not_a_binary_upload"},
    )
    _assert_valid_error_envelope(response, 422, "VALIDATION_ERROR")


@pytest.mark.asyncio
async def test_wrong_content_type_urlencoded(adv_client: AsyncClient) -> None:
    """Probing /api/v1/images/validate with application/x-www-form-urlencoded."""
    response = await adv_client.post(
        "/api/v1/images/validate",
        data={"file": "plain_string"},
    )
    _assert_valid_error_envelope(response, 422, "VALIDATION_ERROR")


@pytest.mark.asyncio
async def test_empty_post_request(adv_client: AsyncClient) -> None:
    """Probing /api/v1/images/validate with zero content and no headers."""
    response = await adv_client.post("/api/v1/images/validate", content=b"")
    _assert_valid_error_envelope(response, 422, "VALIDATION_ERROR")


@pytest.mark.asyncio
async def test_oversized_custom_headers(adv_client: AsyncClient) -> None:
    """Probing health endpoint with oversized headers to verify server stability."""
    giant_header_val = "A" * 8192
    response = await adv_client.get("/api/v1/health", headers={"X-Stress-Test": giant_header_val})
    assert response.status_code == 200
    HealthResponse.model_validate(response.json())


# =====================================================================
# VECTOR 3: MULTIPART FORM BOUNDARY PAYLOADS & FILENAME INJECTIONS
# =====================================================================

@pytest.mark.asyncio
async def test_upload_missing_file_key(adv_client: AsyncClient, valid_png_bytes: bytes) -> None:
    """Probing with wrong field name (e.g. 'image' or 'doc' instead of 'file')."""
    files = {"wrong_key": ("page1.png", valid_png_bytes, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_valid_error_envelope(response, 422, "VALIDATION_ERROR")


@pytest.mark.asyncio
async def test_upload_with_extra_fields(adv_client: AsyncClient, valid_png_bytes: bytes) -> None:
    """Upload with extra form fields alongside the valid 'file' parameter."""
    files = {"file": ("page1.png", valid_png_bytes, "image/png")}
    data = {"project_id": "test-project-123", "chapter_number": "5"}
    response = await adv_client.post("/api/v1/images/validate", files=files, data=data)
    assert response.status_code == 200
    resp_obj = ImageValidationResponse.model_validate(response.json())
    assert resp_obj.valid is True
    assert resp_obj.filename == "page1.png"


@pytest.mark.asyncio
async def test_path_traversal_filename(adv_client: AsyncClient, valid_png_bytes: bytes) -> None:
    """Upload with directory traversal sequences in filename."""
    traversal_name = "../../../../etc/passwd"
    files = {"file": (traversal_name, valid_png_bytes, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    # The server should either preserve or sanitize the filename without error or path exposure
    assert data["filename"] in (traversal_name, "passwd", "unknown_image")


@pytest.mark.asyncio
async def test_null_byte_in_filename(adv_client: AsyncClient, valid_png_bytes: bytes) -> None:
    """Upload with null byte in filename."""
    files = {"file": ("page_1\x00_hidden.png", valid_png_bytes, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)
    # Must succeed or return 400/422, never 500 HTML
    assert response.status_code in (200, 400, 422)
    if response.status_code == 200:
        assert response.json()["valid"] is True
    else:
        _assert_valid_error_envelope(response, response.status_code)


@pytest.mark.asyncio
async def test_unicode_and_emoji_filename(adv_client: AsyncClient, valid_png_bytes: bytes) -> None:
    """Upload with complex Unicode characters and emoji."""
    filename = "漫画_チャプター1_✨_manhwa_한국어.png"
    files = {"file": (filename, valid_png_bytes, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["filename"] == filename


@pytest.mark.asyncio
async def test_empty_string_filename(adv_client: AsyncClient, valid_png_bytes: bytes) -> None:
    """Upload with empty string filename is treated as unparseable UploadFile, returning 422 VALIDATION_ERROR."""
    files = {"file": ("", valid_png_bytes, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_valid_error_envelope(response, 422, "VALIDATION_ERROR")



# =====================================================================
# VECTOR 4: DIMENSIONAL BOUNDARIES & CORRUPTED RASTERS
# =====================================================================

@pytest.mark.asyncio
async def test_exact_minimum_dimension_10x10(adv_client: AsyncClient) -> None:
    """Boundary test: 10x10 image is exactly the minimum dimension and must succeed."""
    img_bytes = generate_test_image(format="PNG", width=10, height=10)
    files = {"file": ("min10.png", img_bytes, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["width"] == 10
    assert data["height"] == 10


@pytest.mark.asyncio
async def test_below_minimum_dimension_9x10(adv_client: AsyncClient) -> None:
    """Boundary test: 9x10 image (width 1 below minimum) must fail with 400."""
    img_bytes = generate_test_image(format="PNG", width=9, height=10)
    files = {"file": ("fail_width.png", img_bytes, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_valid_error_envelope(response, 400, "INVALID_IMAGE_FORMAT")
    assert "too small" in response.json()["detail"]


@pytest.mark.asyncio
async def test_below_minimum_dimension_10x9(adv_client: AsyncClient) -> None:
    """Boundary test: 10x9 image (height 1 below minimum) must fail with 400."""
    img_bytes = generate_test_image(format="PNG", width=10, height=9)
    files = {"file": ("fail_height.png", img_bytes, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_valid_error_envelope(response, 400, "INVALID_IMAGE_FORMAT")
    assert "too small" in response.json()["detail"]


@pytest.mark.asyncio
async def test_above_maximum_dimension_16385x10(adv_client: AsyncClient) -> None:
    """Boundary test: 16385x10 image (width 1 above MAX_DIMENSION) must fail with 400."""
    # Low height keeps memory usage minimal (< 1MB) while testing dimension limit
    img_bytes = generate_test_image(format="PNG", width=16385, height=10)
    files = {"file": ("huge_width.png", img_bytes, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_valid_error_envelope(response, 400, "INVALID_IMAGE_FORMAT")
    assert "exceed maximum allowed" in response.json()["detail"]


@pytest.mark.asyncio
async def test_above_maximum_dimension_10x16385(adv_client: AsyncClient) -> None:
    """Boundary test: 10x16385 image (height 1 above MAX_DIMENSION) must fail with 400."""
    img_bytes = generate_test_image(format="PNG", width=10, height=16385)
    files = {"file": ("huge_height.png", img_bytes, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_valid_error_envelope(response, 400, "INVALID_IMAGE_FORMAT")
    assert "exceed maximum allowed" in response.json()["detail"]


@pytest.mark.asyncio
async def test_color_modes_rgba_and_grayscale(adv_client: AsyncClient) -> None:
    """Verify RGBA (transparency) and Grayscale color modes validate properly."""
    # RGBA PNG
    img_rgba = Image.new("RGBA", (50, 50), color=(100, 150, 200, 128))
    buf = io.BytesIO()
    img_rgba.save(buf, format="PNG")
    files_rgba = {"file": ("alpha.png", buf.getvalue(), "image/png")}
    resp_rgba = await adv_client.post("/api/v1/images/validate", files=files_rgba)
    assert resp_rgba.status_code == 200
    assert resp_rgba.json()["valid"] is True

    # Grayscale L mode JPEG
    img_l = Image.new("L", (60, 60), color=128)
    buf_l = io.BytesIO()
    img_l.save(buf_l, format="JPEG")
    files_l = {"file": ("gray.jpg", buf_l.getvalue(), "image/jpeg")}
    resp_l = await adv_client.post("/api/v1/images/validate", files=files_l)
    assert resp_l.status_code == 200
    assert resp_l.json()["valid"] is True


@pytest.mark.asyncio
async def test_truncated_valid_header_with_missing_raster(adv_client: AsyncClient) -> None:
    """Image has valid PNG magic bytes and IHDR chunk, but the bitstream is truncated before IDAT."""
    # 8-byte PNG signature + valid 25-byte IHDR chunk for 100x100 RGB image
    png_header_and_ihdr = (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR"
        b"\x00\x00\x00\x64\x00\x00\x00\x64\x08\x02\x00\x00\x00"
        b"\x5a\x2c\x7d\x13"
    )
    files = {"file": ("truncated.png", png_header_and_ihdr, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)
    _assert_valid_error_envelope(response, 400, "INVALID_IMAGE_FORMAT")


# =====================================================================
# VECTOR 5: CORS HEADERS & SECURITY PREFLIGHT
# =====================================================================

@pytest.mark.asyncio
async def test_cors_preflight_allowed_origin(adv_client: AsyncClient) -> None:
    """Preflight OPTIONS request from allowed frontend origin http://localhost:5173."""
    headers = {
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }
    response = await adv_client.options("/api/v1/images/validate", headers=headers)
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "POST" in response.headers.get("access-control-allow-methods", "")


@pytest.mark.asyncio
async def test_cors_preflight_disallowed_origin(adv_client: AsyncClient) -> None:
    """Preflight OPTIONS request from unauthorized external origin."""
    headers = {
        "Origin": "http://malicious-external-site.com",
        "Access-Control-Request-Method": "GET",
    }
    response = await adv_client.options("/api/v1/health", headers=headers)
    # CORS middleware does not attach allow-origin for unlisted origins
    assert response.headers.get("access-control-allow-origin") != "http://malicious-external-site.com"


# =====================================================================
# VECTOR 6: CONCURRENCY STRESS & THROUGHPUT
# =====================================================================

@pytest.mark.asyncio
async def test_concurrent_mixed_traffic(adv_client: AsyncClient, valid_png_bytes: bytes) -> None:
    """Concurrent burst of mixed requests (health, capabilities, valid upload, invalid upload, 404)."""
    tasks = []

    # 10 health checks
    for _ in range(10):
        tasks.append(adv_client.get("/api/v1/health"))

    # 5 capabilities
    for _ in range(5):
        tasks.append(adv_client.get("/api/v1/capabilities"))

    # 5 valid uploads
    for i in range(5):
        files = {"file": (f"concurrent_{i}.png", valid_png_bytes, "image/png")}
        tasks.append(adv_client.post("/api/v1/images/validate", files=files))

    # 5 invalid uploads (corrupt)
    for i in range(5):
        files = {"file": (f"bad_{i}.png", b"not_an_image", "image/png")}
        tasks.append(adv_client.post("/api/v1/images/validate", files=files))

    # 5 intentional 404s
    for i in range(5):
        tasks.append(adv_client.get(f"/api/v1/nonexistent_{i}"))

    results = await asyncio.gather(*tasks)
    assert len(results) == 30

    for resp in results:
        # Every response must be valid JSON with a non-500 status code
        assert resp.status_code in (200, 400, 404)
        data = resp.json()
        assert isinstance(data, dict)
        assert "text/html" not in resp.headers.get("content-type", "")


# =====================================================================
# VECTOR 7: DECOMPRESSION BOMB / EXTREME DOS PAYLOAD
# =====================================================================

@pytest.mark.asyncio
async def test_decompression_bomb_handling(adv_client: AsyncClient) -> None:
    """Verify server behavior when presented with an image triggering PIL's DecompressionBomb check.
    
    The server should not crash. Even if PIL triggers DecompressionBombError, the general_exception_handler
    must safely catch it and return a standard ErrorResponse envelope (application/json) rather than
    crashing the server or leaking raw HTML stack traces.
    """
    buf = io.BytesIO()
    # A 14000x14000 image produces 196,000,000 pixels (> PIL's 178,956,970 limit)
    img = Image.new("RGB", (14000, 14000))
    img.save(buf, format="PNG")
    bomb_bytes = buf.getvalue()

    files = {"file": ("decompression_bomb.png", bomb_bytes, "image/png")}
    response = await adv_client.post("/api/v1/images/validate", files=files)

    # Must return JSON, not HTML
    assert "application/json" in response.headers.get("content-type", "")
    assert response.status_code in (400, 500)
    data = response.json()
    validated = ErrorResponse.model_validate(data)
    assert validated.status_code == response.status_code
    assert validated.error_code in ("INVALID_IMAGE_FORMAT", "INTERNAL_SERVER_ERROR")


# =====================================================================
# VECTOR 8: SYSTEMATIC ERROR ENVELOPE INTEGRITY
# =====================================================================

@pytest.mark.asyncio
async def test_png_malformed_no_idat_chunk_leak_check(adv_client: AsyncClient) -> None:
    """A PNG with valid signature and IHDR but no IDAT chunks.
    
    Verifies that even when PIL raises an IndexError during verify(), the server does NOT leak
    raw HTML or crash, and returns a valid ErrorResponse JSON envelope.
    """
    import zlib, struct
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 50, 50, 8, 2, 0, 0, 0)
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_data + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr_data))
    iend = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", zlib.crc32(b"IEND"))
    payload = sig + ihdr + iend

    response = await adv_client.post("/api/v1/images/validate", files={"file": ("no_idat.png", payload, "image/png")})
    # Currently triggers unhandled IndexError caught by general_exception_handler returning 500
    # Must never leak HTML!
    assert "application/json" in response.headers.get("content-type", "")
    data = response.json()
    ErrorResponse.model_validate(data)
    assert response.status_code in (400, 500)


@pytest.mark.asyncio
async def test_query_parameters_on_endpoints(adv_client: AsyncClient) -> None:
    """Extra query parameters on health and capabilities endpoints should be safely ignored."""
    resp_h = await adv_client.get("/api/v1/health?debug=true&timestamp=now&extra=123")
    assert resp_h.status_code == 200
    HealthResponse.model_validate(resp_h.json())

    resp_c = await adv_client.get("/api/v1/capabilities?format=detailed&v=2")
    assert resp_c.status_code == 200
    CapabilitiesResponse.model_validate(resp_c.json())


@pytest.mark.asyncio
async def test_case_sensitivity_routes(adv_client: AsyncClient) -> None:
    """Uppercase or mixed-case routes should return standard 404 error envelope."""
    resp = await adv_client.get("/API/V1/HEALTH")
    _assert_valid_error_envelope(resp, 404, "NOT_FOUND")

    resp2 = await adv_client.get("/api/v1/Health")
    _assert_valid_error_envelope(resp2, 404, "NOT_FOUND")


@pytest.mark.asyncio
async def test_massive_multipart_extra_fields(adv_client: AsyncClient, valid_png_bytes: bytes) -> None:
    """Request with 50 unexpected form fields alongside valid image file."""
    files = {"file": ("manga.png", valid_png_bytes, "image/png")}
    data = {f"field_{i}": f"value_{i * 100}" for i in range(50)}
    resp = await adv_client.post("/api/v1/images/validate", files=files, data=data)
    assert resp.status_code == 200
    data = resp.json()
    assert data["valid"] is True
    assert data["filename"] == "manga.png"

