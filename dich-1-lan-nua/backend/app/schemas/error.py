from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    """Standard unified error response envelope."""
    detail: str = Field(..., description="Human-readable error explanation")
    error_code: str = Field(..., description="Machine-readable error identifier")
    status_code: int = Field(..., description="HTTP status code")
