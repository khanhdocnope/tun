/**
 * Serverless Image Proxy Endpoint
 * Bypasses CORS and Hotlinking / Referer blocks on manga CDNs
 * Supports GET & POST (JSON)
 */
module.exports = async function handler(req, res) {
  // 1. CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 2. Extract Target URL and Referer
  let targetUrl = "";
  let referer = "";

  if (req.method === "GET") {
    targetUrl = req.query.url;
    referer = req.query.referer || "";
  } else if (req.method === "POST") {
    targetUrl = req.body?.url || req.query.url;
    referer = req.body?.referer || req.query.referer || "";
  }

  if (!targetUrl || typeof targetUrl !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'url' parameter" });
  }

  // Clean URL
  targetUrl = targetUrl.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    return res.status(400).json({ error: "Invalid URL protocol (must be http or https)" });
  }

  // Fallback referer to target URL's origin if not provided
  if (!referer) {
    try {
      referer = new URL(targetUrl).origin + "/";
    } catch (_) {
      referer = targetUrl;
    }
  }

  // 3. Fetch Image with Native Fetch & Timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

  try {
    const upstreamRes = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": referer,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
      },
    });

    clearTimeout(timeoutId);

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).json({
        error: `Upstream CDN returned HTTP ${upstreamRes.status}: ${upstreamRes.statusText}`,
      });
    }

    const contentType = upstreamRes.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await upstreamRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400"); // Cache 24h

    return res.status(200).send(buffer);
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === "AbortError";
    return res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? "CDN request timed out after 20s" : err.message,
    });
  }
};
