import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import api_v1_router
from app.core.config import settings
from app.core.errors import (
    AppException,
    app_exception_handler,
    general_exception_handler,
    http_exception_handler,
    validation_exception_handler,
)

logger = logging.getLogger(__name__)


def _warm_ocr_in_background() -> None:
    """Load OCR/ONNX sessions before the first user request.

    Runs in a daemon thread so a slow model download never delays startup or
    blocks the health endpoint on Hugging Face Spaces.
    """

    try:
        from app.services.ocr.manager import ocr_manager

        engine = ocr_manager.get_engine("rapidocr")
        warmup = getattr(engine, "warmup", None)
        if callable(warmup):
            warmup()
    except Exception as exc:  # pragma: no cover - optional warmup
        logger.warning("Background OCR warmup skipped: %s", exc)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(
        target=_warm_ocr_in_background, name="ocr-warmup", daemon=True
    ).start()
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Custom Exception Handlers for Unified Error Envelopes
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(500, general_exception_handler)
app.add_exception_handler(Exception, general_exception_handler)

# Mount API v1 Router
app.include_router(api_v1_router)


@app.get("/")
async def root() -> dict:
    """Root endpoint providing service status and documentation link."""
    return {
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "online",
        "docs": "/docs",
    }
