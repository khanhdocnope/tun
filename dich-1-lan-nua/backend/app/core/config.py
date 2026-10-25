import json
import os
from pathlib import Path
from typing import List
from dotenv import load_dotenv

# Automatically locate and load .env from current directory or parents
current_path = Path(__file__).resolve().parent
candidates = [
    Path(".env"),
    Path("backend/.env"),
    current_path / ".env",
    current_path.parent / ".env",
    current_path.parent.parent / ".env",
    current_path.parent.parent.parent / ".env",
]
for candidate in candidates:
    if candidate.is_file():
        load_dotenv(candidate)
        break


def _parse_list(key: str, default: List[str]) -> List[str]:
    raw = os.getenv(key)
    if not raw:
        return default
    raw = raw.strip()
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    except Exception:
        pass
    return [item.strip() for item in raw.split(",") if item.strip()]


class Settings:
    """Application configuration settings."""

    PROJECT_NAME: str = os.getenv("PROJECT_NAME", "Comic Translation Studio")
    VERSION: str = os.getenv("VERSION", "1.0.0")
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")

    # Allowed CORS Origins & Regex (supporting localhost, Hugging Face Spaces, and frontend deploys)
    CORS_ORIGINS: List[str] = _parse_list(
        "CORS_ORIGINS",
        ["http://localhost:5173", "http://127.0.0.1:5173"],
    )
    CORS_ORIGIN_REGEX: str = os.getenv(
        "CORS_ORIGIN_REGEX",
        r"^https?://.*(\.hf\.space|\.vercel\.app|localhost|127\.0\.0\.1)(:\d+)?$",
    )

    # File and upload limits
    TEMP_STORAGE_DIR: str = os.getenv("TEMP_STORAGE_DIR", "storage/temp")
    MAX_UPLOAD_SIZE_MB: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "50"))

    @property
    def max_upload_size_bytes(self) -> int:
        return self.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    # Capabilities configuration
    OCR_ENGINE: str = os.getenv("OCR_ENGINE", "easyocr")
    OCR_LANGUAGES: List[str] = _parse_list(
        "OCR_LANGUAGES",
        ["en", "ja", "ko", "ch_sim"],
    )
    INPAINTING_ENGINE: str = os.getenv("INPAINTING_ENGINE", "opencv_telea")
    DEFAULT_TRANSLATION_PROVIDER: str = os.getenv(
        "DEFAULT_TRANSLATION_PROVIDER", "openrouter"
    )

    SUPPORTED_IMAGE_TYPES: List[str] = [
        "image/png",
        "image/jpeg",
        "image/webp",
    ]


settings = Settings()
