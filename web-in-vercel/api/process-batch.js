// Vercel Serverless Function: POST /api/process-batch
const {
  getGeminiApiKey,
  callGeminiWithFallback,
  stripEmptyLines,
  buildOcrPrompt,
  buildTranslatePrompt
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

    const apiKey = getGeminiApiKey(req.body && req.body.apiKey);
    if (!apiKey) {
      return res.status(400).json({
        error: "Chưa có API Key! Vui lòng cấu hình API_KEY_GEMINI trong .env hoặc nhập trong Cài đặt."
      });
    }

    const modelName = (req.body && req.body.model) || "gemini-2.5-flash";
    const sourceLang = (req.body && req.body.sourceLang) || "ja";
    const targetLang = (req.body && req.body.targetLang) || "vi";
    const tone = (req.body && req.body.tone) || "natural";
    const skipSFX = req.body && (req.body.skipSFX === true || req.body.skipSFX === "true");
    const mode = (req.body && req.body.mode) || "all"; // 'all', 'ocr_only', 'translate_only'

    let ocrTextBlock = (req.body && req.body.existingOcr) || "";
    let viTextBlock = "";
    let modelUsedFinal = modelName;
    let totalElapsed = 0;

    // STEP 1: Run OCR if needed
    if (mode === "all" || mode === "ocr_only") {
      const ocrPrompt = buildOcrPrompt(sourceLang, skipSFX);
      const ocrPayload = {
        contents: [
          {
            parts: [
              { text: ocrPrompt },
              { inline_data: { mime_type: mimeType, data: base64Image } }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1
        }
      };

      const startOcr = Date.now();
      const { data, modelUsed } = await callGeminiWithFallback(modelName, apiKey, ocrPayload);
      totalElapsed += Date.now() - startOcr;
      modelUsedFinal = modelUsed;

      let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      rawText = rawText
        .replace(/\n\s*\n/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      ocrTextBlock = stripEmptyLines(rawText);
    }

    // STEP 2: Run Translate if needed
    if ((mode === "all" || mode === "translate_only") && ocrTextBlock) {
      const transPrompt = buildTranslatePrompt(ocrTextBlock, sourceLang, targetLang, tone);
      const transPayload = {
        contents: [
          {
            parts: [
              { text: transPrompt },
              { inline_data: { mime_type: mimeType, data: base64Image } }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.6
        }
      };

      const startTrans = Date.now();
      const { data, modelUsed } = await callGeminiWithFallback(modelName, apiKey, transPayload);
      totalElapsed += Date.now() - startTrans;
      modelUsedFinal = modelUsed;

      let rawTrans = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      rawTrans = rawTrans.replace(/^(?:Translation:|Translated text:|Here is the translation:)/i, "").trim();
      viTextBlock = stripEmptyLines(rawTrans);
    }

    res.json({
      success: true,
      timeMs: totalElapsed,
      model: modelUsedFinal,
      ocrTextBlock,
      viTextBlock
    });
  } catch (error) {
    console.error("Batch process error:", error);
    res.status(500).json({ error: error.message || "Lỗi xử lý ảnh." });
  }
};
