// Vercel Serverless Function: POST /api/batch-zip
const AdmZip = require("adm-zip");

const BACKEND_URL = (process.env.BACKEND_URL || "https://dobietdc-backe-manga-remove.hf.space").replace(/\/$/, "");
const DEFAULT_DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";

// Cấu hình số luồng chạy song song trên Cloud
const OCR_CONCURRENCY = 4;    // 4 trang OCR cùng lúc (do OCR chạy CPU siêu nhẹ)
const CLEAN_CONCURRENCY = 2;  // 2 trang Clean cùng lúc (để tránh nghẽn hàng đợi ZeroGPU)

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// Hàm điều phối worker pool chạy song song tối đa `limit` tác vụ cùng lúc
async function runConcurrentPool(tasks, limit = 4) {
  const results = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      try {
        results[idx] = await tasks[idx]();
      } catch (err) {
        results[idx] = { error: err.message };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
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

    // Tách phần base64 an toàn bất kể MIME type nào (application/zip, application/x-zip-compressed, v.v.)
    const cleanB64 = zipBase64.includes(";base64,") ? zipBase64.split(";base64,").pop() : zipBase64;
    const zipBuffer = Buffer.from(cleanB64.trim(), "base64");

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
    const concurrency = action === "clean" ? CLEAN_CONCURRENCY : OCR_CONCURRENCY;

    // Chuẩn bị các tác vụ xử lý từng trang độc lập
    const tasks = imageEntries.map((entry, idx) => {
      const pageIndex = idx + 1;
      const filename = entry.name;
      const imgBuffer = entry.getData();

      return async () => {
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
              signal: AbortSignal.timeout(50000),
            });

            if (cleanResp.ok) {
              const cleanData = await cleanResp.json();
              const chatBoxes = cleanData.stats?.chat_count ?? cleanData.stats?.total_boxes ?? 0;
              return {
                pageIndex,
                page_index: pageIndex,
                filename,
                success: true,
                cleanedImageBase64: cleanData.cleanedImageBase64,
                stats: cleanData.stats,
                totalBoxes: chatBoxes,
                total_boxes: chatBoxes,
              };
            } else {
              return {
                pageIndex,
                page_index: pageIndex,
                filename,
                success: false,
                totalBoxes: 0,
                total_boxes: 0,
                error: `HTTP ${cleanResp.status}`,
              };
            }
          } else {
            // Mặc định: OCR Nhận diện chữ trong bóng thoại
            const imgBlob = new Blob([imgBuffer], { type: "image/png" });
            const formData = new FormData();
            formData.append("file", imgBlob, filename);
            formData.append("reading_order", readingOrder);
            formData.append("ocr_engine", ocrEngine);
            formData.append("chat_only", String(Boolean(chatOnly)));
            formData.append("det_threshold", String(detThreshold));
            formData.append("target_lang", targetLang);
            formData.append("ocr_only", "true");
            if (activeKey) {
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
              const boxCount = ocrData.total_boxes || boxes.length;
              return {
                pageIndex,
                page_index: pageIndex,
                filename,
                success: true,
                totalBoxes: boxCount,
                total_boxes: boxCount,
                data: boxes,
              };
            } else {
              const errTxt = await ocrResp.text();
              return {
                pageIndex,
                page_index: pageIndex,
                filename,
                success: false,
                totalBoxes: 0,
                total_boxes: 0,
                error: `HTTP ${ocrResp.status}: ${errTxt}`,
                data: [],
              };
            }
          }
        } catch (pageErr) {
          return {
            pageIndex,
            page_index: pageIndex,
            filename,
            success: false,
            totalBoxes: 0,
            total_boxes: 0,
            error: pageErr.message,
            data: [],
          };
        }
      };
    });

    // Chạy song song qua Worker Pool (tối đa `concurrency` trang đồng thời)
    const results = await runConcurrentPool(tasks, concurrency);

    // Nếu ở chế độ Clean, đóng gói các ảnh đã tẩy sạch thành file ZIP nhị phân
    let cleanedZipBase64 = null;
    if (action === "clean") {
      try {
        const outZip = new AdmZip();
        results.forEach((resItem) => {
          if (resItem && resItem.cleanedImageBase64) {
            const b64 = resItem.cleanedImageBase64.includes(";base64,")
              ? resItem.cleanedImageBase64.split(";base64,").pop()
              : resItem.cleanedImageBase64;
            const imgBuf = Buffer.from(b64, "base64");
            outZip.addFile(resItem.filename, imgBuf);
          }
        });
        cleanedZipBase64 = outZip.toBuffer().toString("base64");
      } catch (zipPackErr) {
        console.error("Lỗi đóng gói file zip ảnh sạch:", zipPackErr);
      }
    }

    // Gom kịch bản thoại text theo đúng thứ tự 1 -> N
    const scriptLines = [
      `# ========================================================`,
      `# KỊCH BẢN THOẠI TRUYỆN TRANH (XUẤT TỰ ĐỘNG BỞI MANGA STUDIO)`,
      `# Tổng số trang: ${totalPages} (Xử lý song song ${concurrency} luồng)`,
      `# Chế độ: ${action.toUpperCase()} | Bong bóng chat: ${chatOnly ? "BẬT" : "TẤT CẢ"}`,
      `# Thời gian: ${new Date().toLocaleString("vi-VN")}`,
      `# ========================================================\n`,
    ];

    results.forEach((resItem) => {
      if (!resItem) return;
      const pIdx = resItem.pageIndex;
      const fName = resItem.filename;
      const boxes = resItem.data || [];

      scriptLines.push(`=== TRANG ${pIdx} [${fName}] (${resItem.totalBoxes || boxes.length} câu) ===`);
      if (!resItem.success) {
        scriptLines.push(`  [Lỗi xử lý trang: ${resItem.error}]`);
      } else if (boxes.length === 0) {
        scriptLines.push(`  (Không phát hiện bong bóng thoại nào)`);
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
    });

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    const fullScriptText = scriptLines.join("\n");

    return res.status(200).json({
      success: true,
      action,
      concurrency,
      totalPages,
      processedPages: results.length,
      elapsedSeconds,
      results,
      cleanedZipBase64,
      scriptText: fullScriptText,
    });
  } catch (err) {
    console.error("api/batch-zip error:", err);
    return res.status(500).json({
      error: `Cloud Batch Function lỗi: ${err.message}`,
    });
  }
};
