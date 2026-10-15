// Vercel Serverless Function: GET /api/health
const BACKEND_URL = (process.env.BACKEND_URL || "https://dobietdc-backe-manga-remove.hf.space").replace(/\/$/, "");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const start = Date.now();
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: "GET",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    const elapsed = Date.now() - start;
    if (!response.ok) {
      return res.status(response.status).json({
        status: "backend_error",
        backendUrl: BACKEND_URL,
        backendStatus: response.status,
        latencyMs: elapsed,
      });
    }

    const data = await response.json();
    return res.status(200).json({
      status: "online",
      nodeRuntime: process.version,
      backendUrl: BACKEND_URL,
      latencyMs: elapsed,
      backend: data,
    });
  } catch (err) {
    return res.status(503).json({
      status: "unreachable",
      backendUrl: BACKEND_URL,
      error: err.message,
      latencyMs: Date.now() - start,
    });
  }
};
