# Chapter workspace (Batch Studio) – đối chiếu tính năng tab cũ

Từ Giai đoạn 1, `/batch-studio` là nơi duy nhất để dịch. Trang chính chỉ còn 2 tab: **Xóa chữ** và **Dịch lại script**.
Hai tab cũ (`tab-translator`, `tab-batch`) được ẩn bằng `const LEGACY_TABS = false;` trong `index.html` (đổi thành `true` để hiện lại). Mã cũ chưa bị xóa.

## tab-translator (dịch 1 trang) → Batch Studio với 1 ảnh

| Tính năng tab cũ | Trạng thái ở Chapter workspace |
|---|---|
| Tải 1 ảnh, xem trước, xóa | Có: thêm 1 ảnh vào danh sách, nút ✕ xóa trang |
| Chế độ Nhanh / Pro (OCR riêng + dịch riêng) | Có tương đương: nút OCR / Translate / OCR + Dịch trên từng trang |
| Chỉ lấy bóng thoại (chat-only) | Có tương đương: công tắc Skip SFX |
| Thứ tự đọc Manga / Webtoon | Có |
| Ngôn ngữ đích | Có (VI / EN) |
| Bản đồ số #1, #2 vẽ trên ảnh + hover đồng bộ với bảng | **CHƯA CÓ**: Gemini ở Batch Studio không trả tọa độ khung |
| Bảng đối chiếu từng bóng thoại | Thay bằng 2 ô sửa tay OCR / bản dịch theo dòng |
| Refine (dịch/OCR lại theo yêu cầu) | **CHƯA CÓ** |
| Chọn mô hình dịch (MiniMax, Qwen, DeepSeek, GLM, Kimi, Gemini 2.5) | **CHƯA CÓ**: Batch Studio chỉ dùng Gemini 3.1 / 3.5 flash-lite |
| Chọn bộ OCR manga-ocr / PaddleOCR (Hàn, Trung, Anh) | **CHƯA CÓ**: Batch Studio chỉ OCR tiếng Nhật qua Gemini |
| Copy script / tải script .txt | Có (.txt, .doc, copy, xem trước) |

## tab-batch (ZIP)

| Tính năng tab cũ | Trạng thái |
|---|---|
| Nhập ZIP chứa cả chapter | Có (mới): chọn hoặc kéo thả .zip, ảnh sắp xếp tự nhiên, bỏ `__MACOSX` và file không phải ảnh |
| Batch tẩy chữ (mô hình, SFX) | Có: bước Tẩy chữ (model, SFX, dilation, threshold, backend) |
| Batch dịch + xuất script | Có |
| Tải ZIP kết quả | Có: ZIP ảnh sạch, hoặc ZIP ảnh sạch + `script.txt` |
| Bảng kết quả từng trang | Có: nhãn trạng thái riêng cho Tẩy và OCR/Dịch trên từng trang |
| Chọn mô hình LLM kiểu DeepSeek | **CHƯA CÓ** (như trên) |

Các mục **CHƯA CÓ** cần bạn quyết định: bỏ có chủ đích, hay bổ sung ở giai đoạn sau.

## File legacy (không xóa)

Chỉ ghi chú, chưa xóa. Nơi UI còn gọi:

- `api/vision.js`, `api/ocr.js`, `api/translate.js`: chỉ tab-translator (đang ẩn) gọi.
- `api/batch-zip.js`: chỉ tab-batch (đang ẩn) gọi.
- `api/clean.js`: còn dùng (tab Xóa chữ và bước Tẩy chữ của Batch Studio).
- `api/process-batch.js`, `api/translate-text.js`, `api/batch-helper.js`: Batch Studio.

## Rollback

Toàn bộ thay đổi Giai đoạn 1 nằm trong git của thư mục làm việc: `git revert` các commit `phase1:*`, hoặc khôi phục `index.html`, `batch-studio/*`. Dữ liệu IndexedDB v2 tương thích ngược: bản cũ (v1) mở DB v2 sẽ báo lỗi phiên bản, nên cần xóa DB `manga_studio_batch` nếu quay về bản cũ (ảnh và bản dịch trong đó sẽ mất, hãy xuất .txt trước).
