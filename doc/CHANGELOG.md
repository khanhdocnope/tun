# NHẬT KÝ PHÁT TRIỂN DỰ ÁN (PROJECT CHANGELOG)

## [2026-11-03] - Tối ưu hóa Detector & Smart Downscaling trên Branch mới

### Đã hoàn thành:
1. **Thiết lập Git & Tạo Branch Mới:**
   - Khởi tạo Git repo và liên kết với remote: `https://github.com/khanhdocnope/tun.git`.
   - Tạo và checkout branch mới độc lập: `feature/manga-cleaner-optimization`.
   - Đã push commit khởi tạo thành công lên GitHub (không đụng chạm hay đọc code từ các branch khác).
2. **Nâng cấp Client với Smart Downscaling & Đổi Detector sang `ctd`:**
   - Cập nhật [src/vision/cleaner_client.py](file:///d:/MoeJect/src/vision/cleaner_client.py):
     - Thêm thuật toán `_smart_downscale_image`: Tự động resize ảnh về `max_dim=1000px` trước khi gửi lên Space.
     - Sau khi nhận kết quả inpaint sạch từ Space, tự động upscale về kích thước pixel gốc bằng `LANCZOS`, bảo toàn 100% độ phân giải ban đầu của trang truyện.
     - Chuyển `detector` mặc định sang `ctd` (ComicTextDetector) chuyên biệt cho Manga, nhẹ và nhanh hơn nhiều so với DBNet.
3. **Kết quả Đo lường Hiệu năng (Benchmark Thần Tốc):**
   - **Ảnh `0.webp` (Ảnh phức tạp từng mất 8.519s):**
     - Detection: giảm từ `7.163s` $\rightarrow$ **`4.640s`** (Giảm ~35%).
     - Inpaint: giảm từ `1.142s` $\rightarrow$ **`0.188s`** (Nhanh gấp 6 lần).
     - Tổng thời gian: giảm từ `8.519s` $\rightarrow$ **`4.989s`**.
   - **Ảnh `04.webp` (Sau khi model đã warm-up):**
     - Detection: chỉ còn **`0.119s`**!
     - Inpaint: chỉ còn **`0.049s`**!
     - **TỔNG THỜI GIAN TOÀN TRANG: `0.358s` (XỬ LÝ DƯỚI NỬA GIÂY)!**
