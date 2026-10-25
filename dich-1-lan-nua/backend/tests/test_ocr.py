import io
import pytest
from httpx import AsyncClient, ASGITransport
from PIL import Image, ImageDraw, ImageFont
from app.main import app


def create_sample_comic_image(text: str = "HELLO COMIC") -> bytes:
    """Create a high-contrast sample comic dialogue box image."""
    img = Image.new("RGB", (300, 150), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    # Draw bubble outline
    draw.rectangle([20, 20, 280, 130], outline=(0, 0, 0), width=3)
    # Draw text
    draw.text((40, 60), text, fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_ocr_detect_rapidocr_endpoint():
    """Test real OCR text detection and coordinate extraction via RapidOCR."""
    image_bytes = create_sample_comic_image("HELLO WORLD")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/ocr/detect",
            files={"file": ("comic_page.png", image_bytes, "image/png")},
            data={"reading_direction": "rtl", "engine": "rapidocr"},
        )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["success"] is True
        assert data["image_width"] == 300
        assert data["image_height"] == 150
        assert data["engine"] == "rapidocr"
        assert "processing_time_ms" in data
        assert isinstance(data["regions"], list)
        if len(data["regions"]) > 0:
            first = data["regions"][0]
            assert "box" in first
            assert "text" in first
            assert first["confidence"] >= 0.0
            assert first["reading_order"] == 1


@pytest.mark.asyncio
async def test_ocr_detect_contour_fallback_endpoint():
    """Test contour bubble detector endpoint."""
    image_bytes = create_sample_comic_image("FALLBACK BUBBLE")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/ocr/detect",
            files={"file": ("page.png", image_bytes, "image/png")},
            data={"reading_direction": "ltr", "engine": "contour"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["engine"] == "contour"
        assert len(data["regions"]) >= 1
        assert data["regions"][0]["reading_order"] == 1


@pytest.mark.asyncio
async def test_ocr_rejects_corrupted_image():
    """Test OCR endpoint properly rejects corrupt payload with HTTP 400."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/ocr/detect",
            files={"file": ("corrupt.png", b"not-a-valid-png", "image/png")},
        )
        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_IMAGE_FORMAT"
