# BỘ NGUYÊN TẮC PHÁT TRIỂN DỰ ÁN (PROJECT PHILOSOPHY & LIVING RULES)

> **DÀNH CHO AI ASSISTANT (ANTIGRAVITY):**
> Tài liệu trong `doc/` không phải là "tượng đá bất biến", mà là **Tài liệu Sống (Living Documentation)** đại diện cho kiến trúc và hiểu biết hiện tại của dự án. 
> Bộ quy tắc dưới đây được thiết kế vừa giữ vững mạch tổng thể, vừa đủ linh hoạt và thực tế khi gặp bài toán mới.

---

### NGUYÊN TẮC 1: KIM CHỈ NAM TỔNG THỂ (THE NORTH STAR)
1. **Mục tiêu cốt lõi không đổi:** Xây dựng hệ sinh thái Manga hoàn chỉnh với 2 năng lực trọng tâm:
   - **Ingestion Engine:** Thu thập dữ liệu thông minh, ổn định, tôn trọng hạ tầng máy chủ và xử lý tốt rào cản mạng (Cloudflare/WAF).
   - **Vision & Processing Pipeline:** Xử lý ảnh truyện (xóa chữ, khôi phục nền, dịch thuật) với ưu tiên tối ưu hóa tài nguyên phần cứng (CPU/RAM-friendly).
2. **Tính Module hóa:** Giữ ranh giới rõ ràng giữa tầng mạng (`src/core`, `src/api`) và tầng thị giác máy tính (`src/vision`).

---

### NGUYÊN TẮC 2: TÍNH THỰC TẾ & LINH HOẠT TRONG THỰC THI (PRAGMATIC FLEXIBILITY)
*Các thông số và giải pháp kỹ thuật là **mặc định ưu tiên (default conventions)**, không phải giáo điều cứng nhắc. Khi gặp tình huống thực tế khác biệt, AI được phép linh hoạt điều chỉnh:*

1. **Về Text Detection & Masking:**
   - *Mặc định:* Ưu tiên Polygon của RapidOCR để bám sát chữ nghiêng, chữ uốn lượn.
   - *Ngoại lệ linh hoạt:* Với những bóng thoại tròn/elip hoàn hảo hoặc văn bản căn giữa đơn giản, nếu việc tính toán polygon quá tốn CPU hoặc phát hiện thiếu nét, có thể kết hợp hoặc fallback về Bounding Box có padding hợp lý.
2. **Về Inpainting & Resize:**
   - *Mặc định:* Ưu tiên Crop Patch hoặc Resize về ~512px để LaMa chạy nhanh trên CPU.
   - *Ngoại lệ linh hoạt:* Nếu sau khi thử nghiệm thấy ảnh manga có screentone quá chi tiết bị mờ nét khi resize, hoàn toàn có thể tăng lên 768px, hoặc áp dụng sliding-window (chia ô lưới), hoặc chuyển sang mô hình khác nhẹ hơn nếu đáp ứng tốt hơn bài toán chất lượng $\leftrightarrow$ tốc độ.
3. **Về Downloader & Network:**
   - *Mặc định:* Dùng `nodriver` lấy cookie lưu file, tải ảnh bằng `requests.Session` có Semaphore.
   - *Ngoại lệ linh hoạt:* Nếu một nguồn truyện mới dùng API mở không có Cloudflare, dùng thẳng client HTTP thuần (như `httpx` / `aiohttp`) để tối đa tốc độ mà không cần nạp logic cookie phức tạp.

---

### NGUYÊN TẮC 3: QUY TẮC BẮT BUỘC VỀ "TỰ ĐỘNG CẬP NHẬT DOCS" (DOCUMENTATION EVOLUTION)
*Mỗi khi có sự điều chỉnh, cải tiến hoặc thêm tính năng mới, AI PHẢI đồng bộ lại với tài liệu:*

1. **Khi đề xuất hoặc thay đổi logic/kiến trúc mới:**
   - Không được âm thầm code lệch so với `doc/`.
   - **Phải cập nhật ngay** file tài liệu tương ứng (`ARCHITECTURE.md`, `PIPELINE_INPAINTING.md`, v.v.) giải thích lý do vì sao thay đổi (ví dụ: *"Đã nâng kích thước patch lên 64px để tránh lem viền bóng thoại"*).
2. **Ghi nhật ký tiến trình (Living Changelog):**
   - Bất kỳ tính năng mới, module mới hay thử nghiệm kỹ thuật nào được thêm vào dự án đều phải ghi nhận vào [doc/CHANGELOG.md](file:///d:/MoeJect/doc/CHANGELOG.md).
3. **Giữ mạch xuyên suốt giữa các phiên:**
   - Khi bắt đầu một cuộc hội thoại mới, đọc lại `doc/` và `CHANGELOG.md` để nắm được hiện trạng dự án đang dừng ở đâu và tiếp tục mạch phát triển một cách tự nhiên.
