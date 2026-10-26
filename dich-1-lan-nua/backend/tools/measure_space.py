"""Measure a deployed Comic Studio backend end-to-end.

Usage:
    python backend/tools/measure_space.py --base https://<space>.hf.space
    python backend/tools/measure_space.py --repeat 2 --out raw-test/space-out

The script separates client-perceived time from the server-reported
processing time so upload/download overhead can be estimated.
"""

from __future__ import annotations

import argparse
import io
import json
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[2]


def _post(client: httpx.Client, url: str, **kwargs) -> tuple[httpx.Response, float]:
    started = time.perf_counter()
    response = client.post(url, **kwargs)
    return response, (time.perf_counter() - started) * 1000.0


def _get(client: httpx.Client, url: str) -> tuple[httpx.Response, float]:
    started = time.perf_counter()
    response = client.get(url)
    return response, (time.perf_counter() - started) * 1000.0


def measure_page(
    client: httpx.Client,
    base: str,
    path: Path,
    out_dir: Path,
    repeat: int,
    output_format: str = "png",
) -> dict[str, Any]:
    image = path.read_bytes()
    result: dict[str, Any] = {
        "page": path.name,
        "bytes": len(image),
    }

    # Network / proxy baseline.
    latencies = []
    for _ in range(3):
        try:
            response, ms = _get(client, f"{base}/api/v1/health")
            if response.status_code == 200:
                latencies.append(ms)
        except Exception:
            pass
    result["health_ms"] = round(statistics.median(latencies), 1) if latencies else None

    # Upload + header/raster validation only (no OCR compute).
    try:
        response, ms = _post(
            client,
            f"{base}/api/v1/upload/validate",
            files={"file": (path.name, image, "image/webp")},
        )
        result["upload_ms"] = round(ms, 1)
        result["upload_ok"] = response.status_code == 200
    except Exception as exc:
        result["upload_ms"] = None
        result["upload_error"] = str(exc)

    ocr_totals: list[float] = []
    ocr_servers: list[float] = []
    erase_totals: list[float] = []
    erase_servers: list[float] = []
    regions: list[dict[str, Any]] = []
    cleaned_bytes = 0

    for attempt in range(max(1, repeat)):
        response, total_ms = _post(
            client,
            f"{base}/api/v1/ocr/detect",
            files={"file": (path.name, image, "image/webp")},
            data={"engine": "rapidocr", "reading_order": "rtl"},
            timeout=300,
        )
        if response.status_code != 200:
            result["ocr_error"] = response.text[:300]
            break
        payload = response.json()
        regions = payload.get("regions", [])
        ocr_totals.append(total_ms)
        ocr_servers.append(float(payload.get("processing_time_ms", 0.0)))
        result["regions"] = payload.get("total_regions")
        result["engine"] = payload.get("engine")
        result["texts"] = [item.get("text", "") for item in regions]

        boxes = [
            [
                int(item["box"]["x"]),
                int(item["box"]["y"]),
                int(item["box"]["width"]),
                int(item["box"]["height"]),
            ]
            for item in regions
        ]
        if not boxes:
            continue

        response, erase_ms = _post(
            client,
            f"{base}/api/v1/erase-text-in-region",
            files={"file": (path.name, image, "image/webp")},
            data={
                "regions": json.dumps(boxes),
                "dilation": "5",
                "engine": "auto",
                "output_format": output_format,
            },
            timeout=300,
        )
        if response.status_code != 200:
            result["erase_error"] = response.text[:300]
            break
        erase_totals.append(erase_ms)
        erase_servers.append(float(response.headers.get("X-SmartErase-Elapsed-Ms", 0.0)))
        cleaned_bytes = len(response.content)
        result["erase_engine"] = response.headers.get("X-SmartErase-Engine")
        result["erase_text_boxes"] = response.headers.get("X-SmartErase-Text-Boxes")
        out_dir.mkdir(parents=True, exist_ok=True)
        suffix = {"webp": "webp", "jpeg": "jpg", "png": "png"}[output_format]
        (out_dir / f"{path.stem}_space_cleaned.{suffix}").write_bytes(
            response.content
        )

    if ocr_totals:
        result["ocr_total_ms"] = round(statistics.median(ocr_totals), 1)
        result["ocr_server_ms"] = round(statistics.median(ocr_servers), 1)
        result["ocr_overhead_ms"] = round(
            result["ocr_total_ms"] - result["ocr_server_ms"], 1
        )
    if erase_totals:
        result["erase_total_ms"] = round(statistics.median(erase_totals), 1)
        result["erase_server_ms"] = round(statistics.median(erase_servers), 1)
        result["erase_overhead_ms"] = round(
            result["erase_total_ms"] - result["erase_server_ms"], 1
        )
        result["cleaned_bytes"] = cleaned_bytes
        result["cleaned_content_type"] = response.headers.get("content-type")
        result["erase_format"] = response.headers.get("X-SmartErase-Format")
    return result


def measure_concurrency(
    base: str, path: Path, parallel: int
) -> dict[str, Any]:
    """Compare sequential vs parallel OCR requests on the same page."""

    image = path.read_bytes()

    def one() -> tuple[float, int, float]:
        started = time.perf_counter()
        with httpx.Client(timeout=300) as client:
            response = client.post(
                f"{base}/api/v1/ocr/detect",
                files={"file": (path.name, image, "image/webp")},
                data={"engine": "rapidocr", "reading_order": "rtl"},
            )
        total = (time.perf_counter() - started) * 1000.0
        server = 0.0
        if response.status_code == 200:
            server = float(response.json().get("processing_time_ms", 0.0))
        return total, response.status_code, server

    started = time.perf_counter()
    sequential = [one() for _ in range(parallel)]
    seq_wall = (time.perf_counter() - started) * 1000.0

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=parallel) as pool:
        concurrent = list(pool.map(lambda _: one(), range(parallel)))
    par_wall = (time.perf_counter() - started) * 1000.0

    return {
        "parallel": parallel,
        "sequential_wall_ms": round(seq_wall, 1),
        "parallel_wall_ms": round(par_wall, 1),
        "sequential_avg_ms": round(statistics.mean(x[0] for x in sequential), 1),
        "parallel_avg_ms": round(statistics.mean(x[0] for x in concurrent), 1),
        "statuses": [x[1] for x in sequential + concurrent],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True, help="Backend base URL")
    parser.add_argument(
        "--images",
        nargs="*",
        default=["raw-test/15.webp", "raw-test/16.webp", "raw-test/05.webp"],
    )
    parser.add_argument("--out", default="raw-test/space-out")
    parser.add_argument("--repeat", type=int, default=2)
    parser.add_argument(
        "--format",
        default="png",
        choices=["png", "webp", "jpeg"],
        help=(
            "Cleaned-image response format: png (lossless default), "
            "webp (lossless), jpeg (q98, lossy)"
        ),
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=0,
        help="Also compare sequential vs N parallel OCR calls on the first image",
    )
    args = parser.parse_args()

    base = args.base.rstrip("/")
    out_dir = ROOT / args.out
    results = []

    with httpx.Client(timeout=300) as client:
        # Wake / warm the Space before measuring.
        try:
            warm, ms = _get(client, f"{base}/api/v1/health")
            print(f"warmup health: {warm.status_code} {ms:.0f} ms")
        except Exception as exc:
            print(f"warmup failed: {exc}")

        for item in args.images:
            path = Path(item)
            if not path.is_absolute():
                path = ROOT / path
            if not path.is_file():
                print(f"skip missing {path}")
                continue
            print(f"\n=== {path.name} ===")
            data = measure_page(
                client, base, path, out_dir, args.repeat, args.format
            )
            results.append(data)
            print(json.dumps(data, ensure_ascii=False, indent=2))

    if args.concurrency and args.images:
        first = Path(args.images[0])
        if not first.is_absolute():
            first = ROOT / first
        if first.is_file():
            conc = measure_concurrency(base, first, args.concurrency)
            print("\n=== concurrency ===")
            print(json.dumps(conc, ensure_ascii=False, indent=2))
            results.append({"concurrency": conc})

    out_dir.mkdir(parents=True, exist_ok=True)
    report = out_dir / "space_benchmark.json"
    report.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nreport: {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
