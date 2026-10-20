// Shared helper for Batch Studio Pro Gemini OCR & Translation
const LITE_MODELS_FALLBACK = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite"
];

function getAllGeminiApiKeys(clientKey, clientKey2) {
  const keys = [];

  const addKey = (k) => {
    if (!k) return;
    const trimmed = String(k).trim();
    if (trimmed && !keys.includes(trimmed)) {
      keys.push(trimmed);
    }
  };

  // 1. Client keys passed from frontend
  if (clientKey) {
    String(clientKey).split(',').forEach(addKey);
  }
  if (clientKey2) {
    String(clientKey2).split(',').forEach(addKey);
  }

  // 2. Environment keys (.env)
  const envCandidates = [
    process.env.API_KEY_GEMINI,
    process.env.API_KEY_GEMINI_2,
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2
  ];

  for (const envVal of envCandidates) {
    if (envVal) {
      String(envVal).split(',').forEach(addKey);
    }
  }

  return keys;
}

function getGeminiApiKey(clientKey, clientKey2) {
  const all = getAllGeminiApiKeys(clientKey, clientKey2);
  return all.length > 0 ? all[0] : "";
}

async function callGeminiWithFallback(primaryModel, apiKeyOrKeys, requestPayload) {
  // Normalize keys to array
  let keys = [];
  if (Array.isArray(apiKeyOrKeys)) {
    keys = apiKeyOrKeys.filter(Boolean);
  } else if (typeof apiKeyOrKeys === "string" && apiKeyOrKeys.includes(",")) {
    keys = apiKeyOrKeys.split(",").map(k => k.trim()).filter(Boolean);
  } else if (apiKeyOrKeys) {
    keys = [String(apiKeyOrKeys).trim()];
  } else {
    keys = getAllGeminiApiKeys();
  }

  if (keys.length === 0) {
    throw new Error("Không có Gemini API Key hợp lệ. Vui lòng cấu hình API_KEY_GEMINI trong .env hoặc trong Cài đặt.");
  }

  const defaultModel = (primaryModel === "gemini-3.5-flash-lite") ? "gemini-3.5-flash-lite" : "gemini-3.1-flash-lite";
  const modelsToTry = [
    defaultModel,
    ...LITE_MODELS_FALLBACK.filter((m) => m !== defaultModel)
  ];

  let lastError = null;

  // Try each API Key in order (Key 1 -> Key 2 if Key 1 hits 429/quota)
  for (let kIdx = 0; kIdx < keys.length; kIdx++) {
    const currentKey = keys[kIdx];

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${currentKey}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload)
        });

        if (response.ok) {
          const data = await response.json();
          return { data, modelUsed: model, keyIndex: kIdx };
        }

        const errData = await response.json().catch(() => ({}));
        const errMsg = errData.error?.message || response.statusText;
        console.warn(`[Batch Studio] Key #${kIdx + 1} with Model ${model} returned (${response.status}): ${errMsg}`);

        // Rate Limit (429) or Quota Exhausted on current key: immediately switch to next key if available!
        if (
          response.status === 429 ||
          errMsg.includes("Resource has been exhausted") ||
          errMsg.includes("quota") ||
          errMsg.includes("Quota exceeded")
        ) {
          lastError = `[Key #${kIdx + 1}] ${errMsg}`;
          // Break inner loop to try next API Key immediately
          break;
        }

        // 503 Overloaded or High demand: try fallback model on same key first
        if (
          response.status === 503 ||
          errMsg.includes("high demand") ||
          errMsg.includes("overloaded")
        ) {
          lastError = `[Key #${kIdx + 1} - ${model}] ${errMsg}`;
          continue;
        } else {
          lastError = errMsg;
          break;
        }
      } catch (err) {
        lastError = err.message;
      }
    }
  }

  throw new Error(lastError || "Tất cả các API Key hoặc Model đều bận/hết hạn mức. Vui lòng thử lại sau.");
}

const LANG_NAMES = {
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  en: "English",
  vi: "Vietnamese",
  "manga-en": "English"
};

const BLANK_MARKER_RE = /^[\s(\[{]*(?:bỏ\s*trống|để\s*trống|dòng\s*trống|trống|blank|empty|no\s*text|untranslated|n\/a)[\s)\]}]*$/i;

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

function getOcrRuleBlocks(skipSfx = true, readingOrder = "manga") {
  const isWebtoon = readingOrder === "webtoon";
  const orderDirective = isWebtoon
    ? `READING ORDER DIRECTIVE (WEBTOON / MANHWA):
- This image is from a WEBTOON / digital manhwa with vertical scroll panel format.
- You MUST scan speech bubbles strictly in WEBTOON READING ORDER: TOP TO BOTTOM, LEFT TO RIGHT sequentially down the page.
- NEVER use Japanese right-to-left ordering on this webtoon.`
    : `READING ORDER DIRECTIVE (MANGA TRADITIONAL):
- This image is from a traditional MANGA page.
- You MUST scan speech bubbles strictly in JAPANESE MANGA READING ORDER: TOP TO BOTTOM, RIGHT TO LEFT.
- Panels on the right are read first, moving leftward, panel by panel down the page.`;

  const bubbleRule = `
BUBBLE BOUNDARY RULE (the single most important rule - read this carefully before anything else):
- A speech bubble is a single, fully enclosed graphical outline (an oval, a cloud shape, a jagged/spiky outline for shouting, or a rectangular caption/narration box). Any text located INSIDE one such outline belongs to ONE single bubble - no matter if it visually wraps into 2-5 lines because the bubble is narrow, changes font size mid-sentence, or contains ellipses ("...") or gaps.
- When you produce your output, you MUST merge ALL the text from the same bubble into a SINGLE output line (join the wrapped fragments with a single space). NEVER create an extra output line just because the text wraps naturally inside a bubble - this is the single most important rule to follow carefully.
- EXAMPLE: if one bubble visually shows the text broken across 3 lines like:
    "I can't believe
    you actually
    did that!"
  your output for that ONE bubble must be a SINGLE line: "I can't believe you actually did that!" - do NOT output it as 3 separate lines.
- Conversely, two DIFFERENT bubbles (two separate graphical outlines) - even if placed close together, touching, or overlapping - MUST become two SEPARATE output lines. Never merge two different bubbles into one line.
- A rectangular caption/narration box is still a normal text unit that must be extracted in full just like a speech bubble.
- Before finalizing your answer, double check each output line: does it correspond to EXACTLY one bubble outline in the image?`;

  const sfxInstruction = skipSfx
    ? `
SFX RULE (exclude completely):
- Completely IGNORE any sound-effect / onomatopoeia lettering that is drawn directly onto the artwork itself, with NO enclosing bubble or box outline around it (for example: footsteps, impact sounds, animal sounds, wind, explosions...).
- ONLY extract text that sits inside an actual speech bubble or caption box. Do not output any SFX line at all.`
    : `
SFX RULE (include, keep in true reading position):
- If the page contains SFX (stylized sound-effect lettering drawn directly onto the artwork, with no enclosing outline), include each one as its own separate output line, placed EXACTLY where it falls in the true reading order of the page.
- Look CAREFULLY at the actual shape of every letter and transcribe EXACTLY what you see. Do NOT guess a common sound effect if it does not match.`;

  return { isWebtoon, orderDirective, bubbleRule, sfxInstruction };
}

function buildOcrPrompt(sourceLang = "ja", skipSfx = true, readingOrder = "manga") {
  const { isWebtoon, orderDirective, bubbleRule, sfxInstruction } = getOcrRuleBlocks(skipSfx, readingOrder);

  const outro = `
If a bubble/box truly has no legible text, skip that line entirely instead of writing a placeholder note/marker.
Return ONLY the scanned text lines. Do not add a title, numbering, or any explanation.`;

  if (sourceLang === "ko") {
    return `This is a page from a Korean comic (manhwa / webtoon). Your task is to OCR the text from the speech bubbles / text boxes on this page.
IMPORTANT INSTRUCTIONS:
1. ${orderDirective}
2. Each separate bubble/box goes on its own output line.
3. Do NOT translate anything - extract the original Korean text exactly as written.
4. Preserve every character and punctuation mark from the source text.
5. Do not add any explanation or commentary besides the scanned text.
${bubbleRule}
${sfxInstruction}
${outro}`;
  }

  if (sourceLang === "zh") {
    return `This is a page from a Chinese comic (manhua / webtoon). Your task is to OCR the text from the speech bubbles / text boxes on this page.
IMPORTANT INSTRUCTIONS:
1. ${orderDirective}
2. Each separate bubble/box goes on its own output line.
3. Do NOT translate anything - extract the original Chinese text exactly as written.
4. Keep the original Han characters as-is - do not convert between Simplified and Traditional.
5. Preserve every punctuation mark and special character.
${bubbleRule}
${sfxInstruction}
${outro}`;
  }

  if (sourceLang === "manga-en") {
    return `This is a page from an English-language comic (${isWebtoon ? 'Webtoon' : 'Manga'}).
IMPORTANT INSTRUCTIONS:
1. ${orderDirective}
2. Each separate bubble/box goes on its own single output line.
3. Do NOT translate anything - extract the original English text exactly as written.
${bubbleRule}
${sfxInstruction}
${outro}`;
  }

  // Default: Japanese Manga / Webtoon (ja)
  return `This is a page from a Japanese ${isWebtoon ? 'webtoon / vertical strip' : 'manga'}. Your task is to OCR the text from the speech bubbles / text boxes on this page.

IMPORTANT INSTRUCTIONS:
1. Each separate bubble/box goes on its own single output line, with all wrapped text inside that bubble merged into that one line.
2. ${orderDirective}
3. Do NOT translate anything - extract the original Japanese text of each bubble exactly as written.
4. If kanji is paired with furigana, scan only the main text (the kanji) and ignore the furigana.
5. Preserve punctuation marks and special characters from the source text.
6. Do not add any explanation or commentary besides the scanned text.
${bubbleRule}
${sfxInstruction}
${outro}`;
}

function getToneNote(tone) {
  let toneNote = "";
  if (tone === "shounen") toneNote = `\n- Genre Tone: Shounen comic tone (energetic, dramatic, natural pronouns like tớ/cậu, mày/tao when appropriate).`;
  if (tone === "romcom") toneNote = `\n- Genre Tone: Rom-Com comic tone (gentle, sweet, romantic, natural pronouns like anh/em, cậu/tớ).`;
  if (tone === "historical") toneNote = `\n- Genre Tone: Historical / martial arts tone (honorifics like huynh đệ, tại hạ, các hạ).`;
  if (tone === "raw") toneNote = `\n- Genre Tone: Literal translation to assist editor proofreading.`;
  return toneNote;
}

const PREV_CONTEXT_MAX_LINES = 12;
const PREV_CONTEXT_MAX_CHARS = 200;

// Lấy tối đa N dòng cuối của trang trước làm ngữ cảnh (chỉ để giữ nhất quán xưng hô / tên riêng).
function sanitizePrevContext(prevContext) {
  if (!prevContext) return [];
  const arr = Array.isArray(prevContext) ? prevContext : String(prevContext).split(/\r?\n/);
  return arr
    .map((l) => String(l || "").replace(/\s+/g, " ").trim().slice(0, PREV_CONTEXT_MAX_CHARS))
    .filter(Boolean)
    .slice(-PREV_CONTEXT_MAX_LINES);
}

function buildPrevBlock(prevContext) {
  const lines = sanitizePrevContext(prevContext);
  if (lines.length === 0) return "";
  return `PREVIOUS PAGE (already translated). Use it ONLY for story context and consistency of names, pronouns and tone. Do NOT translate it again and do NOT include it in your output:\n${lines.join("\n")}\n\n`;
}

function buildGlossaryBlock(glossary) {
  if (!glossary) return "";
  const trimmed = String(glossary).trim();
  if (!trimmed) return "";
  return `=== CHARACTER GLOSSARY & PRONOUN RULES (MANDATORY) ===
Strictly adhere to the following character names, relationships, pronouns, and terms throughout your translation.
They take absolute priority over default style choices:
${trimmed}
======================================================\n\n`;
}

function buildTranslatePrompt(text, sourceLang = "ja", targetLang = "vi", tone = "natural", readingOrder = "manga", prevContext = [], glossary = "") {
  const sourceName = LANG_NAMES[sourceLang] || sourceLang;
  const targetName = LANG_NAMES[targetLang] || targetLang;
  const isWebtoon = readingOrder === "webtoon";

  const toneNote = getToneNote(tone);

  return `You are a professional comic localization translator with 20+ years of experience translating ${isWebtoon ? 'Webtoons/Manhwa' : 'Manga'} from ${sourceName} to ${targetName}.

Below is the OCR text scanned from a ${isWebtoon ? 'Webtoon (vertical scroll, read top-to-bottom)' : 'traditional Manga (read top-to-bottom, right-to-left)'} page, along with the image of that same page. EACH LINE is a separate speech bubble / text box in reading sequence.

${buildGlossaryBlock(glossary)}${buildPrevBlock(prevContext)}OCR text:
${text}

TRANSLATION INSTRUCTIONS:
1. Translate the OCR content into ${targetName} accurately.
2. IMPORTANT: use the IMAGE and the ${isWebtoon ? 'Webtoon vertical flow' : 'Manga right-to-left flow'} CONTEXT to translate with the correct meaning and conversational flow.
3. The number of lines in your translation MUST exactly match the number of lines in the source text.
4. EVERY line in the source text must correspond to EXACTLY ONE line in the translation - never merge or split lines.
5. Use NATURAL phrasing suited to the comic genre, with modern, easy-to-understand wording.${toneNote}
6. Convey the correct emotion and context of each bubble.
7. Translate honorifics and forms of address that reflect the relationship between characters accurately.
8. If a line is a standalone sound-effect/SFX word, translate/transliterate it BRIEFLY into an equivalent in ${targetName} that keeps the spirit of a sound effect.
9. Count the lines in the source text and make sure your translation has exactly that many lines.
10. IMPORTANT ABOUT CAPITALIZATION: Your translation MUST use normal sentence case: capitalize only the first letter of each sentence and proper nouns. Do NOT capitalize an entire word/sentence just because the source text was uppercase.
11. IMPORTANT ABOUT THE JAPANESE WAVE DASH "〜" (or "～"): This character indicates a drawn-out, elongated sound. Do NOT replace it with an ellipsis "...". Keep the "〜" mark or render the elongated sound naturally.
12. NEVER write a placeholder note/marker for a line (such as "(blank)", "(empty)", "(bỏ trống)", "(để trống)", "(no text)", "N/A"...).
13. MANDATORY: Output ONLY the translated ${targetName} lines. Do NOT include any of the original ${sourceName} lines in your output.

Return ONLY the translation. Do not add any explanation or notes.`;
}


// ---------------------------------------------------------------------------
// COMBINED MODE: OCR + dịch trong MỘT lần gọi Gemini (tiết kiệm ~50% quota/ngày)
// ---------------------------------------------------------------------------

// Gộp mọi part text của candidate đầu tiên; ném lỗi rõ ràng nếu bị chặn / rỗng.
function extractText(data) {
  const block = data && data.promptFeedback && data.promptFeedback.blockReason;
  if (block) throw new Error(`Gemini từ chối xử lý ảnh này (${block}).`);
  const cand = data && data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const text = parts.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("");
  if (!text.trim() && cand && cand.finishReason && cand.finishReason !== "STOP") {
    throw new Error(`Gemini không trả kết quả (finishReason: ${cand.finishReason}).`);
  }
  return text;
}

function buildCombinedPrompt({
  sourceLang = "ja",
  targetLang = "vi",
  skipSfx = true,
  readingOrder = "manga",
  tone = "natural",
  prevContext = [],
  glossary = ""
} = {}) {
  const { isWebtoon, orderDirective, bubbleRule, sfxInstruction } = getOcrRuleBlocks(skipSfx, readingOrder);
  const sourceName = LANG_NAMES[sourceLang] || sourceLang;
  const targetName = LANG_NAMES[targetLang] || targetLang;
  const toneNote = getToneNote(tone);
  const furigana = sourceLang === "ja"
    ? "\n- If kanji is paired with furigana, read only the main text (the kanji) and ignore the furigana."
    : "";

  return `You are a professional comic OCR specialist AND a senior ${sourceName}-to-${targetName} localization translator.
This image is one page of a ${sourceName} ${isWebtoon ? "webtoon / vertical strip" : "manga"}. Do BOTH jobs in ONE pass:
  A) OCR the text of every speech bubble / caption box exactly as written.
  B) Translate each of those bubbles into natural ${targetName}.

${buildGlossaryBlock(glossary)}${buildPrevBlock(prevContext)}=== OCR RULES ===
${orderDirective}
${bubbleRule}
${sfxInstruction}
- Do NOT translate inside the "src" field: keep the exact original text and punctuation.${furigana}

=== TRANSLATION RULES ===
- Use the IMAGE (expressions, relationships, scene) to translate with the right meaning and emotion.
- Natural spoken ${targetName} suited to comic dialogue; choose pronouns / forms of address that fit the characters.${toneNote}
- Use normal sentence case; do NOT write whole sentences in capitals just because the source lettering is uppercase.
- The Japanese wave dash "〜" / "～" marks a drawn-out sound: keep it or render the elongation naturally, do NOT turn it into "...".
- A standalone sound-effect word: translate or transliterate it BRIEFLY, keeping the spirit of a sound effect.
- NEVER write placeholders such as "(blank)", "(empty)", "(bỏ trống)", "N/A".

=== OUTPUT FORMAT (STRICT) ===
Return ONLY a JSON array, with no markdown fences and no commentary. One element per bubble, in reading order:
[{"n":1,"box_2d":[ymin,xmin,ymax,xmax],"src":"<original text of bubble 1, ONE line>","tgt":"<${targetName} translation of bubble 1, ONE line>"}]
- "box_2d": normalized coordinates [ymin, xmin, ymax, xmax] of the speech bubble / text area as 4 integers scaled 0 to 1000 (top, left, bottom, right).
- "n" starts at 1 and increases by 1 with no gaps.
- "src" and "tgt" must each be a single line (never contain a line break).
- Every element MUST have a non-empty "tgt" that translates exactly its own "src".
- If the page has no readable text, return [].`;
}

function cleanCell(v) {
  return String(v == null ? "" : v)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isBlankCell(v) {
  return !v || BLANK_MARKER_RE.test(v);
}

// Trả về { lines: [{src, tgt, box}], missing: [1-based index dòng thiếu bản dịch] } hoặc null nếu không parse được.
function parseCombinedOutput(raw) {
  let text = String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let arr = null;
  try {
    arr = JSON.parse(text);
  } catch (e) {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      try { arr = JSON.parse(m[0]); } catch (e2) { arr = null; }
    }
  }
  if (arr && !Array.isArray(arr)) {
    arr = arr.lines || arr.bubbles || arr.items || null;
  }
  if (!Array.isArray(arr)) return null;

  const lines = [];
  const missing = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const src = cleanCell(item.src != null ? item.src : (item.jp != null ? item.jp : item.ocr));
    if (isBlankCell(src)) continue; // bubble rỗng / placeholder: bỏ cả src lẫn tgt để 2 cột luôn thẳng hàng
    let tgt = cleanCell(item.tgt != null ? item.tgt : (item.vi != null ? item.vi : item.translation));
    if (isBlankCell(tgt)) {
      tgt = src; // thiếu bản dịch -> giữ dòng gốc đúng vị trí, số dòng vẫn khớp
      missing.push(lines.length + 1);
    }
    let box = null;
    const rawBox = item.box_2d || item.box || item.bbox || null;
    if (Array.isArray(rawBox) && rawBox.length === 4) {
      const nums = rawBox.map(Number);
      if (nums.every((n) => !isNaN(n))) {
        box = nums;
      }
    }
    lines.push({ src, tgt, box });
  }
  return { lines, missing };
}

module.exports = {
  LITE_MODELS_FALLBACK,
  getAllGeminiApiKeys,
  getGeminiApiKey,
  callGeminiWithFallback,
  stripEmptyLines,
  buildOcrPrompt,
  buildTranslatePrompt,
  buildCombinedPrompt,
  parseCombinedOutput,
  extractText,
  sanitizePrevContext
};
