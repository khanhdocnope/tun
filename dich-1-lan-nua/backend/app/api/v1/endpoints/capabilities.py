from fastapi import APIRouter
from app.core.config import settings
from app.schemas.capabilities import (
    CapabilitiesResponse,
    InpaintingOptions,
    LimitsOptions,
    OCROptions,
    TranslationOptions,
)
from app.services.ocr.manager import ocr_manager
from app.services.inpainting.manager import inpainting_manager

router = APIRouter(tags=["Capabilities"])


@router.get("/capabilities", response_model=CapabilitiesResponse)
async def get_capabilities() -> CapabilitiesResponse:
    """Return configured and available engines, providers, and upload constraints."""
    ocr_avail = list(dict.fromkeys(["rapidocr", "easyocr", "contour"] + ocr_manager.get_available_engines()))
    # "auto" and "flat" are mask/fill strategies used by /erase-text-in-region;
    # they are listed alongside the classical inpainting engines for the UI.
    inpaint_avail = list(
        dict.fromkeys(
            ["auto", "flat", "texture", "flatten"]
            + inpainting_manager.get_available_engines()
            + ["lama"]
        )
    )

    return CapabilitiesResponse(
        ocr=OCROptions(
            available_engines=ocr_avail,
            default_engine="rapidocr" if ocr_manager.get_engine().name == "rapidocr" else settings.OCR_ENGINE,
            languages=settings.OCR_LANGUAGES,
        ),
        inpainting=InpaintingOptions(
            available_engines=inpaint_avail if inpaint_avail else ["opencv_telea", "opencv_ns", "lama"],
            default_engine=settings.INPAINTING_ENGINE,
        ),
        translation=TranslationOptions(
            available_providers=["openrouter", "openai"],
            default_provider=settings.DEFAULT_TRANSLATION_PROVIDER,
        ),
        limits=LimitsOptions(
            max_upload_size_mb=settings.MAX_UPLOAD_SIZE_MB,
            supported_image_types=settings.SUPPORTED_IMAGE_TYPES,
        ),
    )
