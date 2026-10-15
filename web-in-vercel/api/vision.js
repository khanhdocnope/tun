// Vercel Serverless Function: POST /api/vision
// Gemini 3 Flash Vision pipeline for Manga/Manhwa: OCR, Contextual Translation, and Refinement
// Inspired by VisionBox architecture & best practices

const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_API_KEY = process.env.API_KEY_GEMINI || process.env.GEMINI_API_KEY || "";

const BLANK_MARKER_RE = /^[\s(\[{]*(?:bỏ\s*trống|để\s*trống|blank|empty|no\s*text|untranslated|n\/a)[\s)\]}]*$/i;

function stripEmptyLines(text) {
  if (!text) return "";
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (BLANK_MARKER_RE.test(trimmed)) return false;
      return true;
    })
    .join("\n");
}

function cleanOcrOutput(raw) {
  return stripEmptyLines(
    (raw || "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/```[a-z]*\s*([\s\S]*?)\s*```/gi, "$1")
      .replace(/\n\s*\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

function cleanTranslateOutput(raw) {
  return stripEmptyLines(
    (raw || "")
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/```[a-z]*\s*([\s\S]*?)\s*```/gi, "$1")
      .replace(/^(?:Translation:|Translated text:|Here is the translation:)/im, "")
      .trim()
  );
}

function parseNumberedLines(text, expectedCount = 0) {
  const clean = (text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[a-z]*\s*([\s\S]*?)\s*```/gi, "$1");

  const lines = clean.split(/\r?\n/);
  const map = new Map();

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^\s*[\[(]?(\d{1,3})[\])\.:：]\s*(.*)$/);
    if (m) {
      const idx = Number(m[1]);
      if (idx >= 1 && (!map.has(idx) || !map.get(idx))) {
        map.set(idx, m[2].trim());
      }
    }
  }

  if (map.size > 0 && expectedCount > 0) {
    return Array.from({ length: expectedCount }, (_, i) => map.get(i + 1) || "");
  }

  if (map.size > 0 && expectedCount === 0) {
    const maxIdx = Math.max(...Array.from(map.keys()));
    return Array.from({ length: maxIdx }, (_, i) => map.get(i + 1) || "");
  }

  // Fallback: line-by-line
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !BLANK_MARKER_RE.test(l));
}

function buildOcrPrompt({ readingOrder = "manga", sourceLang = "ja", skipSfx = true }) {
  const isManga = readingOrder === "manga" || sourceLang === "ja";
  const orderText = isManga
    ? "Reading order: top to bottom, RIGHT to left (standard Japanese manga layout). MANDATORY."
    : "Reading order: top to bottom, left to right (standard webtoon/manhwa layout). MANDATORY.";

  const sfxRule = skipSfx
    ? "SFX RULE: SKIP ALL sound effects drawn directly onto artwork without speech bubble borders."
    : "SFX RULE: Include sound effects in proper reading order as their own lines.";

  return `You are a professional comic/manga OCR specialist.
Extract all text from speech bubbles and text boxes in this image.

INSTRUCTIONS:
1. ${orderText}
2. BUBBLE BOUNDARY RULE:
   - Exactly ONE speech bubble / narration box = ONE output line.
   - Merge all text wrapping inside the SAME bubble into a single line joined with space.
   - Two different bubbles, even if adjacent, MUST be separate lines.
   - Double-check: each line in your output corresponds to exactly one bubble.
3. ${sfxRule}
4. Do NOT translate. Keep the exact original text.
5. If a bubble is truly empty or purely graphical noise, skip it. NEVER write placeholders like "(blank)" or "(empty)".
6. Format output as numbered lines:
[1] Text of first bubble
[2] Text of second bubble
...

Return ONLY the numbered lines. Absolutely no introductory text or explanations.`;
}

function buildQuickTranslatePrompt({ readingOrder = "manga", sourceLang = "ja", targetLang = "Tiếng Việt", skipSfx = true }) {
  const isManga = readingOrder === "manga" || sourceLang === "ja";
  const orderText = isManga
    ? "Reading order: top to bottom, RIGHT to left (standard Japanese manga layout). MANDATORY."
    : "Reading order: top to bottom, left to right (standard webtoon/manhwa layout). MANDATORY.";

  const sfxRule = skipSfx
    ? "SFX RULE: SKIP ALL hand-drawn background sound effects. Focus strictly on speech bubbles."
    : "SFX RULE: Translate sound effects concisely as punchy sound equivalents.";

  return `You are a master comic/manga translator with 20+ years of localization experience into ${targetLang}.
Read the speech bubbles directly from this comic page and translate them into natural, immersive ${targetLang}.

RULES:
1. ${orderText}
2. BUBBLE BOUNDARY:
   - Exactly ONE speech bubble = ONE output line.
   - Merge wrapped text within one bubble into one fluent sentence.
3. LOCALIZATION QUALITY:
   - Natural spoken ${targetLang} tailored to manga/manhwa dialogue.
   - Choose pronouns and honorifics (xưng hô) appropriately based on visual age, gender, and emotional intensity.
   - ALL CAPS in source font is standard comic lettering, NOT shouting. Use natural sentence case.
   - Japanese wave dash '〜'/'～' denotes playful or sing-song tone; preserve tone, do NOT convert to '...'.
4. ${sfxRule}
5. Truly empty bubbles: skip them, NEVER write placeholders like "(blank)" or "không có chữ".
6. Output format: numbered lines matching the reading order:
[1] Bản dịch câu 1
[2] Bản dịch câu 2
...

Return ONLY the numbered translated lines. No original text, no intro, no notes.`;
}

function buildTranslateWithImagePrompt({ ocrLines = [], targetLang = "Tiếng Việt", prevContext = "" }) {
  const formattedInput = ocrLines.map((l, i) => `[${i + 1}] ${l}`).join("\n");
  const prevContextBlock = prevContext
    ? `\nPREVIOUS PAGE CONTEXT (for character reference & story flow only, do NOT translate):\n${prevContext}\n`
    : "";

  return `You are an elite manga/webtoon localization expert translating into ${targetLang}.
Translate the provided OCR text into natural, expressive ${targetLang}, using the provided comic image for visual emotion, character relationships, and scene context.
${prevContextBlock}
INPUT SPEECH BUBBLES:
${formattedInput}

CRITICAL RULES:
1. Number of output lines MUST EXACTLY MATCH ${ocrLines.length}. Never merge or split numbered items.
2. Natural, expressive dialogue suited for comics: appropriate pronouns (xưng hô), correct tone.
3. Handle comic typography: convert ALL-CAPS to sentence case; keep playful elongation for '〜'.
4. Truly empty input lines: output empty string for that number. NEVER write "(blank)".
5. Output format MUST be numbered lines 1 to ${ocrLines.length}:
[1] Bản dịch của câu 1
[2] Bản dịch của câu 2
...

Return ONLY the numbered translation lines.`;
}

function buildRefineOcrPrompt({ previousOcrText, readingOrder = "manga" }) {
  return `You are proofreading an OCR scan of a comic page against the actual image.

PREVIOUS OCR RESULT (may have errors):
${previousOcrText}

MOST COMMON MISTAKE: Text inside ONE bubble got split into multiple lines, or two bubbles got merged.

YOUR TASK:
1. Carefully compare every bubble in the image with the previous OCR.
2. All text inside ONE bubble MUST be exactly ONE line.
3. Two different bubbles merged together MUST be split back into 2 separate lines.
4. Reading order: ${readingOrder === "manga" ? "Top to bottom, RIGHT to left" : "Top to bottom, left to right"}.
5. Do NOT translate. Keep original characters intact.
6. If previous result was already correct, keep it unchanged.
7. Format:
[1] Sửa câu 1
[2] Sửa câu 2
...

Return ONLY the numbered lines.`;
}

function buildRefineTranslatePrompt({ ocrText, prevTranslation, userInstruction = "", targetLang = "Tiếng Việt" }) {
  const extraBlock = userInstruction
    ? `\nADDITIONAL USER INSTRUCTION (PRIORITY OVER GENERAL STYLES):\n${userInstruction}\n`
    : "";

  return `You are proofreading a ${targetLang} comic translation against the comic page image.

ORIGINAL OCR TEXT:
${ocrText}

CURRENT TRANSLATION:
${prevTranslation}
${extraBlock}
YOUR TASK:
1. Improve naturalness, fix mistranslations, and adjust tone according to visual expressions and user instructions.
2. Keep EXACT same number of lines and same order.
3. Format as numbered lines:
[1] Bản dịch hoàn thiện 1
[2] Bản dịch hoàn thiện 2
...

Return ONLY the numbered refined lines.`;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const startTime = Date.now();

  try {
    const {
      task = "quick_translate", // 'quick_translate' | 'ocr' | 'translate_with_image' | 'refine_ocr' | 'refine_translate'
      imageBase64 = "",
      mimeType = "image/jpeg",
      readingOrder = "manga",
      sourceLang = "ja",
      targetLang = "Tiếng Việt",
      skipSfx = true,
      ocrText = "",
      prevTranslation = "",
      userInstruction = "",
      prevContext = "",
      model = DEFAULT_MODEL,
      apiKey = "",
    } = req.body || {};

    const activeKey = (apiKey || DEFAULT_API_KEY).trim();
    if (!activeKey) {
      return res.status(401).json({
        error: "Chưa cấu hình Google API Key. Vui lòng cấu hình API_KEY_GEMINI trong .env hoặc nhập trong Cài đặt (⚙️).",
      });
    }

    const cleanBase64 = (imageBase64 || "").replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");

    let promptText = "";
    let temperature = 0.3;
    let expectedCount = 0;

    if (task === "quick_translate") {
      if (!cleanBase64) return res.status(400).json({ error: "Thiếu dữ liệu ảnh (imageBase64)." });
      promptText = buildQuickTranslatePrompt({ readingOrder, sourceLang, targetLang, skipSfx });
      temperature = 0.4;
    } else if (task === "ocr") {
      if (!cleanBase64) return res.status(400).json({ error: "Thiếu dữ liệu ảnh (imageBase64)." });
      promptText = buildOcrPrompt({ readingOrder, sourceLang, skipSfx });
      temperature = 0.1;
    } else if (task === "translate_with_image") {
      const lines = (ocrText || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        return res.status(400).json({ error: "Danh sách OCR rỗng." });
      }
      expectedCount = lines.length;
      promptText = buildTranslateWithImagePrompt({ ocrLines: lines, targetLang, prevContext });
      temperature = 0.6;
    } else if (task === "refine_ocr") {
      if (!cleanBase64) return res.status(400).json({ error: "Thiếu dữ liệu ảnh (imageBase64)." });
      promptText = buildRefineOcrPrompt({ previousOcrText: ocrText, readingOrder });
      temperature = 0.1;
    } else if (task === "refine_translate") {
      promptText = buildRefineTranslatePrompt({ ocrText, prevTranslation, userInstruction, targetLang });
      temperature = 0.6;
    } else {
      return res.status(400).json({ error: `Tác vụ không hợp lệ: ${task}` });
    }

    // Build Gemini GenerateContent payload
    const parts = [{ text: promptText }];
    if (cleanBase64 && task !== "refine_translate") {
      parts.push({
        inline_data: {
          mime_type: mimeType || "image/jpeg",
          data: cleanBase64,
        },
      });
    }

    const requestBody = {
      contents: [{ parts }],
      generationConfig: {
        temperature,
        topP: 0.9,
        maxOutputTokens: 8192,
      },
    };

    const targetModel = (model || DEFAULT_MODEL).trim();
    const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${activeKey}`;

    // Retry handling for HTTP 429
    let response;
    let attempts = 0;
    const maxRetries = 3;

    while (attempts < maxRetries) {
      attempts++;
      response = await fetch(googleUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000),
      });

      if (response.status === 429 && attempts < maxRetries) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      break;
    }

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Gemini API lỗi (${response.status}): ${errText}`,
      });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

    const parsedLines = parseNumberedLines(rawText, expectedCount);
    const elapsedSeconds = Number(((Date.now() - startTime) / 1000).toFixed(2));

    return res.status(200).json({
      success: true,
      task,
      raw_text: rawText,
      lines: parsedLines,
      elapsed_s: elapsedSeconds,
      model: targetModel,
    });
  } catch (err) {
    console.error("api/vision error:", err);
    return res.status(500).json({
      error: `Lỗi xử lý Gemini Vision: ${err.message}`,
    });
  }
};
