from datetime import datetime, timezone
from fastapi import APIRouter
from app.core.config import settings
from app.schemas.health import HealthResponse

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
async def check_health() -> HealthResponse:
    """Return system health status, current version, and ISO 8601 UTC timestamp."""
    return HealthResponse(
        status="healthy",
        version=settings.VERSION,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
