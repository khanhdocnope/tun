# PROMPT CHUẨN HÓA – MangaStudio AI (dùng để giao việc cho AI/agent, tiếp tục từ Giai đoạn 2)

> Dán nguyên file này khi bắt đầu phiên mới, kèm `web-in-vercel-phase1-full.zip`. Trạng thái hiện tại: **Giai đoạn 1 xong, chờ duyệt Giai đoạn 2**.

## VAI TRÒ
Bạn là kỹ sư frontend/Node làm việc trên MangaStudio AI (Vercel + Express local). Làm tuần tự từng giai đoạn; sau mỗi giai đoạn chạy test, dừng lại, báo cáo, chờ duyệt rồi mới sang giai đoạn kế.

## PHẠM VI VÀ LUẬT CỨNG
- Chỉ sửa trong `web-in-vercel/`. Không chạm thư mục `Do-not-touch` và `tool-xoa-anh/` (backend HF) nếu chưa được cho phép bằng văn bản.
- Không xóa file hoặc tính năng khi chưa được đồng ý; mỗi giai đoạn ghi cách rollback (git commit theo giai đoạn).
- Không hardcode hay commit API key/token. Nếu thấy bí mật trong repo, báo, không chép lại.
- Nếu prompt mâu thuẫn với code thực tế: dừng lại và hỏi, không tự đoán.
- Mỗi giai đoạn báo cáo: liệt kê file đổi, ảnh chụp 390x844, kết quả test, phần chưa kiểm tra được.

## PHẢI GIỮ NGUYÊN
- `api/process-batch.js`: chế độ "all" gọi Gemini 1 lần/trang (JSON src/tgt), fallback 2 bước, temperature 0.6.
- `prevContext` (12 dòng dịch của trang trước, lùi tối đa 3 trang).
- `batch-studio/app.js`: `needsWork()`/`item.stage` (0/1/2), `flushPendingSaves` khi ẩn tab, nút Clear all gắn `clearAllBatch`.
- Prompt OCR/dịch hiện tại, tên các khóa localStorage (`manga_api_key`, `manga_llm_model`, `manga_llm_base_url`, `manga_backend_url`, `manga_model`, `manga_api_key_2`, `manga_tone`, `manga_reading_order`, `manga_skip_sfx`, `manga_zoom_val`; khóa mới từ GĐ1: `manga_step_clean`, `manga_step_translate`, `manga_clean_model`, `manga_clean_sfx`, `manga_clean_dilation`, `manga_clean_threshold`).
- IndexedDB `manga_studio_batch`, **hiện là version 2** với 4 kho: `pages`, `state`, `cleaned`, `originals`. Nếu đổi schema: tăng version, migrate, không xóa dữ liệu người dùng.

## ĐÃ XÁC MINH TRONG CODE (cập nhật so với prompt gốc)
- Trang Batch Studio có **4** bản trùng (không phải 3): `batch-studio/index.html`, `batch-studio.html`, `public/batch-studio.html`, `public/batch-studio/index.html`; `public/` sinh ra từ `sync-public.js` (prestart/build). Chỉ sửa bản gốc; `public/` trong repo có thể cũ.
- `batch-studio/index.html` ban đầu **không** nạp JSZip; GĐ1 đã thêm CDN + fallback `/js/jszip.min.js`.
- Batch Studio nén ảnh hiển thị về ≤1400px (WebP 0.82); ảnh gốc chỉ giữ trong kho `originals` khi ảnh bị nén. OCR/dịch luôn chạy trên ảnh hiển thị; bước Tẩy chữ dùng ảnh gốc.
- Backend HF `/clean_page` trả ảnh sạch **PNG** (data URL), nên tên file trong ZIP giữ phần tên gốc, đổi đuôi `.png`.
- `/api/clean` (Vercel) giới hạn body ~4.5MB; ảnh lớn tự gọi thẳng `manga_backend_url + /clean_page` (cần CORS của HF cho phép — **chưa kiểm chứng**).
- Server local `server.js` có `express.static(__dirname)` nên phục vụ cả mã nguồn (`server.js`, `api/*.js`); cần vá ở GĐ3.

## GIAI ĐOẠN 1 – HOÀN THÀNH (commit `phase1:*`)
Gộp luồng, bước Tẩy chữ, xuất ZIP, nhập ZIP, ẩn tab cũ sau `LEGACY_TABS=false`, sửa header/tab mobile, modal cuộn được. Chi tiết: `PROGRESS.md`, `web-in-vercel/MIGRATION-CHAPTER-WORKSPACE.md`.
Còn chờ quyết định của người dùng: 4 tính năng tab cũ chưa có ở Chapter workspace (bản đồ #1/#2 + bảng đối chiếu, refine, chọn LLM khác Gemini, chọn bộ OCR manga-ocr/PaddleOCR).

## GIAI ĐOẠN 2 – UI MOBILE CHO BATCH STUDIO (việc tiếp theo)
Làm trên nền GĐ1 (đã có chip bước Tẩy chữ/OCR+Dịch, nút "Tẩy chữ tất cả", nhãn "Tẩy: …" mỗi trang, menu Xuất có 2 mục ZIP, mục Tẩy chữ trong Cài đặt). Không làm mất các phần đó.
1. Thanh hành động cố định ở đáy: nút chính (khi chạy đổi thành "Dừng" + tiến độ "12/50"), dùng `env(safe-area-inset-bottom)`, nội dung có `padding-bottom` để không bị che. Nút chính chạy các bước đang bật (hàm `runSelectedSteps`).
2. Menu "Thêm" (bottom sheet): Tẩy chữ tất cả, OCR tất cả, Dịch tất cả, Tải .txt, Tải ZIP ảnh sạch, Tải ZIP ảnh sạch + script, Xuất file. "Xóa tất cả" riêng ở cuối, màu đỏ, giữ `confirm()`, không đặt sát nút dịch.
3. Thanh công cụ trên cùng tối đa 2 hàng: [Trang chủ | Nguồn→Đích | Cài đặt] và [Manga/Webtoon + SFX]; "Thêm ảnh" là nút nổi hoặc ở màn hình trống.
4. Chip tiến độ "x/N xong · y lỗi · z chưa làm" tính từ `stage`/`status` **và** `cleanStatus`; bấm để lọc (Tất cả / Chưa xong / Lỗi); nút "Nhảy tới trang chưa xong".
5. Thẻ trang thu gọn được (mặc định thu gọn khi đã xong: tên, trạng thái OCR + tẩy, dòng dịch đầu); nút "Thu gọn/Mở tất cả".
6. Chế độ "Soát bản dịch": overlay toàn màn hình, vuốt hoặc nút Trước/Sau (phím mũi tên trên desktop), ảnh trên (cuộn/zoom được; có thể chuyển giữa ảnh gốc và ảnh đã tẩy), hai ô OCR và dịch ở dưới; sửa tay cập nhật item và gọi `scheduleSave`.
7. Dọn chữ: bỏ dấu "+" thừa ở "+ + Thêm ảnh"; Việt hóa nhãn ("OCR tất cả", "Dịch tất cả", "Xóa tất cả", "Trang 1:", CHỜ / ĐANG XỬ LÝ / XONG / LỖI cho cả `badge-status`).
8. Vùng chạm tối thiểu 44px, không cuộn ngang ở 360/390/414px (`documentElement.scrollWidth <= clientWidth`).
Nghiệm thu: chạy lại bộ e2e của GĐ1 (không được vỡ) + thêm test cho từng mục trên; ảnh 390x844.

## GIAI ĐOẠN 3 – TÁCH FILE VÀ DỌN CẤU TRÚC (không đổi hành vi)
1. Tách `<style>`/`<script>` inline của `index.html` thành `public/css/main.css` và `public/js/` (`cleaner.js`, `retrans.js`, `shared.js`), giữ thứ tự nạp và fallback jszip.
2. Một nguồn duy nhất: file tĩnh đặt trực tiếp trong `public/`, bỏ `sync-public.js` và `prestart`; sửa `server.js`, `vercel.json` (rewrite `/batch-studio` và `/batch-studio/` về `batch-studio/index.html`), `package.json`. Kiểm tra `npm start` và Vercel (Root Directory = `web-in-vercel`).
   - Vá `server.js`: không `express.static(__dirname)`; chỉ phục vụ `public/`.
3. Tách `app.js` thành module (storage, api, queue, ui, export) bằng `<script type="module">`; xác nhận Safari iOS 14+ và Chrome Android (nếu không kiểm chứng được thì ghi rõ).
4. Test: node test cho `parseCombinedOutput` và `buildCombinedPrompt`; Playwright e2e chuyển bộ test GĐ1 vào repo (mock `/api/*`).

## GIAI ĐOẠN 4 (ĐỀ XUẤT, CẦN DUYỆT) – CHÈN CHỮ TỰ ĐỘNG
Mục tiêu: ZIP xuất ra là ảnh đã chèn chữ dịch, người chỉ duyệt/sửa cuối. Cần tọa độ bóng thoại theo thứ tự đọc: backend HF đã có `/api/v1/translate-page` (bbox `[ymin,xmin,ymax,xmax]`) và bộ RT-DETR (viền bóng thoại). Chỉ làm sau khi người dùng duyệt phạm vi (có thể cần sửa backend `tool-xoa-anh/`). Xem `BACKEND-AUDIT.md`.

## MÔI TRƯỜNG VÀ GIỚI HẠN KIỂM THỬ
- Chạy thử: `cd web-in-vercel && npm install && npm start` (cổng mặc định; có thể `PORT=3111`). Playwright Chromium chạy được trong sandbox; WebKit/Safari iOS, deploy Vercel thật và backend HF thật thì **không** kiểm chứng được — luôn nêu rõ trong báo cáo.
- Chặn font/CDN khi test headless (route abort `fonts.googleapis.com`, `cdnjs.cloudflare.com`) vì JSZip có fallback local.
- Bộ test GĐ1 (`phase1-e2e-tests.zip`): `phase1_e2e.py` (23 kiểm tra), `retry_stop_e2e.py` (3), `migrate_e2e.py` (migrate IDB v1→v2), `main_e2e.py` (22), `shots.py` (ảnh chụp), `mock.js` (mock API trong trang).
