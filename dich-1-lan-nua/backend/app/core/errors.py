import logging
from typing import Any, Dict, List, Union
from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.error import ErrorResponse

logger = logging.getLogger(__name__)


class AppException(Exception):
    """Base application exception with explicit error_code and status_code."""

    def __init__(
        self,
        detail: str,
        error_code: str = "APP_ERROR",
        status_code: int = status.HTTP_400_BAD_REQUEST,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.error_code = error_code
        self.status_code = status_code


class InvalidImageException(AppException):
    """Raised when an uploaded image is corrupt, empty, unsupported, or out of bounds."""

    def __init__(
        self,
        detail: str = "Invalid or corrupt image file. Only PNG, JPEG, and WebP are allowed.",
    ) -> None:
        super().__init__(
            detail=detail,
            error_code="INVALID_IMAGE_FORMAT",
            status_code=status.HTTP_400_BAD_REQUEST,
        )


class FileTooLargeException(AppException):
    """Raised when an uploaded file exceeds the maximum permitted size."""

    def __init__(
        self,
        detail: str = "File size exceeds the 50MB limit.",
    ) -> None:
        super().__init__(
            detail=detail,
            error_code="FILE_TOO_LARGE",
            status_code=413,
        )


class NotFoundException(AppException):
    """Raised when a requested resource is not found."""

    def __init__(
        self,
        detail: str = "Resource not found",
    ) -> None:
        super().__init__(
            detail=detail,
            error_code="NOT_FOUND",
            status_code=status.HTTP_404_NOT_FOUND,
        )


def _status_to_error_code(status_code: int) -> str:
    mapping = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        413: "FILE_TOO_LARGE",
        415: "UNSUPPORTED_MEDIA_TYPE",
        422: "VALIDATION_ERROR",
        500: "INTERNAL_SERVER_ERROR",
        502: "BAD_GATEWAY",
        503: "SERVICE_UNAVAILABLE",
    }
    return mapping.get(status_code, f"HTTP_{status_code}")


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """Handler for custom application exceptions."""
    payload = ErrorResponse(
        detail=exc.detail,
        error_code=exc.error_code,
        status_code=exc.status_code,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=payload.model_dump(),
    )


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Handler for Starlette/FastAPI HTTPExceptions (e.g. 404, 405)."""
    error_code = getattr(exc, "error_code", None) or _status_to_error_code(exc.status_code)
    detail_str = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    payload = ErrorResponse(
        detail=detail_str,
        error_code=error_code,
        status_code=exc.status_code,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=payload.model_dump(),
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Handler for Pydantic RequestValidationErrors (HTTP 422)."""
    # Build a concise, clean string detail representation
    error_messages: List[str] = []
    for err in exc.errors():
        loc = ".".join(str(item) for item in err.get("loc", []) if item != "body")
        msg = err.get("msg", "Validation error")
        error_messages.append(f"{loc}: {msg}" if loc else msg)

    detail_str = "; ".join(error_messages) if error_messages else "Request validation failed"
    payload = ErrorResponse(
        detail=detail_str,
        error_code="VALIDATION_ERROR",
        status_code=422,
    )
    return JSONResponse(
        status_code=422,
        content=payload.model_dump(),
    )


async def general_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Global catch-all handler for unhandled exceptions (HTTP 500)."""
    logger.exception(f"Unhandled exception on {request.method} {request.url.path}: {exc}")
    payload = ErrorResponse(
        detail="Internal server error",
        error_code="INTERNAL_SERVER_ERROR",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=payload.model_dump(),
    )
