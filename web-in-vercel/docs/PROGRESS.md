# TIẾN ĐỘ – MangaStudio AI

## Trạng thái
| Giai đoạn | Trạng thái |
|---|---|
| 1. Gộp luồng + sửa tab/header mobile | **Xong**, đã giao `web-in-vercel-phase1.zip` + 6 ảnh chụp 390x844, chờ duyệt cuối |
| 2. UI mobile cho Batch Studio | Chưa bắt đầu |
| 3. Tách file, dọn cấu trúc, test | Chưa bắt đầu |
| 4. Chèn chữ tự động | Đề xuất, cần duyệt |
| Kiểm kê backend | Xong (`BACKEND-AUDIT.md`), chưa sửa gì |

## Giai đoạn 1: đã làm
**Trang chính (`index.html`)**
- Chỉ còn 2 tab: "Xóa chữ", "Dịch lại script". Tab `tab-translator`, `tab-batch` ẩn sau `const LEGACY_TABS = false;` (mã giữ nguyên).
- Bỏ iframe/tab Batch Studio; link header "Chương (hàng loạt)" → `/batch-studio`, cùng tab, không `target=_blank`.
- Mobile: trước 538px trên khung 360px, nay `scrollWidth == clientWidth` ở 360/390/414; thanh tab vừa khung; phụ đề ẩn <480px; tên app 1 dòng; cạnh navbar thu hẹp ≤380px.

**Batch Studio (`batch-studio/*`)**
- Bước Tẩy chữ: công tắc [Tẩy chữ] / [OCR + Dịch], nút "Tẩy chữ tất cả", nút "Tẩy chữ" + "Xem ảnh sạch" mỗi trang, nhãn "Tẩy: CHỜ/ĐANG XỬ LÝ/XONG/LỖI" (trạng thái riêng, không đụng `stage`).
- Cài đặt tẩy: model, SFX, dilation, threshold, backend URL (dùng chung `manga_backend_url`).
- 2 request đồng thời; retry tối đa 3 lần với lỗi tạm thời (mạng, 408/425/429/5xx); `/api/clean` lỗi thì gọi thẳng `…/clean_page`.
- IndexedDB v1→v2: thêm kho `cleaned`, `originals`; dữ liệu v1 giữ nguyên (test migrate). `originals` chỉ lưu khi ảnh hiển thị bị nén.
- Xuất ZIP ảnh sạch, hoặc ZIP ảnh sạch + `script.txt` (`=== tên_file ===`). Nhập ZIP (sắp xếp tự nhiên, bỏ `__MACOSX`).
- Sửa lỗi có sẵn: modal Cài đặt cuộn được; header thẻ trang tự xuống dòng.

## Kết quả test (Chromium, mock API)
phase1_e2e 23/23 · retry/dừng/nhập ZIP 3/3 · migrate IDB đạt · main_e2e 22/22.

## Chưa kiểm tra được
Safari iOS/Chrome Android thật; deploy Vercel thật; backend HF thật (kể cả CORS khi gọi thẳng); ZIP chục trang PNG gốc trên điện thoại (RAM).

## Rollback
Git trong `web-in-vercel/.git`: `baseline` → `phase1: main page tabs/header/mobile` → `phase1: batch studio clean step, zip import/export, IDB v2, docs`. `git revert` hoặc `git checkout baseline -- .`. Lưu ý: bản v1 cũ không mở được DB v2 (xuất .txt trước khi quay về).

## Việc đang chờ quyết định
1. 4 tính năng tab cũ chưa có (bản đồ #1/#2, refine, LLM khác Gemini, OCR manga-ocr/PaddleOCR): bỏ có chủ đích hay bổ sung?
2. Thu hồi token Hugging Face lộ trong `tool-xoa-anh/PROJECT_CONTEXT_AND_ISSUES.md` (dòng 100).
3. Có cho phép sửa backend `tool-xoa-anh/` không (dọn file thừa, CORS, trả tọa độ)?
4. Có làm Giai đoạn 4 không?
