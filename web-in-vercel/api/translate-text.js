// Vercel Serverless Function: POST /api/translate-text
const {
  getAllGeminiApiKeys,
  callGeminiWithFallback,
  buildTranslatePrompt,
  stripEmptyLines
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
    const {
      text_jp,
      apiKey: clientKey,
      apiKey2: clientKey2,
      preferredKey,
      model,
      tone = "natural",
      readingOrder = "manga",
      comicType,
      sourceLang = "ja",
      targetLang = "vi",
      imageBase64,
      prevContext,
      glossary = ""
    } = req.body || {};

    const inputPromptText = (text_jp || req.body?.text || "").trim();
    if (!inputPromptText) {
      return res.status(400).json({ error: "Thiếu văn bản gốc cần dịch." });
    }

    let allKeys = getAllGeminiApiKeys(clientKey, clientKey2);
    if (preferredKey && preferredKey.trim()) {
      const pk = preferredKey.trim();
      allKeys = [pk, ...allKeys.filter(k => k !== pk)];
    }

    if (allKeys.length === 0) {
      return res.status(400).json({
        error: "Chưa có Gemini API Key! Vui lòng cấu hình API_KEY_GEMINI hoặc nhập trong Cài đặt."
      });
    }

    const modelName = model || "gemini-3.1-flash-lite";
    const order = readingOrder || comicType || "manga";
    const prompt = buildTranslatePrompt(inputPromptText, sourceLang, targetLang, tone, order, prevContext, glossary);

    const parts = [{ text: prompt }];

    if (imageBase64) {
      const match = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
      } else {
        parts.push({ inline_data: { mime_type: "image/jpeg", data: imageBase64 } });
      }
    }

    const requestPayload = {
      contents: [{ parts }],
      generationConfig: { temperature: 0.6 }
    };

    const { data, modelUsed, keyIndex } = await callGeminiWithFallback(modelName, allKeys, requestPayload);
    let rawTrans = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    rawTrans = rawTrans.replace(/^(?:Translation:|Translated text:|Here is the translation:)/i, "").trim();
    const cleanTrans = stripEmptyLines(rawTrans);

    res.json({
      success: true,
      text_vi: cleanTrans,
      translatedText: cleanTrans,
      modelUsed,
      keyIndex: keyIndex || 0
    });
  } catch (err) {
    console.error("translate-text error:", err);
    res.status(500).json({ error: err.message || "Lỗi dịch văn bản." });
  }
};
