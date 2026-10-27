# LaMa-Manga neural eraser

## Why

Flat manga bubbles can be erased exactly: the text mask is filled with the
bubble's modal colour and the result is pixel-perfect. That is what `auto` did
for most of the pages in `raw-test/`, at ~1.5 s per page.

The cases that kept losing were the other ones:

* translucent bubbles that sit on top of skin, clothing or screentone,
* coloured halos / white-stroked lettering on webtoon panels,
* patterned backgrounds where a flat patch leaves a visible rectangle.

Those are inpainting problems, not thresholding problems. Hand-tuned
normalised-convolution / directional-fill code produced washed-out patches and
text-shaped ghosts because it has no concept of "what line art looks like
here". A model trained on manga does.

## The model

[`anime-manga-big-lama.pt`](https://github.com/Sanster/models/releases/download/AnimeMangaInpainting/anime-manga-big-lama.pt)
is IOPaint's anime/manga fine-tune of Big-LaMa (FFCResNet, 18 residual blocks,
~196 MB TorchScript). The same weights are published as SafeTensors in
[`mayocream/lama-manga`](https://huggingface.co/mayocream/lama-manga), which is
what the [Koharu](https://github.com/koharu-rs/koharu) manga translator loads.

We keep the TorchScript file: it loads with `torch.jit.load` and needs no model
code, so the engine cannot drift from the architecture.

## Install (optional)

```powershell
backend\.venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
backend\.venv\Scripts\python.exe backend/tools/download_lama.py
```

Check the wiring:

```powershell
backend\.venv\Scripts\python.exe backend/tools/download_lama.py --status
# with DEBUG=true in .env the diagnostic route is exposed:
curl http://127.0.0.1:8000/api/v1/debug/lama
```

Without torch or without the checkpoint, `GET /api/v1/capabilities` does not
list `lama` and `auto` keeps using the texture-fill engine. Nothing crashes and
no request ever triggers a download.

## How inference works

`backend/app/services/inpainting/lama_engine.py`:

1. The page is never fed whole. Masked glyphs are grouped into clusters
   (connected components merged when they are closer than `margin/2`) and each
   cluster gets its own crop with `LAMA_MARGIN` (default 96 px) of context.
   That context is what lets the model continue a grid or a line of clothing.
2. Crops are downscaled so the long side is at most `LAMA_MAX_SIDE`
   (default 320), padded to a multiple of 8 with reflect borders, and fed as
   `image` (RGB, 0–1) + `mask` (0/1).
3. The output is scaled back and blended only inside the mask, feathered over
   ~2 px; every unmasked pixel stays bit-identical to the source.
4. A process-wide lock serialises forward passes: one Big-LaMa call needs
   roughly 1 GB of activations and the target machine has 8 GB of RAM.

`auto` now batches **all** textured regions into a single engine call. Calling
the engine per OCR line was 4x the work because the lines of one bubble share
the same crop (page 05: 54 s before batching, 13.6 s after).

## Measured on the dev box (Pentium G4560, 2 cores / 4 threads, 8 GB)

| page | regions | strategy | erase time |
|------|---------|----------|-----------|
| `15.webp` | 27 | all flat (`flat`) | 1.3 s |
| `05.webp` | 7 | flat + 4 textured → LaMa | 13.6 s |
| `16.webp` | 13 | flat + LaMa | 8.2 s |
| `rzZ…1280.jpg` | 2 | textured → LaMa | ~11 s (plus ~4 s first-load) |

Measured with the machine otherwise idle; running the downloader or a second
benchmark in parallel roughly doubles every number, which is why the engine
serialises forward passes. A single 300x430 crop costs 4–6 s; the FFC Fourier
blocks, not the convolutions, are the bottleneck.

Torch reports 15.8 GFLOPS of conv throughput on this CPU with 2 OpenMP
threads, and the FFC Fourier blocks are the slow part, so throughput is about
7 000 px/s. On a 4-core GPU-less laptop expect 3–5x faster; on CUDA (HF ZeroGPU)
this becomes sub-second.

## Quality notes

* White bubbles: `flat` stays the best choice — exact colour, no invention.
* Translucent bubbles: LaMa removes the glyphs cleanly and continues the
  surrounding artwork. It cannot recover what was hidden *behind* the text; if
  the bubble must look like a clean white bubble, use `flatten` (deliberately
  lossy) instead.
* Very large text blocks are downscaled to `LAMA_MAX_SIDE`; raise it for a
  sharper result at the cost of quadratic time, e.g.
  `set LAMA_MAX_SIDE=512`.

## Tuning knobs

| env | default | meaning |
|-----|---------|---------|
| `LAMA_MODEL_PATH` | `backend/models/anime-manga-big-lama.pt` | checkpoint override |
| `LAMA_MAX_SIDE` | `320` | long side sent to the network |
| `LAMA_MARGIN` | `96` | context around each text cluster |
| `LAMA_MASK_DILATE` | `3` | mask growth before inference |

## Alternatives considered

* **ONNX Runtime** — the widely used `lama_fp32.onnx` exports do not run
  correctly (the FFC FFT is decomposed into a graph that returns a white image),
  and re-exporting needs `torch.export` on a `ScriptModule`, which is not
  supported. Keeping torch avoids that whole class of breakage.
* **`lama-mpe` / generic big-lama** — no manga fine-tune, invents photorealistic
  texture over line art.
* **Diffusion inpainting (SD)** — far slower on CPU and not constrained to line
  art.
