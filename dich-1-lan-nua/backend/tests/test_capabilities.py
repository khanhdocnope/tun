import pytest
from httpx import AsyncClient
from app.schemas.capabilities import CapabilitiesResponse


@pytest.mark.asyncio
async def test_capabilities_structure_and_values(client: AsyncClient) -> None:
    """Test that GET /api/v1/capabilities returns 200 and matches CapabilitiesResponse model."""
    response = await client.get("/api/v1/capabilities")
    assert response.status_code == 200

    data = response.json()

    # Validate against Pydantic schema
    validated = CapabilitiesResponse.model_validate(data)
    assert validated is not None

    # Verify OCR capabilities
    assert "easyocr" in data["ocr"]["available_engines"] or "rapidocr" in data["ocr"]["available_engines"]
    assert data["ocr"]["default_engine"] in ["easyocr", "rapidocr"]
    assert "ja" in data["ocr"]["languages"]
    assert "en" in data["ocr"]["languages"]

    # Verify Inpainting capabilities
    assert "opencv_telea" in data["inpainting"]["available_engines"]
    assert data["inpainting"]["default_engine"] == "opencv_telea"

    # Verify Translation capabilities
    assert "openrouter" in data["translation"]["available_providers"]
    assert data["translation"]["default_provider"] == "openrouter"

    # Verify Upload limits
    assert data["limits"]["max_upload_size_mb"] == 50
    assert "image/png" in data["limits"]["supported_image_types"]
    assert "image/jpeg" in data["limits"]["supported_image_types"]
    assert "image/webp" in data["limits"]["supported_image_types"]
