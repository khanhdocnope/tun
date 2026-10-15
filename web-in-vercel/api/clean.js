// Vercel Serverless Function: POST /api/clean
const BACKEND_URL = (process.env.BACKEND_URL || "https://dobietdc-backe-manga-remove.hf.space").replace(/\/$/, "");

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
    const { imageBase64, cleanSFX, dilationPx, detThreshold, inpaintModel } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: "Thiếu dữ liệu ảnh (imageBase64)." });
    }

    const payload = {
      imageBase64,
      cleanSFX: Boolean(cleanSFX),
      dilationPx: Number(dilationPx || 4),
      detThreshold: Number(detThreshold || 0.20),
      inpaintModel: String(inpaintModel || "anime-lama"),
    };

    const response = await fetch(`${BACKEND_URL}/clean_page`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000), // Cho phép tối đa 60s cho trang cực nét
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Lỗi từ backend (${response.status}): ${errText}`,
      });
    }

    const result = await response.json();
    return res.status(200).json(result);
  } catch (err) {
    console.error("api/clean error:", err);
    return res.status(500).json({
      error: `Cloud Function lỗi khi xử lý: ${err.message}`,
    });
  }
};
