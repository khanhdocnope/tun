// Vercel Serverless Function: POST /api/batch-zip
const AdmZip = require("adm-zip");

const BACKEND_URL = (process.env.BACKEND_URL || "https://dobietdc-backe-manga-remove.hf.space").replace(/\/$/, "");
const DEFAULT_DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

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

  const startTime = Date.now();

  try {
    const {
      zipBase64,
      action = "ocr", // "ocr" hoặc "clean"
      readingOrder = "manga",
      ocrEngine = "ja_manga",
      chatOnly = true,
      enableLLM = false,
      apiKey = "",
      targetLang = "vi",
      detThreshold = 0.20,
      cleanSFX = false,
      inpaintModel = "anime-lama",
    } = req.body || {};

    if (!zipBase64) {
      return res.status(400).json({ error: "Thiếu dữ liệu tệp ZIP (zipBase64)." });
    }

    const cleanB64 = zipBase64.replace(/^data:application\/\w+;base64,/, "");
    const zipBuffer = Buffer.from(cleanB64, "base64");

    // Giải nén tệp ZIP hoàn toàn trong bộ nhớ Cloud (RAM Node.js)
    const inZip = new AdmZip(zipBuffer);
    const zipEntries = inZip.getEntries();

    const validExts = [".png", ".jpg", ".jpeg", ".webp", ".bmp"];
    const imageEntries = zipEntries.filter(
      (entry) =>
        !entry.isDirectory &&
        !entry.entryName.startsWith("__MACOSX/") &&
        !entry.name.startsWith(".") &&
        validExts.some((ext) => entry.name.toLowerCase().endsWith(ext))
    );

    imageEntries.sort((a, b) => naturalSort(a.name, b.name));

    if (imageEntries.length === 0) {
      return res.status(400).json({
        error: "Không tìm thấy tệp ảnh hợp lệ (.jpg, .png, .webp) bên trong file ZIP.",
      });
    }

    const totalPages = imageEntries.length;
    const activeKey = (apiKey || DEFAULT_DEEPSEEK_KEY).trim();
    const results = [];
    let scriptLines = [
      `# ========================================================`,
      `# KỊCH BẢN THOẠI TRUYỆN TRANH (XUẤT TỰ ĐỘNG BỞI MANGA STUDIO)`,
      `# Tổng số trang: ${totalPages}`,
      `# Chế độ: ${action.toUpperCase()} | Bong bóng chat: ${chatOnly ? "BẬT" : "TẤT CẢ"}`,
      `# Thời gian: ${new Date().toLocaleString("vi-VN")}`,
      `# ========================================================\n`,
    ];

    // Xử lý tuần tự hoặc theo cụm nhỏ 2 trang để không quá tải backend
    for (let i = 0; i < imageEntries.length; i++) {
      const entry = imageEntries[i];
      const pageIndex = i + 1;
      const filename = entry.name;
      const imgBuffer = entry.getData();

      try {
        if (action === "clean") {
          // Xóa chữ tranh bằng AI Inpainting
          const base64Img = `data:image/png;base64,${imgBuffer.toString("base64")}`;
          const cleanResp = await fetch(`${BACKEND_URL}/clean_page`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageBase64: base64Img,
              cleanSFX: Boolean(cleanSFX),
              dilationPx: 4,
              detThreshold: Number(detThreshold),
              inpaintModel,
            }),
            signal: AbortSignal.timeout(45000),
          });

          if (cleanResp.ok) {
            const cleanData = await cleanResp.json();
            results.push({
              pageIndex,
              filename,
              success: true,
              cleanedImageBase64: cleanData.cleanedImageBase64,
              stats: cleanData.stats,
            });
          } else {
            results.push({
              pageIndex,
              filename,
              success: false,
              error: `HTTP ${cleanResp.status}`,
            });
          }
        } else {
          // Mặc định: OCR Nhận diện chữ & Dịch
          const imgBlob = new Blob([imgBuffer], { type: "image/png" });
          const formData = new FormData();
          formData.append("file", imgBlob, filename);
          formData.append("reading_order", readingOrder);
          formData.append("ocr_engine", ocrEngine);
          formData.append("chat_only", String(Boolean(chatOnly)));
          formData.append("det_threshold", String(detThreshold));
          formData.append("target_lang", targetLang);
          if (enableLLM && activeKey) {
            formData.append("api_key", activeKey);
          }

          const ocrResp = await fetch(`${BACKEND_URL}/api/v1/translate-page`, {
            method: "POST",
            body: formData,
            signal: AbortSignal.timeout(45000),
          });

          if (ocrResp.ok) {
            const ocrData = await ocrResp.json();
            const boxes = ocrData.data || [];
            results.push({
              pageIndex,
              filename,
              success: true,
              totalBoxes: ocrData.total_boxes || boxes.length,
              data: boxes,
            });

            // Ghi vào kịch bản text
            scriptLines.push(`=== TRANG ${pageIndex} [${filename}] (${boxes.length} câu) ===`);
            if (boxes.length === 0) {
              scriptLines.push("(Không phát hiện bong bóng thoại nào)");
            } else {
              boxes.forEach((b) => {
                const jp = b.original_text || "";
                const vi = b.translated_text || "";
                scriptLines.push(`  #${b.id}:`);
                scriptLines.push(`    Gốc:  ${jp}`);
                if (vi) scriptLines.push(`    Dịch: ${vi}`);
              });
            }
            scriptLines.push("");
          } else {
            const errTxt = await ocrResp.text();
            results.push({
              pageIndex,
              filename,
              success: false,
              error: `HTTP ${ocrResp.status}: ${errTxt}`,
              data: [],
            });
          }
        }
      } catch (pageErr) {
        results.push({
          pageIndex,
          filename,
          success: false,
          error: pageErr.message,
          data: [],
        });
      }
    }

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    const fullScriptText = scriptLines.join("\n");

    return res.status(200).json({
      success: true,
      action,
      totalPages,
      processedPages: results.length,
      elapsedSeconds,
      results,
      scriptText: fullScriptText,
    });
  } catch (err) {
    console.error("api/batch-zip error:", err);
    return res.status(500).json({
      error: `Cloud Batch Function lỗi: ${err.message}`,
    });
  }
};
