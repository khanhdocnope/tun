// Vercel Serverless Function: GET /api/config
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const hasEnvKey = Boolean(process.env.API_KEY_GEMINI || process.env.GEMINI_API_KEY);
  const liteModels = [
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash"
  ];

  res.json({
    hasEnvKey,
    defaultModel: "gemini-2.5-flash",
    liteModels,
    defaultTone: "natural"
  });
};
