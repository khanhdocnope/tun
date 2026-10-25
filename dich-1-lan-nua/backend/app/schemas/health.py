from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Health check response schema."""
    status: str = Field(default="healthy", description="Application health status")
    version: str = Field(default="1.0.0", description="API version")
    timestamp: str = Field(..., description="ISO 8601 UTC timestamp")
