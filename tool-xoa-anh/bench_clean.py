#!/usr/bin/env python3
"""
bench_clean.py  –  CPU benchmark for manga_cleaner.clean_image

Runs examples/sample1.jpg, sample2.jpg, and a synthetic vertical webtoon
strip (sample1+sample2 stacked) through the pipeline 5 times each on CPU.
Prints a median/p95 table broken down by pipeline stage.

Usage:
    cd tool-xoa-anh
    python bench_clean.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from statistics import median

import numpy as np
from PIL import Image

# Ensure this script can import manga_cleaner from the same directory
sys.path.insert(0, str(Path(__file__).resolve().parent))

from manga_cleaner import MangaCleanerPipeline

EXAMPLES_DIR = Path(__file__).resolve().parent / "examples"
RUNS = 5


def percentile(vals: list[float], pct: float) -> float:
    """Simple percentile (nearest-rank) without scipy."""
    if not vals:
        return 0.0
    s = sorted(vals)
    k = int(len(s) * pct / 100.0)
    return s[min(k, len(s) - 1)]


def make_webtoon_strip() -> Image.Image:
    """Stack sample1+sample2 vertically to simulate a webtoon long strip."""
    s1 = Image.open(EXAMPLES_DIR / "sample1.jpg").convert("RGB")
    s2 = Image.open(EXAMPLES_DIR / "sample2.jpg").convert("RGB")
    w = max(s1.width, s2.width)
    h = s1.height + s2.height
    strip = Image.new("RGB", (w, h), (255, 255, 255))
    strip.paste(s1, (0, 0))
    strip.paste(s2, (0, s1.height))
    return strip


def bench_image(pipeline: MangaCleanerPipeline, img: Image.Image, label: str) -> dict:
    """Run pipeline RUNS times and collect per-stage timings."""
    all_timings: dict[str, list[float]] = {}

    for i in range(RUNS):
        print(f"  {label}: run {i + 1}/{RUNS} ...", end=" ", flush=True)
        t0 = time.perf_counter()
        _cleaned, _mask, stats = pipeline.clean_image(
            image_input=img,
            clean_sfx=False,
            dilation_px=4,
            det_threshold=0.30,
            force_cpu=True,
            inpaint_model="anime-lama",
        )
        wall = (time.perf_counter() - t0) * 1000.0
        print(f"{wall:.0f} ms")

        timings = stats.get("timings_ms", {})
        for key, val in timings.items():
            if isinstance(val, (int, float)):
                all_timings.setdefault(key, []).append(float(val))

    result = {}
    for key, vals in all_timings.items():
        result[key] = {
            "median": round(median(vals), 1),
            "p95": round(percentile(vals, 95), 1),
        }
    return result


def print_table(results: dict[str, dict]):
    """Print a readable markdown-style table."""
    # Collect all stage keys across all images
    all_keys: list[str] = []
    for res in results.values():
        for k in res:
            if k not in all_keys:
                all_keys.append(k)

    # Header
    header = f"| {'Stage':<16} |"
    sep = f"|{'-' * 18}|"
    for label in results:
        header += f" {label:>20} (med/p95) |"
        sep += f"{'-' * 31}|"

    print("\n" + header)
    print(sep)

    for key in all_keys:
        row = f"| {key:<16} |"
        for label in results:
            entry = results[label].get(key)
            if entry:
                row += f" {entry['median']:>10.1f} / {entry['p95']:>8.1f} ms |"
            else:
                row += f" {'—':>10} / {'—':>8}    |"
        print(row)

    print()


def main():
    s1_path = EXAMPLES_DIR / "sample1.jpg"
    s2_path = EXAMPLES_DIR / "sample2.jpg"

    if not s1_path.is_file() or not s2_path.is_file():
        print(f"ERROR: Need {s1_path} and {s2_path}")
        sys.exit(1)

    print("Loading pipeline (first load includes model init)...")
    pipeline = MangaCleanerPipeline()
    if not pipeline.ready:
        print("WARNING: Pipeline not fully ready (models may be missing). Running anyway.")

    images = {
        "sample1": Image.open(s1_path).convert("RGB"),
        "sample2": Image.open(s2_path).convert("RGB"),
        "webtoon_strip": make_webtoon_strip(),
    }

    # Print image dimensions
    for label, img in images.items():
        print(f"  {label}: {img.width}x{img.height}")

    # Warm-up run (not counted)
    print("\nWarm-up run...")
    pipeline.clean_image(images["sample1"], force_cpu=True)

    print(f"\nBenchmarking ({RUNS} runs each, CPU only):\n")
    results = {}
    for label, img in images.items():
        results[label] = bench_image(pipeline, img, label)

    print_table(results)

    # Also output a quick summary line
    for label, res in results.items():
        total = res.get("total", {})
        print(f"  {label}: median total = {total.get('median', '?')} ms, p95 = {total.get('p95', '?')} ms")


if __name__ == "__main__":
    main()
