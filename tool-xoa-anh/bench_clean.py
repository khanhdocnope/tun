#!/usr/bin/env python3
"""
bench_clean.py  –  Performance Benchmark Suite for manga_cleaner.clean_image

Runs examples/sample1.jpg, sample2.jpg, and a synthetic vertical webtoon
strip (sample1+sample2 stacked) through the pipeline 3-5 times each.
Computes median and p95 timings per pipeline stage, and formats ready-to-copy
Markdown tables matching web-in-vercel/docs/PERF-BASELINE.md.

Can be run:
1. Standalone via CLI:
       python bench_clean.py [--runs 5] [--gpu]
2. Imported as a module in app.py for the /benchmark Web UI & API endpoint:
       from bench_clean import run_benchmark_suite, run_self_tests
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from statistics import median
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import torch
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

from mask_logic import Det, CLS_TEXT_BUBBLE, build_masks

EXAMPLES_DIR = Path(__file__).resolve().parent / "examples"


def percentile(vals: List[float], pct: float) -> float:
    """Nearest-rank percentile without scipy."""
    if not vals:
        return 0.0
    s = sorted(vals)
    k = int(len(s) * pct / 100.0)
    return s[min(k, len(s) - 1)]


def make_webtoon_strip(s1: Image.Image, s2: Image.Image) -> Image.Image:
    """Stack sample1 + sample2 vertically to simulate a webtoon long strip."""
    w = max(s1.width, s2.width)
    h = s1.height + s2.height
    strip = Image.new("RGB", (w, h), (255, 255, 255))
    strip.paste(s1, (0, 0))
    strip.paste(s2, (0, s1.height))
    return strip


def get_example_images() -> Dict[str, Image.Image]:
    """Load sample images from examples/ directory."""
    s1_path = EXAMPLES_DIR / "sample1.jpg"
    s2_path = EXAMPLES_DIR / "sample2.jpg"

    if s1_path.is_file() and s2_path.is_file():
        s1 = Image.open(s1_path).convert("RGB")
        s2 = Image.open(s2_path).convert("RGB")
    else:
        # Fallback synthetic images if examples folder missing
        s1 = Image.new("RGB", (800, 1200), (245, 245, 245))
        s2 = Image.new("RGB", (800, 1200), (250, 250, 250))

    strip = make_webtoon_strip(s1, s2)
    return {
        "sample1": s1,
        "sample2": s2,
        "webtoon_strip": strip,
    }


def bench_single_image(
    pipeline: Any,
    img: Image.Image,
    label: str,
    runs: int = 5,
    force_cpu: bool = True,
    inpaint_model: str = "anime-lama",
) -> Tuple[Dict[str, Dict[str, float]], List[Dict[str, Any]]]:
    """Run pipeline `runs` times on an image and collect stage timings."""
    all_timings: Dict[str, List[float]] = {}
    raw_runs: List[Dict[str, Any]] = []

    for i in range(runs):
        t0 = time.perf_counter()
        _cleaned, _mask, stats = pipeline.clean_image(
            image_input=img,
            clean_sfx=False,
            dilation_px=4,
            det_threshold=0.30,
            force_cpu=force_cpu,
            inpaint_model=inpaint_model,
        )
        wall_ms = (time.perf_counter() - t0) * 1000.0

        timings = stats.get("timings_ms", {})
        raw_runs.append({"run": i + 1, "wall_ms": round(wall_ms, 2), "timings": timings})

        for key, val in timings.items():
            if isinstance(val, (int, float)):
                all_timings.setdefault(key, []).append(float(val))

    stage_stats: Dict[str, Dict[str, float]] = {}
    for key, vals in all_timings.items():
        stage_stats[key] = {
            "median": round(median(vals), 1),
            "p95": round(percentile(vals, 95), 1),
        }
    return stage_stats, raw_runs


def format_cpu_markdown_table(results: Dict[str, Dict[str, Dict[str, float]]]) -> str:
    """Format results into the exact markdown table required by PERF-BASELINE.md."""
    stages = ["decode", "detect", "seg", "masks", "inpaint", "total", "regions"]

    lines = [
        "| Stage            |       sample1 (med/p95) |       sample2 (med/p95) | webtoon_strip (med/p95) |",
        "|------------------|-------------------------|-------------------------|-------------------------|",
    ]

    for stage in stages:
        row = f"| {stage:<16} |"
        for label in ["sample1", "sample2", "webtoon_strip"]:
            entry = results.get(label, {}).get(stage)
            if entry:
                if stage == "regions":
                    row += f" {entry['median']:>10.0f} / {entry['p95']:>8.0f}    |"
                else:
                    row += f" {entry['median']:>10.1f} / {entry['p95']:>8.1f} ms |"
            else:
                row += f" {'—':>10} / {'—':>8}    |"
        lines.append(row)

    # Engine row
    lines.append("| engine           |              anime-lama |              anime-lama |              anime-lama |")
    return "\n".join(lines)


def format_api_markdown_table(payloads: Dict[str, Dict[str, Any]]) -> str:
    """Round-trip numbers as an HTTP client sees them (Vercel studio -> Space /clean_page)."""
    rows = payloads.get("runs", [])
    if not rows:
        return "_(no /clean_page measurement yet)_"
    cols = ["payload_mb", "api_total_ms", "pipeline_total_ms", "detect_s", "seg_s", "inpaint_s", "device"]
    lines = [
        "| " + " | ".join(["run"] + cols) + " |",
        "|" + "|".join(["---"] * (len(cols) + 1)) + "|",
    ]
    for r in rows:
        vals = [str(r.get("run", "?"))] + [str(r.get(c, "—")) for c in cols]
        lines.append("| " + " | ".join(vals) + " |")
    lines.append("")
    lines.append(f"- status: {payloads.get('status')}, pages: {payloads.get('pages', 0)}, device: {payloads.get('device', '—')}")
    if payloads.get("error"):
        lines.append(f"- error: {payloads['error']}")
    return "\n".join(lines)


def measure_clean_page_api(
    base_url: str,
    image_paths: Optional[List[str]] = None,
    runs: int = 1,
    timeout: float = 120.0,
) -> Dict[str, Any]:
    """
    POST examples/sample1.jpg & sample2.jpg to a running backend's /clean_page and report the
    wall-clock round trip plus the split of pipeline stages. This is the number the studio sees.
    """
    import base64
    import json
    import urllib.request

    images = image_paths or [str(EXAMPLES_DIR / "sample1.jpg"), str(EXAMPLES_DIR / "sample2.jpg")]
    base = (base_url or "").rstrip("/")
    out: Dict[str, Any] = {"base_url": base, "status": "success", "pages": 0, "runs": [], "device": ""}
    n = 0
    for _ in range(max(1, runs)):
        for path in images:
            p = Path(path)
            if not p.is_file():
                continue
            src = base64.b64encode(p.read_bytes()).decode("ascii")
            payload = json.dumps({"imageBase64": src, "cleanSFX": False, "dilationPx": 4,
                                  "detThreshold": 0.20, "inpaintModel": "anime-lama"}).encode()
            req = urllib.request.Request(f"{base}/clean_page", data=payload,
                                         headers={"Content-Type": "application/json"})
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
            except Exception as exc:  # noqa: BLE001
                out["status"] = "error"
                out["error"] = f"{Path(path).name}: {type(exc).__name__}: {exc}"
                out["markdown_table"] = format_api_markdown_table(out)
                return out
            wall_ms = (time.perf_counter() - t0) * 1000.0
            n += 1
            stats = body.get("stats", {}) or {}
            tim = stats.get("timings_ms", {}) or {}
            api = stats.get("api_timings_ms", {}) or {}
            out["pages"] = n
            out["device"] = stats.get("device", out["device"])
            out["runs"].append({
                "run": n,
                "image": Path(path).name,
                "payload_mb": round(len(src) / (1024 * 1024), 2),
                "api_total_ms": api.get("total"),
                "round_trip_ms": round(wall_ms, 1),
                "pipeline_total_ms": tim.get("total"),
                "detect_s": round(tim.get("detect", 0) / 1000.0, 3),
                "seg_s": round(tim.get("seg", 0) / 1000.0, 3),
                "masks_s": round(tim.get("masks", 0) / 1000.0, 3),
                "inpaint_s": round(tim.get("inpaint", 0) / 1000.0, 3),
                "engine": stats.get("engine"),
                "device": stats.get("device"),
            })
    out["markdown_table"] = format_api_markdown_table(out)
    return out


def format_gpu_markdown_table(
    avg_total: float,
    avg_detect: float,
    avg_seg: float,
    avg_inpaint: float,
    gpu_overhead: float = 0.0,
    pages_tested: int = 10,
    model: str = "anime-lama",
    device: str = "ZeroGPU A100",
) -> str:
    """Format HF ZeroGPU summary table for PERF-BASELINE.md."""
    lines = [
        "| Metric                       | Value |",
        "|------------------------------|-------|",
        f"| Avg total_ms per page        | {avg_total:.1f} ms |",
        f"| Avg detect_ms                | {avg_detect:.1f} ms |",
        f"| Avg seg_ms                   | {avg_seg:.1f} ms |",
        f"| Avg inpaint_ms               | {avg_inpaint:.1f} ms |",
        f"| GPU allocation overhead (ms) | {gpu_overhead:.1f} ms |",
        f"| Pages tested                 | {pages_tested} |",
        f"| Model                        | {model} |",
        f"| Device                       | {device} |",
    ]
    return "\n".join(lines)


def run_benchmark_suite(
    pipeline: Any = None,
    runs: int = 5,
    force_cpu: bool = True,
    inpaint_model: str = "anime-lama",
) -> Dict[str, Any]:
    """
    Run full benchmark suite across sample1, sample2, and webtoon_strip.
    Reuses provided pipeline or instantiates a new MangaCleanerPipeline.
    """
    if pipeline is None:
        from manga_cleaner import get_pipeline
        pipeline = get_pipeline()

    images = get_example_images()

    dimensions: Dict[str, str] = {}
    for name, img in images.items():
        dimensions[name] = f"{img.width}x{img.height}"

    # Warm-up run (excluded from stats) - first call loads detectors + LaMa
    warmup_error: Optional[str] = None
    try:
        pipeline.clean_image(images["sample1"], force_cpu=force_cpu, inpaint_model=inpaint_model)
    except Exception as exc:  # noqa: BLE001
        warmup_error = f"{type(exc).__name__}: {exc}"

    results: Dict[str, Dict[str, Dict[str, float]]] = {}
    raw_details: Dict[str, List[Dict[str, Any]]] = {}
    engines: Dict[str, str] = {}
    errors: Dict[str, str] = {}

    for label, img in images.items():
        stage_stats, raw_runs = bench_single_image(
            pipeline=pipeline,
            img=img,
            label=label,
            runs=runs,
            force_cpu=force_cpu,
            inpaint_model=inpaint_model,
        )
        results[label] = stage_stats
        raw_details[label] = raw_runs

    md_table = format_cpu_markdown_table(results)

    device_name = "CPU"
    if not force_cpu:
        device_name = "ZeroGPU (Nvidia A100)" if (HAS_TORCH and torch.cuda.is_available()) else "GPU"

    return {
        "status": "success",
        "device": device_name,
        "runs": runs,
        "inpaint_model": inpaint_model,
        "dimensions": dimensions,
        "results": results,
        "raw_details": raw_details,
        "warmup_error": warmup_error,
        "markdown_table": md_table,
    }


def run_self_tests(pipeline: Any = None) -> Dict[str, Any]:
    """Run verification checks ensuring no behavioral or output regression."""
    checks = []

    # 1. build_masks deterministic
    try:
        H, W = 200, 300
        img = np.full((H, W, 3), 255, np.uint8)
        seg = np.zeros((H, W), np.float32)
        dets = [Det(CLS_TEXT_BUBBLE, 0.9, (10.0, 10.0, 80.0, 80.0))]
        m1 = build_masks(img, seg, dets, 0.3, 4)
        m2 = build_masks(img, seg, dets, 0.3, 4)
        assert np.array_equal(m1.chat_erase, m2.chat_erase)
        checks.append({"name": "build_masks deterministic", "status": "PASS"})
    except Exception as exc:
        checks.append({"name": "build_masks deterministic", "status": "FAIL", "error": str(exc)})

    # 2. Pipeline check if available
    if HAS_TORCH:
        try:
            if pipeline is None:
                from manga_cleaner import cleaner_pipeline
                pipeline = cleaner_pipeline

            blank = Image.new("RGB", (100, 100), (255, 255, 255))
            c1, m1, s1 = pipeline.clean_image(blank, force_cpu=True, inpaint_model="opencv-telea")
            c2, m2, s2 = pipeline.clean_image(blank, force_cpu=True, inpaint_model="opencv-telea")

            assert "timings_ms" in s1, "timings_ms missing"
            req_keys = {"decode", "detect", "seg", "masks", "inpaint", "total"}
            missing = req_keys - set(s1["timings_ms"].keys())
            assert not missing, f"Missing keys: {missing}"
            assert np.array_equal(np.array(c1), np.array(c2)), "Images not identical"
            checks.append({"name": "clean_image timing keys & output identity", "status": "PASS", "timings": s1["timings_ms"]})
        except Exception as exc:
            checks.append({"name": "clean_image timing keys & output identity", "status": "FAIL", "error": str(exc)})
    else:
        checks.append({"name": "clean_image pipeline tests", "status": "SKIP", "reason": "torch not installed"})

    all_passed = all(c["status"] == "PASS" for c in checks if c["status"] != "SKIP")
    return {"all_passed": all_passed, "checks": checks}


def main():
    parser = argparse.ArgumentParser(description="Performance benchmark for manga cleaner")
    parser.add_argument("--runs", type=int, default=5, help="Number of benchmark runs per image")
    parser.add_argument("--gpu", action="store_true", help="Benchmark on GPU instead of CPU")
    parser.add_argument("--test", action="store_true", help="Run self-tests and exit")
    parser.add_argument("--url", default="", help="Also measure /clean_page round trip on this backend, e.g. https://dobietdc-backe-manga-remove.hf.space")
    parser.add_argument("--url-runs", type=int, default=1, help="How many passes over the 2 sample pages to POST")
    args = parser.parse_args()

    if args.test:
        print("Running self-tests...")
        res = run_self_tests()
        for c in res["checks"]:
            print(f"[{c['status']}] {c['name']}")
        sys.exit(0 if res["all_passed"] else 1)

    if args.url:
        print(f"Measuring POST /clean_page on {args.url} ({args.url_runs} pass(es))...")
        api = measure_clean_page_api(args.url, runs=args.url_runs)
        print("\n" + api["markdown_table"] + "\n")
        if api.get("runs"):
            first = api["runs"][0]
            print(f"first page: round trip {first['round_trip_ms']} ms "
                  f"(pipeline {first['pipeline_total_ms']} ms, device {first.get('device')})\n")
        return

    print(f"Loading pipeline for benchmarking ({args.runs} runs, {'GPU' if args.gpu else 'CPU'})...")
    res = run_benchmark_suite(runs=args.runs, force_cpu=not args.gpu)
    if res.get("warmup_error"):
        print(f"warm-up error (check models): {res['warmup_error']}\n")
    print("\n" + res["markdown_table"] + "\n")


if __name__ == "__main__":
    main()
