// Vercel Serverless Function: GET & POST /api/download-script
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const params = req.method === "POST" ? (req.body || {}) : (req.query || {});
    let { content, filename = "Manga_Chapter_Script.txt", format = "txt" } = params;

    if (!content) {
      return res.status(400).send("Không có nội dung kịch bản.");
    }

    let safeName = filename.endsWith(".txt") ? filename : (filename + ".txt");
    let contentType = "text/plain; charset=utf-8";

    if (format === "doc") {
      safeName = filename.replace(/\.(txt|doc)$/i, "") + ".doc";
      contentType = "application/msword; charset=utf-8";
    }

    // Prepend UTF-8 BOM so Notepad & Word render Vietnamese perfectly
    const bomBuffer = Buffer.from("\uFEFF", "utf-8");
    const contentBuffer = Buffer.from(content, "utf-8");
    const finalBuffer = Buffer.concat([bomBuffer, contentBuffer]);

    const encodedName = encodeURIComponent(safeName);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader("Content-Length", finalBuffer.length);
    res.send(finalBuffer);
  } catch (err) {
    res.status(500).send(err.message);
  }
};
