from fastapi import APIRouter

from app.api.v1.endpoints import (
    capabilities,
    debug,
    erase_ui,
    health,
    inpaint,
    ocr,
    smart_erase,
    upload,
)
from app.core.config import settings

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(health.router)
api_v1_router.include_router(capabilities.router)
api_v1_router.include_router(upload.router)
api_v1_router.include_router(ocr.router)
api_v1_router.include_router(inpaint.router)
api_v1_router.include_router(smart_erase.router)
api_v1_router.include_router(erase_ui.router)
if settings.DEBUG:
    # Diagnostic endpoint: reports torch/model state without downloading
    # anything.  Never expose it on a public Space unless DEBUG is enabled.
    api_v1_router.include_router(debug.router)
