// Vercel Serverless Function: GET & POST /api/translate-google
// Endpoint siêu tốc Google Translate GTX miễn phí, không cần key

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const text = req.method === "POST" ? (req.body?.text || req.body?.q || "") : (req.query?.text || req.query?.q || "");
    const sl = (req.method === "POST" ? req.body?.sl : req.query?.sl) || "ja";
    const tl = (req.method === "POST" ? req.body?.tl : req.query?.tl) || "vi";

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Thiếu văn bản cần dịch." });
    }

    const gtxUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text.trim())}`;

    const response = await fetch(gtxUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: `Google GTX error: ${errText}` });
    }

    const data = await response.json();
    let translatedText = "";
    if (Array.isArray(data) && Array.isArray(data[0])) {
      translatedText = data[0].map(item => item[0] || "").join("");
    }

    return res.status(200).json({
      success: true,
      translatedText,
      text_vi: translatedText,
      engine: "google_gtx",
    });
  } catch (err) {
    console.error("translate-google proxy error:", err);
    return res.status(500).json({
      error: `Proxy Google Translate lỗi: ${err.message}`,
    });
  }
};
