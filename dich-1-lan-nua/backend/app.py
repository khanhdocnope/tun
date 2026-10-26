"""Comic Translation Studio Backend — Hugging Face Gradio Space Entrypoint.

Mounts our full FastAPI backend (/api/v1/*) alongside a Gradio status & test UI.
Runs natively on Hugging Face Spaces Free Tier (Gradio SDK, 2 vCPU, 16 GB RAM).
"""

import io
import os
import gradio as gr
try:
    import spaces
except Exception:  # spaces chỉ có trên Hugging Face ZeroGPU
    spaces = None
from PIL import Image
import numpy as np

from app.services.ocr.manager import ocr_manager
from app.services.inpainting.manager import inpainting_manager
from app.services.inpainting.mask_generator import MaskGenerator


if spaces is not None:
    @spaces.GPU(duration=15)
    def _gpu_warmup(x=0):
        """Dummy GPU function to satisfy HF ZeroGPU runtime (backend is CPU-only)."""
        return int(x) + 1


def run_quick_ocr_demo(image_input):
    """Run RapidOCR on uploaded image and return annotated text and regions."""
    if image_input is None:
        return "Please upload an image.", None

    pil_img = Image.fromarray(image_input).convert("RGB")
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    img_bytes = buf.getvalue()

    engine = ocr_manager.get_engine("rapidocr")
    regions = engine.detect_and_recognize(img_bytes, reading_direction="rtl")

    if not regions:
        return "No text regions detected on this image.", image_input

    result_text = f"Detected {len(regions)} text regions:\n\n"
    draw_img = pil_img.copy()
    from PIL import ImageDraw

    draw = ImageDraw.Draw(draw_img)

    for reg in regions:
        result_text += f"[#{reg.reading_order}] (conf: {round(reg.confidence * 100)}%): {reg.text}\n"
        b = reg.box
        draw.rectangle([b.x, b.y, b.x + b.width, b.y + b.height], outline="red", width=3)

    return result_text, np.array(draw_img)


# Build Gradio UI
with gr.Blocks(
    title="Comic Translation Studio Backend",
) as demo:
    gr.Markdown(
        """
        # 🎨 Comic Translation Studio Backend
        ### Hybrid FastAPI + Gradio Space (100% Free Tier Compatible)

        This Hugging Face Space hosts the **FastAPI REST API** utilized by the **Comic Translation Studio Web App**.
        All API routes are live and accept requests with CORS enabled.
        """
    )

    with gr.Accordion("📡 Available REST API Endpoints", open=True):
        gr.Markdown(
            """
            - `GET  /api/v1/health` — Space health and wake check.
            - `GET  /api/v1/capabilities` — Available OCR & Inpainting engines.
            - `POST /api/v1/ocr/detect` — Real RapidOCR text extraction with reading order.
            - `POST /api/v1/inpaint/process` — Telea & Navier-Stokes OpenCV inpainting.
            - `POST /api/v1/mask/generate` — Binary dilation mask generator.

            **To connect your frontend:**
            1. Copy this Space URL (e.g. `https://<your-username>-<space-name>.hf.space`).
            2. In the Comic Studio Web App, click **Server Connection** on the top toolbar.
            3. Paste the URL, click **Test**, then **Save & Connect**.
            """
        )

    with gr.Tab("🧪 Quick OCR & Inpainting Test"):
        gr.Markdown("RapidOCR test endpoint is available via `/api/v1/ocr/detect`.")


# Launch pattern theo Hugging Face Gradio SDK (tham khao tool-xoa-anh/app.py):
# - demo.launch(prevent_thread_lock=True) tra ve FastAPI app cua Gradio
# - gan router /api/v1/* vao app do (CORS da duoc Gradio xu ly cho host non-localhost)
# - block_thread() giu process song tren HF
if __name__ == "__main__":
    import os
    import threading

    from app.api.v1.router import api_v1_router

    def _warm_models() -> None:
        try:
            engine = ocr_manager.get_engine("rapidocr")
            warmup = getattr(engine, "warmup", None)
            if callable(warmup):
                warmup()
        except Exception:
            pass

    threading.Thread(target=_warm_models, name="ocr-warmup", daemon=True).start()

    port = int(os.getenv("PORT", "7860"))

    app, local_url, share_url = demo.launch(
        server_name="0.0.0.0",
        server_port=port,
        prevent_thread_lock=True,
        show_error=True,
        strict_cors=False,
        ssr_mode=False,
    )

    # Gan toan bo REST API (/api/v1/*) vao FastAPI app cua Gradio
    app.include_router(api_v1_router)

    print(f"Gradio Web UI : http://0.0.0.0:{port}/")
    print(f"REST API      : http://0.0.0.0:{port}/api/v1/health")

    demo.block_thread()
