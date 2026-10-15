// Vercel Serverless Function: POST /api/batch-zip
const AdmZip = require("adm-zip");

const BACKEND_URL = (process.env.BACKEND_URL || "https://dobietdc-backe-manga-remove.hf.space").replace(/\/$/, "");
const DEFAULT_DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.API_KEY || "";
const DEFAULT_LLM_URL = process.env.OPENAI_BASE_URL || "https://discovery-api.intern-ai.org.cn/v1";
const DEFAULT_MODEL = process.env.MODEL || "minimax-m3";

// Cấu hình số luồng chạy song song trên Cloud
const OCR_CONCURRENCY = 4;    // 4 trang OCR cùng lúc (do OCR chạy CPU siêu nhẹ)
const CLEAN_CONCURRENCY = 2;  // 2 trang Clean cùng lúc (để tránh nghẽn hàng đợi ZeroGPU)

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// Hàm dịch danh sách box của 1 trang truyện bằng LLM (Tối ưu định dạng dòng siêu tốc)
async function translatePageBoxes(boxes, targetLang = "vi", apiKey = "", model = DEFAULT_MODEL, baseUrl = DEFAULT_LLM_URL) {
  if (!boxes || boxes.length === 0) return boxes;

  const activeKey = (apiKey || DEFAULT_DEEPSEEK_KEY).trim();
  if (!activeKey) return boxes;

  const targetName = targetLang === "vi" ? "Tiếng Việt" : targetLang;
  const systemPrompt = `Bạn là chuyên gia dịch thuật manga/comic sang ${targetName}.
Quy tắc:
1. Xưng hô tự nhiên, linh hoạt theo quan hệ, tuổi tác, tính cách (mày/tao, cậu/tớ, anh/em...).
2. Câu thoại ngắt nhiều bóng: Giữ câu liền mạch tự nhiên.
3. Từ tượng thanh / SFX: Dịch ngắn gọn, sinh động.

QUY ĐỊNH ĐẦU RA BẮT BUỘC:
Trả về kết quả dịch theo từng dòng:
[#ID] Câu dịch ${targetName}
Ví dụ:
[#1] Về sớm nhỉ.
[#2] Ừ, hôm nay xong sớm.

Tuyệt đối KHÔNG sinh JSON, KHÔNG giải thích, KHÔNG chào hỏi.`;

  const cleanBase = (baseUrl || DEFAULT_LLM_URL).trim().replace(/\/+$/, "").replace(/\/chat\/completions\/?$/, "");
  const endpoint = `${cleanBase}/chat/completions`;

  const userMessage = boxes.map((it) => `[#${it.id}] ${it.original_text}`).join("\n");

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeKey}`,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!resp.ok) {
      console.warn("Batch translate page error:", resp.status, await resp.text());
      return boxes;
    }

    const data = await resp.json();
    let rawContent = data?.choices?.[0]?.message?.content || "";
    rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    const map = new Map();
    const lines = rawContent.split("\n");
    for (const l of lines) {
      const match = l.trim().match(/^\[?#?(\d+)\]?[:\.\-\s]+(.*)$/);
      if (match) {
        map.set(Number(match[1]), match[2].trim());
      }
    }

    if (map.size > 0) {
      boxes.forEach((b) => {
        if (map.has(b.id)) {
          b.translated_text = map.get(b.id);
        }
      });
    } else {
      // Fallback JSON parser nếu model vẫn cố tình xuất JSON
      let parsedArray = null;
      const jsonMatch = rawContent.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        try { parsedArray = JSON.parse(jsonMatch[0]); } catch (e) {}
      }
      if (Array.isArray(parsedArray)) {
        parsedArray.forEach((p) => {
          if (p && p.id !== undefined) {
            map.set(Number(p.id), String(p.translated || p.translation || p.text || "").trim());
          }
        });
        boxes.forEach((b) => {
          if (map.has(b.id)) b.translated_text = map.get(b.id);
        });
      } else {
        const cleanLines = rawContent.split("\n").map((l) => l.trim()).filter(Boolean);
        boxes.forEach((b, idx) => {
          if (cleanLines[idx]) {
            b.translated_text = cleanLines[idx].replace(/^\[#?\d+\]\s*/, "");
          }
        });
      }
    }
  } catch (err) {
    console.error("translatePageBoxes error:", err.message);
  }

  return boxes;
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
      llmModel = DEFAULT_MODEL,
      llmBaseUrl = DEFAULT_LLM_URL,
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
              let boxes = ocrData.data || [];
              const boxCount = ocrData.total_boxes || boxes.length;

              // Tự động dịch sang Tiếng Việt bằng LLM cho từng trang
              if (boxes.length > 0) {
                boxes = await translatePageBoxes(boxes, targetLang, activeKey, llmModel, llmBaseUrl);
              }

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

    // Gom kịch bản thoại text theo đúng thứ tự 1 -> N theo format === filename ===
    const scriptLines = [];

    results.forEach((resItem) => {
      if (!resItem) return;
      const fName = resItem.filename;
      const boxes = resItem.data || [];

      scriptLines.push(`=== ${fName} ===`);
      if (!resItem.success) {
        scriptLines.push(`[Lỗi xử lý: ${resItem.error}]`);
      } else {
        boxes.forEach((b) => {
          const text = (b.translated_text || b.original_text || "").trim();
          if (text) scriptLines.push(text);
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
