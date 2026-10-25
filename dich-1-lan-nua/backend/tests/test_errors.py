import pytest
from httpx import AsyncClient
from app.main import app
from app.schemas.error import ErrorResponse


# Register a test-only crash endpoint to verify 500 exception handler
@app.get("/api/v1/test/crash", include_in_schema=False)
async def crash_endpoint() -> None:
    raise RuntimeError("Simulated unexpected server error")


@pytest.mark.asyncio
async def test_404_error_envelope(client: AsyncClient) -> None:
    """Test that requesting a nonexistent endpoint returns standard 404 ErrorResponse."""
    response = await client.get("/api/v1/definitely_not_a_valid_route_12345")
    assert response.status_code == 404

    data = response.json()
    validated = ErrorResponse.model_validate(data)
    assert validated.status_code == 404
    assert validated.error_code == "NOT_FOUND"
    assert "Not Found" in validated.detail


@pytest.mark.asyncio
async def test_405_method_not_allowed(client: AsyncClient) -> None:
    """Test that using an invalid HTTP method returns standard 405 ErrorResponse."""
    response = await client.get("/api/v1/images/validate")
    assert response.status_code == 405

    data = response.json()
    validated = ErrorResponse.model_validate(data)
    assert validated.status_code == 405
    assert validated.error_code == "METHOD_NOT_ALLOWED"
    assert "Method Not Allowed" in validated.detail


@pytest.mark.asyncio
async def test_422_validation_error_envelope(client: AsyncClient) -> None:
    """Test that missing required body/form parameters returns standard 422 ErrorResponse."""
    # POST to validate endpoint without 'file' form-data
    response = await client.post("/api/v1/images/validate", json={"wrong": "data"})
    assert response.status_code == 422

    data = response.json()
    validated = ErrorResponse.model_validate(data)
    assert validated.status_code == 422
    assert validated.error_code == "VALIDATION_ERROR"
    assert len(validated.detail) > 0


@pytest.mark.asyncio
async def test_500_internal_server_error_envelope(client: AsyncClient) -> None:
    """Test that unhandled exceptions are caught and returned in standard 500 ErrorResponse."""
    response = await client.get("/api/v1/test/crash")
    assert response.status_code == 500

    data = response.json()
    validated = ErrorResponse.model_validate(data)
    assert validated.status_code == 500
    assert validated.error_code == "INTERNAL_SERVER_ERROR"
    assert validated.detail == "Internal server error"
