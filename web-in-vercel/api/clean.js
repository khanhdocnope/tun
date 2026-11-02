// Vercel Serverless Function: POST /api/clean
// Proxy inpainting backend (AOT / LaMa) with Multer Binary, 413 Guard & V2 Contract
const multer = require("multer");
const { formatMangaPageResponse } = require("./manga-contract");

const DEFAULT_BACKEND = (process.env.BACKEND_URL || "https://dobietdc-manga-text-cleaner.hf.space").replace(/\/$/, "");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

function runMulterMiddleware(req, res) {
  return new Promise((resolve) => {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      upload.fields([
        { name: "image", maxCount: 1 },
        { name: "mask", maxCount: 1 },
      ])(req, res, (err) => {
        if (err) console.warn("[api/clean] Multer parse warning:", err.message);
        resolve();
      });
    } else {
      resolve();
    }
  });
}

function normalizeBackendUrl(url) {
  if (!url || typeof url !== "string") return DEFAULT_BACKEND;
  let trimmed = url.trim().replace(/\/$/, "");

  // Tự động sửa lỗi gõ thiếu chữ r: manga-text-cleane -> manga-text-cleaner
  trimmed = trimmed.replace(/manga-text-cleane(?=$|[\/?#])/i, "manga-text-cleaner");

  const spaceMatch = trimmed.match(/huggingface\.co\/spaces\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/i);
  if (spaceMatch) {
    const user = spaceMatch[1].toLowerCase();
    const space = spaceMatch[2].toLowerCase();
    return `https://${user}-${space}.hf.space`;
  }

  return trimmed;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    await runMulterMiddleware(req, res);

    const body = req.body || {};

    // 413 Payload Guard
    const rawBase64 = body.imageBase64 || body.image || "";
    if (typeof rawBase64 === "string" && rawBase64.length > 4.2 * 1024 * 1024) {
      return res.status(413).json({
        error: "Payload Base64 quá lớn (> 4.2MB). Vui lòng gửi ảnh dưới dạng Blob nhị phân (multipart/form-data) hoặc nén ảnh JPEG/WebP trước khi gửi.",
        code: 413,
      });
    }

    let imageBase64 = "";
    let maskBase64 = body.maskBase64 || "";

    if (req.files && req.files.image && req.files.image[0]) {
      const imgFile = req.files.image[0];
      const mime = imgFile.mimetype || "image/jpeg";
      imageBase64 = `data:${mime};base64,${imgFile.buffer.toString("base64")}`;
    } else if (rawBase64) {
      imageBase64 = rawBase64;
    }

    if (req.files && req.files.mask && req.files.mask[0]) {
      const maskFile = req.files.mask[0];
      const mime = maskFile.mimetype || "image/png";
      maskBase64 = `data:${mime};base64,${maskFile.buffer.toString("base64")}`;
    }

    if (!imageBase64) {
      return res.status(400).json({ error: "Thiếu dữ liệu ảnh (imageBase64 hoặc binary file)." });
    }

    const {
      cleanSFX,
      dilationPx,
      dilation_offset,
      dilationOffset,
      detThreshold,
      inpaintModel,
      detector = "default",
      inpainter = "aot",
      backendUrl,
      readingDirection = "rtl",
    } = body;

    const targetBackend = normalizeBackendUrl(backendUrl);
    const dilationVal = dilationOffset !== undefined ? dilationOffset : (dilation_offset !== undefined ? dilation_offset : (dilationPx !== undefined ? dilationPx : 0));

    // Thử gọi /api/clean trước
    const mitPayload = {
      imageBase64,
      detector: detector || "default",
      inpainter: inpainter || (inpaintModel === "anime-lama" ? "lama_large" : "aot"),
      dilation_offset: Number(dilationVal),
      dilationOffset: Number(dilationVal),
      readingDirection: readingDirection || "rtl",
    };
    if (maskBase64) {
      mitPayload.maskBase64 = maskBase64;
    }

    try {
      const respMit = await fetch(`${targetBackend}/api/clean`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(mitPayload),
        signal: AbortSignal.timeout(60000),
      });

      if (respMit.ok) {
        const result = await respMit.json();
        return res.status(200).json({
          success: true,
          cleanedImageBase64: result.cleanedImageBase64,
          ...result,
        });
      }

      if (respMit.status === 413) {
        return res.status(413).json({
          error: "Ảnh gửi lên backend quá lớn (vượt giới hạn 413). Vui lòng dùng tính năng tự động nén hoặc tải lại ảnh.",
        });
      }

      if (respMit.status !== 404 && respMit.status !== 405 && respMit.status !== 422) {
        const errText = await respMit.text();
        return res.status(respMit.status).json({
          error: `Lỗi từ backend (${respMit.status}): ${errText}`,
        });
      }
    } catch (e) {
      if (targetBackend.includes("localhost")) {
        throw e;
      }
    }

    // Fallback sang endpoint /clean_page (Backend HuggingFace cũ)
    const safeLegacyModel = (inpaintModel === "aot" || inpainter === "aot")
      ? "anime-lama"
      : (inpaintModel || inpainter || "anime-lama");

    const legacyPayload = {
      imageBase64,
      cleanSFX: Boolean(cleanSFX),
      dilationPx: Number(dilationVal || 4),
      detThreshold: Number(detThreshold || 0.20),
      inpaintModel: safeLegacyModel,
      readingDirection: readingDirection || "rtl",
    };

    const response = await fetch(`${targetBackend}/clean_page`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(legacyPayload),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      if (response.status === 413) {
        return res.status(413).json({
          error: "Ảnh gửi lên backend quá lớn (vượt giới hạn 413). Vui lòng dùng tính năng tự động nén hoặc tải lại ảnh.",
        });
      }
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Lỗi từ backend (${response.status}): ${errText}`,
      });
    }

    const result = await response.json();
    return res.status(200).json({
      success: true,
      cleanedImageBase64: result.cleanedImageBase64,
      colorMaskBase64: result.colorMaskBase64,
      layers: result.layers || [],
      ...result,
    });
  } catch (err) {
    console.error("api/clean error:", err);
    return res.status(500).json({
      error: `Cloud Function lỗi khi xử lý inpainting: ${err.message}`,
    });
  }
};
