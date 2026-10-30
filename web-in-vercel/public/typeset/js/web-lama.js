/**
 * Web Manga LaMa Inpainting Engine (100% Client-Side WebGPU / WASM)
 * Runs LaMa ONNX directly in a Background Web Worker with zero server dependency.
 * Never blocks the main browser UI thread, completely preventing "Page Unresponsive" freezes.
 */

export class WebLamaEngine {
  constructor(options = {}) {
    this.options = options;
    this.worker = null;
    this.isReady = false;
    this.isLoading = false;
    this.deviceMode = "none"; // 'webgpu' | 'wasm' | 'none'
    this.isCached = false;
    this.cachedSize = 0;

    // Model URLs
    this.primaryUrl = "https://huggingface.co/mayocream/lama-manga-onnx/resolve/main/lama-manga.onnx";
    this.mirrorUrl = "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama.onnx";
    this.cacheName = "manga-studio-lama-v1";
    this.cacheKey = "model_lama_manga.onnx";

    this.onStatusChange = options.onStatusChange || (() => {});
    this._msgId = 0;
    this._pendingRequests = new Map();

    this._initWorker();
  }

  /**
   * Khởi tạo Web Worker chạy ngầm
   */
  _initWorker() {
    try {
      this.worker = new Worker("/typeset/js/web-lama-worker.js");
      this.worker.onmessage = (e) => this._handleWorkerMessage(e);
      this.worker.onerror = (err) => {
        console.error("[WebLamaEngine] Worker error:", err);
        this.notifyStatus("error", `Lỗi Web Worker: ${err.message || "Không thể khởi chạy worker"}`);
      };
    } catch (err) {
      console.warn("[WebLamaEngine] Không thể tạo Web Worker:", err);
    }
  }

  _handleWorkerMessage(e) {
    const { id, success, data, error } = e.data;
    if (this._pendingRequests.has(id)) {
      const { resolve, reject } = this._pendingRequests.get(id);
      this._pendingRequests.delete(id);
      if (success) {
        resolve(data);
      } else {
        reject(new Error(error || "Worker operation failed"));
      }
    }
  }

  _sendWorkerMessage(type, payload = {}, transferables = []) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this._initWorker();
      }
      if (!this.worker) {
        return reject(new Error("Web Worker không khả dụng trong trình duyệt này."));
      }

      const id = ++this._msgId;
      this._pendingRequests.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload }, transferables);
    });
  }

  /**
   * Khởi tạo kiểm tra xem model đã được lưu trong trình duyệt chưa.
   * Chạy hoàn toàn bất đồng bộ, KHÔNG làm đứng luồng chính (Main Thread).
   */
  async init() {
    try {
      const status = await this._sendWorkerMessage("CHECK_STATUS");
      this.isCached = Boolean(status?.isCached);
      this.cachedSize = status?.cachedSize || 0;

      if (this.isCached) {
        this.notifyStatus("idle", `Đã lưu trong máy (~${Math.round(this.cachedSize / 1024 / 1024 || 198)}MB)`);
        // Khởi tạo phiên tính toán ngầm trong Worker mà không chặn trang web
        this._warmupSessionInBackground();
        return true;
      }

      this.notifyStatus("idle", "Chưa tải model");
      return false;
    } catch (e) {
      console.warn("WebLamaEngine init check warning:", e);
      // Fallback kiểm tra caches trực tiếp
      const directCached = await this.isModelCached();
      if (directCached) {
        this.isCached = true;
        this.notifyStatus("idle", "Đã lưu trong máy (~198MB)");
      } else {
        this.notifyStatus("idle", "Chưa tải model");
      }
      return false;
    }
  }

  /**
   * Nạp trước session trong background worker khi máy rảnh rỗi (idle)
   */
  async _warmupSessionInBackground() {
    if (this.isReady || this.isLoading) return;
    try {
      this.notifyStatus("loading", "Đang nạp model từ bộ nhớ...");
      const res = await this._sendWorkerMessage("INIT_FROM_CACHE");
      this.deviceMode = res.deviceMode || "wasm";
      this.isReady = true;
      this.notifyStatus("ready", `Sẵn sàng (${this.deviceMode.toUpperCase()})`);
    } catch (err) {
      console.warn("[WebLamaEngine] Warmup model ngầm chưa thành công:", err);
      this.notifyStatus("idle", "Đã lưu trong máy (Nhấn xóa chữ để nạp)");
    }
  }

  notifyStatus(state, message, percent = 0) {
    this.onStatusChange({
      state, // 'idle' | 'loading' | 'ready' | 'error'
      message,
      percent,
      device: this.deviceMode,
      isReady: this.isReady,
      isCached: this.isCached,
      cachedSize: this.cachedSize,
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

  async getStorageInfo() {
    try {
      const status = await this._sendWorkerMessage("CHECK_STATUS");
      return {
        isCached: Boolean(status?.isCached),
        cachedSize: status?.cachedSize || 0,
        formattedSize: status?.cachedSize ? `${Math.round(status.cachedSize / 1024 / 1024)} MB` : "0 MB",
      };
    } catch (_) {
      const cached = await this.isModelCached();
      return {
        isCached: cached,
        cachedSize: cached ? 204544673 : 0,
        formattedSize: cached ? "~198 MB" : "0 MB",
      };
    }
  }

  /**
   * Xóa hoàn toàn Model khỏi bộ nhớ trình duyệt và hủy Worker session
   */
  async clearCache() {
    try {
      if (this.worker) {
        await this._sendWorkerMessage("CLEAR_CACHE");
      }
    } catch (e) {
      console.warn("[WebLamaEngine] Worker clearCache warning:", e);
    }

    // Đảm bảo xóa cả ở main thread CacheStorage
    if ("caches" in window) {
      try {
        await caches.delete(this.cacheName);
      } catch (e) {
        console.error("Lỗi xóa CacheStorage:", e);
      }
    }

    this.isReady = false;
    this.isLoading = false;
    this.isCached = false;
    this.cachedSize = 0;
    this.deviceMode = "none";
    this.notifyStatus("idle", "Đã xóa model khỏi máy");
  }

  /**
   * Tải model từ mạng với tiến trình % chi tiết, không làm đơ giao diện
   */
  async downloadModel(onProgress = () => {}) {
    if (this.isLoading) return;
    this.isLoading = true;
    this.notifyStatus("loading", "Bắt đầu tải mô hình Manga LaMa...", 0);

    let buffer = null;
    try {
      // 1. Tải từ primary URL hoặc mirror URL
      try {
        buffer = await this.fetchWithProgress(this.primaryUrl, onProgress);
      } catch (errPrimary) {
        console.warn("Primary URL tải thất bại, chuyển sang mirror:", errPrimary);
        buffer = await this.fetchWithProgress(this.mirrorUrl, onProgress);
      }

      if (!buffer || buffer.byteLength < 1000000) {
        throw new Error("Dữ liệu model tải về không hợp lệ hoặc bị gián đoạn mạng.");
      }

      this.notifyStatus("loading", "Đang nạp mô hình vào luồng xử lý Web Worker...", 98);

      // Chuyển buffer sang Web Worker (Transferable 0-copy, không làm đứng giao diện!)
      const res = await this._sendWorkerMessage(
        "INIT_FROM_BUFFER",
        { buffer, saveCache: true },
        [buffer]
      );

      this.deviceMode = res.deviceMode || "wasm";
      this.isReady = true;
      this.isCached = true;
      this.cachedSize = 204544673;

      this.notifyStatus("ready", `Sẵn sàng (${this.deviceMode.toUpperCase()})`, 100);
      return true;
    } catch (err) {
      this.notifyStatus("error", `Lỗi tải model: ${err.message}`, 0);
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Tải file lớn có micro-yield để nhường luồng UI xử lý sự kiện
   */
  async fetchWithProgress(url, onProgress) {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} khi tải từ ${url}`);
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 204544673; // ~198MB
    let loaded = 0;

    const reader = response.body.getReader();
    const chunks = [];
    let lastYieldTime = performance.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;

      // Nhường luồng cho UI mỗi 50ms để giao diện không bị giật lag
      const now = performance.now();
      if (now - lastYieldTime > 50) {
        lastYieldTime = now;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const percent = Math.min(96, Math.round((loaded / total) * 100));
      onProgress(percent, loaded, total);
      this.notifyStatus(
        "loading",
        `Đang tải: ${percent}% (${Math.round(loaded / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB)`,
        percent
      );
    }

    // Ghép các chunk lại
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
   * Chuyển thẳng buffer sang Web Worker, giao diện giữ nguyên 60FPS
   */
  async loadFromFile(file) {
    if (!file) return;
    this.isLoading = true;
    this.notifyStatus("loading", "Đang đọc file .onnx từ máy...", 30);

    try {
      const buffer = await file.arrayBuffer();
      this.notifyStatus("loading", "Đang khởi tạo phiên tính toán trong Web Worker...", 70);

      const res = await this._sendWorkerMessage(
        "INIT_FROM_BUFFER",
        { buffer, saveCache: true },
        [buffer]
      );

      this.deviceMode = res.deviceMode || "wasm";
      this.isReady = true;
      this.isCached = true;
      this.cachedSize = file.size;

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
   * Xóa chữ (Inpaint) vùng khoanh bằng thuật toán 512x512 Crop & Feathered Blend
   * Toàn bộ bước nặng ONNX được chạy ngầm trong Web Worker!
   */
  async inpaintCrop(sourceImage, fullMaskCanvas, cropRect) {
    if (!this.isReady) {
      // Thử nạp từ cache nếu trước đó chưa nạp
      if (this.isCached) {
        await this._warmupSessionInBackground();
      }
      if (!this.isReady) {
        throw new Error("Mô hình Web LaMa chưa sẵn sàng. Hãy tải model trong Cài đặt trước.");
      }
    }

    const tStart = performance.now();
    const imgW = sourceImage.naturalWidth || sourceImage.width;
    const imgH = sourceImage.naturalHeight || sourceImage.height;

    // 1. Bounding Box mở rộng lề ~35%
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
    ctxImg512.drawImage(sourceImage, boxX, boxY, boxW, boxH, 0, 0, 512, 512);

    const canvasMask512 = document.createElement("canvas");
    canvasMask512.width = 512;
    canvasMask512.height = 512;
    const ctxMask512 = canvasMask512.getContext("2d");
    ctxMask512.drawImage(fullMaskCanvas, boxX, boxY, boxW, boxH, 0, 0, 512, 512);

    // Lấy pixel data (mỗi mảng 512*512*4 = 1MB)
    const imgPixels = ctxImg512.getImageData(0, 0, 512, 512).data;
    const maskPixels = ctxMask512.getImageData(0, 0, 512, 512).data;

    // 3. Gửi sang Web Worker xử lý (Truyền Transferable 0-copy)
    const res = await this._sendWorkerMessage(
      "INPAINT",
      { imgPixels, maskPixels },
      [imgPixels.buffer, maskPixels.buffer]
    );

    const resultPixels = res.resultPixels;

    // 4. Đưa pixel kết quả vào Canvas 512x512
    const resultImageData = ctxImg512.createImageData(512, 512);
    resultImageData.data.set(resultPixels);

    const canvasResult512 = document.createElement("canvas");
    canvasResult512.width = 512;
    canvasResult512.height = 512;
    canvasResult512.getContext("2d").putImageData(resultImageData, 0, 0);

    // 5. Scale 512x512 về kích thước thật (boxW x boxH)
    const canvasPatch = document.createElement("canvas");
    canvasPatch.width = boxW;
    canvasPatch.height = boxH;
    const ctxPatch = canvasPatch.getContext("2d");
    ctxPatch.drawImage(canvasResult512, 0, 0, 512, 512, 0, 0, boxW, boxH);

    // 6. Feather Mask hòa trộn viền mềm
    const canvasFeatherMask = document.createElement("canvas");
    canvasFeatherMask.width = boxW;
    canvasFeatherMask.height = boxH;
    const ctxFeather = canvasFeatherMask.getContext("2d");
    ctxFeather.drawImage(fullMaskCanvas, boxX, boxY, boxW, boxH, 0, 0, boxW, boxH);
    ctxFeather.filter = "blur(4px)";
    ctxFeather.drawImage(canvasFeatherMask, 0, 0);
    ctxFeather.filter = "none";

    // 7. Hòa trộn hoàn chỉnh vào ảnh trang
    const outputFullCanvas = document.createElement("canvas");
    outputFullCanvas.width = imgW;
    outputFullCanvas.height = imgH;
    const ctxOut = outputFullCanvas.getContext("2d");
    ctxOut.drawImage(sourceImage, 0, 0);

    const canvasBlendedPatch = document.createElement("canvas");
    canvasBlendedPatch.width = boxW;
    canvasBlendedPatch.height = boxH;
    const ctxBlend = canvasBlendedPatch.getContext("2d");
    ctxBlend.drawImage(canvasPatch, 0, 0);
    ctxBlend.globalCompositeOperation = "destination-in";
    ctxBlend.drawImage(canvasFeatherMask, 0, 0);

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
