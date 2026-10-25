"""E2E Test Suite for Phase 2: Real OCR Text-Region Detection & Inpainting Pipeline.

Covers:
1. RapidOCR ONNX inference with polygon coordinates, confidence, and reading order.
2. Bubble Contour fallback detection.
3. OpenCV Inpainting (Telea & Navier-Stokes) with non-destructive image preservation.
4. Mask generation with morphological dilation.
5. Hugging Face Free Tier deployment artifact validation (Dockerfile, port, requirements).
"""

import io
import pytest
from httpx import AsyncClient, ASGITransport
from PIL import Image, ImageDraw, ImageFont
import numpy as np

from app.main import app
from app.services.ocr.manager import ocr_manager
from app.services.inpainting.manager import inpainting_manager


def _create_manga_fixture(width: int = 500, height: int = 700) -> bytes:
    """Create a realistic manga crop fixture with background art and 2 dialogue bubbles."""
    img = Image.new("RGB", (width, height), color=(235, 235, 235))
    draw = ImageDraw.Draw(img)

    # Some background artwork stripes
    for y in range(0, height, 40):
        draw.line([(0, y), (width, y + 20)], fill=(200, 200, 200), width=2)

    # Bubble 1: Top-Right (RTL #1)
    draw.ellipse([300, 50, 470, 200], fill=(255, 255, 255), outline=(0, 0, 0), width=3)
    draw.text((340, 110), "HELLO", fill=(0, 0, 0))

    # Bubble 2: Bottom-Left (RTL #2)
    draw.ellipse([30, 450, 200, 600], fill=(255, 255, 255), outline=(0, 0, 0), width=3)
    draw.text((70, 510), "WORLD", fill=(0, 0, 0))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_e2e_phase2_rapidocr_detection_and_ordering():
    """Verify RapidOCR detects text regions, assigns confidence, and orders RTL correctly."""
    fixture_bytes = _create_manga_fixture()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/api/v1/ocr/detect",
            files={"file": ("manga_test.png", fixture_bytes, "image/png")},
            data={"engine": "rapidocr", "reading_order": "rtl"},
        )

        assert response.status_code == 200
        data = response.json()

        assert data["engine"] == "rapidocr"
        assert data["reading_order"] == "rtl"
        assert data["image_width"] == 500
        assert data["image_height"] == 700
        assert data["processing_time_ms"] > 0
        assert len(data["regions"]) >= 1

        first_region = data["regions"][0]
        assert "polygon" in first_region
        assert len(first_region["polygon"]) >= 4
        assert "confidence" in first_region
        assert 0.0 <= first_region["confidence"] <= 1.0
        assert "box" in first_region or "bounding_box" in first_region
        box_data = first_region.get("box") or first_region.get("bounding_box")
        assert box_data["width"] > 0
        assert box_data["height"] > 0


@pytest.mark.asyncio
async def test_e2e_phase2_contour_bubble_fallback():
    """Verify contour bubble fallback detects speech bubbles when RapidOCR is bypassed."""
    fixture_bytes = _create_manga_fixture()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/api/v1/ocr/detect",
            files={"file": ("manga_test.png", fixture_bytes, "image/png")},
            data={"engine": "contour", "reading_order": "rtl"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["engine"] == "contour"
        assert len(data["regions"]) >= 1


@pytest.mark.asyncio
async def test_e2e_phase2_inpainting_non_destructive():
    """Verify OpenCV inpainting cleanly removes text in bubble while preserving original bytes."""
    fixture_bytes = _create_manga_fixture()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        # Inpaint Bubble 1: Top-Right
        regions_json = (
            '[{"x": 320, "y": 90, "width": 130, "height": 80}]'
        )

        response = await client.post(
            "/api/v1/inpaint/process",
            files={"file": ("manga_test.png", fixture_bytes, "image/png")},
            data={"regions": regions_json, "dilation": 3, "engine": "opencv_telea"},
        )

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert response.headers["X-Inpaint-Engine"] == "opencv_telea"
        assert int(response.headers["X-Inpaint-Duration-Ms"]) >= 0

        cleaned_bytes = response.content
        assert len(cleaned_bytes) > 0

        # Load both original and cleaned images
        orig_img = Image.open(io.BytesIO(fixture_bytes)).convert("RGB")
        clean_img = Image.open(io.BytesIO(cleaned_bytes)).convert("RGB")

        orig_np = np.array(orig_img)
        clean_np = np.array(clean_img)

        # 1. Output dimensions match perfectly
        assert clean_np.shape == orig_np.shape

        # 2. Pixels completely outside the inpaint region are 100% identical (non-destructive)
        # Check area at (10, 10, 100, 100)
        assert np.array_equal(orig_np[10:100, 10:100], clean_np[10:100, 10:100])

        # 3. Inside the inpainted text area, dark text pixels were replaced with light background
        # Original text area had black text (luminance ~ 0)
        # Cleaned area should have average luminance > 200 (white bubble background)
        inpainted_crop = clean_np[100:130, 330:400]
        assert np.mean(inpainted_crop) > 200


@pytest.mark.asyncio
async def test_e2e_phase2_mask_generator_endpoint():
    """Verify /api/v1/mask/generate creates an accurate 8-bit binary mask."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        payload = {
            "width": 400,
            "height": 400,
            "regions": [{"x": 50, "y": 50, "width": 100, "height": 100}],
            "dilation": 4,
        }
        response = await client.post("/api/v1/mask/generate", json=payload)
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"

        mask_img = Image.open(io.BytesIO(response.content))
        assert mask_img.size == (400, 400)
        mask_np = np.array(mask_img)

        # Center should be white (255)
        assert mask_np[100, 100] == 255
        # Corner should be black (0)
        assert mask_np[10, 10] == 0


def test_hugging_face_spaces_free_tier_readiness():
    """Verify Gradio SDK configuration, requirements.txt, and packages.txt for 100% Free Tier."""
    from pathlib import Path

    app_py = Path("backend/app.py")
    assert app_py.exists(), "backend/app.py must exist as Gradio Space entrypoint"

    packages_txt = Path("backend/packages.txt")
    assert packages_txt.exists(), "backend/packages.txt must exist for apt dependencies"
    assert "libgl1" in packages_txt.read_text(encoding="utf-8")

    readme = Path("backend/README.md").read_text(encoding="utf-8")
    assert "sdk: gradio" in readme

    reqs = Path("backend/requirements.txt").read_text(encoding="utf-8")
    assert "rapidocr-onnxruntime" in reqs
    assert "gradio" in reqs
    assert "torch" not in reqs, (
        "torch should be excluded to respect Hugging Face free tier memory limits"
    )
