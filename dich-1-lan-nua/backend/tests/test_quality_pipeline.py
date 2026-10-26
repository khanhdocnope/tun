"""Quality regression tests for the tuned OCR and pixel-mask eraser."""

import io
import json

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from app.services.inpainting.smart_erase import smart_erase
from app.services.inpainting.text_mask import build_region_mask
from app.services.ocr.manager import ocr_manager


def _font(size: int = 36):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # older Pillow
        return ImageFont.load_default()


def _comic_bubble(text: str = "HELLO WORLD") -> tuple[bytes, tuple[int, int, int, int]]:
    image = Image.new("RGB", (640, 420), (235, 235, 235))
    draw = ImageDraw.Draw(image)
    # Screentone-like background strokes outside the bubble.
    for y in range(0, 420, 24):
        draw.line([(0, y), (640, y + 8)], fill=(205, 205, 205), width=2)
    bubble = (90, 40, 550, 380)
    draw.ellipse(bubble, fill=(255, 255, 255), outline=(0, 0, 0), width=4)
    font = _font(38)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(
        ((640 - tw) // 2, (420 - th) // 2 - 10),
        text,
        fill=(0, 0, 0),
        font=font,
    )
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    x1, y1, x2, y2 = bubble
    return buf.getvalue(), (x1, y1, x2 - x1, y2 - y1)


def test_ocr_finds_horizontal_text():
    image_bytes, _ = _comic_bubble("HELLO WORLD")
    engine = ocr_manager.get_engine("rapidocr")
    regions = engine.detect_and_recognize(image_bytes, reading_direction="ltr")
    assert regions, "tuned detector should find the dialogue"
    joined = "".join(region.text for region in regions).upper()
    assert "HELLO" in joined


def test_pixel_mask_covers_text_and_not_outline():
    image_bytes, region = _comic_bubble("HELLO WORLD")
    rgb = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    result = build_region_mask(rgb, region, dilation=4)
    assert result.components >= 1
    assert result.mask.any()
    # The mask either finds the bubble itself or stays inside the outlined
    # ellipse; in both cases the outline pixels must not be part of the mask.
    x, y, w, h = region
    assert result.mask[y + 1, x + w // 2] == 0


def test_smart_erase_removes_text_but_keeps_bubble_outline():
    image_bytes, region = _comic_bubble("HELLO WORLD")
    cleaned_png, stats = smart_erase(
        image_bytes, [region], dilation=5, engine_name="auto"
    )
    assert stats["status"] == "ok"
    assert stats["text_boxes"] >= 1

    original = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    cleaned = np.array(Image.open(io.BytesIO(cleaned_png)).convert("RGB"))

    # Outside the bubble must be untouched.
    np.testing.assert_array_equal(original[:30, :30], cleaned[:30, :30])

    # The text area is now clean white.
    x, y, w, h = region
    center = cleaned[y + h // 2 - 25 : y + h // 2 + 25, x + 120 : x + w - 120]
    assert float(center.mean()) > 235

    # The bubble outline survives.
    left_outline = cleaned[y + h // 2, x + 1 : x + 6]
    assert int(left_outline.min()) < 80


@pytest.mark.asyncio
async def test_erase_text_in_region_endpoint(client):
    image_bytes, region = _comic_bubble("HELLO WORLD")
    response = await client.post(
        "/api/v1/erase-text-in-region",
        files={"file": ("bubble.png", image_bytes, "image/png")},
        data={"regions": json.dumps([list(region)]), "engine": "auto", "dilation": "5"},
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/png"
    assert response.headers["X-SmartErase-Status"] == "ok"
    assert int(response.headers["X-SmartErase-Text-Boxes"]) >= 1
    assert response.headers["X-SmartErase-Engine"] in ("flat", "flat+opencv_telea")

    cleaned = np.array(Image.open(io.BytesIO(response.content)).convert("RGB"))
    x, y, w, h = region
    center = cleaned[y + h // 2 - 25 : y + h // 2 + 25, x + 120 : x + w - 120]
    assert float(center.mean()) > 235


@pytest.mark.asyncio
async def test_erase_text_in_region_webp_output(client):
    image_bytes, region = _comic_bubble("HELLO WORLD")
    payload = {
        "regions": json.dumps([list(region)]),
        "engine": "auto",
        "dilation": "5",
        "output_format": "webp",
    }
    response = await client.post(
        "/api/v1/erase-text-in-region",
        files={"file": ("bubble.png", image_bytes, "image/png")},
        data=payload,
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    assert response.headers["X-SmartErase-Format"] == "image/webp"
    # WebP should be smaller than the lossless PNG default.
    png_response = await client.post(
        "/api/v1/erase-text-in-region",
        files={"file": ("bubble.png", image_bytes, "image/png")},
        data={**payload, "output_format": "png"},
    )
    assert len(response.content) < len(png_response.content)
    with Image.open(io.BytesIO(response.content)) as webp_file:
        assert webp_file.format == "WEBP"
        webp_pixels = np.array(webp_file.convert("RGB"))
    with Image.open(io.BytesIO(png_response.content)) as png_file:
        png_pixels = np.array(png_file.convert("RGB"))
    # Lossless WebP must be pixel-identical to the PNG output.
    np.testing.assert_array_equal(webp_pixels, png_pixels)


@pytest.mark.asyncio
async def test_erase_text_in_region_rejects_bad_regions(client):
    image_bytes, _ = _comic_bubble("HELLO WORLD")
    response = await client.post(
        "/api/v1/erase-text-in-region",
        files={"file": ("bubble.png", image_bytes, "image/png")},
        data={"regions": "not-json"},
    )
    assert response.status_code == 400
    assert response.json()["error_code"] == "INVALID_IMAGE_FORMAT"
