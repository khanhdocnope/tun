"""
Tier 5 Adversarial & Stress Hardening Suite (Challenger M5).
Tests backend API resilience against adversarial uploads, Content-Type spoofing,
boundary payload limits, path traversal in filenames, concurrent barrages,
and mathematical coordinate transformations.
"""

import io
import asyncio
import pytest
from PIL import Image
from starlette.testclient import TestClient

from app.main import app
from app.core.config import settings
from tests_e2e.contracts import (
    BoundingBox,
    clamp_bounding_box,
    normalize_bounding_box,
    fit_to_screen,
    zoom_to_cursor,
    image_from_screen,
    screen_from_image,
)
from tests_e2e.fixtures.sample_images import (
    create_test_png,
    create_test_jpeg,
    create_test_webp,
    create_corrupt_image,
    create_micro_image,
)


@pytest.fixture
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# Suite 1: Content-Type Spoofing & Header Parameter Variations
# ---------------------------------------------------------------------------
class TestContentTypeSpoofing:
    """Verifies that backend relies on true raster/magic byte validation,
    not untrusted client Content-Type headers."""

    def test_png_binary_with_jpeg_content_type(self, client):
        """PNG image uploaded with image/jpeg header should be parsed as PNG."""
        png_bytes = create_test_png(100, 100)
        response = client.post(
            "/api/v1/images/validate",
            files={"file": ("test.png", png_bytes, "image/jpeg")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert data["format"] == "PNG"
        assert data["content_type"] == "image/png"

    def test_jpeg_binary_with_png_content_type(self, client):
        """JPEG image uploaded with image/png header should be parsed as JPEG."""
        jpeg_bytes = create_test_jpeg(100, 100)
        response = client.post(
            "/api/v1/images/validate",
            files={"file": ("test.jpg", jpeg_bytes, "image/png")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert data["format"] == "JPEG"
        assert data["content_type"] == "image/jpeg"

    def test_webp_binary_with_generic_content_type(self, client):
        """WebP image uploaded with application/octet-stream should be parsed as WEBP."""
        webp_bytes = create_test_webp(100, 100)
        response = client.post(
            "/api/v1/images/validate",
            files={"file": ("test.webp", webp_bytes, "application/octet-stream")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert data["format"] == "WEBP"
        assert data["content_type"] == "image/webp"

    def test_header_with_charset_and_parameters(self, client):
        """MIME header with extra parameters like image/png; charset=utf-8."""
        png_bytes = create_test_png(50, 50)
        response = client.post(
            "/api/v1/images/validate",
            files={"file": ("page.png", png_bytes, "image/png; charset=binary")},
        )
        assert response.status_code == 200
        assert response.json()["valid"] is True


# ---------------------------------------------------------------------------
# Suite 2: Filename Path Traversal & Exotic Filename Sanitization
# ---------------------------------------------------------------------------
class TestFilenameEdgeCases:
    """Verifies filename handling does not crash or cause directory traversal."""

    @pytest.mark.parametrize(
        "adversarial_filename",
        [
            "../../../../etc/passwd.png",
            "..\\..\\..\\windows\\system32\\cmd.exe.png",
            "image\x00malicious.png",
            "A" * 255 + ".png",
            "   padded_with_spaces.png   ",
            "第1話_日本語ファイル名.png",
            "Trang_01_Tiếng_Việt_có_dấu.png",
            "manga [ch01] (2026) {hires} !@#$%^&*()_+.webp",
        ],
    )
    def test_adversarial_filename_upload(self, client, adversarial_filename):
        png_bytes = create_test_png(60, 60)
        response = client.post(
            "/api/v1/images/validate",
            files={"file": (adversarial_filename, png_bytes, "image/png")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["valid"] is True
        assert isinstance(data["filename"], str)
        assert len(data["filename"]) > 0

    def test_empty_filename_rejected_with_validation_error(self, client):
        """Empty filename in multipart is rejected by FastAPI with 422 ErrorResponse."""
        png_bytes = create_test_png(60, 60)
        response = client.post(
            "/api/v1/images/validate",
            files={"file": ("", png_bytes, "image/png")},
        )
        assert response.status_code == 422
        data = response.json()
        assert data["error_code"] == "VALIDATION_ERROR"
        assert data["status_code"] == 422


# ---------------------------------------------------------------------------
# Suite 3: Dimension Boundaries (Exact 10px Minimum, 16384px Maximum)
# ---------------------------------------------------------------------------
class TestDimensionExtremes:
    """Rigorous boundary verification for MIN_DIMENSION=10 and MAX_DIMENSION=16384."""

    def test_exact_10x10_accepted(self, client):
        img_bytes = create_micro_image(10, 10)
        res = client.post(
            "/api/v1/images/validate",
            files={"file": ("10x10.png", img_bytes, "image/png")},
        )
        assert res.status_code == 200
        assert res.json()["width"] == 10
        assert res.json()["height"] == 10

    def test_sub_min_9x10_rejected(self, client):
        img_bytes = create_micro_image(9, 10)
        res = client.post(
            "/api/v1/images/validate",
            files={"file": ("9x10.png", img_bytes, "image/png")},
        )
        assert res.status_code == 400
        assert res.json()["error_code"] == "INVALID_IMAGE_FORMAT"

    def test_sub_min_10x9_rejected(self, client):
        img_bytes = create_micro_image(10, 9)
        res = client.post(
            "/api/v1/images/validate",
            files={"file": ("10x9.png", img_bytes, "image/png")},
        )
        assert res.status_code == 400
        assert res.json()["error_code"] == "INVALID_IMAGE_FORMAT"

    def test_extreme_aspect_ratio_10x16000_tall(self, client):
        """Very narrow vertical strip (10 x 16000) accepted."""
        buf = io.BytesIO()
        img = Image.new("RGB", (10, 16000), color="white")
        img.save(buf, format="PNG")
        res = client.post(
            "/api/v1/images/validate",
            files={"file": ("strip.png", buf.getvalue(), "image/png")},
        )
        assert res.status_code == 200
        assert res.json()["width"] == 10
        assert res.json()["height"] == 16000

    def test_extreme_aspect_ratio_16000x10_wide(self, client):
        """Very wide panoramic strip (16000 x 10) accepted."""
        buf = io.BytesIO()
        img = Image.new("RGB", (16000, 10), color="white")
        img.save(buf, format="PNG")
        res = client.post(
            "/api/v1/images/validate",
            files={"file": ("pano.png", buf.getvalue(), "image/png")},
        )
        assert res.status_code == 200
        assert res.json()["width"] == 16000
        assert res.json()["height"] == 10


# ---------------------------------------------------------------------------
# Suite 4: Corrupt, Truncated, and Polyglot Payloads
# ---------------------------------------------------------------------------
class TestAdversarialPayloads:
    """Verifies that malformed or polyglot files are rejected with 400 and clean envelope."""

    def test_empty_zero_byte_file(self, client):
        res = client.post(
            "/api/v1/images/validate",
            files={"file": ("empty.png", b"", "image/png")},
        )
        assert res.status_code == 400
        assert res.json()["error_code"] == "INVALID_IMAGE_FORMAT"

    def test_random_garbage_bytes(self, client):
        res = client.post(
            "/api/v1/images/validate",
            files={"file": ("garbage.png", b"x" * 1024, "image/png")},
        )
        assert res.status_code == 400
        assert res.json()["error_code"] == "INVALID_IMAGE_FORMAT"

    def test_truncated_png_ihdr(self, client):
        """PNG magic number with truncated IHDR header."""
        truncated = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
        res = client.post(
            "/api/v1/images/validate",
            files={"file": ("trunc.png", truncated, "image/png")},
        )
        assert res.status_code == 400
        assert res.json()["error_code"] == "INVALID_IMAGE_FORMAT"

    def test_zip_archive_disguised_as_png(self, client):
        """PK zip header uploaded as .png."""
        zip_bytes = b"PK\x03\x04\x14\x00\x00\x00" + b"\x00" * 100
        res = client.post(
            "/api/v1/images/validate",
            files={"file": ("archive.png", zip_bytes, "image/png")},
        )
        assert res.status_code == 400
        assert res.json()["error_code"] == "INVALID_IMAGE_FORMAT"

    def test_html_polyglot_payload(self, client):
        """HTML file starting with <html> disguised as image."""
        html_bytes = b"<!DOCTYPE html><html><body><script>alert(1)</script></body></html>"
        res = client.post(
            "/api/v1/images/validate",
            files={"file": ("xss.png", html_bytes, "image/png")},
        )
        assert res.status_code == 400
        assert res.json()["error_code"] == "INVALID_IMAGE_FORMAT"


# ---------------------------------------------------------------------------
# Suite 5: High-Frequency Concurrent Request Barrage
# ---------------------------------------------------------------------------
class TestConcurrentBarrage:
    """Verifies system stability and absence of state leakage under rapid requests."""

    def test_50_rapid_sequential_validations(self, client):
        png_bytes = create_test_png(50, 50)
        jpeg_bytes = create_test_jpeg(50, 50)
        webp_bytes = create_test_webp(50, 50)

        for i in range(50):
            mod = i % 3
            if mod == 0:
                res = client.post("/api/v1/images/validate", files={"file": (f"p{i}.png", png_bytes, "image/png")})
            elif mod == 1:
                res = client.post("/api/v1/images/validate", files={"file": (f"p{i}.jpg", jpeg_bytes, "image/jpeg")})
            else:
                res = client.post("/api/v1/images/validate", files={"file": (f"p{i}.webp", webp_bytes, "image/webp")})

            assert res.status_code == 200
            assert res.json()["valid"] is True

    def test_capabilities_and_health_under_rapid_polling(self, client):
        for _ in range(50):
            h_res = client.get("/api/v1/health")
            assert h_res.status_code == 200
            assert h_res.json()["status"] == "healthy"

            c_res = client.get("/api/v1/capabilities")
            assert c_res.status_code == 200
            assert "ocr" in c_res.json()
            assert "inpainting" in c_res.json()
            assert "translation" in c_res.json()


# ---------------------------------------------------------------------------
# Suite 6: Mathematical Coordinate Transformation Invariant Tests
# ---------------------------------------------------------------------------
class TestCoordinateMathInvariants:
    """Verifies that mathematical contracts from contracts.py never produce NaN or drift."""

    def test_roundtrip_precision_across_100_points(self):
        vw, vh = 1920.0, 1080.0
        img_w, img_h = 2400.0, 3600.0
        z, tx, ty = fit_to_screen(vw, vh, img_w, img_h, padding=20.0)

        for xi in range(0, 2400, 24):
            for yi in range(0, 3600, 36):
                xs, ys = screen_from_image(float(xi), float(yi), z, tx, ty)
                rec_xi, rec_yi = image_from_screen(xs, ys, z, tx, ty)
                assert abs(rec_xi - xi) < 1e-6
                assert abs(rec_yi - yi) < 1e-6

    def test_clamp_bounding_box_sub_4px_discarded(self):
        img_w, img_h = 1000.0, 1000.0
        box = BoundingBox(x=10.0, y=10.0, width=3.99, height=5.0)
        assert clamp_bounding_box(box, img_w, img_h, min_size=4.0) is None

        box2 = BoundingBox(x=10.0, y=10.0, width=5.0, height=3.99)
        assert clamp_bounding_box(box2, img_w, img_h, min_size=4.0) is None

        box_exact = BoundingBox(x=10.0, y=10.0, width=4.0, height=4.0)
        clamped = clamp_bounding_box(box_exact, img_w, img_h, min_size=4.0)
        assert clamped is not None
        assert clamped.width == 4.0
        assert clamped.height == 4.0
