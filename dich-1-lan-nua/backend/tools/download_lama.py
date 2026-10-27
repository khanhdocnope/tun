"""Fetch the LaMa-Manga checkpoint used by the neural inpainting engine.

Usage (from the repository root):

    backend\\.venv\\Scripts\\python.exe backend/tools/download_lama.py
    backend\\.venv\\Scripts\\python.exe backend/tools/download_lama.py --status

The checkpoint (~196 MB) is the TorchScript export of the anime/manga
fine-tune of Big-LaMa, the same weights IOPaint ships as its manga model.
It is stored under ``backend/models/`` and is git-ignored.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--status", action="store_true", help="Only report availability"
    )
    args = parser.parse_args()

    from app.services.inpainting import lama_engine

    if args.status:
        for key, value in lama_engine.status().items():
            print(f"{key:15s} {value}")
        return 0 if lama_engine.is_available() else 1

    if not lama_engine.TORCH_AVAILABLE:
        print(
            "torch is not installed. Install the CPU build first:\n"
            "  backend\\.venv\\Scripts\\python.exe -m pip install torch "
            "--index-url https://download.pytorch.org/whl/cpu"
        )
        return 2

    path = lama_engine.ensure_model(download=True)
    if path is None:
        print(f"download failed: {lama_engine.status()['last_error']}")
        return 1
    size_mb = path.stat().st_size / (1024 * 1024)
    print(f"checkpoint ready: {path} ({size_mb:.0f} MB)")
    print("restart the backend to register the 'lama' engine.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
