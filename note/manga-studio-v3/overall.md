# Overall — Manga Studio v3 (đề xuất)

## Bối cảnh
Dự án hiện có 2 nhánh: `tool-xoa-anh` (HF Space, Gradio, Gradio UI + REST) và `dich-1-lan-nua` (FastAPI + React, OCR RapidOCR + OpenCV inpaint). Cần một **dự án mới** kết hợp cái tốt của cả hai + Vision LLM OCR.

## So sánh approaches

| Yếu tố | tool-xoa-anh (HF) | dich-1-lan-nua (FastAPI+React) | VisionBox (diem-sang) |
|---|---|---|---|
| Detection | RT-DETR (chat vs SFX) + ComicTextDetector seg | RapidOCR / contour | Vision LLM |
| Mask | Contour-preserving dilation, flat-fill bypass, white-halo snap | Rectangle box + dilation | N/A (OCR only) |
| Inpaint | LaMa (anime/big) trên crops + classical fallback | OpenCV Telea/NS | N/A |
| OCR | (qua HF API, không OCR) | RapidOCR (CPU) | Gemini Vision + reading order + bubble boundary |
| Translation | MiniMax/Qwen/DeepSeek/GLM/Kimi/Gemini | OpenRouter/OpenAI | Gemini + numbered lines + prev context |
| Offline | Model download trên HF | ONNX (rapidocr) | Không (cần API) |
| Client-side | Không | React canvas | Không |

## Recommended proposal (Manga Studio v3)

### Kiến trúc
- **Backend**: FastAPI (như dich-1-lan-nua) + REST, deploy HF Space Gradio SDK + ZeroGPU (như tool-xoa-anh) để chạy LaMa GPU.
- **Frontend**: React + TypeScript (dich-1-lan-nua) với canvas affine, dual reader, IndexedDB.
- **Pipeline xóa chữ** (tool-xoa-anh):
  1. RT-DETR detect chat vs SFX.
  2. ComicTextDetector seg → pixel mask.
  3. build_masks: contour barrier, contour-preserving dilation, white-halo snap.
  4. flat-fill bypass cho bubble giấy trắng.
  5. LaMa trên crops (ZeroGPU) + classical fallback.
  6. Trả ảnh sạch + color mask.
- **Pipeline OCR/Dịch** (VisionBox):
  1. Gemini Vision OCR với bubble boundary rule + reading order + numbered lines.
  2. Refine loop.
  3. Dịch với ảnh gốc + prev context 12 dòng.
  4. Combined call (OCR+dịch 1 request) + fallback 2 bước.
  5. Strip placeholders + cancelable retry.
- **Client-side** (typeset-studio): WebGPU ONNX detector cho offline detection box.

### Ưu điểm
- Chất lượng xóa chữ cao (LaMa + flat-fill + contour barrier).
- OCR/dịch thông minh (Vision LLM, reading order, bubble boundary).
- Offline detection box (WebGPU).
- Deploy free trên HF ZeroGPU.

### Rủi ro
- Phức tạp, nhiều model (RT-DETR, ComicTextDetector, LaMa) → download/cache.
- ZeroGPU quota (free tier giới hạn).
- Gemini API cost/rate limit.

## Câu hỏi cho user
1. Scope: chỉ làm **xóa chữ** (cleaner) hay cả **OCR+dịch** (studio đầy đủ)?
2. Frontend: dùng React canvas (dich-1-lan-nua) hay Gradio UI (tool-xoa-anh)?
3. Deploy: HF Space ZeroGPU (free, cần GPU func) hay CPU basic (chậm)?
4. Có cần client-side WebGPU detection không?
5. Bắt đầu từ module nào trước (detection/mask, inpaint, hay OCR)?