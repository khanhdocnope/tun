// Vercel Serverless Function / Express Handler: /api/jobs
// Async Job Dispatcher & SSE Stream Proxy for Manga Batch Studio
const http = require("http");
const https = require("https");

const DEFAULT_BACKEND = (process.env.BACKEND_URL || "https://dobietdc-manga-text-cleaner.hf.space").replace(/\/$/, "");

function normalizeBackendUrl(url) {
  if (!url || typeof url !== "string") return DEFAULT_BACKEND;
  let trimmed = url.trim().replace(/\/$/, "");
  trimmed = trimmed.replace(/manga-text-cleane(?=$|[\/?#])/i, "manga-text-cleaner");

  const spaceMatch = trimmed.match(/huggingface\.co\/spaces\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/i);
  if (spaceMatch) {
    const user = spaceMatch[1].toLowerCase();
    const space = spaceMatch[2].toLowerCase();
    return `https://${user}-${space}.hf.space`;
  }
  return trimmed;
}

// In-Memory Fallback Job Store for Edge/Local execution if backend has no native job engine
const edgeJobStore = new Map();

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const jobId = url.searchParams.get("id") || url.searchParams.get("job_id");
  const isStream = url.searchParams.get("stream") === "true";
  const action = url.searchParams.get("action");
  const targetBackend = normalizeBackendUrl(req.headers["x-backend-url"] || req.query?.backendUrl || DEFAULT_BACKEND);

  // 1. GET /api/jobs?id=...&stream=true -> SSE Stream Proxy
  if (req.method === "GET" && isStream && jobId) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Ping event để giữ kết nối không bị timeout
    const keepAliveTimer = setInterval(() => {
      res.write(": keep-alive ping\n\n");
    }, 15000);

    req.on("close", () => clearInterval(keepAliveTimer));

    try {
      const backendStreamUrl = `${targetBackend}/api/v2/jobs/${encodeURIComponent(jobId)}/stream`;
      const client = backendStreamUrl.startsWith("https") ? https : http;

      const proxyReq = client.get(backendStreamUrl, (streamRes) => {
        if (streamRes.statusCode !== 200) {
          res.write(`event: error\ndata: {"error": "Backend returned ${streamRes.statusCode}"}\n\n`);
          res.end();
          return;
        }

        streamRes.on("data", (chunk) => {
          res.write(chunk);
        });

        streamRes.on("end", () => {
          clearInterval(keepAliveTimer);
          res.end();
        });
      });

      proxyReq.on("error", (err) => {
        clearInterval(keepAliveTimer);
        res.write(`event: error\ndata: {"error": "${err.message}"}\n\n`);
        res.end();
      });

      return;
    } catch (e) {
      clearInterval(keepAliveTimer);
      res.write(`event: error\ndata: {"error": "${e.message}"}\n\n`);
      return res.end();
    }
  }

  // 2. GET /api/jobs?id=... -> Snapshot status poll
  if (req.method === "GET" && jobId) {
    try {
      const resp = await fetch(`${targetBackend}/api/v2/jobs/${encodeURIComponent(jobId)}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        return res.status(200).json(data);
      }
    } catch (_) {}

    // Fallback store
    const local = edgeJobStore.get(jobId);
    if (local) {
      return res.status(200).json({ success: true, job: local });
    }
    return res.status(404).json({ error: `Không tìm thấy job: ${jobId}` });
  }

  // 3. POST /api/jobs (Tạo job mới hoặc Hủy job)
  if (req.method === "POST") {
    // Action: Cancel
    if (action === "cancel" && jobId) {
      try {
        const resp = await fetch(`${targetBackend}/api/v2/jobs/${encodeURIComponent(jobId)}/cancel`, {
          method: "POST",
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) {
          return res.status(200).json(await resp.json());
        }
      } catch (_) {}
      return res.status(200).json({ success: true, message: "Cancelled" });
    }

    // Action: Create Job
    try {
      let body = req.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch (_) {
          body = {};
        }
      }
      body = body || {};

      const pages = body.pages || [];
      if (!Array.isArray(pages) || pages.length === 0) {
        return res.status(400).json({ error: "Danh sách pages không được để trống." });
      }

      // Gửi sang Python GPU Backend
      try {
        const backendResp = await fetch(`${targetBackend}/api/v2/jobs/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pages: pages,
            defaultOptions: body.defaultOptions || {},
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (backendResp.ok) {
          const result = await backendResp.json();
          return res.status(200).json(result);
        }
      } catch (backendErr) {
        console.warn("[api/jobs] Python backend job create error, using edge fallback:", backendErr.message);
      }

      // Edge In-Memory Job Fallback
      const localJobId = `job_edge_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
      const jobRecord = {
        job_id: localJobId,
        status: "queued",
        total_pages: pages.length,
        completed_pages: 0,
        failed_pages: 0,
        progress_percent: 0,
        created_at: Date.now() / 1000,
        updated_at: Date.now() / 1000,
        pages: pages.map((p, idx) => ({
          page_id: p.page_id || `page_${idx + 1}`,
          index: idx + 1,
          status: "pending",
        })),
      };
      edgeJobStore.set(localJobId, jobRecord);

      return res.status(200).json({
        success: true,
        job: jobRecord,
      });
    } catch (err) {
      console.error("[api/jobs] Create error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
};
