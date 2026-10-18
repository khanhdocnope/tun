# KIỂM KÊ BACKEND (đọc code, chưa chạy được vì không có GPU/HF trong sandbox)

## Endpoint HF (`tool-xoa-anh/app.py`) và người gọi
| Endpoint | Người gọi | Kết luận |
|---|---|---|
| `POST /clean_page` | tab Xóa chữ, bước Tẩy chữ Batch Studio, `api/clean.js` | Cốt lõi |
| `GET /health` | thanh trạng thái, `api/health.js` | Giữ |
| `POST /api/v1/translate` | tab Dịch lại script (dự phòng), tab cũ | Giữ |
| `POST /api/v1/translate-page` | tab cũ (ẩn), `api/ocr.js`, `api/batch-zip.js` | Chưa dùng ở luồng mới; **trả bbox** — nền cho chèn chữ |
| `POST /api/v1/translate-zip` | không ai | Thừa |
| `/api/clean_page`, `/api/v1/health` | không ai | Bí danh thừa |
| `/docs`, `/redoc`, `/openapi.json` | debug | Giữ |
| `/api/clean_zip`, `/api/inpaint` | chỉ trong tài liệu | Không tồn tại — sửa tài liệu |

## Vercel `api/*.js`
Còn dùng: `clean`, `health`, `config`, `process-batch`, `translate-text`, `batch-helper`, `download-script`, `translate` (tab Dịch lại script). Legacy (chỉ tab ẩn gọi): `vision`, `ocr`, `batch-zip`.

## Có thể tái dùng cho chèn chữ
- `translate-page`: bbox `[ymin,xmin,ymax,xmax]` theo thứ tự đọc manga/webtoon + OCR manga-ocr (tọa độ theo ảnh gửi lên).
- `bubble_detector.py` (RT-DETR `ogkalu/comic-text-and-bubble-detector`): lớp 0 viền bóng rỗng, 1 chữ trong bóng, 2 chữ ngoài bóng. `clean_page` hiện chỉ trả số lượng, không trả tọa độ.
- `mask_logic.py` + `tests/test_mask_logic.py`: phần có test duy nhất.

## Thừa / cũ (đề xuất, chưa xóa)
`manga_cleaner_v2.zip` (cũ hơn bản đang chạy), `log.txt` (deploy cũ), `Dockerfile` (`uvicorn app:app` nhưng không có biến `app`; README khai báo `sdk: gradio`), `web_app.py` + `ai_client.py` + `templates/` + `static/` + `run_web.bat` (app chat Flask riêng), `examples/`, `upload_to_hf.py`, `prompt.txt`, `model_list.txt`, `model-gemini.txt`; khoảng 600 dòng UI Gradio không ai gọi.
**Không xóa Gradio**: ZeroGPU (`@spaces.GPU`) cần Gradio SDK.

## Bảo mật / rủi ro
- Token Hugging Face dạng thật trong `PROJECT_CONTEXT_AND_ISSUES.md` dòng 100: cần thu hồi.
- `server.js` local: `express.static(__dirname)` phục vụ mã nguồn (`server.js`, `api/*.js`); Vercel không bị. `.env` không bị lộ.
- CORS: `CORSMiddleware` được import nhưng không gắn; đường gọi thẳng HF từ trình duyệt chưa kiểm chứng. Lệnh thử: `curl -i -X OPTIONS <HF>/clean_page -H "Origin: https://<vercel>" -H "Access-Control-Request-Method: POST"` rồi tìm `access-control-allow-origin`.
