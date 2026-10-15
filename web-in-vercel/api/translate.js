// Vercel Serverless Function: POST /api/translate
// Proxy or server-side fallback for LLM completions (DeepSeek, Intern-AI, OpenAI)

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_API_KEY = process.env.API_KEY_GEMINI || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const {
      messages,
      model = DEFAULT_MODEL,
      baseUrl = "",
      apiKey = "",
      temperature = 0.3,
      max_tokens = 4096,
    } = req.body || {};

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Thiếu danh sách tin nhắn (messages array)." });
    }

    const activeKey = (apiKey || DEFAULT_API_KEY).trim();
    if (!activeKey) {
      return res.status(401).json({ error: "Chưa cấu hình API Key. Vui lòng nhập API Key vào Cài đặt (⚙️)." });
    }

    const activeModel = (model || DEFAULT_MODEL).trim();
    const isGemini = activeModel.toLowerCase().includes("gemini");
    const chosenBase = (baseUrl || (isGemini ? "https://generativelanguage.googleapis.com/v1beta/openai" : "https://discovery-api.intern-ai.org.cn/v1")).trim().replace(/\/+$/, "");
    const endpoint = `${chosenBase}/chat/completions`;

    const bodyPayload = {
      model: activeModel,
      messages,
      temperature,
      max_tokens: max_tokens || 4096,
    };
    if (!isGemini) {
      bodyPayload.thinking = { type: "disabled" };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${activeKey}`,
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `LLM API Error (${response.status}): ${errText}`,
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("api/translate error:", err);
    return res.status(500).json({
      error: `Proxy lỗi khi gọi LLM: ${err.message}`,
    });
  }
};
