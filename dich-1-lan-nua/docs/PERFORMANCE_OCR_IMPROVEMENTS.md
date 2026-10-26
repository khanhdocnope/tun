# Cải thiện tốc độ backend + chất lượng OCR/xóa chữ

Tài liệu này ghi lại chẩn đoán trên bộ ảnh `raw-test/` và các thay đổi đã thực hiện.

## 1. Nguyên nhân đo được

| Vấn đề | Nguyên nhân | Bằng chứng |
| --- | --- | --- |
| Xóa chữ rất chậm (14 giây/trang) | `smart_erase` gọi `RapidOCREngine()` **mới cho từng region**, mỗi lần lại load lại model ONNX | 7 region mất 14.1 s; 100% thời gian nằm ở detect/load chứ không phải inpaint |
| OCR bỏ sót gần hết bong bóng | Detector RapidOCR mặc định `limit_type=min, limit_side_len=736` — phóng to ảnh nhỏ, làm chữ manga bị mất | Trang `15.webp`: cấu hình cũ chỉ tìm được **7** box; cấu hình mới tìm **27–37** box |
| Chữ Nhật đọc sai (kana thành kanji) | Model recognition mặc định là `ch_PP-OCRv3` (từ điển tiếng Trung), không có kana; chữ dọc lại được đưa thẳng vào model ngang | `何加用加？` thay vì `何か用か？`; `私の連` thiếu ký tự |
| Ảnh sau khi xóa bị bóng mờ (ghost) | Mask chỉ phủ nét chữ, không phủ viền anti-alias; Telea kéo các pixel xám còn lại vào vùng trắng | `test_cleaned_bubble.png`: còn bóng chữ mờ |
| Lần xóa đầu tiên treo rất lâu | Engine mặc định `lama` tải checkpoint ~200 MB ngay trong request; máy không có torch thì fallback Telea | `engine_used` ghi `opencv_telea` dù UI chọn LaMa |
| API bị "đơ" khi đang OCR | Các endpoint `async def` gọi inference CPU đồng bộ, chặn event loop | Health check bị chậm trong lúc OCR |
| Giải mã ảnh 2–3 lần | `validate_image_upload` decode toàn bộ ảnh, sau đó OCR/inpaint decode lại | Tốn thêm thời gian với webtoon dài |

## 2. Thay đổi chính

### OCR (`backend/app/services/ocr/rapidocr_engine.py`)

- Detector PP-OCR cấu hình lại: `limit_type=max`, `limit_side_len=1600`, `thresh=0.2`,
  `box_thresh=0.3`, `unclip_ratio=2.0`. Đây là thay đổi có tác động lớn nhất.
- Ảnh lớn/webtoon được chia tile 1800 px, overlap 192 px để giữ cỡ chữ đọc được.
- **Chữ dọc được xoay 90° ngược chiều kim đồng hồ** trước khi nhận dạng; kana và dấu
  câu được đọc đúng thứ tự trên → trái.
- Dùng **PP-OCRv5 multilingual rec** (16.6 MB, từ
  [RapidOCR model zoo](https://rapidai.github.io/RapidOCRDocs/main/model_list/)) thay
  cho từ điển Trung v3; model được bundle trong `backend/models/ocr/` và có cơ chế tải
  lại nếu thiếu.
- Hợp nhất các box bị detector cắt vụn, nới box bị cắt bằng thành phần ink, tách box
  chồng lấn để crop không dính sang cột bên cạnh.
- Gom box theo **bubble trắng** rồi mới sắp thứ tự đọc (RTL/LTR), thay vì chia dải
  `y // 120` thô.
- Lọc box nhiễu theo confidence, kích thước, ký tự Latin đơn lẻ.
- Cache model/session; warmup chạy nền lúc khởi động.

### Xóa chữ (`backend/app/services/inpainting/`)

- `text_mask.py`: tìm **pixel chữ thật** trong từng region:
  - ước lượng màu nền bằng màu xuất hiện nhiều nhất (mode),
  - tách vùng interior của bubble, loại viền/đường panel,
  - giữ component giống glyph, bỏ nhiễu/screentone,
  - dilation có giới hạn bởi interior.
- Nếu region nằm trong một bubble kín, mask được **mở rộng ra toàn bubble**. Nhờ vậy
  các dòng OCR bỏ sót vẫn bị xóa (ví dụ bubble `どうしたら いいのー！？` ở trang 15).
- `smart_erase.py`: bubble phẳng được **fill đúng màu nền** thay vì Telea → không còn
  ghost, nhanh hơn nhiều. Vùng có screentone/gradient mới dùng Telea/NS (hoặc LaMa nếu
  đã có sẵn model).
- Không còn load OCR trong đường xóa; không tải LaMa ngầm.
- Encode PNG `compress_level=1` thay cho `optimize=True`.

### API

- OCR/erase/inpaint chạy trong `run_in_threadpool` → health check và request khác không
  bị chặn.
- `/erase-text-in-region` mặc định `engine=auto`, `dilation=5`; có thêm header
  `X-SmartErase-Flat-Regions`, `X-SmartErase-Textured-Regions`.
- `/inpaint/process` trả `X-Inpaint-Duration-Ms` thật.
- Bỏ decode dư ở erase/inpaint (`full_decode=False`).

### Frontend

- Mặc định `Inpaint Engine = Auto`, `maskDilation = 5`.
- Thêm lựa chọn `Auto`, `Flat fill`; LaMa còn đó nhưng là tuỳ chọn.

## 3. Kết quả đo trên máy CPU (Windows, Python 3.14)

Ảnh `raw-test/` (1075×1518), đo bằng `backend/tools/benchmark_pipeline.py`:

| Trang | OCR trước | OCR sau | Region trước | Region sau | Xóa trước | Xóa sau |
| --- | --- | --- | --- | --- | --- | --- |
| 15.webp | ~3.1 s | **2.8–5.2 s** (tuỳ tải CPU) | 7 | **27** | **14.1 s** (7 box) | **1.0–1.6 s** (27 box, mở rộng bubble) |
| 16.webp | — | **1.8–2.8 s** | — | 13 | — | **0.7–1.2 s** |
| 05.webp | — | **2.6–3.7 s** | — | 7 | — | **0.6–1.0 s** |

- Xóa 7 region trước đây: 14.1 s. Xóa 27 region bây giờ: ~1.0–1.6 s → **nhanh hơn
  khoảng 9–14×** dù số vùng gấp gần 4 lần và mask còn mở rộng ra toàn bubble.
- OCR nay trả 27 region thay vì 7; thời gian gần như không tăng vì phần lớn chi phí cũ
  là load model lặp lại và detect sai cấu hình.
- Không còn cold-start tải LaMa 200 MB; model OCR 19 MB đã nằm trong repo.

> **Đã deploy và đo thực tế trên Hugging Face free:** xem
> [HF_SPACE_BENCHMARK.md](HF_SPACE_BENCHMARK.md). Tóm tắt: OCR `15.webp`
> 21.0 s → **6.8 s** (19 → 27 box); xóa `16.webp` **67.7 s → 4.18 s**.
> Output mặc định là **PNG lossless**; có thể chọn WebP lossless (pixel-identical,
> nhỏ hơn ~46%) hoặc JPEG q98 (lossy). Chia nhỏ ảnh/tải song song **không có lợi**
> trên 2 vCPU (đã đo).
- Trang 15: các bubble trước đây bị bỏ sót hoàn toàn nay đọc được:
  `ああの……`, `通らせて`, `ひとりなんだろ?`, `姉さん達と`, `艦娘が一般の方に`,
  `怪我させたら`, `大変だし`, `行こうぜ。`...
- Chữ dọc đã đúng chiều; các lỗi còn lại chủ yếu là kana nhỏ/trợ từ
  (`ください` → `くだれい`, `はぐれちゃったー!!` → `はぐれちった`) — xem hướng tiếp theo.
- Giới hạn đã biết: bubble **trong suốt/gradient** (như bubble lớn trang 05) không thể
  fill phẳng hoàn hảo; vùng chữ được fill bằng màu nền trung bình nên có thể thấy patch
  sáng. Với loại này cần LaMa/ONNX inpaint (mục 5.2). Bubble trắng thông thường thì sạch
  hoàn toàn.

## 4. Cách chạy / chỉnh

```powershell
# Benchmark toàn bộ raw-test, xuất ảnh đã xóa ra raw-test/bench-out/
backend\.venv\Scripts\python.exe backend\tools\benchmark_pipeline.py

# Test
backend\.venv\Scripts\python.exe -m pytest -q

# Chạy backend
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Biến môi trường để tinh chỉnh trên CPU yếu:

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `OCR_DET_LIMIT_SIDE` | `1600` | Giảm còn `1280` để nhanh hơn (~15–25%), đổi lại giảm recall |
| `OCR_REC_BATCH` | `4` | Batch recognition; 4 đang nhanh nhất trên CPU 2 vCPU |
| `OCR_MAX_BOXES` | `220` | Chặn số box tối đa mỗi trang |
| `DISABLE_OCR_MODEL_DOWNLOAD` | unset | Đặt `1` để cấm tải model (offline) |

## 5. Ý tưởng tiếp theo (ưu tiên giảm dần)

1. **Quality mode với manga-ocr ONNX** ([`l0wgear/manga-ocr-2025-onnx`](https://huggingface.co/l0wgear/manga-ocr-2025-onnx),
   ~140 MB, không cần torch): đọc kana/vertical tốt hơn PP-OCR. Có thể bật cho tiếng Nhật,
   giữ PP-OCR cho webtoon/tiếng Anh. Đổi lại tốc độ ~0.5–1.5 s/bubble trên CPU.
2. **LaMa ONNX** ([`Carve/LaMa-ONNX`](https://huggingface.co/Carve/LaMa-ONNX), dùng
   onnxruntime có sẵn) cho vùng textured/translucent; chỉ dùng khi `engine=lama`,
   không tải ngầm.
3. **Bubble-level translation**: trả thêm `block_id` cho các line cùng bubble để
   frontend gộp câu trước khi dịch — cải thiện ngữ cảnh dịch đáng kể.
4. **Cache OCR theo SHA-256 ảnh** (RAM hoặc IndexedDB): bấm OCR lại hoặc undo/redo
   không phải chạy lại model.
5. **Queue + progress**: hiện đã chạy threadpool nhưng chưa có job queue; với nhiều
   trang nên chạy nền và trả job id + SSE để UI không phải chờ.
6. **INT8 quantization** cho det/rec ONNX: thường nhanh 1.5–2× trên CPU, chất lượng
   giảm không đáng kể; cần đo CER trên bộ ảnh thật trước khi bật mặc định.
7. **Benchmark có ground truth**: thêm CER (Character Error Rate) trên 20–50 bubble
   đã gán nhãn để chọn model/cấu hình bằng số liệu thay vì cảm giác.
8. **Comic-text-detector** (dmMaze, ONNX 95 MB) detect bubble tốt nhưng đo trên máy này
   mất ~11 s/ảnh 1024², chưa phù hợp free CPU; chỉ đáng dùng nếu có GPU hoặc model nhỏ
   hơn.
9. **Client-side crop**: khi user chỉ xóa 1 bubble, gửi crop thay vì cả trang; giảm
   upload và giữ nguyên toạ độ bằng offset. Backend hiện đã đủ nhanh nên lợi ích chính
   là băng thông.
10. **Font/line-break aware typesetting** sau dịch: hiện chưa có; nên dùng box bubble
    + font tiếng Việt/Nhật để tránh tràn chữ.

## 6. File thay đổi

- `backend/app/services/ocr/rapidocr_engine.py` (viết lại pipeline)
- `backend/app/services/ocr/model_store.py` (mới)
- `backend/app/services/ocr/region_text_detector.py` (dùng engine singleton)
- `backend/app/services/inpainting/text_mask.py` (mới)
- `backend/app/services/inpainting/smart_erase.py` (viết lại)
- `backend/app/services/inpainting/lama_engine.py` (không tải model ngầm)
- `backend/app/api/v1/endpoints/{ocr,smart_erase,inpaint}.py`
- `backend/app/services/image_validator.py` (tuỳ chọn full decode)
- `backend/app/main.py` (warmup nền)
- `backend/models/ocr/*.onnx` + README
- `backend/tests/test_quality_pipeline.py` (mới)
- `backend/tools/benchmark_pipeline.py` (mới)
- `frontend/src/store/useStudioStore.ts`, `services/api.ts`,
  `components/layout/{ServerSettingsModal,TopToolbar,PropertiesPanel}.tsx`
