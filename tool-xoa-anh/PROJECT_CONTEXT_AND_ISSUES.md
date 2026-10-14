# BÁO CÁO TOÀN DIỆN VỀ DỰ ÁN & VẤN ĐỀ KỸ THUẬT CẦN GIẢI QUYẾT
**Dự án:** Manga/Manhwa Automated Text & Speech Bubble Cleaner  
**Hệ thống mục tiêu:** Hugging Face Space (`dobietdc/backe-manga-remove`), ZeroGPU (Nvidia A10G/A100), Gradio Web UI + FastAPI REST API.  
**Ràng buộc bảo toàn:** Tuyệt đối không can thiệp thư mục `d:\tool-xoa-anh-manga\Do-not-touch`.

---

## 1. MỤC TIÊU DỰ ÁN (PROJECT GOAL)
1. **Làm sạch tự động trang truyện tranh:** Tự động phát hiện và xóa chữ trong truyện tranh (Manga / Manhwa / Comic), tái tạo lại nền bằng AI inpainting trong thời gian dưới 1-2 giây/trang.
2. **Tách biệt thông minh Lời thoại (Chat) và Hiệu ứng âm thanh (SFX):**
   - **Chế độ 1 (Mặc định):** Chỉ xóa lời thoại trong bóng thoại (Chat), **giữ nguyên 100% SFX** (từ tượng thanh, chữ vẽ nghệ thuật, onomatopoeia).
   - **Chế độ 2:** Xóa toàn bộ (cả Chat và SFX).
3. **Bảo vệ viền khung thoại (Contour Barrier):** Không được làm lem hoặc xóa mất đường viền đen (black ink contour) của bong bóng thoại (cả bóng tròn, elip và bóng nổ tia chớp).
4. **Không nhận nhầm nét vẽ và screentone:** Không biến trame hạt (halftone), speedlines hoặc nếp gấp quần áo nhân vật thành mask xóa.

---

## 2. KIẾN TRÚC HIỆN TẠI ĐANG DÙNG (CURRENT TECH STACK)

### A. Mô hình Deep Learning:
1. **Text Detection:** `comic-text-detector.onnx` (từ repo `dmMaze/comic-text-detector`).
   - Gồm 3 output head:
     - `blk`: YOLOv5 detection head cho Text Blocks (`[1, 64512, 7]`).
     - `det`: DBNet line heatmap (`[1, 2, 1024, 1024]`).
     - `seg`: UNet pixel-level character segmentation (`[1, 1, 1024, 1024]`).
2. **Inpainting:** `anime-manga-big-lama.pt` (Big-LaMa fine-tuned cho anime/manga).
   - Chạy trên PyTorch với ZeroGPU decorator (`@spaces.GPU`).

### B. Cấu trúc mã nguồn trong workspace:
- `app.py`: Giao diện Gradio (2 cột, tab so sánh Color Mask preview, Batch ZIP, Brush Editor) gắn kèm FastAPI Router (`/api/clean_page`, `/health`).
- `manga_cleaner.py`: Pipeline chính gồm `ComicTextDetectorEngine` và `MangaCleanerPipeline`.
- `download_models.py`: Tự động tải weights từ Hugging Face Hub nếu thiếu.
- `upload_to_hf.py`: Đồng bộ các file mã nguồn lên Hugging Face Space thông qua `huggingface_hub`.
- `examples/`: Chứa 2 file ảnh mẫu kiểm thử:
  - `sample1.jpg`: Nhân vật hô khẩu hiệu ("I WON'T LET YOU DESTROY...", "THIS IS MY PROMISE, MY NINDO!") + SFX `ガッ` vẽ trên bầu trời.
  - `sample2.jpg`: Nhân vật lo lắng ("HUH!?") + tóc gai + bóng thoại nổ tia chớp.

---

## 3. NHỮNG BẾ TẮC VÀ VẤN ĐỀ KỸ THUẬT CỐT LÕI (CORE BOTTLENECKS)

### ❌ Vấn đề 1: Nhận nhầm bản chất giữa Chat (Lời thoại) và SFX (Hiệu ứng)
* **Nguyên nhân gốc rễ:** 
  - Mô hình `comic-text-detector` không được huấn luyện với nhãn ngữ nghĩa `Chat` vs `SFX`. Hai class `[c0, c1]` trong output `blk` của model này thực chất là **Vertical Text (chữ dọc)** vs **Horizontal Text (chữ ngang)** của văn bản tiếng Nhật/Anh.
  - Khi cố gắng dùng các thuật toán xử lý ảnh hình học truyền thống (Heuristics):
    - Dùng màu nền trắng (`white_ratio > 0.55`): Bị sai ngay lập tức khi chữ SFX `ガッ` được vẽ trên nền trời trắng hoặc panel có nền sáng $\rightarrow$ Hệ thống tưởng nhầm là bóng thoại và **xóa luôn SFX**.
    - Dùng thuật toán bắn tia (Raycasting 4 hướng kiểm tra viền mực đen): Bị sai vì viền khung tranh (panel borders) hoặc nét vẽ xung quanh khiến điểm ảnh nào trong trang truyện cũng có "viền đen bao bọc trong 180px".
* **Hậu quả:** Màu trên Color Mask bị lộn xộn (SFX bị chuyển thành màu xanh lá của Chat và bị xóa oan, hoặc chữ thoại bị chuyển thành màu đỏ của SFX).

### ❌ Vấn đề 2: "Bôi lem" phá hủy viền khung thoại (Bubble border destruction)
* **Nguyên nhân gốc rễ:**
  - Để xóa sạch chữ mà không để lại viền bóng mờ (ghost artifacts), mask text bắt buộc phải được nở rộng (morphological dilation từ 3 đến 5px).
  - Tuy nhiên, chữ trong manga thường nằm rất sát mép viền bóng thoại. Khi mask nở ra, nó **tràn qua nét mực đen (black border) của bong bóng**.
  - Mô hình Inpainting (`Big-LaMa`) khi nhận được mask bao trùm nét viền sẽ hiểu rằng nét viền là rác cần xóa, dẫn đến việc **tô một mảng trắng bệt loang ra ngoài tranh vẽ nhân vật**.

### ❌ Vấn đề 3: Screentone & Speedlines bị kích hoạt giả thành Text
* **Nguyên nhân gốc rễ:**
  - Nhánh phân đoạn nét ký tự (`seg`) từ UNet có độ nhạy rất cao với các hoa văn có tần số biến thiên liên tục như trame hạt (halftone screentone) trên áo quần, bóng đổ và các đường tốc độ (speedlines).
  - Nếu lấy trực tiếp `seg > threshold`, toàn bộ thân người và nền tranh bị phủ kín các đốm xanh/đỏ rải rác.

### ❌ Vấn đề 4: Quá sa đà vào Heuristic "chắp vá"
* Tinh chỉnh từng thông số đơn lẻ (threshold 0.20 $\rightarrow$ 0.35 $\rightarrow$ 0.45, padding 10px $\rightarrow$ 25px) chỉ giải quyết được cục bộ cho một góc ảnh cụ thể, nhưng khi chạy ảnh khác hoặc khung hình khác thì lập tức bị lỗi ngược lại. **Cần một giải pháp ở tầng mô hình (Model-level) thay vì code heuristic.**

---

## 4. ĐỀ XUẤT CÁC HƯỚNG GIẢI PHÁP MỚI CẦN CÂN NHẮC

Khi mở phiên làm việc mới, nên cân nhắc các hướng đi kiến trúc mạnh mẽ sau:

### 💡 Hướng tiếp cận 1: Mô hình kép (Speech Bubble Detector + Text Detector)
Thay vì bắt 1 mô hình text detector phải đoán đâu là bóng thoại, hãy sử dụng **2 mô hình độc lập**:
1. **Mô hình 1 - Speech Bubble Detector:**
   - Dùng mô hình phát hiện khung thoại (ví dụ: `YOLOv8-manga-bubble`, hoặc mô hình segmentation bong bóng thoại từ cộng đồng anime/manga).
   - Mô hình này trả về chính xác Polygon Mask của từng quả bóng thoại (bất kể tròn, elip hay tia chớp nổ).
2. **Mô hình 2 - Text Detector (`comic-text-detector`):**
   - Chỉ dùng để trích xuất các nét chữ (`Text Mask`).
3. **Logic phân loại tuyệt đối không thể sai:**
   $$\text{Mask Chat (Lời thoại)} = \text{Text Mask} \cap \text{Bubble Mask}$$
   $$\text{Mask SFX (Hiệu ứng)} = \text{Text Mask} \setminus \text{Bubble Mask}$$
   *(Bất kỳ chữ nào nằm trong bong bóng thoại thì chắc chắn là Lời thoại; chữ nằm ngoài thì chắc chắn là SFX/Narration).*

### 💡 Hướng tiếp cận 2: Intelligent Script-Gate qua OCR (như Libre Manga Translator / Mokuro)
1. Dùng detector định vị các block chữ.
2. Cho chạy qua một mô hình OCR truyện tranh siêu nhẹ (như `PaddleOCR` hoặc `PP-OCRv4 Manga` hoặc `Manga-OCR`).
3. Dùng bộ lọc ngôn ngữ (Script Gate):
   - Chuỗi ký tự có nghĩa, thành câu, nhiều chữ Latin/Kanji/Hiragana hoàn chỉnh $\rightarrow$ **Chat**.
   - Chuỗi ngắn 1-3 ký tự Katakana mang tính tượng thanh (`ガッ`, `ドォン`, `バッ`, `HUH!?`) $\rightarrow$ **SFX**.

### 💡 Hướng tiếp cận 3: Tích hợp giải pháp từ các Repo Manga mã nguồn mở đã trưởng thành
Cần nghiên cứu và tái sử dụng pipeline đã kiểm chứng từ các dự án lớn:
- **`manga-image-translator`** (https://github.com/zyddnys/manga-image-translator): Chuẩn mực hàng đầu hiện nay về detect, bubble mask và inpaint manga.
- **`BallonsTranslator`** (https://github.com/dmMaze/BallonsTranslator): Dự án gốc của chính tác giả tạo ra file `comic-text-detector.onnx`.
- **`libre-manga-translator`** (https://github.com/mrdhnto/libre-manga-translator): Áp dụng cơ chế Script-Gate phân tách SFX độc lập.

---

## 5. DỮ LIỆU FILE VÀ LINK HIỆN CÓ ĐỂ BÀN GIAO
- **Mã nguồn hiện tại:** `d:\tool-xoa-anh-manga\`
- **Hugging Face Space:** `https://huggingface.co/spaces/dobietdc/backe-manga-remove`
- **Tài khoản Hugging Face Token:** `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`
- **Mục tiêu của cửa sổ mới:** Đưa ra phương án dứt điểm (chọn model nhận diện bong bóng thoại hoặc OCR script-gate) để thay thế hoàn toàn các logic heuristic thủ công trong `manga_cleaner.py`.
