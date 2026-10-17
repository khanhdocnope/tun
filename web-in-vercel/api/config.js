// Vercel Serverless Function: GET /api/config
const { getAllGeminiApiKeys } = require("./batch-helper");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const envKeys = getAllGeminiApiKeys();
  const hasEnvKey = envKeys.length > 0;
  const hasEnvKey2 = envKeys.length > 1;

  const liteModels = [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite"
  ];

  res.json({
    hasEnvKey,
    hasEnvKey2,
    envKeyCount: envKeys.length,
    defaultModel: "gemini-3.1-flash-lite",
    liteModels,
    defaultTone: "natural"
  });
};
