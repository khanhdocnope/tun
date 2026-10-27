"""Image / ZIP erase endpoints used by the built-in web UI.

These wrap the same pipeline as /erase-text-in-region, but accept a whole page
(OCR happens server-side) or a ZIP of pages, which is what the browser UI needs.
"""

from __future__ import annotations

import io
import json
import zipfile
from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from app.core.errors import InvalidImageException
from app.services.batch_erase import (
    MAX_ZIP_BYTES,
    erase_page,
    erase_zip,
    summary_markdown,
)

router = APIRouter(tags=["Smart Erase (UI)"])


@router.post("/erase-page")
async def erase_page_endpoint(
    file: UploadFile = File(...),
    engine: str = Form("auto"),
    direction: str = Form("rtl"),
    dilation: int = Form(5),
) -> Response:
    """Erase every detected text region of one page and return a PNG."""

    data = await file.read()
    if not data:
        raise InvalidImageException("Empty upload")
    page = await run_in_threadpool(erase_page, data, engine, direction, int(dilation))
    if page.status == "error":
        raise InvalidImageException(f"Erase failed: {page.error}")

    headers = {
        "X-Erase-Status": page.status,
        "X-Erase-Engine": page.engine or engine,
        "X-Erase-Regions": str(page.regions),
        "X-Erase-Elapsed-Ms": f"{page.elapsed_ms:.0f}",
    }
    # No text found: return the original bytes untouched so the UI can say so.
    return Response(content=page.data, media_type="image/png", headers=headers)


@router.post("/erase-zip")
async def erase_zip_endpoint(
    file: UploadFile = File(...),
    engine: str = Form("auto"),
    direction: str = Form("rtl"),
    dilation: int = Form(5),
) -> Response:
    """Erase every image inside a ZIP and stream back a ZIP of cleaned pages."""

    data = await file.read()
    if not data:
        raise InvalidImageException("Empty upload")
    if len(data) > MAX_ZIP_BYTES:
        raise InvalidImageException(
            f"ZIP too large ({len(data)/1e6:.0f} MB > {MAX_ZIP_BYTES/1e6:.0f} MB)"
        )
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            archive.namelist()
    except zipfile.BadZipFile as exc:
        raise InvalidImageException("Not a valid .zip file") from exc

    try:
        out, results = await run_in_threadpool(
            erase_zip, data, engine, direction, int(dilation)
        )
    except ValueError as exc:
        raise InvalidImageException(str(exc)) from exc

    summary = summary_markdown(results)
    # HTTP headers are latin-1: strip the emoji the markdown summary uses.
    plain = summary.encode("ascii", "replace").decode("ascii")
    return Response(
        content=out,
        media_type="application/zip",
        headers={
            "X-Erase-Pages": str(len(results)),
            "X-Erase-Ok": str(sum(1 for r in results if r.status == "ok")),
            "X-Erase-Summary": json.dumps(
                [
                    {
                        "name": r.name,
                        "output": r.output_name,
                        "status": r.status,
                        "engine": r.engine,
                        "regions": r.regions,
                        "elapsed_ms": round(r.elapsed_ms),
                        "error": r.error,
                    }
                    for r in results
                ]
            ).encode("ascii", "replace").decode("ascii")[:4000],
            "X-Erase-Log": plain.replace("\n", " | ")[:2000],
        },
    )
