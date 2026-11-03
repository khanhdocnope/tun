# CƠ CHẾ THU THẬP DỮ LIỆU & BẢO VỆ KẾT NỐI (INGESTION ENGINE)
## HỌC HỎI VÀ ĐÚC KẾT TỪ `comix-downloader`

> **Mục tiêu:** Tải truyện tranh với tốc độ cao nhất, không bị lỗi đứt gánh giữa chừng, và vượt qua được các lớp phòng thủ Cloudflare/WAF mà không làm cháy tài nguyên máy.

---

### 1. BÀI TOÁN CLOUDFLARE & GIẢI PHÁP `nodriver`

#### Nỗi đau:
- Các web truyện hiện đại (như Comix, MangaDex, NetTruyen, v.v.) sử dụng Cloudflare Turnstile, JavaScript Challenge hoặc WAF (`@waf/challenge`).
- `requests` hay `httpx` thông thường sẽ bị chặn với mã lỗi HTTP 403 / 503.
- `selenium` hay `playwright` chạy nặng nề, dễ bị phát hiện fingerprint bot.

#### Giải pháp từ `comix-downloader`:
1. **Sử dụng `nodriver`:** Thư viện điều khiển Chrome trực tiếp qua DevTools Protocol (CDP), không cài extension WebDriver, vô hình trước hầu hết cơ chế anti-bot.
2. **Cơ chế Cookie Jar Caching (`cf_cookies.dat`):**
   - Chỉ mở trình duyệt khi gặp Challenge hoặc khi chưa có cookie hợp lệ.
   - Khi vượt qua Cloudflare thành công, trích xuất cookie (đặc biệt là cookie `cf_clearance` hoặc `waf_pass`) và lưu vào file cục bộ.
   - Các lượt tải ảnh sau đó: Nạp cookie này vào `requests.Session` nhẹ nhàng. Không giữ Chrome chạy ngầm gây hao tốn RAM.
3. **Thread Safety:** Dùng `threading.Lock()` bảo vệ quá trình khởi tạo browser và đọc/ghi file cookie.

---

### 2. HAI TẦNG CONCURRENCY & CHỐNG RATE-LIMIT (CONNECTION GATING)

#### Kiến trúc 2 tầng (Two-Tier Pool):
- **Chapter Pool:** Giới hạn tải song song 2–3 chapters cùng lúc để tránh làm phình RAM khi giải nén ảnh.
- **Image Pool:** Tải đồng thời 5–10 ảnh trong mỗi chapter.

#### Connection Gating (`BoundedSemaphore`):
- Để tránh bị CDN chặn IP vì mở quá nhiều kết nối TCP cùng lúc đến một domain:
  ```python
  import threading
  from urllib.parse import urlparse

  class HostConnectionGate:
      def __init__(self, per_host_limit=4):
          self.per_host_limit = per_host_limit
          self._lock = threading.Lock()
          self._gates = {}

      def acquire(self, url):
          host = urlparse(url).netloc.lower() or "default"
          with self._lock:
              if host not in self._gates:
                  self._gates[host] = threading.BoundedSemaphore(self.per_host_limit)
              gate = self._gates[host]
          return gate
  ```

---

### 3. KIẾN TRÚC DIAGNOSTICS & RETRY

- Mọi lỗi tải ảnh được bọc trong dataclass `ImageFailure`:
  - `attempts`: Số lần đã thử.
  - `category`: Phân loại lỗi (`HTTP_403`, `SSL_ERROR`, `TIMEOUT`, `CORRUPTED_BYTES`).
- **Exponential Backoff:** Sau mỗi lần lỗi, chờ $2^{\text{attempt}} + \text{random}(0.1, 0.5)$ giây.
- **Bytes Validation:** Trước khi ghi file, kiểm tra header ảnh (Magic Bytes: PNG, JPEG, WebP) bằng Pillow để đảm bảo không lưu phải trang HTML báo lỗi của Cloudflare dưới dạng file ảnh.
