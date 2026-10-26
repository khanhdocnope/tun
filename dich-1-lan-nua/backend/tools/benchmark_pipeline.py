"""Benchmark and visual inspection helper for the OCR + erase pipeline.

Usage (from the repository root):

    backend\\.venv\\Scripts\\python.exe backend/tools/benchmark_pipeline.py
    backend\\.venv\\Scripts\\python.exe backend/tools/benchmark_pipeline.py raw-test/15.webp raw-test/16.webp

Outputs cleaned page previews to ``raw-test/bench-out/`` and prints per-page
timings, detected text and mask statistics.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.inpainting.smart_erase import smart_erase  # noqa: E402
from app.services.ocr.manager import ocr_manager  # noqa: E402


def run_page(path: Path, out_dir: Path, direction: str = "rtl") -> dict:
    image_bytes = path.read_bytes()
    engine = ocr_manager.get_engine("rapidocr")

    started = time.perf_counter()
    regions = engine.detect_and_recognize(image_bytes, reading_direction=direction)
    ocr_ms = (time.perf_counter() - started) * 1000.0

    boxes = [
        (int(r.box.x), int(r.box.y), int(r.box.width), int(r.box.height))
        for r in regions
    ]

    started = time.perf_counter()
    cleaned_png, stats = smart_erase(
        image_bytes, boxes, dilation=5, engine_name="auto"
    )
    erase_ms = (time.perf_counter() - started) * 1000.0

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{path.stem}_cleaned.png").write_bytes(cleaned_png)

    print(f"\n=== {path.name} ({len(image_bytes)/1024:.0f} KB) ===")
    print(
        f"OCR: {ocr_ms:7.0f} ms  regions={len(regions):2d}  "
        f"mode={getattr(engine, 'mode', '?')}"
    )
    for region in regions:
        b = region.box
        text = region.text.replace("\n", " ")
        print(
            f"  #{region.reading_order:02d} "
            f"({int(b.x):4d},{int(b.y):4d}) {int(b.width):3d}x{int(b.height):3d} "
            f"{'V' if region.direction == 'vertical' else 'H'} "
            f"{region.confidence:.2f}  {text}"
        )
    print(
        f"ERASE: {erase_ms:7.0f} ms  engine={stats.get('engine_used')}  "
        f"mask={stats.get('mask_coverage_pct')}%  "
        f"flat={stats.get('flat_regions')} textured={stats.get('textured_regions')}"
    )
    print(f"wrote {out_dir / (path.stem + '_cleaned.png')}")
    return {
        "page": path.name,
        "ocr_ms": round(ocr_ms, 1),
        "erase_ms": round(erase_ms, 1),
        "regions": len(regions),
        "erase_engine": stats.get("engine_used"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "images",
        nargs="*",
        help="Input pages (default: raw-test/*.webp)",
    )
    parser.add_argument(
        "--out",
        default="raw-test/bench-out",
        help="Directory for cleaned previews",
    )
    parser.add_argument(
        "--direction",
        default="rtl",
        choices=["rtl", "ltr"],
        help="Reading order for manga (rtl) or webtoon (ltr)",
    )
    args = parser.parse_args()

    root = BACKEND_DIR.parent
    images = (
        [Path(item) for item in args.images]
        if args.images
        else sorted((root / "raw-test").glob("*.webp"))
    )
    if not images:
        print("No input images found.")
        return 1

    out_dir = root / args.out
    summaries = [run_page(path, out_dir, args.direction) for path in images]
    print("\nSummary")
    for item in summaries:
        print(
            f"  {item['page']:12s} OCR {item['ocr_ms']:6.0f} ms  "
            f"erase {item['erase_ms']:6.0f} ms  regions={item['regions']:2d}  "
            f"engine={item['erase_engine']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
