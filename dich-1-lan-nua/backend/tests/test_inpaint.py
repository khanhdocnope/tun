import io
import json
import numpy as np
import pytest
from httpx import AsyncClient, ASGITransport
from PIL import Image, ImageDraw
from app.main import app


def create_sample_page_with_dialogue() -> bytes:
    """Create a 200x200 white comic image with a black text block."""
    img = Image.new("RGB", (200, 200), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    # Background texture outside bubble: draw a distinct line at y=10
    draw.line([(0, 10), (200, 10)], fill=(0, 128, 255), width=2)
    # Black dialogue box to erase at center (50, 50, 150, 150)
    draw.rectangle([50, 50, 150, 150], fill=(0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
@pytest.mark.parametrize("engine", ["opencv_telea", "opencv_ns"])
async def test_inpaint_process_telea_and_ns(engine: str):
    """Test inpainting erases black text box and preserves external pixels."""
    image_bytes = create_sample_page_with_dialogue()
    regions_payload = json.dumps([
        {"box": {"x": 50, "y": 50, "width": 100, "height": 100}, "dilation_px": 2}
    ])

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/inpaint/process",
            files={"image": ("manga.png", image_bytes, "image/png")},
            data={"regions_json": regions_payload, "engine": engine, "dilation_px": "2"},
        )

        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "image/png"
        assert response.headers["X-Cleaned-Width"] == "200"
        assert response.headers["X-Cleaned-Height"] == "200"

        # Verify output image pixels
        cleaned_pil = Image.open(io.BytesIO(response.content))
        cleaned_np = np.array(cleaned_pil)

        # 1. External pixel check: Line at y=10, x=50 must remain undisturbed blue (0, 128, 255)
        np.testing.assert_array_equal(cleaned_np[10, 50], [0, 128, 255])

        # 2. Inpainted pixel check: Center pixel at (100, 100) was black [0, 0, 0],
        # now inpainted from surrounding white background (should be high luminance > 200)
        center_color = cleaned_np[100, 100]
        assert np.mean(center_color) > 150, f"Expected inpainted center to be bright, got {center_color}"


@pytest.mark.asyncio
async def test_inpaint_rejects_missing_mask_and_regions():
    """Test inpainting returns 400 when neither mask nor regions_json is supplied."""
    image_bytes = create_sample_page_with_dialogue()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/inpaint/process",
            files={"image": ("manga.png", image_bytes, "image/png")},
            data={"engine": "opencv_telea"},
        )
        assert response.status_code == 400
        assert response.json()["error_code"] == "INVALID_IMAGE_FORMAT"
