from datetime import datetime
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check_success(client: AsyncClient) -> None:
    """Test that GET /api/v1/health returns status 200 and conforms to HealthResponse schema."""
    response = await client.get("/api/v1/health")
    assert response.status_code == 200

    data = response.json()
    assert data["status"] == "healthy"
    assert data["version"] == "1.0.0"
    assert "timestamp" in data

    # Verify that timestamp is valid ISO 8601
    parsed_time = datetime.fromisoformat(data["timestamp"])
    assert parsed_time is not None


@pytest.mark.asyncio
async def test_root_endpoint_success(client: AsyncClient) -> None:
    """GET / serves the built-in UI, GET /status returns the JSON service info."""
    response = await client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")

    status = await client.get("/status")
    assert status.status_code == 200
    data = status.json()
    assert data["service"] == "Comic Translation Studio"
    assert data["status"] == "online"
    assert data["docs"] == "/docs"
