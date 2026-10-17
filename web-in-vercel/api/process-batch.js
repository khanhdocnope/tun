// Vercel Serverless Function: POST /api/process-batch
const {
  getAllGeminiApiKeys,
  callGeminiWithFallback,
  stripEmptyLines,
  buildOcrPrompt,
  buildTranslatePrompt,
  buildCombinedPrompt,
  parseCombinedOutput,
  extractText,
  sanitizePrevContext
} = require("./batch-helper");

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
    let base64Image = "";
    let mimeType = "image/jpeg";

    if (req.file) {
      base64Image = req.file.buffer.toString("base64");
      mimeType = req.file.mimetype || "image/jpeg";
    } else if (req.body && req.body.imageBase64) {
      const match = req.body.imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Image = match[2];
      } else {
        base64Image = req.body.imageBase64;
      }
    } else {
      return res.status(400).json({ error: "Không tìm thấy dữ liệu ảnh (imageBase64)." });
    }

    const clientKey = req.body && req.body.apiKey;
    const clientKey2 = req.body && req.body.apiKey2;
    const preferredKey = req.body && req.body.preferredKey;

    let allKeys = getAllGeminiApiKeys(clientKey, clientKey2);
    if (preferredKey && preferredKey.trim()) {
      const pk = preferredKey.trim();
      allKeys = [pk, ...allKeys.filter(k => k !== pk)];
    }

    if (allKeys.length === 0) {
      return res.status(400).json({
        error: "Chưa có API Key! Vui lòng cấu hình API_KEY_GEMINI trong .env hoặc nhập trong Cài đặt."
      });
    }

    const modelName = (req.body && req.body.model) || "gemini-3.1-flash-lite";
    const sourceLang = (req.body && req.body.sourceLang) || "ja";
    const targetLang = (req.body && req.body.targetLang) || "vi";
    const tone = (req.body && req.body.tone) || "natural";
    const skipSFX = req.body && (req.body.skipSFX === true || req.body.skipSFX === "true");
    const mode = (req.body && req.body.mode) || "all"; // 'all', 'ocr_only', 'translate_only'
    const readingOrder = (req.body && (req.body.readingOrder || req.body.comicType)) || "manga";

    const prevContext = sanitizePrevContext(req.body && req.body.prevContext);

    let ocrTextBlock = (req.body && req.body.existingOcr) || "";
    let viTextBlock = "";
    let modelUsedFinal = modelName;
    let keyUsedIndex = 0;
    let totalElapsed = 0;
    let apiCalls = 0;
    let missing = [];
    let usedFallback = false;

    const imagePart = { inline_data: { mime_type: mimeType, data: base64Image } };

    // Một lần gọi Gemini, cộng dồn thống kê
    async function callGemini(promptText, generationConfig) {
      const started = Date.now();
      const out = await callGeminiWithFallback(modelName, allKeys, {
        contents: [{ parts: [{ text: promptText }, imagePart] }],
        generationConfig
      });
      totalElapsed += Date.now() - started;
      apiCalls += 1;
      modelUsedFinal = out.modelUsed;
      keyUsedIndex = out.keyIndex || 0;
      return extractText(out.data);
    }

    // Luồng 2 bước cũ (OCR rồi dịch) - dùng cho ocr_only / translate_only và làm fallback
    async function runOcrStep() {
      const raw = await callGemini(buildOcrPrompt(sourceLang, skipSFX, readingOrder), { temperature: 0.1 });
      ocrTextBlock = stripEmptyLines(raw.replace(/\n\s*\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim());
    }

    async function runTranslateStep() {
      const raw = await callGemini(
        buildTranslatePrompt(ocrTextBlock, sourceLang, targetLang, tone, readingOrder, prevContext),
        { temperature: 0.6 }
      );
      viTextBlock = stripEmptyLines(
        raw.replace(/^(?:Translation:|Translated text:|Here is the translation:)/i, "").trim()
      );
    }

    if (mode === "all") {
      // OCR + dịch trong MỘT lần gọi -> mỗi trang tốn 1 request thay vì 2
      const raw = await callGemini(
        buildCombinedPrompt({ sourceLang, targetLang, skipSfx: skipSFX, readingOrder, tone, prevContext }),
        { temperature: 0.6, responseMimeType: "application/json" }
      );
      const parsed = parseCombinedOutput(raw);

      if (parsed) {
        ocrTextBlock = parsed.lines.map((l) => l.src).join("\n");
        viTextBlock = parsed.lines.map((l) => l.tgt).join("\n");
        missing = parsed.missing;
      } else {
        // Gemini trả JSON hỏng -> quay lại luồng 2 bước để vẫn có kết quả
        console.warn("[process-batch] Combined output không parse được, fallback 2 bước.");
        usedFallback = true;
        await runOcrStep();
        if (ocrTextBlock) await runTranslateStep();
      }
    } else {
      if (mode === "ocr_only") await runOcrStep();
      if (mode === "translate_only" && ocrTextBlock) await runTranslateStep();
    }

    res.json({
      success: true,
      timeMs: totalElapsed,
      model: modelUsedFinal,
      keyIndex: keyUsedIndex,
      apiCalls,
      fallback: usedFallback,
      missingTranslation: missing,
      lineCount: ocrTextBlock ? ocrTextBlock.split("\n").length : 0,
      ocrTextBlock,
      viTextBlock
    });
  } catch (error) {
    console.error("Batch process error:", error);
    res.status(500).json({ error: error.message || "Lỗi xử lý ảnh." });
  }
};
