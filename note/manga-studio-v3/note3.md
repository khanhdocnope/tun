# Note 3 — OCR & Translation (from diem-sang.md / VisionBox + web-in-vercel)

## Problem
OCR truyền thống (Tesseract/Paddle) không hiểu layout manga, split/merge bubble sai, thứ tự đọc loạn. Dịch thiếu context.

## Hypothesis
Dùng **Vision LLM (Gemini)** làm OCR engine với prompt engineering:
1. **Bubble Boundary Rule**: 1 bubble = 1 dòng output, merge text wrap trong bubble, tách bubble khác.
2. **Reading order** theo loại: webtoon top→bottom left→right; manga Nhật top→bottom right→left; manga-EN 6 bước.
3. **Temperature 0.1** cho OCR (đọc chính xác), **0.6** cho dịch (sáng tạo).
4. **Numbered lines** `[1]...[N]` + parseNumberedLines robust → số dòng output = input.
5. **Refine loop**: cho AI xem lại bài làm của chính nó (proofread).
6. **Gửi ảnh gốc kèm khi dịch** + **context 12 dòng cuối trang trước** → nhất quán xưng hô.
7. **Strip placeholders**: xóa "(blank)", "(empty)" hallucination.
8. **Cancelable retry**: 429 → chờ 10s retry 6 lần, nút Stop.
9. **Combined call**: OCR + dịch trong 1 request (JSON src/tgt) → tiết kiệm 50% API call, fallback 2 bước.
10. **Cloudflare chunking**: ảnh dài → chunk có overlap, OCR song song concurrency=3, merge dòng trùng (similarity ≥0.8).

## Evidence
- `diem-sang.md` Templates 1-8
- `web-in-vercel/api/process-batch.js`, `api/batch-helper.js`
- `web-in-vercel/public/batch-studio/js/queue.js`

## Risks
- Phụ thuộc Gemini API (rate limit 15 RPM/key, dual-key xoay tua).
- Hallucination phải cleanup.
- Cost: ~258 tokens/ảnh + text.