# Đo thực tế trên Hugging Face Space (free)

Space: https://huggingface.co/spaces/dobietdc/manga-text-cleaner  
API: https://dobietdc-manga-text-cleaner.hf.space  
Hardware: `zero-a10g` (ZeroGPU free) — **backend hiện chạy CPU-only**, không dùng GPU.  
Commit đo: `e6e197d` (PNG lossless mặc định, WebP lossless tuỳ chọn, JPEG q98).

## 1. Cách đo

Chạy từ máy local (mạng Việt Nam), dùng `backend/tools/measure_space.py`:

```powershell
backend\.venv\Scripts\python.exe backend\tools\measure_space.py `
  --base https://dobietdc-manga-text-cleaner.hf.space `
  --repeat 2 --format png
```

Script tách:
- **server_ms**: thời gian backend tự báo (`processing_time_ms` / `X-SmartErase-Elapsed-Ms`).
- **total_ms**: thời gian client thấy, gồm upload + xếp hàng + proxy HF + tải kết quả.
- **overhead_ms** = total − server.

## 2. Trước và sau khi deploy

Đo trên cùng Space, cùng ảnh `raw-test/`, cùng mạng:

| Hạng mục | Code cũ trên Space | Code mới trên Space | Ghi chú |
|---|---:|---:|---|
| OCR `15.webp` | **21.0 s**, 19 box | **6.8 s**, 27 box | nhanh ~3.1×, nhận đúng chữ dọc |
| OCR `16.webp` (warm) | **6.9 s**, 6 box | **4.35 s**, 13 box | nhanh ~1.6×, gấp đôi recall |
| Xóa chữ `16.webp` | **67.7 s** | **4.18 s** | nhanh **~16×** |
| Inpaint `16.webp` | 8.4 s | — | endpoint cũ; endpoint mới nhanh hơn |
| Upload 200 KB | 1.19–1.43 s | 0.44–1.14 s | tùy lần, proxy HF chi phối |

Code cũ trên Space trả text rất kém (`私の連`, `何加用加？`, `人丫!`, `南？`...), code mới trả đúng gần đủ (`私の連れに`, `何か用か?`, `おさつ`, `邪魔すんなよ`...).

## 3. Chi tiết code mới (mặc định PNG lossless)

| Trang | Upload | OCR server | OCR total | Erase server | Erase total | File trả về |
|---|---:|---:|---:|---:|---:|---:|
| 15.webp | 1.14–1.15 s | 6.41–6.99 s | 6.80–7.40 s | 2.51–2.78 s | 4.05–5.43 s | **1,128,743 B** PNG |
| 16.webp | 0.44 s | 3.94–5.20 s | 4.35–5.61 s | 2.46–3.11 s | 4.18–4.22 s | **1,264,915 B** PNG |
| 05.webp | 0.45–0.47 s | 4.09–4.41 s | 4.54–4.89 s | 2.80–3.06 s | 4.07–4.22 s | **1,406,807 B** PNG |

Frontend mặc định gửi `output_format=png`, nên ảnh giữ nguyên từng pixel. Nếu cần nhẹ hơn mà vẫn lossless, client có thể gửi `output_format=webp` (WebP lossless, pixel-identical).

### Dao động và warm request

Free Space dùng CPU chia sẻ nên số đo dao động đáng kể. Đo lặp lại trên `16.webp`:

| Trạng thái | Erase server | Erase total |
|---|---:|---:|
| Request đầu sau idle / worker lạnh | 2.5–3.7 s | 4.2–6.2 s |
| Các request erase liên tiếp (warm) | **0.28–0.30 s** | **0.9–1.5 s** |

OCR dao động mạnh hơn: server **3.8–9.3 s** trong 4 lần gọi liên tiếp cùng ảnh (free CPU bị throttle/chia sẻ). Vì vậy nên đọc bảng trên là **khoảng**, không phải một con số cố định.

Ghi chú: trước đây đo PNG với `repeat=2` cho erase server 2.5–3.1 s; đó là các lần chạm worker lạnh. Khi warm, PNG/WebP lossless/JPEG98 đều rất nhanh; khác biệt chủ yếu nằm ở dung lượng tải về.

- Health check (đã warm): **0.28 s** — đây là latency mạng/proxy cơ bản.
- OCR overhead (upload 200 KB + response): **0.39–0.45 s**.
- Erase overhead (upload + tải ảnh + encode): **1.0–1.3 s**.
- Server OCR chậm hơn máy local khoảng **1.7–2×**; server erase chậm hơn khoảng **3×**. Đây là giới hạn CPU của Space free, không phải code.

## 4. Định dạng trả về: ưu tiên chất lượng

Ba lựa chọn, cùng một ảnh cleaned:

| Trang | PNG (mặc định, lossless) | WebP lossless (pixel-identical) | JPEG q98 (lossy) |
|---|---:|---:|---:|
| 15 | **1,128,743 B** | 602,030 B | 632,211 B |
| 16 | **1,264,915 B** | 690,356 B | 706,772 B |
| 05 | **1,406,807 B** | 764,168 B | 798,421 B |

- **PNG**: lossless tuyệt đối, giữ nguyên từng pixel; đây là mặc định mới.
- **WebP lossless**: giải mã ra **pixel-identical** với PNG (đã test `maxdiff = 0`), dung lượng còn ~53–54%.
- **JPEG q98**: vẫn **lossy**, dễ ringing quanh nét mảnh; đáng chú ý là với ảnh manga ở đây JPEG98 còn **lớn hơn** WebP lossless (632 vs 602 KB, 707 vs 690 KB, 798 vs 764 KB). Vì vậy JPEG98 **không có lợi thế gì** so với WebP lossless.
- Nếu cần giảm băng thông mà không mất chất lượng: dùng **WebP lossless**, không phải JPEG98.
- Frontend mặc định `output_format=png`; có thể đổi sang `webp` (lossless). `jpeg` chỉ dành cho client thật sự muốn lossy.

## 5. Chia nhỏ ảnh / tải song song có cần không?

### 5.1. Upload nhiều mảnh

Thử chia `15.webp` (206 KB) thành 4 mảnh WebP (tổng 312 KB do re-encode):

| Cách | Wall time |
|---|---:|
| 1 request 206 KB | **2.20 s** |
| 4 mảnh tuần tự (312 KB) | 3.12 s |
| 4 mảnh song song (312 KB) | 2.37 s |

→ 4 mảnh song song **vẫn chậm hơn** 1 request, lại tốn thêm byte. Mỗi request có overhead ~1.3 s (proxy HF + validate), nên chia nhỏ không có lợi với ảnh ~200 KB.

### 5.2. OCR song song

Chạy 2 request OCR cùng lúc trên `16.webp`:

| Cách | Wall time | Thời gian trung bình/request |
|---|---:|---:|
| Tuần tự 2 request | **12.79 s** | 6.39 s |
| Song song 2 request | 13.20 s | 10.95 s |

→ Song song **chậm hơn ~3%**; server chỉ có 2 vCPU, detection còn bị lock để tránh race, nên các request tranh CPU của nhau. Không nên chunk + parallel OCR.

### 5.3. Kết luận

- **Không cần chia nhỏ ảnh** cho luồng hiện tại (ảnh manga ~200–500 KB).
- Server đã tự chia **tile bên trong** cho webtoon dài (1800 px/tile, overlap 192 px), nên ảnh cao vẫn xử lý được mà không cần client chia.
- Nút thắt thực sự là **CPU inference**, không phải upload/download.
- Nếu ảnh nguồn rất lớn (>5–10 MB), tối ưu đúng thứ tự:
  1. Nén/convert client-side sang WebP (nếu chấp nhận lossy; muốn giữ chất lượng thì dùng PNG/WebP lossless và chấp nhận file lớn hơn).
  2. Chỉ gửi **crop của bubble** khi user xóa một bubble (kèm offset), thay vì cả trang.
  3. Trả **patch/crop** đã xóa thay vì cả trang, client composite.
  4. Chỉ khi đó mới cân nhắc chunk upload — và cần endpoint ghép mảnh, không đơn giản là gửi song song.

## 6. Có cần nâng cấp không?

### Với nhu cầu hiện tại (1 trang/lần, người dùng chờ)

- OCR **4–7 s/trang** (có lúc 9 s do CPU chia sẻ), xóa **4–6 s lần đầu**, **~1–1.5 s** khi warm.
- Nếu chấp nhận mức này thì **không cần nâng cấp**; chỉ cần keep-alive để tránh cold start 15–30 s.
- Nếu cần <3 s/trang hoặc xử lý batch 20–50 trang, nên nâng cấp.

### Hướng nâng cấp hiệu quả (theo thứ tự)

1. **Keep-alive ping** mỗi 10–15 phút (cron/GitHub Action) — giảm cold start, rẻ nhất.
2. **WebP lossless output** (tuỳ chọn, đã làm) — giảm ~46% băng thông mà vẫn pixel-identical; PNG vẫn là mặc định.
3. **Cache OCR theo SHA-256 ảnh** — bấm lại/undo không phải chạy lại 4–7 s.
4. **Cache/warm bubble-mask path** — erase warm đã 0.28–0.30 s; lần đầu 2.5–3.7 s chủ yếu là worker/module lạnh, có thể giảm bằng warmup định kỳ.
5. **Nâng CPU trả phí** (4–8 vCPU) — đơn giản nhất nếu batch; OCR là CPU-bound nên gần như scale tuyến tính tới 4 vCPU.
6. **GPU**: Space là `zero-a10g` nhưng pipeline đang ONNX CPU. Muốn dùng A10G phải cài `onnxruntime-gpu`, bọc inference trong `spaces.GPU`, và xử lý quota ZeroGPU — công sức lớn, chỉ đáng nếu throughput cao. Với OCR manga, CPU 4–8 vCPU thường hiệu quả chi phí hơn.

### Có nên đổi hardware?

- `zero-a10g` free không giúp gì cho code CPU hiện tại; **không cần đổi** nếu vẫn free.
- Nếu trả phí, ưu tiên **CPU upgrade** trước, không phải GPU, vì bottleneck là ONNX/OpenCV CPU.
- Theo dõi tỷ lệ: OCR server 4–7 s (dao động tới 9 s), erase warm 0.28–0.30 s. Nếu upgrade 4 vCPU, kỳ vọng OCR ~2–3.5 s; erase warm gần như không còn là nút thắt.

## 7. Lưu ý cold start

Space free có thể ngủ sau một thời gian không dùng. Lần gọi đầu sau khi ngủ có thể mất 15–30 s (build/start + model load/worker lạnh). Trong lúc đo, Space đã RUNNING, nhưng request erase đầu tiên vẫn có thể chạm worker lạnh (2.5–3.7 s server); các request ngay sau đó chỉ ~0.3 s. Nếu người dùng mở app lần đầu trong ngày, hãy cộng thêm cold start; keep-alive là cách giảm.
