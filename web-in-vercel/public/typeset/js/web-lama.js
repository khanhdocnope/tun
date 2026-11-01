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
    this.lastDurationMs = 0;
    this.avgDurationMs = 0;
    this._historyDurations = [];

    // Model URLs & Valid Cache Key
    this.primaryUrl = "https://huggingface.co/mayocream/lama-manga-onnx/resolve/main/lama-manga.onnx";
    this.mirrorUrl = "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama.onnx";
    this.cacheName = "manga-studio-lama-v1";
    this.cacheKey = "https://huggingface.co/mayocream/lama-manga-onnx/resolve/main/lama-manga.onnx";

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

  _sendWorkerMessage(type, payload = {}, transferables = [], timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this._initWorker();
      }
      if (!this.worker) {
        return reject(new Error("Web Worker không khả dụng trong trình duyệt này."));
      }

      const id = ++this._msgId;
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (this._pendingRequests.has(id)) {
            this._pendingRequests.delete(id);
            reject(new Error(`Thao tác Worker ${type} quá thời gian chờ (${timeoutMs}ms)`));
          }
        }, timeoutMs);
      }

      this._pendingRequests.set(id, {
        resolve: (data) => {
          if (timer) clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
      });

      this.worker.postMessage({ id, type, payload }, transferables);
    });
  }

  /**
   * Khởi tạo kiểm tra xem model đã được lưu trong trình duyệt chưa.
   * Chạy hoàn toàn bất đồng bộ, KHÔNG làm đứng luồng chính (Main Thread).
   */
  async init() {
    try {
      // 1. Kiểm tra nhanh trực tiếp trong CacheStorage của Main Thread
      const directCached = await this.isModelCached();
      if (directCached) {
        this.isCached = true;
        const info = await this.getStorageInfo();
        this.cachedSize = info.cachedSize || 207482644;
        this.notifyStatus("idle", `Đã lưu trong máy (~${Math.round(this.cachedSize / 1024 / 1024 || 198)}MB)`);
        this._warmupSessionInBackground();
        return true;
      }

      // 2. Nếu chưa thấy ở main thread, hỏi Worker
      const status = await this._sendWorkerMessage("CHECK_STATUS", {}, [], 5000);
      this.isCached = Boolean(status?.isCached);
      this.cachedSize = status?.cachedSize || 0;

      if (this.isCached) {
        this.notifyStatus("idle", `Đã lưu trong máy (~${Math.round(this.cachedSize / 1024 / 1024 || 198)}MB)`);
        this._warmupSessionInBackground();
        return true;
      }

      this.notifyStatus("idle", "Chưa tải model");
      return false;
    } catch (e) {
      console.warn("WebLamaEngine init check warning:", e);
      const directCached = await this.isModelCached();
      if (directCached) {
        this.isCached = true;
        this.cachedSize = 207482644;
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
      const res = await this._sendWorkerMessage("INIT_FROM_CACHE", {}, [], 120000);
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
      lastDurationMs: this.lastDurationMs,
      avgDurationMs: this.avgDurationMs,
    });
  }

  _recordInferenceTiming(durationMs) {
    if (typeof durationMs === "number" && durationMs > 0) {
      this.lastDurationMs = durationMs;
      this._historyDurations.push(durationMs);
      if (this._historyDurations.length > 8) this._historyDurations.shift();
      const sum = this._historyDurations.reduce((a, b) => a + b, 0);
      this.avgDurationMs = Math.round(sum / this._historyDurations.length);
    }
  }

  async isModelCached() {
    if (!("caches" in window)) return false;
    try {
      const cache = await caches.open(this.cacheName);
      const match = await cache.match(this.cacheKey);
      if (match) {
        const blob = await match.blob();
        return blob.size > 1000000;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  async getStorageInfo() {
    if ("caches" in window) {
      try {
        const cache = await caches.open(this.cacheName);
        const match = await cache.match(this.cacheKey);
        if (match) {
          const blob = await match.blob();
          const size = blob.size;
          if (size > 1000000) {
            return {
              isCached: true,
              cachedSize: size,
              formattedSize: `${Math.round(size / 1024 / 1024)} MB`,
            };
          }
        }
      } catch (_) {}
    }

    try {
      const status = await this._sendWorkerMessage("CHECK_STATUS", {}, [], 5000);
      return {
        isCached: Boolean(status?.isCached),
        cachedSize: status?.cachedSize || 0,
        formattedSize: status?.cachedSize ? `${Math.round(status.cachedSize / 1024 / 1024)} MB` : "0 MB",
      };
    } catch (_) {
      return {
        isCached: false,
        cachedSize: 0,
        formattedSize: "0 MB",
      };
    }
  }

  /**
   * Xóa hoàn toàn Model khỏi bộ nhớ trình duyệt và hủy Worker session
   */
  async clearCache() {
    try {
      if (this.worker) {
        await this._sendWorkerMessage("CLEAR_CACHE", {}, [], 10000);
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
   * Tải model từ mạng với tiến trình % chi tiết, hỗ trợ đa luồng (HTTP Range Chunks) siêu tốc
   */
  async downloadModel(onProgress = () => {}) {
    if (this.isLoading) return;
    this.isLoading = true;
    this.notifyStatus("loading", "Bắt đầu kết nối tải mô hình Manga LaMa...", 0);

    let buffer = null;
    try {
      // 1. Tải từ primary URL bằng đa luồng (6 luồng đồng thời)
      try {
        buffer = await this.fetchWithParallelChunks(this.primaryUrl, onProgress, 6);
      } catch (errPrimary) {
        console.warn("Primary URL đa luồng tải thất bại, chuyển sang mirror:", errPrimary);
        buffer = await this.fetchWithParallelChunks(this.mirrorUrl, onProgress, 4);
      }

      if (!buffer || buffer.byteLength < 1000000) {
        throw new Error("Dữ liệu model tải về không hợp lệ hoặc bị gián đoạn mạng.");
      }

      // Thông báo 100% hoàn thành tải xuống
      onProgress(100, buffer.byteLength, buffer.byteLength, "");
      this.notifyStatus("loading", "Đang lưu model vào bộ nhớ máy tính...", 100);

      // Lưu NGAY vào CacheStorage ở Main Thread để đảm bảo vĩnh viễn không bị mất file
      if ("caches" in window) {
        try {
          const cache = await caches.open(this.cacheName);
          const blob = new Blob([buffer], { type: "application/octet-stream" });
          await cache.put(
            this.cacheKey,
            new Response(blob, {
              headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": String(buffer.byteLength),
              },
            })
          );
          this.isCached = true;
          this.cachedSize = buffer.byteLength;
          console.log("[WebLamaEngine] Đã lưu model an toàn vào CacheStorage");
        } catch (cacheErr) {
          console.warn("[WebLamaEngine] Lưu CacheStorage trên main thread thất bại:", cacheErr);
        }
      }

      this.notifyStatus("loading", "Đang nạp mô hình vào luồng xử lý Web Worker...", 100);

      // Chuyển buffer sang Web Worker (Transferable 0-copy, không làm đứng giao diện!)
      const res = await this._sendWorkerMessage(
        "INIT_FROM_BUFFER",
        { buffer, saveCache: false }, // Đã lưu ở main thread rồi
        [buffer],
        120000 // 2 phút timeout cho init
      );

      this.deviceMode = res.deviceMode || "wasm";
      this.isReady = true;
      this.isCached = true;
      this.cachedSize = buffer.byteLength || 207482644;

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
   * Tải đa luồng song song (Multi-threaded Range Download - IDM Style)
   * Chia file thành N phần và tải đồng thời để bão hòa băng thông mạng.
   */
  async fetchWithParallelChunks(url, onProgress, concurrency = 6) {
    let totalLength = 207482644;
    let supportsRange = false;

    // Kiểm tra hỗ trợ HTTP Range và lấy kích thước file chính xác
    try {
      const probeRes = await fetch(url, {
        headers: { Range: "bytes=0-0" },
      });
      if (probeRes.status === 206) {
        supportsRange = true;
        const cr = probeRes.headers.get("content-range");
        if (cr) {
          const match = cr.match(/\/(\d+)$/);
          if (match) totalLength = parseInt(match[1], 10);
        }
      }
    } catch (e) {
      console.warn("Probe range request failed, fallback sang tải đơn luồng:", e);
    }

    if (!supportsRange || totalLength <= 0) {
      return await this.fetchWithProgress(url, onProgress);
    }

    const chunkSize = Math.ceil(totalLength / concurrency);
    const finalBuffer = new Uint8Array(totalLength);
    const loadedPerStream = new Array(concurrency).fill(0);
    const startTime = performance.now();
    let lastYieldTime = performance.now();

    const updateCombinedProgress = (isFinished = false) => {
      const totalLoaded = loadedPerStream.reduce((a, b) => a + b, 0);
      const percent = isFinished ? 100 : Math.min(99, Math.round((totalLoaded / totalLength) * 100));
      const elapsedSec = (performance.now() - startTime) / 1000;
      const speedMBs = elapsedSec > 0.1 ? ((totalLoaded / 1024 / 1024) / elapsedSec).toFixed(1) : "0.0";
      onProgress(percent, totalLoaded, totalLength, speedMBs);
      this.notifyStatus(
        "loading",
        isFinished
          ? `Tải hoàn tất 100% (${Math.round(totalLength / 1024 / 1024)}MB - ${speedMBs} MB/s). Đang lưu vào máy...`
          : `Đang tải đa luồng (${concurrency}x): ${percent}% (${Math.round(totalLoaded / 1024 / 1024)}MB / ${Math.round(totalLength / 1024 / 1024)}MB - ${speedMBs} MB/s)`,
        percent
      );
    };

    const downloadChunk = async (streamIndex) => {
      const start = streamIndex * chunkSize;
      const end = Math.min(start + chunkSize - 1, totalLength - 1);
      if (start > end) return;

      const res = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
      });

      if (!res.ok && res.status !== 206) {
        throw new Error(`Luồng ${streamIndex + 1} phản hồi lỗi HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      let offset = start;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        finalBuffer.set(value, offset);
        offset += value.length;
        loadedPerStream[streamIndex] += value.length;

        const now = performance.now();
        if (now - lastYieldTime > 60) {
          lastYieldTime = now;
          updateCombinedProgress(false);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      updateCombinedProgress(false);
    };

    await Promise.all(
      Array.from({ length: concurrency }, (_, i) => downloadChunk(i))
    );

    // Kích hoạt tiến trình 100% khi toàn bộ các luồng đã xong
    updateCombinedProgress(true);

    return finalBuffer.buffer;
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

      const percent = Math.min(99, Math.round((loaded / total) * 100));
      onProgress(percent, loaded, total);
      this.notifyStatus(
        "loading",
        `Đang tải: ${percent}% (${Math.round(loaded / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB)`,
        percent
      );
    }

    onProgress(100, loaded, total);

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
      this.notifyStatus("loading", "Đang lưu model vào bộ nhớ máy...", 60);

      // Lưu vào CacheStorage
      if ("caches" in window) {
        try {
          const cache = await caches.open(this.cacheName);
          const blob = new Blob([buffer], { type: "application/octet-stream" });
          await cache.put(
            this.cacheKey,
            new Response(blob, {
              headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": String(buffer.byteLength),
              },
            })
          );
          this.isCached = true;
          this.cachedSize = file.size;
        } catch (e) {
          console.warn("Lưu file custom vào cache thất bại:", e);
        }
      }

      this.notifyStatus("loading", "Đang khởi tạo phiên tính toán trong Web Worker...", 80);

      const res = await this._sendWorkerMessage(
        "INIT_FROM_BUFFER",
        { buffer, saveCache: false },
        [buffer],
        120000
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
   * Chuyển đổi linh hoạt nguồn ảnh (Image, Canvas, Blob, DataUrl, ImageBitmap) thành HTMLImageElement / Canvas
   */
  async _loadImage(src) {
    if (!src) throw new Error("Nguồn ảnh rỗng");
    if (src instanceof HTMLImageElement && src.complete && src.naturalWidth > 0) return src;
    if (src instanceof HTMLCanvasElement) return src;
    if (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap) return src;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error("Không thể nạp ảnh: " + (e.message || "Lỗi đọc file ảnh")));
      if (typeof src === "string") {
        img.src = src;
      } else if (src instanceof Blob) {
        img.src = URL.createObjectURL(src);
      } else {
        reject(new Error("Định dạng nguồn ảnh không được hỗ trợ"));
      }
    });
  }

  /**
   * Tạo Binary Mask phân đoạn chữ cục bộ bằng thuật toán Otsu thích nghi độ sáng nền + Dilation
   */
  createLocalTextMask(sourceCtx, x, y, w, h, dilation = 3) {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = Math.max(1, w);
    maskCanvas.height = Math.max(1, h);
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });

    if (w <= 0 || h <= 0) return maskCanvas;

    const imgData = sourceCtx.getImageData(x, y, w, h);
    const pixels = imgData.data;
    const total = w * h;
    const gray = new Uint8Array(total);

    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      gray[i] = Math.round(0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2]);
    }

    // 1. Kiểm tra độ sáng chu vi để xác định nền sáng hay tối
    let perimeterSum = 0;
    let perimeterCount = 0;
    for (let col = 0; col < w; col++) {
      perimeterSum += gray[col] + gray[(h - 1) * w + col];
      perimeterCount += 2;
    }
    for (let row = 1; row < h - 1; row++) {
      perimeterSum += gray[row * w] + gray[row * w + (w - 1)];
      perimeterCount += 2;
    }
    const avgPerimeter = perimeterCount > 0 ? perimeterSum / perimeterCount : 255;
    const isLightBg = avgPerimeter > 128;

    // 2. Ngưỡng Otsu
    const hist = new Uint32Array(256);
    for (let i = 0; i < total; i++) hist[gray[i]]++;

    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];

    let sumB = 0;
    let wB = 0;
    let maxVariance = 0;
    let threshold = isLightBg ? 160 : 90;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const variance = wB * wF * (mB - mF) * (mB - mF);
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = t;
      }
    }

    // 3. Tạo binary mask
    const rawMask = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (isLightBg) {
        rawMask[i] = gray[i] < threshold - 4 ? 1 : 0;
      } else {
        rawMask[i] = gray[i] > threshold + 4 ? 1 : 0;
      }
    }

    // 4. Giãn nở viền (Dilation) để bao trọn nét chữ
    const dilated = new Uint8Array(total);
    const r = Math.max(1, Math.min(8, dilation));
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        if (rawMask[cy * w + cx] === 1) {
          for (let dy = -r; dy <= r; dy++) {
            const ny = cy + dy;
            if (ny < 0 || ny >= h) continue;
            for (let dx = -r; dx <= r; dx++) {
              const nx = cx + dx;
              if (nx < 0 || nx >= w) continue;
              if (dx * dx + dy * dy <= r * r) {
                dilated[ny * w + nx] = 1;
              }
            }
          }
        }
      }
    }

    // 5. Vẽ ra canvas màu trắng (#ffffff)
    const outImgData = maskCtx.createImageData(w, h);
    for (let i = 0; i < total; i++) {
      const idx = i * 4;
      const val = dilated[i] ? 255 : 0;
      outImgData.data[idx] = val;
      outImgData.data[idx + 1] = val;
      outImgData.data[idx + 2] = val;
      outImgData.data[idx + 3] = val ? 255 : 0;
    }
    maskCtx.putImageData(outImgData, 0, 0);

    return maskCanvas;
  }

  /**
   * Xóa chữ (Inpaint) vùng khoanh bằng thuật toán 512x512 Crop & Feathered Blend
   * Toàn bộ bước nặng ONNX được chạy ngầm trong Web Worker!
   */
  async inpaintCrop(sourceImage, fullMaskCanvas, cropRect) {
    if (!this.isReady) {
      if (this.isCached) await this._warmupSessionInBackground();
      if (!this.isReady) throw new Error("Mô hình Web LaMa chưa sẵn sàng. Hãy tải model trong Cài đặt trước.");
    }

    const tStart = performance.now();
    const img = await this._loadImage(sourceImage);
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;

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
    const ctxImg512 = canvasImg512.getContext("2d", { willReadFrequently: true });
    ctxImg512.drawImage(img, boxX, boxY, boxW, boxH, 0, 0, 512, 512);

    const canvasMask512 = document.createElement("canvas");
    canvasMask512.width = 512;
    canvasMask512.height = 512;
    const ctxMask512 = canvasMask512.getContext("2d", { willReadFrequently: true });
    ctxMask512.drawImage(fullMaskCanvas, boxX, boxY, boxW, boxH, 0, 0, 512, 512);

    // Lấy pixel data (Transferable 0-copy)
    const imgPixels = ctxImg512.getImageData(0, 0, 512, 512).data;
    const maskPixels = ctxMask512.getImageData(0, 0, 512, 512).data;

    // 3. Gửi sang Web Worker xử lý
    const res = await this._sendWorkerMessage(
      "INPAINT",
      { imgPixels, maskPixels },
      [imgPixels.buffer, maskPixels.buffer],
      60000
    );

    this._recordInferenceTiming(res.durationMs || 300);

    // 4. Đưa pixel kết quả vào Canvas 512x512
    const canvasResult512 = document.createElement("canvas");
    canvasResult512.width = 512;
    canvasResult512.height = 512;
    const ctxResult512 = canvasResult512.getContext("2d");
    const resultImageData = ctxResult512.createImageData(512, 512);
    resultImageData.data.set(res.resultPixels);
    ctxResult512.putImageData(resultImageData, 0, 0);

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
    ctxFeather.filter = "blur(5px)";
    ctxFeather.drawImage(canvasFeatherMask, 0, 0);
    ctxFeather.filter = "none";

    // 7. Hòa trộn hoàn chỉnh vào ảnh trang
    const outputFullCanvas = document.createElement("canvas");
    outputFullCanvas.width = imgW;
    outputFullCanvas.height = imgH;
    const ctxOut = outputFullCanvas.getContext("2d");
    ctxOut.drawImage(img, 0, 0);

    const canvasBlendedPatch = document.createElement("canvas");
    canvasBlendedPatch.width = boxW;
    canvasBlendedPatch.height = boxH;
    const ctxBlend = canvasBlendedPatch.getContext("2d");
    ctxBlend.drawImage(canvasPatch, 0, 0);
    ctxBlend.globalCompositeOperation = "destination-in";
    ctxBlend.drawImage(canvasFeatherMask, 0, 0);

    ctxOut.drawImage(canvasBlendedPatch, boxX, boxY);

    // Giải phóng bộ nhớ intermediate canvases
    canvasImg512.width = 0; canvasImg512.height = 0;
    canvasMask512.width = 0; canvasMask512.height = 0;
    canvasResult512.width = 0; canvasResult512.height = 0;
    canvasPatch.width = 0; canvasPatch.height = 0;
    canvasFeatherMask.width = 0; canvasFeatherMask.height = 0;
    canvasBlendedPatch.width = 0; canvasBlendedPatch.height = 0;

    const tDuration = Math.round(performance.now() - tStart);
    return {
      cleanedCanvas: outputFullCanvas,
      cleanedDataUrl: outputFullCanvas.toDataURL("image/jpeg", 0.95),
      durationMs: tDuration,
      device: this.deviceMode,
    };
  }

  /**
   * Phương thức 1: Multi-Box Patch Inpainting (100% Client-Side WebGPU / WASM)
   * Tẩy từng bong bóng thoại theo danh sách Bounding Boxes với lề mở rộng 35% và Feathered Blending.
   * Chạy tuần tự trong Web Worker, 0-copy Transferables, không làm lag giao diện.
   */
  async inpaintBoxes(sourceImage, boxes = [], options = {}) {
    if (!this.isReady) {
      if (this.isCached) await this._warmupSessionInBackground();
      if (!this.isReady) throw new Error("Mô hình Web LaMa chưa sẵn sàng. Hãy tải model trong Cài đặt trước.");
    }

    const tTotalStart = performance.now();
    const img = await this._loadImage(sourceImage);
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;

    if (!Array.isArray(boxes) || boxes.length === 0) {
      const canvas = document.createElement("canvas");
      canvas.width = imgW;
      canvas.height = imgH;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return {
        cleanedCanvas: canvas,
        cleanedDataUrl: canvas.toDataURL("image/jpeg", 0.95),
        durationMs: 0,
        device: this.deviceMode,
        boxesCleaned: 0,
      };
    }

    const contextMargin = options.contextMargin !== undefined ? options.contextMargin : 0.35;
    const featherRadius = options.featherRadius || 5;
    const onProgress = options.onProgress || (() => {});
    const fullMaskCanvas = options.fullMaskCanvas || null;

    // Canvas làm việc chính
    const workingCanvas = document.createElement("canvas");
    workingCanvas.width = imgW;
    workingCanvas.height = imgH;
    const workingCtx = workingCanvas.getContext("2d", { willReadFrequently: true });
    workingCtx.drawImage(img, 0, 0);

    // Canvases tái sử dụng 512x512
    const canvasImg512 = document.createElement("canvas");
    canvasImg512.width = 512;
    canvasImg512.height = 512;
    const ctxImg512 = canvasImg512.getContext("2d", { willReadFrequently: true });

    const canvasMask512 = document.createElement("canvas");
    canvasMask512.width = 512;
    canvasMask512.height = 512;
    const ctxMask512 = canvasMask512.getContext("2d", { willReadFrequently: true });

    const canvasResult512 = document.createElement("canvas");
    canvasResult512.width = 512;
    canvasResult512.height = 512;
    const ctxResult512 = canvasResult512.getContext("2d");

    let totalBoxDuration = 0;

    for (let i = 0; i < boxes.length; i++) {
      const rawBox = boxes[i];
      // Chuẩn hóa tọa độ box
      let bx = 0, by = 0, bw = 0, bh = 0;
      if (Array.isArray(rawBox)) {
        if (rawBox.length === 4) {
          if (rawBox[0] <= 1 && rawBox[1] <= 1 && rawBox[2] <= 1 && rawBox[3] <= 1) {
            // [ymin, xmin, ymax, xmax]
            bx = Math.round(rawBox[1] * imgW);
            by = Math.round(rawBox[0] * imgH);
            bw = Math.round((rawBox[3] - rawBox[1]) * imgW);
            bh = Math.round((rawBox[2] - rawBox[0]) * imgH);
          } else {
            // [x, y, w, h]
            bx = Math.round(rawBox[0]);
            by = Math.round(rawBox[1]);
            bw = Math.round(rawBox[2]);
            bh = Math.round(rawBox[3]);
          }
        }
      } else if (typeof rawBox === "object" && rawBox !== null) {
        if (rawBox.bbox_2d && Array.isArray(rawBox.bbox_2d)) {
          const b = rawBox.bbox_2d;
          bx = Math.round((b[1] / 1000) * imgW);
          by = Math.round((b[0] / 1000) * imgH);
          bw = Math.round(((b[3] - b[1]) / 1000) * imgW);
          bh = Math.round(((b[2] - b[0]) / 1000) * imgH);
        } else {
          bx = Math.round(rawBox.x || rawBox.left || 0);
          by = Math.round(rawBox.y || rawBox.top || 0);
          bw = Math.round(rawBox.width || rawBox.w || 50);
          bh = Math.round(rawBox.height || rawBox.h || 50);
        }
      }

      // Giới hạn trong kích thước trang
      bx = Math.max(0, Math.min(imgW - 10, bx));
      by = Math.max(0, Math.min(imgH - 10, by));
      bw = Math.max(10, Math.min(imgW - bx, bw));
      bh = Math.max(10, Math.min(imgH - by, bh));

      // 1. Mở rộng lề thêm 35% (Context Margin)
      const padX = Math.max(28, Math.round(bw * contextMargin));
      const padY = Math.max(28, Math.round(bh * contextMargin));
      const cropX = Math.max(0, bx - padX);
      const cropY = Math.max(0, by - padY);
      const cropW = Math.min(imgW - cropX, bw + padX * 2);
      const cropH = Math.min(imgH - cropY, bh + padY * 2);

      // 2. Vẽ vùng ảnh lên 512x512
      ctxImg512.clearRect(0, 0, 512, 512);
      ctxImg512.drawImage(workingCanvas, cropX, cropY, cropW, cropH, 0, 0, 512, 512);

      // 3. Chuẩn bị Mask
      ctxMask512.clearRect(0, 0, 512, 512);
      let localMaskCanvas = null;
      if (fullMaskCanvas) {
        ctxMask512.drawImage(fullMaskCanvas, cropX, cropY, cropW, cropH, 0, 0, 512, 512);
      } else {
        localMaskCanvas = this.createLocalTextMask(workingCtx, bx, by, bw, bh, 3);
        ctxMask512.drawImage(localMaskCanvas, 0, 0, bw, bh, ((bx - cropX) / cropW) * 512, ((by - cropY) / cropH) * 512, (bw / cropW) * 512, (bh / cropH) * 512);
      }

      const imgPixels = ctxImg512.getImageData(0, 0, 512, 512).data;
      const maskPixels = ctxMask512.getImageData(0, 0, 512, 512).data;

      // 4. Gửi sang Web Worker bằng Transferable 0-copy
      const res = await this._sendWorkerMessage(
        "INPAINT",
        { imgPixels, maskPixels },
        [imgPixels.buffer, maskPixels.buffer],
        60000
      );

      const boxDuration = res.durationMs || 300;
      totalBoxDuration += boxDuration;
      this._recordInferenceTiming(boxDuration);

      // 5. Đưa kết quả vào Canvas 512x512
      const resultImageData = ctxResult512.createImageData(512, 512);
      resultImageData.data.set(res.resultPixels);
      ctxResult512.putImageData(resultImageData, 0, 0);

      // 6. Scale về kích thước thật và áp dụng Feathered Mask
      const canvasPatch = document.createElement("canvas");
      canvasPatch.width = cropW;
      canvasPatch.height = cropH;
      const ctxPatch = canvasPatch.getContext("2d");
      ctxPatch.drawImage(canvasResult512, 0, 0, 512, 512, 0, 0, cropW, cropH);

      const canvasFeather = document.createElement("canvas");
      canvasFeather.width = cropW;
      canvasFeather.height = cropH;
      const ctxFeather = canvasFeather.getContext("2d");

      if (fullMaskCanvas) {
        ctxFeather.drawImage(fullMaskCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      } else if (localMaskCanvas) {
        ctxFeather.drawImage(localMaskCanvas, bx - cropX, by - cropY);
      } else {
        ctxFeather.fillStyle = "#ffffff";
        ctxFeather.fillRect(bx - cropX, by - cropY, bw, bh);
      }

      ctxFeather.filter = `blur(${featherRadius}px)`;
      ctxFeather.drawImage(canvasFeather, 0, 0);
      ctxFeather.filter = "none";

      // Hòa trộn khớp vào workingCanvas
      const canvasBlended = document.createElement("canvas");
      canvasBlended.width = cropW;
      canvasBlended.height = cropH;
      const ctxBlended = canvasBlended.getContext("2d");
      ctxBlended.drawImage(canvasPatch, 0, 0);
      ctxBlended.globalCompositeOperation = "destination-in";
      ctxBlended.drawImage(canvasFeather, 0, 0);

      workingCtx.drawImage(canvasBlended, cropX, cropY);

      // Giải phóng bộ nhớ intermediate canvases
      canvasPatch.width = 0; canvasPatch.height = 0;
      canvasFeather.width = 0; canvasFeather.height = 0;
      canvasBlended.width = 0; canvasBlended.height = 0;
      if (localMaskCanvas) { localMaskCanvas.width = 0; localMaskCanvas.height = 0; }

      // Báo tiến trình cho UI
      onProgress(i + 1, boxes.length, Math.round(((i + 1) / boxes.length) * 100), boxDuration);
    }

    // Dọn dẹp canvases tạm 512
    canvasImg512.width = 0; canvasImg512.height = 0;
    canvasMask512.width = 0; canvasMask512.height = 0;
    canvasResult512.width = 0; canvasResult512.height = 0;

    const totalDurationMs = Math.round(performance.now() - tTotalStart);
    return {
      cleanedCanvas: workingCanvas,
      cleanedDataUrl: workingCanvas.toDataURL("image/jpeg", 0.95),
      durationMs: totalDurationMs,
      device: this.deviceMode,
      boxesCleaned: boxes.length,
      avgBoxMs: Math.round(totalBoxDuration / boxes.length),
    };
  }

  /**
   * Phương thức 2: Full-Page Slided Tiling (100% Client-Side WebGPU / WASM)
   * Tẩy toàn trang bằng quét lưới 512x512 (gối đè 128px, bước nhảy 384px).
   * Chỉ suy luận những ô có chứa pixel mask > 0 để tối đa tốc độ GPU.
   */
  async inpaintFullPage(sourceImage, fullMaskCanvas = null, options = {}) {
    if (!this.isReady) {
      if (this.isCached) await this._warmupSessionInBackground();
      if (!this.isReady) throw new Error("Mô hình Web LaMa chưa sẵn sàng. Hãy tải model trong Cài đặt trước.");
    }

    const tStart = performance.now();
    const img = await this._loadImage(sourceImage);
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;
    const onProgress = options.onProgress || (() => {});

    // Canvas làm việc
    const workingCanvas = document.createElement("canvas");
    workingCanvas.width = imgW;
    workingCanvas.height = imgH;
    const workingCtx = workingCanvas.getContext("2d", { willReadFrequently: true });
    workingCtx.drawImage(img, 0, 0);

    // Nếu không truyền mask, tạo mask nhị phân từ toàn bộ trang
    let maskCanvas = fullMaskCanvas;
    if (!maskCanvas) {
      maskCanvas = this.createLocalTextMask(workingCtx, 0, 0, imgW, imgH, 3);
    }
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });

    const tileSize = 512;
    const overlap = 128;
    const stride = tileSize - overlap; // 384px

    // 1. Quét tìm danh sách các ô (tiles) thực sự có mask
    const activeTiles = [];
    for (let y = 0; y < imgH; y += stride) {
      for (let x = 0; x < imgW; x += stride) {
        const curX = Math.min(x, Math.max(0, imgW - tileSize));
        const curY = Math.min(y, Math.max(0, imgH - tileSize));
        const curW = Math.min(tileSize, imgW - curX);
        const curH = Math.min(tileSize, imgH - curY);

        // Đọc dữ liệu mask trong ô này
        const maskData = maskCtx.getImageData(curX, curY, curW, curH).data;
        let hasMask = false;
        // Quét lấy mẫu nhanh (bước nhảy 16 bytes)
        for (let k = 0; k < maskData.length; k += 16) {
          if (maskData[k] > 15 || maskData[k + 3] > 15) {
            hasMask = true;
            break;
          }
        }
        if (hasMask) {
          activeTiles.push({ x: curX, y: curY, w: curW, h: curH });
        }
      }
    }

    if (activeTiles.length === 0) {
      return {
        cleanedCanvas: workingCanvas,
        cleanedDataUrl: workingCanvas.toDataURL("image/jpeg", 0.95),
        durationMs: Math.round(performance.now() - tStart),
        device: this.deviceMode,
        tilesProcessed: 0,
      };
    }

    // 2. Canvases 512x512
    const canvasImg512 = document.createElement("canvas");
    canvasImg512.width = tileSize;
    canvasImg512.height = tileSize;
    const ctxImg512 = canvasImg512.getContext("2d", { willReadFrequently: true });

    const canvasMask512 = document.createElement("canvas");
    canvasMask512.width = tileSize;
    canvasMask512.height = tileSize;
    const ctxMask512 = canvasMask512.getContext("2d", { willReadFrequently: true });

    const canvasResult512 = document.createElement("canvas");
    canvasResult512.width = tileSize;
    canvasResult512.height = tileSize;
    const ctxResult512 = canvasResult512.getContext("2d");

    for (let i = 0; i < activeTiles.length; i++) {
      const tile = activeTiles[i];

      ctxImg512.clearRect(0, 0, tileSize, tileSize);
      ctxImg512.drawImage(workingCanvas, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);

      ctxMask512.clearRect(0, 0, tileSize, tileSize);
      ctxMask512.drawImage(maskCanvas, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);

      const imgPixels = ctxImg512.getImageData(0, 0, tileSize, tileSize).data;
      const maskPixels = ctxMask512.getImageData(0, 0, tileSize, tileSize).data;

      const res = await this._sendWorkerMessage(
        "INPAINT",
        { imgPixels, maskPixels },
        [imgPixels.buffer, maskPixels.buffer],
        60000
      );

      this._recordInferenceTiming(res.durationMs || 300);

      const resultImageData = ctxResult512.createImageData(tileSize, tileSize);
      resultImageData.data.set(res.resultPixels);
      ctxResult512.putImageData(resultImageData, 0, 0);

      // Feathered blend mask
      const canvasFeather = document.createElement("canvas");
      canvasFeather.width = tile.w;
      canvasFeather.height = tile.h;
      const ctxFeather = canvasFeather.getContext("2d");
      ctxFeather.drawImage(maskCanvas, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
      ctxFeather.filter = "blur(6px)";
      ctxFeather.drawImage(canvasFeather, 0, 0);
      ctxFeather.filter = "none";

      const canvasBlended = document.createElement("canvas");
      canvasBlended.width = tile.w;
      canvasBlended.height = tile.h;
      const ctxBlended = canvasBlended.getContext("2d");
      ctxBlended.drawImage(canvasResult512, 0, 0, tile.w, tile.h, 0, 0, tile.w, tile.h);
      ctxBlended.globalCompositeOperation = "destination-in";
      ctxBlended.drawImage(canvasFeather, 0, 0);

      workingCtx.drawImage(canvasBlended, tile.x, tile.y);

      // Giải phóng
      canvasFeather.width = 0; canvasFeather.height = 0;
      canvasBlended.width = 0; canvasBlended.height = 0;

      onProgress(i + 1, activeTiles.length, Math.round(((i + 1) / activeTiles.length) * 100));
    }

    canvasImg512.width = 0; canvasImg512.height = 0;
    canvasMask512.width = 0; canvasMask512.height = 0;
    canvasResult512.width = 0; canvasResult512.height = 0;

    const totalDuration = Math.round(performance.now() - tStart);
    return {
      cleanedCanvas: workingCanvas,
      cleanedDataUrl: workingCanvas.toDataURL("image/jpeg", 0.95),
      durationMs: totalDuration,
      device: this.deviceMode,
      tilesProcessed: activeTiles.length,
    };
  }

  /**
   * Điều phối tổng quát (Universal Inpaint Dispatcher)
   */
  async inpaintPage(sourceImage, options = {}) {
    if (Array.isArray(options.boxes) && options.boxes.length > 0) {
      return await this.inpaintBoxes(sourceImage, options.boxes, options);
    }
    return await this.inpaintFullPage(sourceImage, options.fullMaskCanvas || null, options);
  }
}
