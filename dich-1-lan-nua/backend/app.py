"""Comic Translation Studio — Hugging Face Gradio Space entrypoint.

The Space is served by uvicorn directly so the FastAPI routes (``/api/v1/*``,
``/``) own the root path; the Gradio UI is mounted at ``/gradio``.

Why not "Gradio owns /"?  With ``demo.launch()`` Gradio registers a catch-all
route that swallows ``/api/v1/*`` unless the API routes are moved in front of
it, and Gradio 5.20's ``get_api_info()`` crashes on ``File`` components that use
``type="binary"``. Mounting Gradio as a sub-app of FastAPI avoids both.

Run locally: ``python app.py`` → http://127.0.0.1:7860
"""

import io
import os
import sys
import threading
from pathlib import Path

os.environ.setdefault("PYTHONUNBUFFERED", "1")
try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass


def _log(message: str) -> None:
    print(f"[boot] {message}", flush=True)


try:
    import spaces  # noqa: F401  (ZeroGPU wants this imported before torch)
    _HAS_SPACES = True
except Exception:
    spaces = None
    _HAS_SPACES = False

import gradio as gr
import gradio.routes as _gr_routes
from PIL import Image

# Gradio 5.20's GET / builds the public API schema and crashes on some
# component schemas ("TypeError: argument of type 'bool' is not iterable"),
# which turns the page into a 500 and keeps the Space unhealthy.  We do not use
# the gradio_client bridge, so an empty schema is enough.  Patching the method
# (not the route function) is what actually takes effect, because /info was
# already bound to the original function at import time.
_EMPTY_API_INFO = {"named_endpoints": {}, "unnamed_endpoints": {}}
gr.Blocks.get_api_info = lambda self, *a, **k: _EMPTY_API_INFO
_gr_routes.api_info = lambda request=None: _EMPTY_API_INFO

from app.services.batch_erase import (
    ENGINE_CHOICES,
    erase_page,
    erase_zip,
    summary_markdown,
)
from app.services.inpainting import lama_engine

_log("imports ok")

OUTPUT_DIR = Path.cwd() / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)


if _HAS_SPACES:

    @spaces.GPU(duration=60)
    def _gpu_warmup(x=0):
        """ZeroGPU requires at least one registered GPU function."""
        return int(x) + 1

    @spaces.GPU(duration=60)
    def _gpu_batch_inpaint(payload):
        """Inpaint every crop of a page in a single ZeroGPU call.

        ``payload`` is ``[(crop_rgb, crop_mask, max_side), ...]``.  The model is
        loaded into VRAM on first use and reused for the rest of the container
        lifetime, so only the first page pays the load cost.
        """

        model = lama_engine._get_model("cuda")
        if model is None:
            raise RuntimeError("LaMa model unavailable on GPU")
        results = []
        for crop_rgb, crop_mask, max_side in payload:
            padded_rgb, padded_mask, scale, size = lama_engine._prepare(
                crop_rgb, crop_mask, max_side
            )
            raw = lama_engine._forward(model, padded_rgb, padded_mask, "cuda")
            results.append(lama_engine._finish(raw, size, scale))
        return results

    lama_engine.set_batch_backend(_gpu_batch_inpaint)


def _download_model() -> None:
    if not (os.getenv("SPACE_ID") or os.getenv("LAMA_AUTO_DOWNLOAD") == "1"):
        return
    if lama_engine.is_available():
        return
    try:
        _log("downloading LaMa-Manga checkpoint…")
        lama_engine.ensure_model(download=True)
        _log(f"LaMa state: {lama_engine.status()}")
    except Exception as exc:
        _log(f"LaMa download failed: {exc}")


def model_status() -> str:
    state = lama_engine.status()
    if not state["torch_available"]:
        return "🔴 Không có torch — chỉ dùng được `flat` / `texture`."
    if not state["model_present"]:
        return "🟡 LaMa-Manga: đang tải model (~196 MB) — chờ vài chục giây…"
    backend = "GPU (ZeroGPU)" if state["batch_backend"] == "custom" else state["device"].upper()
    return f"🟢 LaMa-Manga sẵn sàng · {backend}"


def _pil_to_png_bytes(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="PNG", compress_level=1)
    return buf.getvalue()


def on_erase_image(image: Image.Image, engine: str, reading: str, dilation: int):
    if image is None:
        return None, None, "⚠️ Hãy tải ảnh lên trước."
    direction = "rtl" if str(reading).startswith("Manga") else "ltr"
    page = erase_page(_pil_to_png_bytes(image), engine, direction, int(dilation))
    if page.status == "error":
        return None, None, f"❌ {page.error}"
    if page.status == "no_text":
        return image, None, "➖ Không tìm thấy chữ — ảnh giữ nguyên."
    out = Image.open(io.BytesIO(page.data)).convert("RGB")
    path = OUTPUT_DIR / "cleaned.png"
    path.write_bytes(page.data)
    return (
        out,
        str(path),
        f"✅ **{page.regions}** vùng chữ · engine `{page.engine}` · "
        f"{page.elapsed_ms / 1000:.1f}s",
    )


def on_erase_zip(
    file_path: str, engine: str, reading: str, dilation: int, progress=gr.Progress()
):
    if not file_path:
        return None, "⚠️ Hãy tải file .zip lên trước."
    data = Path(file_path).read_bytes()
    direction = "rtl" if str(reading).startswith("Manga") else "ltr"

    def report(done: int, total: int, name: str) -> None:
        progress(
            (done + 1) / max(total, 1),
            desc=f"{min(done + 1, total)}/{total} {name}".strip(),
        )

    try:
        out, results = erase_zip(
            bytes(data), engine, direction, int(dilation), progress=report
        )
    except Exception as exc:
        return None, f"❌ {exc}"
    path = OUTPUT_DIR / "cleaned.zip"
    path.write_bytes(out)
    return str(path), summary_markdown(results)


def create_ui() -> gr.Blocks:
    with gr.Blocks(title="Manga Text Cleaner", theme=gr.themes.Soft()) as demo:
        gr.Markdown(
            """
            # 🧽 Manga Text Cleaner

            Xoá chữ khỏi trang manga / webtoon. Bong bóng trắng được fill đúng
            màu nền, bong bóng trong suốt hoặc có hoa văn được LaMa-Manga vẽ lại.
            """
        )
        with gr.Tab("🖼 Ảnh lẻ"):
            image_in = gr.Image(type="pil", label="Ảnh manga / webtoon")
            with gr.Row():
                engine_img = gr.Dropdown(
                    ENGINE_CHOICES, value="auto", label="Engine",
                    info="auto = fill phẳng + LaMa cho vùng có hoa văn",
                )
                reading_img = gr.Radio(
                    ["Manga (RTL)", "Webtoon (LTR)"], value="Manga (RTL)",
                    label="Thứ tự đọc",
                )
                dilation_img = gr.Slider(0, 10, value=5, step=1, label="Nới mask (px)")
            btn_img = gr.Button("Xoá chữ", variant="primary")
            with gr.Row():
                image_out = gr.Image(type="pil", label="Sau khi xoá", interactive=False)
                file_out = gr.File(label="Tải PNG")
            log_img = gr.Markdown("")

        with gr.Tab("📦 Cả file ZIP"):
            zip_in = gr.File(label="File .zip chứa ảnh", file_types=[".zip"])
            with gr.Row():
                engine_zip = gr.Dropdown(ENGINE_CHOICES, value="auto", label="Engine")
                reading_zip = gr.Radio(
                    ["Manga (RTL)", "Webtoon (LTR)"], value="Manga (RTL)",
                    label="Thứ tự đọc",
                )
                dilation_zip = gr.Slider(0, 10, value=5, step=1, label="Nới mask (px)")
            btn_zip = gr.Button("Xoá chữ cho cả ZIP", variant="primary")
            zip_out = gr.File(label="Tải ZIP kết quả")
            log_zip = gr.Markdown("")

        status_md = gr.Markdown(model_status())
        gr.Markdown("REST API: `/api/v1/erase-page`, `/api/v1/erase-zip`, `/docs`")

        btn_img.click(
            on_erase_image,
            inputs=[image_in, engine_img, reading_img, dilation_img],
            outputs=[image_out, file_out, log_img],
        )
        btn_zip.click(
            on_erase_zip,
            inputs=[zip_in, engine_zip, reading_zip, dilation_zip],
            outputs=[zip_out, log_zip],
        )
        demo.load(model_status, outputs=status_md)
        demo.queue(max_size=16, default_concurrency_limit=1)
    return demo


demo = create_ui()

if __name__ == "__main__":
    port = int(os.getenv("APP_PORT", "7860"))
    _log(f"lama before download: {lama_engine.status()}")
    threading.Thread(target=_download_model, name="lama-download", daemon=True).start()
    _log(f"launching Gradio on {port}")

    # ZeroGPU only accepts an app started through demo.launch(): it scans for
    # the @spaces.GPU functions at that moment.  The Gradio app owns the port,
    # and the UI calls the erase pipeline in-process.
    app, _local_url, _share_url = demo.launch(
        server_name="0.0.0.0",
        server_port=port,
        prevent_thread_lock=True,
        show_error=True,
    )
    _log("gradio launched")

    print(f"Web UI: http://0.0.0.0:{port}/", flush=True)
    demo.block_thread()
