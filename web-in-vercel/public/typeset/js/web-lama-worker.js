/**
 * Web Manga LaMa Dedicated Background Worker
 * Runs ONNX Runtime Web in a dedicated thread to completely eliminate UI freezes and "Page Unresponsive" dialogs.
 */

self.importScripts("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.all.min.js");

const CACHE_NAME = "manga-studio-lama-v1";
const CACHE_KEY = "model_lama_manga.onnx";

let session = null;
let deviceMode = "none";
let imageInputName = "image";
let maskInputName = "mask";
let outputName = "output";

// Configure WASM paths and threading
if (self.ort && self.ort.env && self.ort.env.wasm) {
  self.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";
  self.ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
  self.ort.env.wasm.simd = true;
}

async function createInferenceSession(arrayBuffer) {
  if (session) {
    try {
      if (typeof session.release === "function") await session.release();
    } catch (_) {}
    session = null;
  }

  // 1. Thử ưu tiên WebGPU (Card màn hình / GPU)
  try {
    session = await self.ort.InferenceSession.create(arrayBuffer, {
      executionProviders: ["webgpu"],
      graphOptimizationLevel: "all",
    });
    deviceMode = "webgpu";
    console.log("[WebLamaWorker] Initialized successfully with WebGPU!");
  } catch (gpuErr) {
    console.warn("[WebLamaWorker] WebGPU unavailable or failed, falling back to WASM CPU:", gpuErr);
    // 2. Fallback sang WASM SIMD trên CPU
    session = await self.ort.InferenceSession.create(arrayBuffer, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    deviceMode = "wasm";
    console.log("[WebLamaWorker] Initialized successfully with WASM CPU!");
  }

  const inputNames = session.inputNames || [];
  imageInputName =
    inputNames.find((n) => n.toLowerCase().includes("img") || n.toLowerCase().includes("image") || n.toLowerCase().includes("input")) ||
    inputNames[0] ||
    "image";

  maskInputName =
    inputNames.find((n) => n.toLowerCase().includes("mask")) ||
    inputNames[1] ||
    "mask";

  outputName = session.outputNames?.[0] || "output";

  return { deviceMode, imageInputName, maskInputName, outputName };
}

async function runInference(imgPixels, maskPixels) {
  if (!session) throw new Error("Session Web LaMa chưa được khởi tạo");

  const numPixels = 512 * 512;
  const imgTensorData = new Float32Array(3 * numPixels);
  const maskTensorData = new Float32Array(numPixels);

  // Normalize image RGB [0.0, 1.0] và mask nhị phân [0.0, 1.0]
  for (let i = 0; i < numPixels; i++) {
    const pIdx = i * 4;
    imgTensorData[i] = imgPixels[pIdx] / 255.0; // R
    imgTensorData[numPixels + i] = imgPixels[pIdx + 1] / 255.0; // G
    imgTensorData[numPixels * 2 + i] = imgPixels[pIdx + 2] / 255.0; // B

    const maskVal = Math.max(maskPixels[pIdx], maskPixels[pIdx + 1], maskPixels[pIdx + 2], maskPixels[pIdx + 3]);
    maskTensorData[i] = maskVal > 15 ? 1.0 : 0.0;
  }

  const imgTensor = new self.ort.Tensor("float32", imgTensorData, [1, 3, 512, 512]);
  const maskTensor = new self.ort.Tensor("float32", maskTensorData, [1, 1, 512, 512]);

  const feeds = {};
  feeds[imageInputName] = imgTensor;
  feeds[maskInputName] = maskTensor;

  const results = await session.run(feeds);
  const outputTensor = results[outputName];
  if (!outputTensor || !outputTensor.data) {
    throw new Error("Model Inpainting không trả về kết quả hợp lệ.");
  }

  const outData = outputTensor.data;
  const resultPixels = new Uint8ClampedArray(numPixels * 4);

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
    resultPixels[pIdx] = Math.min(255, Math.max(0, Math.round(outData[i] * scale)));
    resultPixels[pIdx + 1] = Math.min(255, Math.max(0, Math.round(outData[numPixels + i] * scale)));
    resultPixels[pIdx + 2] = Math.min(255, Math.max(0, Math.round(outData[numPixels * 2 + i] * scale)));
    resultPixels[pIdx + 3] = 255;
  }

  return resultPixels;
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;

  try {
    if (type === "CHECK_STATUS") {
      let isCached = false;
      let cachedSize = 0;
      if ("caches" in self) {
        try {
          const cache = await self.caches.open(CACHE_NAME);
          const match = await cache.match(CACHE_KEY);
          if (match) {
            isCached = true;
            const blob = await match.blob();
            cachedSize = blob.size;
          }
        } catch (_) {}
      }
      self.postMessage({
        id,
        success: true,
        data: {
          isCached,
          cachedSize,
          isReady: Boolean(session),
          deviceMode,
        },
      });
    } else if (type === "INIT_FROM_CACHE") {
      if (!("caches" in self)) throw new Error("Trình duyệt không hỗ trợ CacheStorage.");
      const cache = await self.caches.open(CACHE_NAME);
      const match = await cache.match(CACHE_KEY);
      if (!match) throw new Error("Chưa tìm thấy model trong bộ nhớ đệm.");
      const arrayBuffer = await match.arrayBuffer();
      const meta = await createInferenceSession(arrayBuffer);
      self.postMessage({ id, success: true, data: meta });
    } else if (type === "INIT_FROM_BUFFER") {
      const { buffer, saveCache } = payload;
      if (saveCache && "caches" in self) {
        try {
          const cache = await self.caches.open(CACHE_NAME);
          const response = new Response(buffer.slice(0), {
            headers: { "Content-Type": "application/octet-stream" },
          });
          await cache.put(CACHE_KEY, response);
        } catch (cacheErr) {
          console.warn("[WebLamaWorker] Không thể ghi cache:", cacheErr);
        }
      }
      const meta = await createInferenceSession(buffer);
      self.postMessage({ id, success: true, data: meta });
    } else if (type === "INPAINT") {
      const { imgPixels, maskPixels } = payload;
      const resultPixels = await runInference(imgPixels, maskPixels);
      self.postMessage(
        { id, success: true, data: { resultPixels } },
        [resultPixels.buffer]
      );
    } else if (type === "CLEAR_CACHE") {
      if (session) {
        try {
          if (typeof session.release === "function") await session.release();
        } catch (_) {}
        session = null;
      }
      deviceMode = "none";
      if ("caches" in self) {
        try {
          await self.caches.delete(CACHE_NAME);
        } catch (e) {
          console.warn("[WebLamaWorker] Lỗi xóa cache:", e);
        }
      }
      self.postMessage({ id, success: true });
    }
  } catch (err) {
    self.postMessage({ id, success: false, error: err.message || String(err) });
  }
};
