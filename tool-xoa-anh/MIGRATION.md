# Manga Cleaner v2 — Phương án dứt điểm

## 1. Quyết định

**Chọn Hướng 1 (dual model), nhưng dùng 1 model detector duy nhất đã có sẵn nhãn Chat/SFX**:
`ogkalu/comic-text-and-bubble-detector` (RT-DETR-v2, Apache-2.0, ~43M params, train 640px trên ~11k trang manga/webtoon/manhua/comic).

| class | ý nghĩa | dùng làm |
|---|---|---|
| 0 `bubble` | viền bóng thoại rỗng | bỏ qua |
| 1 `text_bubble` | chữ trong bóng thoại | **Chat** |
| 2 `text_free` | chữ ngoài bóng thoại | **SFX / narration** |

`comic-text-detector` chỉ còn giữ **nhánh `seg`** (nét chữ pixel-level). Bỏ hẳn nhánh `blk` (YOLO) và `det` (DBNet).

Không chọn OCR script-gate (Hướng 2): chậm hơn, cần thêm model, và `HUH!?` hay chữ SFX tiếng Anh sẽ bị phân loại sai theo "độ dài chuỗi".

## 2. Vì sao 4 vấn đề cũ biến mất (không còn threshold chắp vá)

| Vấn đề | Cách xử lý ở v2 |
|---|---|
| 1. Chat vs SFX | Do **class của detector** quyết định, không dùng màu nền / raycast nữa. |
| 2. Lem viền bóng | `protected_ink()`: thành phần liên thông mực đen lớn mà phần lớn **không phải** nét chữ = viền/line-art → barrier. Mask dilation bị cắt bởi barrier; nét chữ vẫn luôn bị xóa. |
| 3. Screentone/speedlines | `seg` chỉ được tính **bên trong box của detector** → ngoài box không bao giờ thành mask. |
| 4. Chắp vá | Chỉ còn 3 tham số có nghĩa: `bubble_threshold` (0.30), `seg_thr` (=`det_threshold`), `dilation_px`. |

Thêm 2 cải tiến:
- **flat-fill**: nếu giấy quanh chữ là một màu phẳng (bóng trắng điển hình) → tô thẳng màu median, **không gọi LaMa** (tức thì, không artifact). Bóng có tone/gradient tự rơi về LaMa.
- **Tile webtoon**: ảnh cao h/w > 2 được cắt tile 1.5×w rồi NMS (model train trên webtoon đã tách dọc).

## 3. Bug tìm thấy trong code cũ (đọc từ `manga_cleaner.py` / `app.py`)

1. **Giải mã box YOLO có vẻ bị hoán vị**: `cy, cx, bh, bw = row[0], row[1], row[2], row[3]`. Format YOLOv5 chuẩn là `cx, cy, w, h` (64512 = 3×(128²+64²+32²) khớp head chuẩn). Nếu đúng, box bị lật chéo → `seg` bị cắt sai chỗ → lý do Color Mask lộn xộn và "ghost text" còn sót. Mình **chưa chạy được model thật** nên coi đây là nghi vấn mạnh, nhưng ở v2 đoạn này bị loại bỏ nên không còn ảnh hưởng.
2. `conf = row[4]` chỉ là objectness, chưa nhân class prob.
3. **Tab Brush Editor bỏ qua mask**: `on_brush_clean` chỉ kiểm tra `mask_pil is None` rồi chạy clean *toàn trang* với `clean_sfx=True`. Đã sửa: truyền `user_mask=mask_pil`, pipeline v2 inpaint đúng vùng quẹt.
4. Token Hugging Face dán trong báo cáo (`hf_…`) đã bị lộ trong chat → **vào huggingface.co/settings/tokens, revoke và tạo token mới**. Đừng đưa token vào file báo cáo; dùng biến môi trường / Space secret `HF_TOKEN`.

## 4. File thay đổi

| File | Trạng thái |
|---|---|
| `mask_logic.py` | **MỚI** — toàn bộ logic mask thuần numpy (test được, không cần model) |
| `bubble_detector.py` | **MỚI** — wrapper RT-DETR-v2 (transformers), CPU/ZeroGPU, tile webtoon |
| `manga_cleaner.py` | **VIẾT LẠI** — API `clean_image(...)` giữ nguyên + thêm `user_mask`, `bubble_threshold` |
| `app.py` | Sửa 1 chỗ (brush truyền `user_mask`) |
| `requirements.txt` | Thêm `transformers>=4.50.0` |
| `download_models.py` | Thêm `prefetch_bubble_detector()` (tùy chọn, làm nóng cache HF); `ensure_models()` giữ nguyên |
| `tests/test_mask_logic.py` | **MỚI** — regression test ảnh tổng hợp |

Tương thích ngược với `app.py`: `cleaner_pipeline.detector.ready` vẫn hoạt động, `stats` giữ các key `chat_count`, `sfx_count`, `engine`, `mode`.

## 5. Đã kiểm chứng gì / chưa kiểm chứng gì

Đã chạy (`python tests/test_mask_logic.py`) trên ảnh tổng hợp (bóng thoại viền dày + chữ + SFX + screentone, `seg` giả có false-positive trên toàn bộ chấm screentone, LaMa thay bằng `cv2.inpaint`):
- Screentone: 0 pixel bị đổi (cả 2 chế độ).
- SFX: 0 pixel bị đổi ở chế độ 1; bị xóa hết ở chế độ 2.
- Bên trong bóng thoại: sạch hoàn toàn.
- Viền: 0 pixel bị hỏng khi chữ không chạm viền. Khi chữ **đè lên** viền (ca cực đoan trong test), chỉ pixel nét chữ bị xóa + ≤9 px viền anti-alias.

**Chưa kiểm chứng** (sandbox không truy cập được huggingface.co): chạy thật `RTDetrV2ForObjectDetection` và `anime-manga-big-lama.pt` trên `sample1.jpg` / `sample2.jpg`. Việc cần làm sau khi push:
1. Log lúc khởi động phải có dòng `Bubble/text detector loaded ... ids={0: 0, 1: 1, 2: 2}`.
2. `sample1.jpg`: 2 bóng thoại → `chat_count=2`; `ガッ` → `sfx_count>=1`, màu **đỏ**, còn nguyên sau khi xóa ở chế độ 1.
3. `sample2.jpg`: bóng nổ tia chớp phải ra màu **xanh lá**; `HUH!?` + `ハッ!!` có thể ra đỏ (SFX) hoặc xanh tùy detector — đây là ca biên cần xem thực tế. Nếu `HUH!?` bị xếp sai, hạ `bubble_threshold` xuống 0.2 trước khi sửa code.
4. Nếu `text_bubble` box của model hóa ra to hơn cả bóng (bao cả viền), logic vẫn an toàn vì barrier cắt mask theo mực viền, nhưng hãy vẽ debug box lên ảnh để xác nhận.

## 6. Giới hạn còn lại (nói thẳng)

- **Xóa SFX (chế độ 2)** vẫn là bài toán khó nhất: chữ vẽ tay dính nét tranh, `seg` có thể sót nét. Chế độ mặc định (giữ SFX) thì giờ không phụ thuộc vào phần này.
- Chữ **đè lên** viền bóng thoại (hiếm) sẽ làm đứt viền tại chỗ đè.
- Bóng thoại nền tối / chữ trắng chưa được hỗ trợ (ngưỡng `ink_thr=110`, `paper_min=200`).
- Mỗi trang gọi thêm 1 lần RT-DETR (~vài chục ms trên GPU; CPU chậm hơn, nên giữ chế độ ZeroGPU).
- Nếu sau này cần polygon bóng thoại chính xác (ví dụ để dịch/đổ chữ lại), thêm 1 model segmentation bóng thoại riêng; xóa chữ thì không cần.
