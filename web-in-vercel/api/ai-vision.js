// Vercel Serverless Function: POST /api/ai-vision
// Unified AI Endpoint for Manga Vision: OCR, Dịch thuật, và 1-Pass Spatial 2D Bounding Boxes
const multer = require("multer");
const {
  getAllGeminiApiKeys,
  callGeminiWithFallback,
  buildOcrPrompt,
  buildTranslatePrompt,
  buildCombinedPrompt,
  parseCombinedOutput,
  buildUnifiedSpatialPrompt,
  parseUnifiedSpatialOutput,
  extractText,
  sanitizePrevContext,
  aiDeduplicationCache,
  computeDeduplicationHash,
} = require("./batch-helper");
const { sortReadingOrder } = require("./manga-contract");

// Cấu hình Multer nhận Binary Multipart (Buffer in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB nhị phân
  },
});

function runMulterMiddleware(req, res) {
  return new Promise((resolve) => {
    // Chỉ chạy multer nếu request có header multipart
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      upload.single("image")(req, res, (err) => {
        if (err) {
          console.warn("[ai-vision] Multer parse warning:", err.message);
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const startTime = Date.now();

  try {
    // 1. Phân tích multipart binary nếu có
    await runMulterMiddleware(req, res);

    const body = req.body || {};

    // 2. Kiểm tra Payload Guard (Tránh lỗi 413 Vercel Payload Too Large)
    const rawBase64Input = body.imageBase64 || body.image || "";
    if (typeof rawBase64Input === "string" && rawBase64Input.length > 4.2 * 1024 * 1024) {
      return res.status(413).json({
        error: "Payload Base64 quá lớn (> 4.2MB). Vui lòng gửi ảnh dưới dạng Blob binary (multipart/form-data) hoặc nén ảnh trước khi gửi.",
        code: 413,
      });
    }

    let imageBuffer = null;
    let base64Image = "";
    let mimeType = "image/jpeg";

    if (req.file && req.file.buffer) {
      imageBuffer = req.file.buffer;
      mimeType = req.file.mimetype || "image/jpeg";
      base64Image = imageBuffer.toString("base64");
    } else if (rawBase64Input) {
      const match = rawBase64Input.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Image = match[2];
      } else {
        base64Image = rawBase64Input;
      }
      try {
        imageBuffer = Buffer.from(base64Image, "base64");
      } catch (_) {
        imageBuffer = null;
      }
    }

    const mode = body.mode || "all"; // 'unified_spatial' | 'all' | 'ocr_only' | 'translate_only'

    // Nếu không phải translate_only mà thiếu ảnh thì báo lỗi
    if (mode !== "translate_only" && !base64Image) {
      return res.status(400).json({
        error: "Không tìm thấy dữ liệu ảnh (Vui lòng gửi file ảnh qua multipart hoặc chuỗi imageBase64).",
      });
    }

    // 3. Quản lý Gemini API Keys
    const clientKey = body.apiKey;
    const clientKey2 = body.apiKey2;
    const preferredKey = body.preferredKey;

    let allKeys = getAllGeminiApiKeys(clientKey, clientKey2);
    if (preferredKey && preferredKey.trim()) {
      const pk = preferredKey.trim();
      allKeys = [pk, ...allKeys.filter((k) => k !== pk)];
    }

    if (allKeys.length === 0) {
      return res.status(400).json({
        error: "Chưa có Gemini API Key! Vui lòng cấu hình API_KEY_GEMINI trong .env hoặc nhập trong Cài đặt.",
      });
    }

    const modelName = body.model || "gemini-3.1-flash-lite";
    const sourceLang = body.sourceLang || "ja";
    const targetLang = body.targetLang || "vi";
    const tone = body.tone || "natural";
    const skipSFX = body.skipSFX === true || body.skipSFX === "true";
    const readingOrder = body.readingOrder || body.comicType || "manga";
    const glossary = body.glossary || "";
    const prevContext = sanitizePrevContext(body.prevContext);

    // 4. Kiểm tra Bộ nhớ đệm (Deduplication Cache Hit)
    const cacheKey = computeDeduplicationHash(
      imageBuffer || (body.text_jp || body.existingOcr || body.text || ""),
      {
        model: modelName,
        sourceLang,
        targetLang,
        mode,
        tone,
        skipSFX,
        readingOrder,
        inputSnippet: (body.text_jp || body.existingOcr || body.text || "").slice(0, 100),
      }
    );

    const cached = aiDeduplicationCache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.status(200).json({
        ...cached,
        fromCache: true,
        cachedAt: cached.cachedAt || Date.now(),
        durationMs: Date.now() - startTime,
      });
    }

    let ocrTextBlock = body.existingOcr || body.text_jp || body.text || "";
    let viTextBlock = "";
    let bubblesOutput = [];
    let modelUsedFinal = modelName;
    let keyUsedIndex = 0;
    let missing = [];

    const imagePart = base64Image
      ? { inline_data: { mime_type: mimeType, data: base64Image } }
      : null;

    // Helper gọi Gemini có rate limit & retry
    async function callGemini(promptText, generationConfig = {}) {
      const parts = [{ text: promptText }];
      if (imagePart) parts.push(imagePart);

      const out = await callGeminiWithFallback(modelName, allKeys, {
        contents: [{ parts }],
        generationConfig,
      });
      modelUsedFinal = out.modelUsed;
      keyUsedIndex = out.keyIndex || 0;
      return extractText(out.data);
    }

    // 5. Thực thi theo chế độ (Mode Execution)
    if (mode === "unified_spatial") {
      // 1-Pass Unified Vision Pipeline: Bounding Box 2D [0-1000] + Emotion + OCR + Dịch
      try {
        const raw = await callGemini(
          buildUnifiedSpatialPrompt({ sourceLang, targetLang, skipSfx: skipSFX, readingOrder, tone, prevContext, glossary }),
          { temperature: 0.5, responseMimeType: "application/json" }
        );
        const parsedSpatial = parseUnifiedSpatialOutput(raw);
        if (parsedSpatial && parsedSpatial.bubbles && parsedSpatial.bubbles.length > 0) {
          bubblesOutput = parsedSpatial.bubbles;
          ocrTextBlock = bubblesOutput.map((b) => b.text_original).join("\n");
          viTextBlock = bubblesOutput.map((b) => b.text_translated).join("\n");
          missing = parsedSpatial.missing || [];
        } else {
          throw new Error("Không thể parse danh sách bubbles từ kết quả Unified Spatial.");
        }
      } catch (errSpatial) {
        console.warn("[ai-vision] Unified Spatial lỗi, fallback sang combined prompt:", errSpatial.message);
        const rawCombined = await callGemini(
          buildCombinedPrompt({ sourceLang, targetLang, skipSfx: skipSFX, readingOrder, tone, prevContext, glossary }),
          { temperature: 0.6, responseMimeType: "application/json" }
        );
        const parsedCombined = parseCombinedOutput(rawCombined);
        if (parsedCombined && parsedCombined.lines && parsedCombined.lines.length > 0) {
          ocrTextBlock = parsedCombined.lines.map((l) => l.src).join("\n");
          viTextBlock = parsedCombined.lines.map((l) => l.tgt).join("\n");
          missing = parsedCombined.missing || [];
          bubblesOutput = parsedCombined.lines.map((l, idx) => ({
            id: idx + 1,
            box_2d: l.box || [100, 100, 300, 300],
            type: "dialogue",
            text_original: l.src,
            text_translated: l.tgt,
            src: l.src,
            tgt: l.tgt,
          }));
        }
      }
    } else if (mode === "all") {
      // Combined OCR + Translate
      const raw = await callGemini(
        buildCombinedPrompt({ sourceLang, targetLang, skipSfx: skipSFX, readingOrder, tone, prevContext, glossary }),
        { temperature: 0.6, responseMimeType: "application/json" }
      );
      const parsed = parseCombinedOutput(raw);
      if (parsed && parsed.lines && parsed.lines.length > 0) {
        ocrTextBlock = parsed.lines.map((l) => l.src).join("\n");
        viTextBlock = parsed.lines.map((l) => l.tgt).join("\n");
        missing = parsed.missing || [];
        bubblesOutput = parsed.lines;
      } else {
        // Fallback tuần tự: OCR trước rồi Dịch
        const ocrRaw = await callGemini(buildOcrPrompt({ sourceLang, skipSfx: skipSFX, readingOrder }));
        ocrTextBlock = ocrRaw || "";
        if (ocrTextBlock.trim()) {
          const transRaw = await callGemini(buildTranslatePrompt({ sourceLang, targetLang, tone, prevContext, glossary, ocrText: ocrTextBlock }));
          viTextBlock = transRaw || "";
        }
      }
    } else if (mode === "ocr_only") {
      // Chỉ nhận diện OCR (Tương thích thay thế cho /api/ocr)
      const ocrRaw = await callGemini(buildOcrPrompt({ sourceLang, skipSfx: skipSFX, readingOrder }));
      ocrTextBlock = ocrRaw || "";
    } else if (mode === "translate_only") {
      // Chỉ dịch văn bản (Tương thích thay thế cho /api/translate-text)
      if (!ocrTextBlock.trim()) {
        return res.status(400).json({ error: "Không tìm thấy nội dung văn bản để dịch." });
      }
      const transRaw = await callGemini(buildTranslatePrompt({ sourceLang, targetLang, tone, prevContext, glossary, ocrText: ocrTextBlock }));
      viTextBlock = transRaw || "";
    }

    const durationMs = Date.now() - startTime;

    // Chuẩn hóa layers theo chuẩn V2 Contract
    const rawLayers = (bubblesOutput || []).map((b, idx) => ({
      id: b.id || `bubble_${String(idx + 1).padStart(2, "0")}`,
      order_index: idx + 1,
      type: b.type || (b.is_sfx ? "sfx" : "speech_bubble"),
      box_2d: b.box_2d || b.box || [0, 0, 0, 0],
      geometry: {
        is_pure_white_bg: b.is_pure_white_bg ?? true,
        confidence: b.confidence ?? 0.95,
      },
      typography: {
        orientation: b.orientation || "vertical",
        suggested_font_size_pt: b.font_size || 18,
        text_align: "center",
        font_color: "#000000",
      },
      content: {
        original_text: b.text_original || b.src || "",
        translated_text: b.text_translated || b.tgt || "",
        confidence: b.confidence ?? 0.95,
      },
    }));

    const sortedLayers = sortReadingOrder(rawLayers, readingOrder);

    const responsePayload = {
      version: "2.0.0",
      status: "success",
      success: true,
      mode,
      modelUsed: modelUsedFinal,
      keyIndex: keyUsedIndex,
      durationMs,
      lineCount: ocrTextBlock ? ocrTextBlock.split("\n").filter(Boolean).length : 0,
      ocrTextBlock,
      viTextBlock,
      layers: sortedLayers,
      bubbles: bubblesOutput,
      missing,
      // Các trường alias hỗ trợ tương thích ngược tối đa
      text: ocrTextBlock,
      text_jp: ocrTextBlock,
      text_vi: viTextBlock,
      translatedText: viTextBlock,
      cachedAt: Date.now(),
    };

    // 6. Lưu vào LRU Cache
    aiDeduplicationCache.set(cacheKey, responsePayload);

    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("[ai-vision] Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Lỗi xử lý AI Vision",
      durationMs: Date.now() - startTime,
    });
  }
};
