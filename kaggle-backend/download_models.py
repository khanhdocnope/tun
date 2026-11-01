"""
Model downloader for Manga Cleaner (Big-LaMa, ComicTextDetector, MangaTextDetector, Bubble/Text detector).
Ensures weights exist locally before launching inference.
"""

from __future__ import annotations

import logging
import os
import sys
import urllib.request
from pathlib import Path
from typing import List

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("manga_cleaner.downloader")

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

MANGA_DET_FP32_PATH = MODEL_DIR / "manga_det_v0.2.onnx"
MANGA_DET_FP16_PATH = MODEL_DIR / "manga_det_v0.2_fp16.onnx"
COMIC_ONNX_PATH = MODEL_DIR / "comictextdetector.pt.onnx"
ANIME_LAMA_PT_PATH = MODEL_DIR / "anime-manga-big-lama.pt"
BIG_LAMA_PT_PATH = MODEL_DIR / "big-lama.pt"

MANGA_DET_URLS = [
    "https://huggingface.co/Kellenok/PP-OCRv6_manga/resolve/main/det/manga_det_v0.2.onnx",
    "https://hf-mirror.com/Kellenok/PP-OCRv6_manga/resolve/main/det/manga_det_v0.2.onnx",
    "https://huggingface.co/Kellenok/PP-OCRv6_manga/resolve/main/det/manga_det_v0.2_fp16.onnx",
    "https://hf-mirror.com/Kellenok/PP-OCRv6_manga/resolve/main/det/manga_det_v0.2_fp16.onnx",
]

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


def download_resilient(urls: List[str], dest: Path, min_mb: float = 0.5) -> bool:
    """Download a file with multiple mirror fallbacks, atomic rename, and size validation."""
    dest = Path(dest)
    min_bytes = int(min_mb * 1024 * 1024)
    if dest.is_file() and dest.stat().st_size >= min_bytes:
        logger.info("[READY] %s (%d MB)", dest.name, dest.stat().st_size // (1024 * 1024))
        return True

    # If already exists in weights/ directory, copy
    legacy_weights = BASE_DIR / "weights" / dest.name
    if not legacy_weights.is_file() and dest.name == "comictextdetector.pt.onnx":
        legacy_alt = BASE_DIR / "weights" / "comic-text-detector.onnx"
        if legacy_alt.is_file():
            legacy_weights = legacy_alt

    if legacy_weights.is_file() and legacy_weights.stat().st_size >= min_bytes:
        logger.info("[COPY] Found in weights/, copying %s -> %s", legacy_weights.name, dest)
        dest.write_bytes(legacy_weights.read_bytes())
        return True

    logger.info("Downloading %s ...", dest.name)
    tmp_path = dest.with_suffix(".tmp")
    for url in urls:
        try:
            logger.info("  -> Attempting source: %s", url)
            req = urllib.request.Request(url, headers={"User-Agent": "MangaCleaner/1.0"})
            with urllib.request.urlopen(req, timeout=90) as resp, open(tmp_path, "wb") as out_f:
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    out_f.write(chunk)
            if tmp_path.is_file() and tmp_path.stat().st_size >= min_bytes:
                if dest.is_file():
                    dest.unlink()
                tmp_path.rename(dest)
                logger.info("[SUCCESS] %s downloaded (%d MB)", dest.name, dest.stat().st_size // (1024 * 1024))
                return True
        except Exception as exc:
            logger.warning("  Mirror warning (%s): %s", url, exc)
            if tmp_path.is_file():
                try:
                    tmp_path.unlink()
                except Exception:
                    pass

    return False


def prefetch_bubble_detector() -> bool:
    """Warm the HF cache with ogkalu/comic-text-and-bubble-detector (RT-DETR-v2, Chat vs SFX regions)."""
    repo = os.getenv("BUBBLE_DETECTOR_REPO", "ogkalu/comic-text-and-bubble-detector")
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(repo_id=repo, allow_patterns=["*.json", "*.safetensors"])
        logger.info("[READY] bubble detector cached: %s", repo)
        return True
    except Exception as exc:
        logger.warning("Could not prefetch %s (will retry lazily at runtime): %s", repo, exc)
        return False


def ensure_manga_det() -> bool:
    """Ensure fast MangaTextDetector model is available."""
    if MANGA_DET_FP32_PATH.is_file() and MANGA_DET_FP32_PATH.stat().st_size >= 1_000_000:
        return True
    if MANGA_DET_FP16_PATH.is_file() and MANGA_DET_FP16_PATH.stat().st_size >= 500_000:
        return True
    ok = download_resilient(MANGA_DET_URLS[:2], MANGA_DET_FP32_PATH, min_mb=1.0)
    if not ok:
        ok = download_resilient(MANGA_DET_URLS[2:], MANGA_DET_FP16_PATH, min_mb=0.5)
    return ok


def ensure_inpainter(model_name: str = "anime-lama") -> bool:
    """Ensure specific inpainting model is available."""
    canonical = "big-lama" if "big" in model_name.lower() and "anime" not in model_name.lower() else "anime-lama"
    if canonical == "big-lama":
        return download_resilient(BIG_LAMA_URLS, BIG_LAMA_PT_PATH, min_mb=50)
    return download_resilient(ANIME_LAMA_URLS, ANIME_LAMA_PT_PATH, min_mb=50)


def ensure_models() -> bool:
    """Ensure primary text detector and inpainter models are downloaded."""
    m_ok = ensure_manga_det()
    l_ok = download_resilient(ANIME_LAMA_URLS, ANIME_LAMA_PT_PATH, min_mb=50)
    return m_ok and l_ok


if __name__ == "__main__":
    success = ensure_models()
    prefetch_bubble_detector()
    if not success:
        logger.error("Failed to download one or more models.")
        sys.exit(1)
    logger.info("All models ready.")
