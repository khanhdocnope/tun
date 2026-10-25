# Note 2 — Inpainting / Text Removal (from tool-xoa-anh)

## Problem
Xóa chữ phải **giữ nền/screentone/nét vẽ** xung quanh, không tạo artifact, và chạy được trên CPU free tier.

## Hypothesis
Pipeline hybrid:
1. **Plan crops**: tách mask thành các rectangle nhỏ (có context 96px), merge nếu overlap, fallback full page nếu crops > 60% diện tích. Works on 1/4 downsampled mask → rẻ cho webtoon dài.
2. **Classical fast path**: Telea/NS cho bubble giấy đơn giản.
3. **LaMa (anime-manga-big-lama / big-lama)** trên từng crop (pad modulo 32), paste-back chỉ vùng mask (pixels ngoài mask untouched).
4. **ZeroGPU**: `@spaces.GPU(duration=20)` cho LaMa, CPU fallback.
5. **Flat-fill bypass** (Note 1) trước LaMa → instant cho bubble giấy trắng.
6. **Color mask** output (xanh=Chat, đỏ=SFX) để user kiểm soát.

## Evidence
- `tool-xoa-anh/manga_cleaner.py`: `_plan_crops`, `_inpaint_crop`, `_inpaint_jobs_forward`, `_inpaint_masked`, `zero_gpu_inpaint_jobs`
- Crop context px = 96, modulo 32, FULL_PAGE_RATIO = 0.6
- Model: anime-manga-big-lama.pt (TorchScript)

## Risks
- Model file lớn (~MB), cần download/cache trên HF.
- LaMa CPU chậm (ZeroGPU cần PRO? thực tế free với ZeroGPU quota).
- Crop paste-back phải cẩn thận aliasing ở viền.