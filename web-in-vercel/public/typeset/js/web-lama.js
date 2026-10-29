/**
 * Web Manga LaMa Inpainting Engine (100% Client-Side WebGPU / WASM)
 * Runs LaMa ONNX directly in the browser with zero server dependency.
 * Powered by ONNX Runtime Web (ort.all.min.js).
 */

export class WebLamaEngine {
  constructor(options = {}) {
    this.options = options;
    this.session = null;
    this.isReady = false;
    this.isLoading = false;
    this.deviceMode = "none"; // 'webgpu' | 'wasm' | 'none'
    this.cachedModelBuffer = null;

    // Model URLs
    this.primaryUrl = "https://huggingface.co/mayocream/lama-manga-onnx/resolve/main/lama-manga.onnx";
    this.mirrorUrl = "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama.onnx";
    this.cacheName = "manga-studio-lama-v1";
    this.cacheKey = "model_lama_manga.onnx";

    this.onStatusChange = options.onStatusChange || (() => {});
  }

  /**
   * Khởi tạo kiểm tra xem model đã được cache trong trình duyệt chưa.
   * Nếu có, nạp sẵn vào bộ nhớ để khi người dùng cần xóa chữ là chạy ngay.
   */
  async init() {
    try {
      const isCached = await this.isModelCached();
      if (isCached) {
        this.notifyStatus("loading", "Đang nạp model từ bộ nhớ đệm...");
        const buffer = await this.loadFromCache();
        if (buffer) {
          await this.initSession(buffer);
          this.notifyStatus("ready", `Sẵn sàng (${this.deviceMode.toUpperCase()})`);
          return true;
        }
      }
      this.notifyStatus("idle", "Chưa tải model");
      return false;
    } catch (e) {
      console.warn("WebLamaEngine init error:", e);
      this.notifyStatus("idle", "Chưa tải model");
      return false;
    }
  }

  notifyStatus(state, message, percent = 0) {
    this.onStatusChange({
      state, // 'idle' | 'loading' | 'ready' | 'error'
      message,
      percent,
      device: this.deviceMode,
      isReady: this.isReady,
    });
  }

  async isModelCached() {
    if (!("caches" in window)) return false;
    try {
      const cache = await caches.open(this.cacheName);
      const match = await cache.match(this.cacheKey);
      return Boolean(match);
    } catch (_) {
      return false;
    }
  }

  async loadFromCache() {
    if (!("caches" in window)) return null;
    try {
      const cache = await caches.open(this.cacheName);
      const match = await cache.match(this.cacheKey);
      if (match) {
        return await match.arrayBuffer();
      }
    } catch (e) {
      console.error("Lỗi đọc cache model:", e);
    }
    return null;
  }

  async saveToCache(arrayBuffer) {
    if (!("caches" in window)) return;
    try {
      const cache = await caches.open(this.cacheName);
      const response = new Response(arrayBuffer, {
        headers: { "Content-Type": "application/octet-stream" },
      });
      await cache.put(this.cacheKey, response);
    } catch (e) {
      console.error("Lỗi lưu cache model:", e);
    }
  }

  async clearCache() {
    if ("caches" in window) {
      try {
        await caches.delete(this.cacheName);
      } catch (e) {
        console.error("Lỗi xóa cache model:", e);
      }
    }
    this.session = null;
    this.isReady = false;
    this.deviceMode = "none";
    this.cachedModelBuffer = null;
    this.notifyStatus("idle", "Đã xóa cache model");
  }

  /**
   * Tải model từ mạng với tiến trình % chi tiết
   */
  async downloadModel(onProgress = () => {}) {
    if (this.isLoading) return;
    this.isLoading = true;
    this.notifyStatus("loading", "Bắt đầu tải mô hình Manga LaMa...", 0);

    let buffer = null;
    try {
      // 1. Thử tải từ primary URL (HuggingFace mayocream manga-lama)
      try {
        buffer = await this.fetchWithProgress(this.primaryUrl, onProgress);
      } catch (errPrimary) {
        console.warn("Primary URL tải thất bại, chuyển sang mirror:", errPrimary);
        buffer = await this.fetchWithProgress(this.mirrorUrl, onProgress);
      }

      if (!buffer || buffer.byteLength < 1000000) {
        throw new Error("Dữ liệu model tải về không hợp lệ hoặc bị lỗi mạng.");
      }

      this.notifyStatus("loading", "Đang lưu vào bộ nhớ đệm trình duyệt...", 98);
      await this.saveToCache(buffer);

      this.notifyStatus("loading", "Đang khởi tạo phiên tính toán WebGPU/WASM...", 99);
      await this.initSession(buffer);

      this.notifyStatus("ready", `Sẵn sàng (${this.deviceMode.toUpperCase()})`, 100);
      return true;
    } catch (err) {
      this.notifyStatus("error", `Lỗi tải model: ${err.message}`, 0);
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  async fetchWithProgress(url, onProgress) {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} khi tải từ ${url}`);
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 207482644; // ~197MB
    let loaded = 0;

    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      const percent = Math.min(96, Math.round((loaded / total) * 100));
      onProgress(percent, loaded, total);
      this.notifyStatus("loading", `Đang tải: ${percent}% (${Math.round(loaded / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB)`, percent);
    }

    const allChunks = new Uint8Array(loaded);
    let position = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }

    return allChunks.buffer;
  }

  /**
   * Nạp trực tiếp từ file .onnx do người dùng chọn từ máy tính
   */
  async loadFromFile(file) {
    if (!file) return;
    this.isLoading = true;
    this.notifyStatus("loading", "Đang nạp file .onnx từ máy...", 50);

    try {
      const buffer = await file.arrayBuffer();
      await this.saveToCache(buffer);
      await this.initSession(buffer);
      this.notifyStatus("ready", `Sẵn sàng (${this.deviceMode.toUpperCase()})`, 100);
      return true;
    } catch (err) {
      this.notifyStatus("error", `Lỗi nạp file: ${err.message}`);
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Khởi tạo ONNX Runtime InferenceSession
   */
  async initSession(arrayBuffer) {
    if (!window.ort) {
      throw new Error("Chưa nạp thư viện onnxruntime-web (window.ort không tồn tại).");
    }

    this.cachedModelBuffer = arrayBuffer;

    // Cấu hình môi trường WASM đa luồng
    if (window.ort.env && window.ort.env.wasm) {
      window.ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
      window.ort.env.wasm.simd = true;
    }

    // 1. Thử ưu tiên WebGPU (Card màn hình rời/onboard siêu nhanh)
    try {
      this.session = await window.ort.InferenceSession.create(arrayBuffer, {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
      });
      this.deviceMode = "webgpu";
      console.log("⚡ WebLama initialized successfully with WebGPU!");
    } catch (gpuErr) {
      console.warn("WebGPU không khả dụng hoặc bị lỗi, tự động chuyển sang WASM (CPU):", gpuErr);
      // 2. Fallback sang WASM SIMD trên CPU
      this.session = await window.ort.InferenceSession.create(arrayBuffer, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      this.deviceMode = "wasm";
      console.log("⚙️ WebLama initialized successfully with WASM CPU!");
    }

    // Tự động nhận diện tên input/output của model
    const inputNames = this.session.inputNames || [];
    this.imageInputName =
      inputNames.find((n) => n.toLowerCase().includes("img") || n.toLowerCase().includes("image") || n.toLowerCase().includes("input")) ||
      inputNames[0] ||
      "image";

    this.maskInputName =
      inputNames.find((n) => n.toLowerCase().includes("mask")) ||
      inputNames[1] ||
      "mask";

    this.outputName = this.session.outputNames?.[0] || "output";
    this.isReady = true;
  }

  /**
   * Xóa chữ (Inpaint) vùng khoanh bằng thuật toán 512x512 Crop & Feathered Blend
   * @param {HTMLImageElement|HTMLCanvasElement} sourceImage - Ảnh trang manga
   * @param {HTMLCanvasElement} fullMaskCanvas - Canvas chứa mask toàn trang
   * @param {Object} cropRect - { x, y, width, height }
   */
  async inpaintCrop(sourceImage, fullMaskCanvas, cropRect) {
    if (!this.isReady || !this.session) {
      throw new Error("Mô hình Web LaMa chưa sẵn sàng. Hãy tải model trong Cài đặt trước.");
    }

    const tStart = performance.now();
    const imgW = sourceImage.naturalWidth || sourceImage.width;
    const imgH = sourceImage.naturalHeight || sourceImage.height;

    // 1. Tính toán Bounding Box có mở rộng lề (Padding ~35%)
    const padX = Math.max(32, Math.round(cropRect.width * 0.35));
    const padY = Math.max(32, Math.round(cropRect.height * 0.35));

    const boxX = Math.max(0, cropRect.x - padX);
    const boxY = Math.max(0, cropRect.y - padY);
    const boxW = Math.min(imgW - boxX, cropRect.width + padX * 2);
    const boxH = Math.min(imgH - boxY, cropRect.height + padY * 2);

    // 2. Tạo Canvas tạm 512x512 cho Image và Mask
    const canvasImg512 = document.createElement("canvas");
    canvasImg512.width = 512;
    canvasImg512.height = 512;
    const ctxImg512 = canvasImg512.getContext("2d");

    // Vẽ vùng crop ảnh gốc lên 512x512
    ctxImg512.drawImage(sourceImage, boxX, boxY, boxW, boxH, 0, 0, 512, 512);

    const canvasMask512 = document.createElement("canvas");
    canvasMask512.width = 512;
    canvasMask512.height = 512;
    const ctxMask512 = canvasMask512.getContext("2d");

    // Vẽ vùng crop mask lên 512x512
    ctxMask512.drawImage(fullMaskCanvas, boxX, boxY, boxW, boxH, 0, 0, 512, 512);

    // 3. Chuẩn bị Float32 Tensors
    const imgPixelData = ctxImg512.getImageData(0, 0, 512, 512).data;
    const maskPixelData = ctxMask512.getImageData(0, 0, 512, 512).data;

    const numPixels = 512 * 512;
    const imgTensorData = new Float32Array(3 * numPixels);
    const maskTensorData = new Float32Array(numPixels);

    // Chuẩn hóa ảnh [1, 3, 512, 512] dạng RGB [0.0, 1.0]
    // Chuẩn hóa mask [1, 1, 512, 512] dạng Binary [0.0 hoặc 1.0]
    for (let i = 0; i < numPixels; i++) {
      const pIdx = i * 4;
      imgTensorData[i] = imgPixelData[pIdx] / 255.0; // R
      imgTensorData[numPixels + i] = imgPixelData[pIdx + 1] / 255.0; // G
      imgTensorData[numPixels * 2 + i] = imgPixelData[pIdx + 2] / 255.0; // B

      // Mask: Bất kỳ pixel mask nào có alpha/màu > 15 thì coi là vùng cần xóa (1.0)
      const maskVal = Math.max(maskPixelData[pIdx], maskPixelData[pIdx + 1], maskPixelData[pIdx + 2], maskPixelData[pIdx + 3]);
      maskTensorData[i] = maskVal > 15 ? 1.0 : 0.0;
    }

    const imgTensor = new window.ort.Tensor("float32", imgTensorData, [1, 3, 512, 512]);
    const maskTensor = new window.ort.Tensor("float32", maskTensorData, [1, 1, 512, 512]);

    const feeds = {};
    feeds[this.imageInputName] = imgTensor;
    feeds[this.maskInputName] = maskTensor;

    // 4. Chạy Inpainting Inference trực tiếp trên WebGPU / WASM
    const results = await this.session.run(feeds);
    const outputTensor = results[this.outputName];
    if (!outputTensor || !outputTensor.data) {
      throw new Error("Model Inpainting không trả về kết quả hợp lệ.");
    }

    const outData = outputTensor.data;

    // 5. Chuyển tensor kết quả thành ImageData 512x512
    const resultImageData = ctxImg512.createImageData(512, 512);
    const rPixels = resultImageData.data;

    // Tự động kiểm tra giá trị đầu ra (nếu là [0, 1] thì nhân 255, nếu đã là [0, 255] thì giữ nguyên)
    let isNormalized = false;
    for (let i = 0; i < 50; i++) {
      if (outData[i] > 1.5) {
        isNormalized = false;
        break;
      }
      isNormalized = true;
    }
    const scale = isNormalized ? 255.0 : 1.0;

    for (let i = 0; i < numPixels; i++) {
      const pIdx = i * 4;
      rPixels[pIdx] = Math.min(255, Math.max(0, Math.round(outData[i] * scale))); // R
      rPixels[pIdx + 1] = Math.min(255, Math.max(0, Math.round(outData[numPixels + i] * scale))); // G
      rPixels[pIdx + 2] = Math.min(255, Math.max(0, Math.round(outData[numPixels * 2 + i] * scale))); // B
      rPixels[pIdx + 3] = 255;
    }

    // 6. Scale kết quả 512x512 về kích thước thật của vùng crop (boxW x boxH)
    const canvasResult512 = document.createElement("canvas");
    canvasResult512.width = 512;
    canvasResult512.height = 512;
    canvasResult512.getContext("2d").putImageData(resultImageData, 0, 0);

    const canvasPatch = document.createElement("canvas");
    canvasPatch.width = boxW;
    canvasPatch.height = boxH;
    const ctxPatch = canvasPatch.getContext("2d");
    ctxPatch.drawImage(canvasResult512, 0, 0, 512, 512, 0, 0, boxW, boxH);

    // 7. Tạo Alpha Feather Mask để hòa trộn viền siêu mềm mượt
    const canvasFeatherMask = document.createElement("canvas");
    canvasFeatherMask.width = boxW;
    canvasFeatherMask.height = boxH;
    const ctxFeather = canvasFeatherMask.getContext("2d");

    // Lấy mask gốc của vùng crop
    ctxFeather.drawImage(fullMaskCanvas, boxX, boxY, boxW, boxH, 0, 0, boxW, boxH);
    ctxFeather.filter = "blur(4px)";
    ctxFeather.drawImage(canvasFeatherMask, 0, 0);
    ctxFeather.filter = "none";

    // 8. Hòa trộn vào trang ảnh hoàn chỉnh
    const outputFullCanvas = document.createElement("canvas");
    outputFullCanvas.width = imgW;
    outputFullCanvas.height = imgH;
    const ctxOut = outputFullCanvas.getContext("2d");

    // Vẽ toàn bộ ảnh gốc
    ctxOut.drawImage(sourceImage, 0, 0);

    // Tạo canvas patch có viền mềm
    const canvasBlendedPatch = document.createElement("canvas");
    canvasBlendedPatch.width = boxW;
    canvasBlendedPatch.height = boxH;
    const ctxBlend = canvasBlendedPatch.getContext("2d");

    ctxBlend.drawImage(canvasPatch, 0, 0);
    ctxBlend.globalCompositeOperation = "destination-in";
    ctxBlend.drawImage(canvasFeatherMask, 0, 0);

    // Đè patch đã làm mềm viền lên ảnh gốc
    ctxOut.drawImage(canvasBlendedPatch, boxX, boxY);

    const tDuration = Math.round(performance.now() - tStart);
    return {
      cleanedCanvas: outputFullCanvas,
      cleanedDataUrl: outputFullCanvas.toDataURL("image/jpeg", 0.95),
      durationMs: tDuration,
      device: this.deviceMode,
    };
  }
}
