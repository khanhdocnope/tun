// Vercel Serverless Function: POST /api/download-script
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
    const { content, filename = "Manga_Chapter_Script.txt", format = "txt" } = req.body || {};
    if (!content) {
      return res.status(400).send("Không có nội dung kịch bản.");
    }

    let safeName = filename.endsWith(".txt") ? filename : `${filename}.txt`;
    let contentType = "text/plain; charset=utf-8";

    if (format === "doc") {
      safeName = filename.replace(/\.txt$/i, "") + ".doc";
      contentType = "application/msword; charset=utf-8";
    }

    // Prepend UTF-8 BOM (\uFEFF) so Windows Notepad and Word display Vietnamese correctly
    const bomBuffer = Buffer.from("\uFEFF", "utf-8");
    const contentBuffer = Buffer.from(content, "utf-8");
    const finalBuffer = Buffer.concat([bomBuffer, contentBuffer]);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("Content-Length", finalBuffer.length);
    res.send(finalBuffer);
  } catch (err) {
    res.status(500).send(err.message);
  }
};
