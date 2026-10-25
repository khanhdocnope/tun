import io
import json
import numpy as np
import pytest
from httpx import AsyncClient, ASGITransport
from PIL import Image
from app.main import app
from app.schemas.inpaint import InpaintRegionRequest
from app.services.inpainting.mask_generator import MaskGenerator


def test_mask_generator_dilation_and_clamping():
    """Verify mask creation accurately covers bounding box and applies dilation."""
    region = InpaintRegionRequest(
        box={"x": 10, "y": 10, "width": 20, "height": 20},
        dilation_px=5,
    )
    mask = MaskGenerator.create_mask_from_regions(
        width=100, height=100, regions=[region], global_dilation_px=0
    )

    assert mask.shape == (100, 100)
    assert mask.dtype == np.uint8
    # Center must be 255 (masked)
    assert mask[20, 20] == 255
    # Corners outside dilated box (x: 5 to 35, y: 5 to 35) must be 0
    assert mask[0, 0] == 0
    assert mask[50, 50] == 0


@pytest.mark.asyncio
async def test_mask_generate_endpoint():
    """Test POST /api/v1/mask/generate endpoint returns binary PNG."""
    regions_payload = json.dumps([
        {"box": {"x": 20, "y": 20, "width": 30, "height": 30}, "dilation_px": 2}
    ])

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/mask/generate",
            data={
                "width": "200",
                "height": "200",
                "regions_json": regions_payload,
                "dilation_px": "2",
            },
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        mask_pil = Image.open(io.BytesIO(response.content))
        assert mask_pil.size == (200, 200)
