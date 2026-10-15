// Vercel Serverless Function: POST /api/ocr
const BACKEND_URL = (process.env.BACKEND_URL || "https://dobietdc-backe-manga-remove.hf.space").replace(/\/$/, "");
const DEFAULT_DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";

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
      imageBase64,
      readingOrder = "manga",
      ocrEngine = "ja_manga",
      chatOnly = true,
      enableLLM = false,
      apiKey = "",
      targetLang = "vi",
      detThreshold = 0.20,
    } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: "Thiếu dữ liệu ảnh (imageBase64)." });
    }

    // Tách base64 header
    const cleanB64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const imgBuffer = Buffer.from(cleanB64, "base64");
    const imgBlob = new Blob([imgBuffer], { type: "image/png" });

    // Tạo multipart FormData gửi sang backend
    const formData = new FormData();
    formData.append("file", imgBlob, "page.png");
    formData.append("reading_order", readingOrder);
    formData.append("ocr_engine", ocrEngine);
    formData.append("chat_only", String(Boolean(chatOnly)));
    formData.append("det_threshold", String(detThreshold));
    formData.append("target_lang", targetLang);

    // Xử lý API key: ưu tiên key người dùng nhập, nếu không có lấy từ biến môi trường Cloud
    const activeKey = (apiKey || DEFAULT_DEEPSEEK_KEY).trim();
    if (activeKey) {
      formData.append("api_key", activeKey);
    }

    const response = await fetch(`${BACKEND_URL}/api/v1/translate-page`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(55000),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Lỗi OCR từ backend (${response.status}): ${errText}`,
      });
    }

    const result = await response.json();
    return res.status(200).json({
      success: true,
      totalBoxes: result.total_boxes || 0,
      readingOrder: result.reading_order,
      ocrEngine: result.ocr_engine,
      executionTimeMs: result.execution_time_ms,
      data: result.data || [],
    });
  } catch (err) {
    console.error("api/ocr error:", err);
    return res.status(500).json({
      error: `Cloud Function lỗi khi OCR: ${err.message}`,
    });
  }
};
