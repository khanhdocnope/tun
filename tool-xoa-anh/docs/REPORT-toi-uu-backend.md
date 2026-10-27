# Báo cáo: dọn dẹp + tối ưu backend xóa chữ

> **Người nhận:** kỹ sư tiếp nhận project · **Ngày:** 2026-10-27 · **Người viết:** phiên làm việc tự động (DSH)
> **Phạm vi:** chỉ `D:\tool-xoa-anh-manga\tool-xoa-anh\` và Space `dobietdc/backe-manga-remove`. Không đụng `web-in-vercel/`, `dich-1-lan-nua/`, `Do-not-touch/`.
> **Trạng thái tổng:** code đã deploy, **đang chạy được nhưng chậm (~41 s/trang)**; đã tìm ra nút thắt và phương án thay thế cụ thể (xem §5). Không commit git, chưa upload các thay đổi sau cùng.

---

## 0. TL;DR cho người tiếp nhận

1. Repo đã dọn từ 24 → 11 file; backend chỉ còn làm 1 việc: **xóa chữ** (OCR/dịch đã bỏ hẳn). API giữ nguyên cho client Vercel.
2. Đã deploy lên Space và **chạy được** (user xác nhận ảnh sạch, Chat/SFX đúng).
3. Nhưng **vẫn ~41 s/trang**: 31 s là `seg` ComicTextDetector ONNX chạy **CPU**. Không phải do code mới chậm, mà là bước này vốn đã chậm từ trước; các tối ưu khác đã ăn hết phần còn lại.
4. Quota ZeroGPU **5 phút/ngày** → hiện chỉ ~10 trang/ngày, và **đốt oan** vì mỗi request giữ cửa sổ GPU 25–35 s trong khi GPU gần như không làm gì.
5. Khuyến nghị số 1: **thay `seg` bằng `manga_det` 0.9 MB của `Kellenok/PP-OCRv6_manga`** (ONNX, CPU, input động, fine-tune manga) — xem §5. Nếu được thì không cần đẩy `seg` lên GPU nữa.
6. Việc bắt buộc trước mọi thứ khác: **REVOKE token HF** (đã lộ trong git history).

---

## 1. Đã làm được gì

### 1.1 Dọn repo — từ 24 file xuống 11 file

**Đã xóa** (chỉ trong `tool-xoa-anh/`): `Dockerfile`, `core/` (`ocr_engine.py`, `translator.py`, `__init__.py`), `prompt.txt`, `PROJECT_CONTEXT_AND_ISSUES.md` (chứa HF token ở dòng 100), `MIGRATION.md`, `manga_cleaner_v2.zip`, `comparison_sample1.png`, `hf_cleaned_sample1.png`, `hf_mask_sample1.png` (~4.8 MB), `test_contour_preserving.py`, `__pycache__/`.

**Còn lại:** `app.py`, `manga_cleaner.py`, `mask_logic.py`, `bubble_detector.py`, `download_models.py`, `bench_clean.py`, `upload_to_hf.py`, `requirements.txt`, `README.md`, `test_cleaner_logic.py`, `examples/` (+ `docs/` chứa báo cáo này).

**Trên Space** đã xóa: `Dockerfile`, `prompt.txt`, `core/*` — xác nhận qua API tree: Space chỉ còn 11 file đúng danh sách trên.

### 1.2 Backend chỉ còn xóa chữ

- `app.py`: bỏ tab OCR, các route `/api/v1/translate-page`, `/api/v1/translate`, `/api/v1/translate-zip`, `/detect_boxes`, `/api/v1/detect-boxes`, trang `/benchmark` (3.4 KB HTML), `/redoc`; viết lại tab hướng dẫn API (bỏ tài liệu cho `/api/clean_zip`, `/api/inpaint` — là route không tồn tại từ trước).
- Hợp đồng API **không đổi** cho client `web-in-vercel`: `POST /clean_page` nhận `imageBase64 / cleanSFX / dilationPx / detThreshold / inpaintModel`, trả `success / cleanedImageBase64 / colorMaskBase64 / stats`. Alias `/api/clean_page` giữ.
- `/health` sửa: `device` đúng A10G (trước báo A100), thêm `seg_ready`, `inpaint_ready`, `limits`.
- Lỗi: trước đây base64 hỏng → **500 body rỗng**; giờ trả `{"detail": ...}` với 400 / 413 / 422 / 500. Thêm giới hạn `MAX_PIXELS` = 40 Mpx, `MAX_B64_BYTES` = 24 MB.
- `stats.timings_ms` không còn bị ghi đè bởi số đo encode của API (trước đây `inpaint` bị cộng cả decode/encode) → tách `stats.api_timings_ms`.
- `requirements.txt`: bỏ `paddlepaddle`, `paddleocr`, `manga-ocr`, `tqdm`, `uvicorn`, `requests`, `python-multipart`, `python-dotenv` (cold start nhẹ hơn nhiều).

### 1.3 Thay đổi hiệu năng / độ ổn định (đã code, đã deploy)

| Thay đổi | File | Trạng thái |
|---|---|---|
| **Khóa toàn cục** `MODEL_LOCK` quanh `clean_image` — trước đây 2 request song song cùng `.to(dev)` model → kết quả lẫn nhau | `manga_cleaner.py` | xong |
| **Lazy load** pipeline (`get_pipeline()`), bỏ `MangaCleanerPipeline()` ở module level + bỏ `ensure_models()` lúc boot | `manga_cleaner.py`, `app.py` | xong |
| **Một `@spaces.GPU` cho cả trang**: RT-DETR + LaMa trong cùng allocation, model `.to(dev)` một lần (tách `predict_boxes` khỏi `detect` trong `bubble_detector.py`) | `manga_cleaner.py`, `bubble_detector.py` | xong |
| **Cổng giấy trắng** `flat_paper_hint()` + tham số `seg_regions` của `build_masks` | `mask_logic.py` | xong (test local PASS) |
| Giảm inpaint: `INPAINT_CONTEXT_PX` 96→64, `FULL_PAGE_RATIO` 0.6→0.35 | `manga_cleaner.py` | xong |
| Sửa lỗi `seg_strokes` gửi 512px vào ONNX có input cố định 1024 → Space crash 1 lần | `manga_cleaner.py` | xong |
| `bench_clean.py --url <space>` đo round-trip `/clean_page` thật | `bench_clean.py` | xong (còn bug nhỏ khi lỗi mạng — §6) |

**Hồi quy đã kiểm:** `mask_logic` mới vs bản HEAD → mask và flat-fill **giống từng pixel** trên `sample1.jpg`, `sample2.jpg` (diff = 0). `python test_cleaner_logic.py` → 3/3 PASS.

### 1.4 Đo thật trên Space (chưa đạt mục tiêu)

```
sample1.jpg: round-trip 41.4 s | detect 3.8 s | seg 31.2 s | inpaint 0 ms | device=gpu
sample2.jpg: round-trip 41.8 s | detect 2.7 s | seg 31.7 s | inpaint 0 ms | device=gpu
```

User xác nhận **"đã hoạt động"** (ảnh ra sạch, Chat/SFX đúng). Hai trang mẫu đều là bóng giấy trắng → đi nhánh flat-fill → `inpaint` = 0. Phần chậm duy nhất là lượt CTD `seg` 1024px trên CPU.

### 1.5 Trạng thái code hiện tại (quan trọng khi bàn giao)

- **Đã deploy** (sha `361f9641` và các bản sau): `app.py + manga_cleaner.py` có khóa, GPU window, flat-paper gate, sửa static-size.
- **Có trong workspace nhưng CHƯA upload**: `_asan_report()` (map địa chỉ abort → `/proc/self/maps`), biến tạm `SEG_DEBUG_FROM`, và tạm chuyển LaMa sang CPU khi `inpaint_model != anime-lama` (để tách ORT khỏi LaMa khi điều tra crash). → Người nhận cần quyết định: deploy tiếp hay revert 3 thay đổi tạm này (§6).
- Space từng `RUNTIME_ERROR`/restart do ONNXRuntime abort; xem §4.
- **Chưa commit git**: toàn bộ thay đổi nằm ở working tree. `git status` sẽ thấy modified: `app.py`, `manga_cleaner.py`, `mask_logic.py`, `bubble_detector.py`, `requirements.txt`, `README.md`, `bench_clean.py`, `upload_to_hf.py`; deleted: các file §1.1; untracked: `test_cleaner_logic.py`, `docs/`.

---

## 2. Bảng số đo & nút thắt

| Giai đoạn | Trước (baseline CPU) | Sau (live) | Mục tiêu |
|---|---|---|---|
| detect (RT-DETR) | 280–775 ms | 2.2–3.8 s (CPU) | ≤ 50 ms |
| **seg (CTD 1024, CPU)** | **~40 157 ms** | **~31 000 ms** | **≤ 300 ms** |
| masks | 17–41 ms | — | giữ |
| inpaint LaMa | 1 267–2 721 ms | 0 (flat-fill) | ≤ 1 s |
| **Tổng** | ≥ 41 s | **41 s** | **≤ 3.5 s** |

**Nút thắt duy nhất:** `seg` của `comictextdetector.pt.onnx` chạy ONNXRuntime trên CPU (~2 vCPU) → ~30–40 s/lượt 1024px. RT-DETR và LaMa đã ở GPU nhưng chi phí của chúng không còn đáng kể; nếu `seg` xuống < 0.5 s thì tổng trang về ~3–4 s.

---

## 3. `seg` là gì và vì sao nó tốn thời gian (để người sau không bỏ nhầm)

`models/comictextdetector.pt.onnx` có 3 head; dự án chỉ dùng head thứ ba:

| Head | Ý nghĩa | Dùng? |
|---|---|---|
| `blk` | YOLO block chữ `[1, 64512, 7]` | **Bỏ** (lọc theo tên khi nạp session) |
| `det` | DBNet line heatmap `[1, 2, 1024, 1024]` | Chỉ `np.maximum` với `seg` |
| `seg` | u-net **xác suất từng pixel là nét chữ** `[1, 1, 1024, 1024]` | **Cần** |

`seg` làm 3 việc (xem `mask_logic.build_masks`):

1. **Quyết định pixel nào bị xóa**, không phải khung nào: `chat_text = (seg > seg_thr) ∩ rect(chat_region)`. RT-DETR chỉ cho hình chữ nhật; xóa cả hình chữ nhật là khoét cả tranh.
2. **Nuôi các bước hạ nguồn**: `snap_white_halo` (viền trắng quanh chữ manhwa), `extract_contour_barrier(gray, all_text)` → barrier = nét mực ≥ 25px **trừ** nét chữ, rồi `contour_preserving_dilate` nở mask 4px nhưng **dừng ở barrier** (chống lem viền bóng).
3. **Color Mask** (xanh = Chat, đỏ = SFX) gửi cho client.

**Không thể bỏ tuỳ tiện:** thiếu `seg` thì barrier không biết đâu là chữ → hoặc xóa oan nét vẽ (trame halftone, speedline, nếp áo), hoặc barrier "ăn" mất chữ. Với trang bóng giấy trắng, `flat_paper_hint` đã bỏ được `LaMa` nhưng **vẫn còn lượt `seg` 1024px** — chính là 31 s đang thấy.

**Bẫy đã gặp (đừng lặp lại):** ONNX này có **input cố định 1024×1024**, gửi 512 → `INVALID_ARGUMENT … Got: 512 Expected: 1024` → Space `RUNTIME_ERROR`. Trước khi feed bất kỳ ONNX nào, đọc `session.get_inputs()[0].shape`.

---

## 4. Vấn đề độ ổn định (ORT abort)

- Triệu chứng: Space tự restart (`RUNTIME_ERROR`) khi xử lý `/clean_page`.
- Lỗi `InvalidArgument` 512-vs-1024 đã sửa (đọc shape cố định từ session).
- Sau đó vẫn có **abort cấp process** trong khi một request vừa chạy ONNXRuntime vừa chạy LaMa TorchScript. Chưa có log chi tiết (API logs HF cần token, log runtime trên UI bị cắt).
- Bản trong workspace đã thêm `_asan_report()` + tách LaMa khỏi ORT khi `inpaint_model != anime-lama` để khoanh vùng. Người nhận cần: deploy bản đó, gọi 1 trang, đọc `stats.error` / `stats.error_address` trong response để biết module nào trong `/proc/self/maps`.
- **Lưu ý:** mỗi lần thử = 1 lần gọi `/clean_page` = **đốt quota GPU**, nên gộp tối đa 1 lần test mỗi bản deploy.

---

## 5. Đề xuất tối ưu (xếp theo giá trị / công sức)

### 5.1 ⭐ Ưu tiên #1 — thay `seg` bằng detector chữ nhẹ cho manga

Ứng viên đã khảo sát: [`Kellenok/PP-OCRv6_manga`](https://huggingface.co/Kellenok/PP-OCRv6_manga) — Apache-2.0, fine-tune trên Manga109-s + AnimeText, chạy CPU, **không cần PaddlePaddle**.

| | Hiện tại (CTD `seg`) | Đề xuất (`manga_det_v0.2_fp16.onnx`) |
|---|---|---|
| Kích thước | ONNX lớn, input **cố định 1024²** | **0.92 MB**, input **động** (long side 960) |
| Runtime | onnxruntime (đã có) | onnxruntime (đã có) + `pyclipper` (hoặc tự offset bằng cv2) |
| Output | heatmap seg thô | polygon dòng chữ + score (DB post-process: `thresh=0.15, box_thresh=0.25, unclip_ratio=1.4`) |
| Số liệu công bố | không có benchmark manga | Recall **94.65% manga**, **96.13% webtoon**; ít FP hơn bản base (bảng 1 của model card) |

**Vai trò giữ nguyên:** RT-DETR vẫn quyết định Chat vs SFX (box); chỉ nguồn "pixel chữ" đổi từ heatmap sang polygon → vẫn đủ dựng `all_text`/barrier, `snap_white_halo`, flat-fill, LaMa. API không đổi.

**Việc cần làm (ước 3–5 h):**
1. Thêm `text_detector.py`: nạp `det/manga_det_v0.2_fp16.onnx` + `ppocrv6_dict.txt` (rec không cần) qua ORT CPU, trả `List[polygon page-coord]`. Dùng lại logic trong [examples/onnx_openvino.py](https://huggingface.co/Kellenok/PP-OCRv6_manga/raw/main/examples/onnx_openvino.py) (box_score_fast, unclip, minAreaRect).
2. `mask_logic.py`: thêm `build_masks_from_polygons(img_bgr, polygons, dets, ...)` trả cùng `MaskSet`; giữ `build_masks` cũ.
3. `manga_cleaner.py`: `TEXT_DET_BACKEND=manga_det|ctd` (env), mặc định `manga_det`; bỏ `flat_paper_hint` nếu không cần nữa (giảm 1 lượt suy luận).
4. **Test local trước, không đốt GPU**: `pip install onnxruntime pyclipper`; chạy `test_cleaner_logic.py` + so ảnh `sample1.jpg` (có SFX ガッ), `sample2.jpg` (bóng tia chớp).
5. Đo lại trên Space đúng **1 lần** (xem §7), kỳ vọng tổng ≤ 4 s.

**Rủi ro:** polygon sát thân chữ hơn heatmap → phải giữ `dilation_px=4` + `snap_white_halo` để không sót viền; dòng ngắn/SFX có thể bị cắt — phải so trực quan trên 2 ảnh mẫu + 1 trang manhwa màu trước khi chốt.

### 5.2 Nếu 5.1 thất bại — đưa `seg` lên GPU

- Export CTD sang torch (`dmMaze/comic-text-detector`, có `model.py` + `.pt`), hoặc qua `onnx2torch`; chạy trong cùng `_gpu_page_job` (detect + seg + LaMa, một `@spaces.GPU`). Ước tính 50–150 ms/trang.
- **Không** export được thì phương án cuối: dùng RT-DETR + ngưỡng sáng/tối trong box (0 model, ~2 s tổng, chất lượng giảm trên trame/line-art). Chỉ là fallback.

### 5.3 Tiết kiệm quota GPU (làm song song, rất rẻ)

| Việc | Lợi ích |
|---|---|
| Chỉ mở cửa sổ GPU khi **thật sự có** job LaMa; trang bóng trắng chạy detect + flat-fill **thuần CPU** | trang đơn giản = 0 giây GPU |
| Hạ `GPU_DURATION` từ 30 s về 6–8 s (ZeroGPU giữ GPU suốt `duration`, không phải "dùng bao nhiêu tính bấy nhiêu") | cắt ~75% quota ngay cả khi code chưa xong |
| Thêm `POST /clean_batch` nhận 5–10 trang trong **một** cửa sổ GPU | giảm overhead 1–3 s/trang |
| Cache theo hash(ảnh + params) | client `batch-studio/js/api.js` đang retry tới 3 lần → mỗi retry hiện đốt 1 cửa sổ |
| Space thứ 2 (quota tính riêng mỗi Space) hoặc máy GPU local cho batch lớn | dành quota HF cho test |
| **Nâng HF PRO** (~5× quota) nếu dùng hằng ngày | nhanh nhất, nếu đây là tool sản xuất |

Với 5 phút/ngày hiện tại ≈ **8–12 trang/ngày**; sau 5.1 + 5.3 có thể lên **150–200 trang/ngày**.

---

## 6. Checklist bàn giao cụ thể

- [ ] **REVOKE token HF** tại huggingface.co/settings/tokens (token đã nằm trong git history của `PROJECT_CONTEXT_AND_ISSUES.md` — file đã xóa nhưng commit cũ vẫn còn). Không cần rewrite history nếu token đã revoke.
- [ ] `git commit` toàn bộ thay đổi (chưa commit gì). Gợi ý: `git add -A tool-xoa-anh && git commit -m "chore(tool-xoa-anh): text-removal only, drop OCR/translate, perf + stability"`.
- [ ] Quyết định 3 thay đổi tạm đang nằm ngoài bản deploy: `_asan_report`, `SEG_DEBUG_FROM`, ép LaMa sang CPU. Khuyến nghị: deploy để lấy 1 log điều tra, sau đó **xóa `SEG_DEBUG_FROM` và nhánh ép CPU**.
- [ ] Sửa bug `bench_clean.py --url`: khi lỗi mạng hàm `measure_clean_page_api` trả sớm mà không có `markdown_table` → `main()` `KeyError`. Thêm `out["markdown_table"] = format_api_markdown_table(out)` trước mọi `return`.
- [ ] `download_models.py`: tải weights song song (thread) để cold start nhanh hơn.
- [ ] Nếu làm §5.1: cập nhật `requirements.txt` (`pyclipper`), `README.md`, và `upload_to_hf.py` if thêm file model.

---

## 7. Cách đo lại đúng (tiết kiệm quota)

1. **Không** dùng lại `bench_clean.py` mặc định (nó chạy 5 lượt × 3 ảnh = 15 lần gọi).
2. Chỉ ghi nhận từ **response của request thật**: `stats.timings_ms` (decode/detect/seg/masks/inpaint/total), `stats.api_timings_ms`, `stats.device`, `stats.engine`.
3. Lệnh tối thiểu (1 request/ảnh):
   `python bench_clean.py --url https://dobietdc-backe-manga-remove.hf.space --url-runs 1` (sau khi sửa bug §6) hoặc `curl` POST `/clean_page`.
4. Đo **trang manhwa màu / nền tối** ngoài 2 ảnh mẫu — 2 ảnh mẫu toàn bóng trắng nên `inpaint` = 0, không đánh giá được nhánh LaMa.

---

## 8. Bài học rút ra

1. **Đo baseline trước, tối ưu sau**: số `seg` 40 s đã có sẵn từ đầu; nếu nhìn bảng đó trước thì `seg` là việc đầu tiên, không phải việc thứ ba.
2. **Đọc shape input ONNX trước khi feed** (đã viết ở §3).
3. **Không `.to(dev)` nhiều lần trong pipeline** — giữ model cố định suốt cửa sổ GPU; `spaces.GPU` lồng nhau = nhiều allocation = tốn quota.
4. **Log chi tiết (ASAN) không dễ đọc qua API HF** → thêm đường "self-diagnose" trả lỗi trong `stats` thay vì chỉ log (đã có `_asan_report`).
5. **Test phải chạy được local** (mask_logic thuần numpy/cv2) để không phụ thuộc quota GPU.

---

## Phụ lục A — Cấu trúc code hiện tại

```
app.py             Gradio UI + FastAPI router; /health, /clean_page (+alias), /api/benchmark, /openapi.json
manga_cleaner.py   pipeline: RT-DETR detect → CTD seg → build_masks → flat_fill → LaMa; MODEL_LOCK; get_pipeline()
mask_logic.py      mask thuần numpy/cv2: build_masks, contour_preserving_dilate, extract_contour_barrier,
                   snap_white_halo, flat_fill_uniform_paper, flat_paper_hint, _eligible_regions
bubble_detector.py RT-DETR ogkalu/comic-text-and-bubble-detector (class 0 bubble, 1 text_bubble, 2 text_free)
download_models.py tải weights (3 mirror) khi thiếu
bench_clean.py     bench local + --url để đo /clean_page thật
test_cleaner_logic.py 3 test mask không cần model (PASS)
upload_to_hf.py    deploy Space: whitelist file, quét token, xóa file thừa (--dry-run)
examples/          sample1.jpg (bóng thoại), sample2.jpg (bóng tia chớp)
```

## Phụ lục B — Knobs (env)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `GPU_DURATION` | 30 | độ dài cửa sổ ZeroGPU / trang (giây) — **giảm về 6–8** để tiết kiệm quota |
| `INPAINT_CONTEXT_PX` | 64 | context quanh vùng xóa khi cắt crop LaMa |
| `FULL_PAGE_RATIO` | 0.35 | crop chiếm ≥ tỉ lệ này → inpaint cả trang |
| `SEG_SIZE` | 1024 | canvas CTD (graph cố định 1024) |
| `SEG_LOW_SIZE` | 512 | độ phân giải đọc nét cho cổng giấy trắng |
| `MAX_PIXELS` / `MAX_B64_BYTES` | 40 Mpx / 24 MB | giới hạn request |
| `TEXT_DET_BACKEND` | *(chưa có)* | sẽ thêm khi làm §5.1: `manga_det` \| `ctd` |

## Phụ lục C — Mẫu gọi API

```bash
curl -X POST https://dobietdc-backe-manga-remove.hf.space/clean_page \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"<b64>","cleanSFX":false,"dilationPx":4,"detThreshold":0.20,"inpaintModel":"anime-lama"}'
```

Response: `{"success":true,"cleanedImageBase64":"data:image/png;base64,...","colorMaskBase64":"...","stats":{...}}`
Lỗi: `{"detail":"..."}` với 400 (base64 hỏng) · 413 (quá lớn) · 422 (tham số sai) · 500 (pipeline lỗi).
