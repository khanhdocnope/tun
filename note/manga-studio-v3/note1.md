# Note 1 — Text Detection & Mask Generation (from tool-xoa-anh)

## Problem
Xóa chữ truyện tranh cần biết **chữ nằm đâu** và **chữ thuộc loại nào** (thoại trong bong bóng vs SFX vẽ tay), đồng thời **không xóa nét vẽ/bong bóng**.

## Hypothesis
Kết hợp 3 lớp:
1. **RT-DETR (ogkalu/comic-text-and-bubble-detector)** phân loại region: `bubble` (viền rỗng), `text_bubble` (thoại), `text_free` (SFX/narration). → Quyết định Chat vs SFX, không dùng heuristic màu.
2. **ComicTextDetector seg head** (ONNX) cho mask pixel-level của nét chữ (stroke).
3. **Mask logic** (mask_logic.py) xử lý deterministic:
   - Dual-gate: SFX chỉ được xóa khi user chọn "clean all", mặc định giữ SFX.
   - Contour-preserving dilation: wavefront 1px/step, chặn ngay tại barrier (viền bong bóng/nét vẽ) → dilation cao không vượt viền.
   - Snap white halo: chữ trong bubble màu có viền trắng → snap pixel sáng kết nối vào mask.
   - Flat-fill bypass: bubble giấy trắng đồng nhất → tô màu giấy ngay (instant, giữ nét viền 100%), bypass LaMa.
   - Safety gate: bubble bán trong suốt/tinted → từ chối flat-fill, fallback LaMa.

## Evidence
- `tool-xoa-anh/manga_cleaner.py` clean_image(), `_inpaint_masked()`, `_plan_crops()`
- `tool-xoa-anh/bubble_detector.py` BubbleTextDetector.detect() (tile webtoon strip)
- `tool-xoa-anh/mask_logic.py`: build_masks, extract_contour_barrier, contour_preserving_dilate, snap_white_halo, flat_fill_uniform_paper
- Tests: `tests/test_mask_logic.py`

## Risks
- Phụ thuộc model HF (RT-DETR, ComicTextDetector ONNX) cần download ~MB.
- Flat-fill có thể tô sai nếu bubble không thực sự flat (đã có safety gate).
- Contour barrier phụ thuộc threshold ink (120) — có thể cần tune cho manga scan.