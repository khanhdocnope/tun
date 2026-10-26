"""Local ONNX model store for the OCR pipeline.

Models are shipped in ``backend/models/ocr`` when possible.  If a model is
missing (for example after a shallow clone or a slim deployment) it is fetched
once from the upstream RapidOCR model zoo, verified against a SHA-256 digest
and cached on disk.  Downloads never happen on the hot path more than once.
"""

from __future__ import annotations

import hashlib
import logging
import os
import tempfile
import urllib.request
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[3]
MODELS_DIR = BACKEND_DIR / "models" / "ocr"

# Upstream: https://github.com/RapidAI/RapidOCR (Apache-2.0)
# Models are conversions of PaddleOCR PP-OCR models (Apache-2.0).
_MODEL_SPECS = {
    "det": {
        "filename": "ch_PP-OCRv3_det_infer.onnx",
        "url": (
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/"
            "onnx/PP-OCRv4/det/multi_PP-OCRv3_det_mobile.onnx"
        ),
        "sha256": "5582933662898cd2b4c2eae8a7e5e4fbdff84773711f29db00a1cbd185059001",
    },
    "rec": {
        "filename": "ch_PP-OCRv5_rec_mobile.onnx",
        "url": (
            "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/"
            "onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx"
        ),
        "sha256": "5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5",
    },
}

DOWNLOAD_TIMEOUT_SECONDS = int(os.getenv("OCR_MODEL_DOWNLOAD_TIMEOUT", "30"))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(url: str, target: Path) -> bool:
    if os.getenv("DISABLE_OCR_MODEL_DOWNLOAD", "").lower() in ("1", "true", "yes"):
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Optional[Path] = None
    try:
        logger.info("Downloading OCR model: %s", url)
        with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            with tempfile.NamedTemporaryFile(
                dir=str(target.parent), suffix=".part", delete=False
            ) as tmp:
                tmp_path = Path(tmp.name)
                for chunk in iter(lambda: response.read(1024 * 512), b""):
                    tmp.write(chunk)
        os.replace(tmp_path, target)
        return True
    except Exception as exc:  # pragma: no cover - network dependent
        logger.warning("Could not download OCR model %s: %s", url, exc)
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
        return False


def get_model(key: str) -> Optional[Path]:
    """Return a verified local model path, downloading it if needed.

    ``key`` is either ``"det"`` or ``"rec"``.  Returns ``None`` when the model
    is unavailable and cannot be downloaded; callers are expected to degrade
    gracefully to the model bundled with ``rapidocr-onnxruntime``.
    """

    spec = _MODEL_SPECS.get(key)
    if spec is None:
        raise KeyError(f"Unknown OCR model key: {key}")

    target = MODELS_DIR / spec["filename"]
    if target.is_file():
        # Shipped and downloaded copies are verified once.  Hashing 16 MB is
        # cheap compared to a model reload, but avoid it on every request.
        if target.stat().st_size > 1_000_000:
            return target

    if not _download(spec["url"], target):
        return None

    actual = _sha256(target)
    if actual.lower() != spec["sha256"].lower():
        logger.error("OCR model checksum mismatch for %s (got %s)", target, actual)
        try:
            target.unlink()
        except OSError:
            pass
        return None
    return target


def bundled_det_model() -> Optional[Path]:
    """Detector shipped by the installed rapidocr-onnxruntime wheel."""

    try:
        import rapidocr_onnxruntime

        candidate = (
            Path(rapidocr_onnxruntime.__file__).resolve().parent
            / "models"
            / "ch_PP-OCRv3_det_infer.onnx"
        )
        if candidate.is_file():
            return candidate
    except Exception:
        pass
    return None


def bundled_rec_model() -> Optional[Path]:
    """Recognition model shipped by the installed rapidocr-onnxruntime wheel."""

    try:
        import rapidocr_onnxruntime

        candidate = (
            Path(rapidocr_onnxruntime.__file__).resolve().parent
            / "models"
            / "ch_PP-OCRv3_rec_infer.onnx"
        )
        if candidate.is_file():
            return candidate
    except Exception:
        pass
    return None


def model_status() -> dict:
    """Small diagnostic payload used by /capabilities."""

    det = MODELS_DIR / _MODEL_SPECS["det"]["filename"]
    rec = MODELS_DIR / _MODEL_SPECS["rec"]["filename"]
    return {
        "det": det.is_file(),
        "rec": rec.is_file(),
        "det_path": str(det) if det.is_file() else None,
        "rec_path": str(rec) if rec.is_file() else None,
    }
