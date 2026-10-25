from fastapi import APIRouter
from app.api.v1.endpoints import capabilities, health, inpaint, ocr, upload

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(health.router)
api_v1_router.include_router(capabilities.router)
api_v1_router.include_router(upload.router)
api_v1_router.include_router(ocr.router)
api_v1_router.include_router(inpaint.router)
