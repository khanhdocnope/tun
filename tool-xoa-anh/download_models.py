"""
Model downloader for Manga Cleaner (Big-LaMa, ComicTextDetector, Bubble/Text detector).
Ensures weights exist locally before launching inference.
"""

from __future__ import annotations

import os
import sys
import logging
from pathlib import Path
from typing import List
import torch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("manga_cleaner.downloader")

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

COMIC_ONNX_PATH = MODEL_DIR / "comictextdetector.pt.onnx"
ANIME_LAMA_PT_PATH = MODEL_DIR / "anime-manga-big-lama.pt"
BIG_LAMA_PT_PATH = MODEL_DIR / "big-lama.pt"

COMIC_URLS = [
    "https://huggingface.co/mayocream/comic-text-detector-onnx/resolve/main/comic-text-detector.onnx",
    "https://huggingface.co/kzome/manga-cleaner/resolve/main/data/comictextdetector.pt.onnx",
    "https://hf-mirror.com/kzome/manga-cleaner/resolve/main/data/comictextdetector.pt.onnx",
]

ANIME_LAMA_URLS = [
    "https://github.com/Sanster/models/releases/download/AnimeMangaInpainting/anime-manga-big-lama.pt",
    "https://huggingface.co/kzome/manga-cleaner/resolve/main/data/anime-manga-big-lama.pt",
    "https://hf-mirror.com/kzome/manga-cleaner/resolve/main/data/anime-manga-big-lama.pt",
]

BIG_LAMA_URLS = [
    "https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt",
    "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt",
    "https://hf-mirror.com/kzome/manga-cleaner/resolve/main/data/big-lama.pt",
]


def download_resilient(urls: List[str], dest: Path, min_mb: int = 10) -> bool:
    """Download a file with multiple mirror fallbacks and size validation."""
    dest = Path(dest)
    if dest.is_file() and dest.stat().st_size >= min_mb * 1024 * 1024:
        logger.info("[READY] %s (%d MB)", dest.name, dest.stat().st_size // (1024 * 1024))
        return True

    # If already exists in weights/ directory, copy or symlink
    legacy_weights = BASE_DIR / "weights" / dest.name
    if not legacy_weights.is_file() and dest.name == "comictextdetector.pt.onnx":
        legacy_alt = BASE_DIR / "weights" / "comic-text-detector.onnx"
        if legacy_alt.is_file():
            legacy_weights = legacy_alt

    if legacy_weights.is_file() and legacy_weights.stat().st_size >= min_mb * 1024 * 1024:
        logger.info("[COPY] Found in weights/, copying %s -> %s", legacy_weights.name, dest)
        dest.write_bytes(legacy_weights.read_bytes())
        return True

    logger.info("Downloading %s ...", dest.name)
    for url in urls:
        try:
            logger.info("  -> Attempting source: %s", url)
            torch.hub.download_url_to_file(url, str(dest), progress=True)
            if dest.is_file() and dest.stat().st_size >= min_mb * 1024 * 1024:
                logger.info("[SUCCESS] %s downloaded (%d MB)", dest.name, dest.stat().st_size // (1024 * 1024))
                return True
        except Exception as exc:
            logger.warning("  Mirror warning (%s): %s", url, exc)
            if dest.is_file():
                try:
                    dest.unlink()
                except Exception:
                    pass

    return False


def prefetch_bubble_detector() -> bool:
    """Warm the HF cache with ogkalu/comic-text-and-bubble-detector (RT-DETR-v2, Chat vs SFX regions).

    bubble_detector.py loads it lazily via from_pretrained, so this is optional:
    it only avoids the first-request download delay. Never blocks startup on failure.
    """
    repo = os.getenv("BUBBLE_DETECTOR_REPO", "ogkalu/comic-text-and-bubble-detector")
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(repo_id=repo, allow_patterns=["*.json", "*.safetensors"])
        logger.info("[READY] bubble detector cached: %s", repo)
        return True
    except Exception as exc:
        logger.warning("Could not prefetch %s (will retry lazily at runtime): %s", repo, exc)
        return False


def ensure_inpainter(model_name: str = "anime-lama") -> bool:
    """Ensure specific inpainting model is available."""
    canonical = "big-lama" if "big" in model_name.lower() and "anime" not in model_name.lower() else "anime-lama"
    if canonical == "big-lama":
        return download_resilient(BIG_LAMA_URLS, BIG_LAMA_PT_PATH, min_mb=50)
    return download_resilient(ANIME_LAMA_URLS, ANIME_LAMA_PT_PATH, min_mb=50)


def ensure_models() -> bool:
    """Ensure all required models are downloaded and valid."""
    c_ok = download_resilient(COMIC_URLS, COMIC_ONNX_PATH, min_mb=10)
    l_ok = download_resilient(ANIME_LAMA_URLS, ANIME_LAMA_PT_PATH, min_mb=50)
    return c_ok and l_ok


if __name__ == "__main__":
    success = ensure_models()
    prefetch_bubble_detector()
    if not success:
        logger.error("Failed to download one or more models.")
        sys.exit(1)
    logger.info("All models ready.")
