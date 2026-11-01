/**
 * Multi-Engine Translation Service for Manga Studio
 * Supports Google Dịch (GTX Direct), OpenRouter AI (Manga styles & Glossary), and Gemini Multimodal.
 */
import { getSetting, getGlossary } from "./storage.js";

export const GENRE_PRESETS = {
  natural: {
    name: "Học đường / Đời thường",
    desc: "Thân mật, xưng hô anh/em/cậu/tớ, tự nhiên như đời sống học đường.",
    prompt: "Văn phong học đường, đời thường, thân thiết, xưng hô anh/em, cậu/tớ, tự nhiên như giao tiếp hàng ngày.",
  },
  xianxia: {
    name: "Kiếm hiệp / Tu tiên",
    desc: "Văn phong Hán-Việt cổ trang, xưng huynh/đệ, tại hạ, các hạ, sư phụ, bổn tọa.",
    prompt: "Văn phong Hán-Việt cổ trang, kiếm hiệp, tu tiên, xưng hô huynh đệ, sư huynh, sư muội, tại hạ, các hạ, chưởng môn, bổn tọa.",
  },
  shounen: {
    name: "Shounen / Hành động",
    desc: "Hào sảng, kịch tính, xưng hô tớ/cậu, mày/tao, chiến đấu quyết liệt.",
    prompt: "Văn phong Shounen hành động, hào sảng, kịch tính, xưng hô tớ/cậu, mày/tao, chiến đấu quyết liệt, giữ cảm xúc cao trào.",
  },
  comedy: {
    name: "Hài hước / Bựa",
    desc: "Dí dỏm, tấu hài nhẹ, gần gũi với giới trẻ, từ ngữ biểu cảm.",
    prompt: "Văn phong hài hước, dí dỏm, tấu hài, gần gũi giới trẻ, linh hoạt và giàu tính giải trí.",
  },
};

/**
 * Dịch văn bản theo Engine đã chọn
 * @param {string} text - Tiếng Nhật cần dịch
 * @param {Object} [options]
 */
export async function translateText(text, options = {}) {
  const cleanInput = (text || "").trim();
  if (!cleanInput) return "";

  const engine = options.engine || (await getSetting("translation_engine", "google"));

  if (engine === "openrouter") {
    return translateOpenRouter(cleanInput, options);
  } else if (engine === "gemini") {
    return translateGemini(cleanInput, options);
  } else {
    return translateGoogleGTX(cleanInput, options);
  }
}

/**
 * 1. Google Dịch (GTX) - Miễn phí 100%, không cần Key, siêu tốc (~0.2s)
 */
export async function translateGoogleGTX(text, options = {}) {
  const sl = options.sl || "ja";
  const tl = options.tl || "vi";

  // Thử gọi trực tiếp endpoint GTX từ browser
  try {
    const directUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(directUrl, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        return data[0].map((item) => item[0] || "").join("");
      }
    }
  } catch (err) {
    console.warn("Direct Google GTX call failed, falling back to Gemini:", err);
  }

  // Fallback qua Gemini AI nếu direct GTX bị lỗi mạng
  try {
    return await translateGemini(text, options);
  } catch (err) {
    console.error("Google / Gemini Translate error:", err);
    throw new Error(`Không thể dịch văn bản: ${err.message}`);
  }
}

/**
 * 2. OpenRouter AI (Dịch ngữ cảnh sâu & Văn phong Manga)
 */
export async function translateOpenRouter(text, options = {}) {
  const apiKey = (options.apiKey || (await getSetting("openrouter_api_key", ""))).trim();
  const model = (options.model || (await getSetting("openrouter_model", "cognitivecomputations/dolphin-mistral-24b-venice-edition:free"))).trim();
  const genreKey = options.genre || (await getSetting("genre_preset", "natural"));
  const genreInfo = GENRE_PRESETS[genreKey] || GENRE_PRESETS.natural;

  // Lấy bảng từ điển thuật ngữ
  const glossaryList = await getGlossary();
  let glossaryPrompt = "";
  if (glossaryList && glossaryList.length > 0) {
    const items = glossaryList.map((g) => `- "${g.original}" -> "${g.translated}"${g.notes ? ` (${g.notes})` : ""}`);
    glossaryPrompt = `\nBẢNG TỪ ĐIỂN BẮT BUỘC TUÂN THỦ:\n${items.join("\n")}\n`;
  }

  const systemPrompt = `Bạn là dịch giả manga/manhwa chuyên nghiệp từ tiếng Nhật sang tiếng Việt.
Phong cách dịch: ${genreInfo.prompt}
${glossaryPrompt}
Quy tắc:
1. Dịch tự nhiên, thoát ý, câu cú ngắt dòng phù hợp với bóng thoại truyện tranh.
2. Giữ nguyên cảm xúc và ngữ điệu của nhân vật.
3. CHỈ TRẢ VỀ DUY NHẤT BẢN DỊCH TIẾNG VIỆT, KHÔNG THÊM LỜI GIẢI THÍCH, KHÔNG GHI THỪA CHỮ "Dịch:", KHÔNG DẤU NGOẶC KÉP BAO QUANH.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Dịch câu thoại manga tiếng Nhật sau sang tiếng Việt:\n${text}` },
  ];

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey || "free"}`,
        "HTTP-Referer": window.location.origin || "https://mangastudio.local",
        "X-Title": "Manga Translation Studio",
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.4,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      // Nếu gọi direct bị chặn CORS, thử qua server proxy /api/translate
      if (resp.status === 401 && !apiKey) {
        throw new Error("Vui lòng nhập OpenRouter API Key trong Cài đặt (⚙️).");
      }
      throw new Error(`OpenRouter Error (${resp.status}): ${errBody}`);
    }

    const data = await resp.json();
    let translated = data.choices?.[0]?.message?.content || "";
    // Làm sạch kết quả
    translated = translated
      .replace(/^(?:Dịch:|Bản dịch:|Translation:|Translated:)/i, "")
      .replace(/^["'「](.*)["'」]$/s, "$1")
      .trim();

    return translated;
  } catch (err) {
    console.warn("OpenRouter API error:", err);
    throw err;
  }
}

/**
 * 3. Google Gemini AI (Multimodal Vision & Context)
 */
export async function translateGemini(text, options = {}) {
  const apiKey = (options.apiKey || (await getSetting("gemini_api_key", ""))).trim();
  const apiKey2 = (options.apiKey2 || (await getSetting("gemini_api_key2", ""))).trim();
  const model = options.model || (await getSetting("gemini_model", "gemini-3.1-flash-lite"));
  const tone = options.tone || (await getSetting("genre_preset", "natural"));

  // Lấy glossary
  const glossaryList = await getGlossary();
  let glossaryText = "";
  if (glossaryList && glossaryList.length > 0) {
    glossaryText = glossaryList.map((g) => `${g.original} -> ${g.translated}${g.notes ? ` (${g.notes})` : ""}`).join("\n");
  }

  const payload = {
    mode: "translate_only",
    text_jp: text,
    apiKey: apiKey,
    apiKey2: apiKey2,
    model: model,
    tone: tone,
    sourceLang: "ja",
    targetLang: "vi",
    glossary: glossaryText,
    imageBase64: options.imageBase64 || null,
  };

  const resp = await fetch("/api/ai-vision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini translation error: ${errText}`);
  }

  const data = await resp.json();
  return data.text_vi || data.viTextBlock || data.translatedText || "";
}

/**
 * Trích xuất text tiếng Nhật từ ảnh vùng chọn (OCR)
 * Dùng /api/ai-vision mode "ocr_only"
 */
export async function runOcrOnRegion(croppedImageB64) {
  if (!croppedImageB64) return "";

  const geminiKey = await getSetting("gemini_api_key", "");
  const payload = {
    mode: "ocr_only",
    imageBase64: croppedImageB64,
    apiKey: geminiKey,
  };

  try {
    const resp = await fetch("/api/ai-vision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    if (resp.ok) {
      const data = await resp.json();
      return (data.text || data.text_jp || data.ocrTextBlock || data.ocr_text || "").trim();
    }
  } catch (err) {
    console.warn("/api/ai-vision ocr call failed:", err);
  }

  // Fallback: Nếu có Tesseract.js trong trình duyệt
  if (window.Tesseract) {
    try {
      const res = await window.Tesseract.recognize(croppedImageB64, "jpn+jpn_vert", {
        logger: () => {},
      });
      return (res?.data?.text || "").trim();
    } catch (te) {
      console.warn("Tesseract OCR fallback error:", te);
    }
  }

  return "";
}

/**
 * Chuyển Base64 / DataURL sang Blob nhị phân để gửi qua FormData
 */
export function dataUrlToBlob(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
  try {
    const parts = dataUrl.split(",");
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (_) {
    return null;
  }
}

/**
 * 1-Pass Unified Vision & Spatial Pipeline
 * Gọi Gemini Vision API qua /api/ai-vision với mode: "unified_spatial" (Hỗ trợ Binary FormData)
 * Trả về danh sách bubbles đã chuẩn hóa với toạ độ 2D [ymin, xmin, ymax, xmax], emotion type, OCR & Bản dịch
 *
 * @param {string} imageBase64 - Ảnh trang manga (Data URL hoặc Base64)
 * @param {Object} [options]
 * @returns {Promise<{ bubbles: Array, ocrTextBlock: string, viTextBlock: string, lineCount: number }>}
 */
export async function runUnifiedSpatialPipeline(imageBase64, options = {}) {
  if (!imageBase64) throw new Error("Thiếu dữ liệu ảnh để chạy Unified Spatial Pipeline.");

  const apiKey = (options.apiKey || (await getSetting("gemini_api_key", ""))).trim();
  const apiKey2 = (options.apiKey2 || (await getSetting("gemini_api_key2", ""))).trim();
  const model = options.model || (await getSetting("gemini_model", "gemini-3.1-flash-lite"));
  const sourceLang = options.sourceLang || (await getSetting("source_lang", "ja"));
  const targetLang = options.targetLang || (await getSetting("target_lang", "vi"));
  const tone = options.tone || (await getSetting("genre_preset", "natural"));
  const readingOrder = options.readingOrder || (await getSetting("reading_order", "manga"));
  const skipSFX = options.skipSFX !== undefined ? options.skipSFX : (await getSetting("skip_sfx", false));

  // Lấy danh sách thuật ngữ glossary
  let glossaryText = options.glossary || "";
  if (!glossaryText) {
    try {
      const glossaryList = await getGlossary();
      if (glossaryList && glossaryList.length > 0) {
        glossaryText = glossaryList
          .map((g) => `${g.original} -> ${g.translated}${g.notes ? ` (${g.notes})` : ""}`)
          .join("\n");
      }
    } catch (_) {}
  }

  const blob = dataUrlToBlob(imageBase64);
  let resp;

  // Ưu tiên gửi Binary Multipart để triệt tiêu lỗi 413 Payload Too Large
  if (blob) {
    const formData = new FormData();
    formData.append("mode", "unified_spatial");
    formData.append("image", blob, "page.jpg");
    formData.append("apiKey", apiKey);
    formData.append("apiKey2", apiKey2);
    formData.append("model", model);
    formData.append("sourceLang", sourceLang);
    formData.append("targetLang", targetLang);
    formData.append("tone", tone);
    formData.append("readingOrder", readingOrder);
    formData.append("skipSFX", String(skipSFX));
    formData.append("glossary", glossaryText);
    formData.append("prevContext", JSON.stringify(options.prevContext || []));

    resp = await fetch("/api/ai-vision", {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(60000),
    });
  } else {
    const payload = {
      mode: "unified_spatial",
      imageBase64,
      apiKey,
      apiKey2,
      model,
      sourceLang,
      targetLang,
      tone,
      readingOrder,
      skipSFX,
      glossary: glossaryText,
      prevContext: options.prevContext || [],
    };

    resp = await fetch("/api/ai-vision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Unified Spatial Pipeline error (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  return {
    bubbles: data.bubbles || [],
    ocrTextBlock: data.ocrTextBlock || "",
    viTextBlock: data.viTextBlock || "",
    lineCount: data.lineCount || (data.bubbles ? data.bubbles.length : 0),
  };
}
