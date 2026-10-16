const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 30 * 1024 * 1024 }
});

function getGeminiApiKey(clientKey) {
  if (clientKey && clientKey.trim()) {
    return clientKey.trim();
  }
  return process.env.API_KEY_GEMINI || process.env.GEMINI_API_KEY || '';
}

// Low-cost Lite models priority for Free Tier
const LITE_MODELS_FALLBACK = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash'
];

async function callGeminiWithFallback(primaryModel, apiKey, requestPayload) {
  const modelsToTry = [primaryModel, ...LITE_MODELS_FALLBACK.filter(m => m !== primaryModel)];
  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (response.ok) {
        const data = await response.json();
        return { data, modelUsed: model };
      }

      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || response.statusText;
      console.warn(`[Model ${model}] trả về lỗi (${response.status}): ${errMsg}`);

      if (response.status === 503 || response.status === 429 || errMsg.includes('high demand') || errMsg.includes('quota')) {
        lastError = `[${model}] ${errMsg}`;
        continue;
      } else {
        throw new Error(errMsg);
      }
    } catch (err) {
      lastError = err.message;
    }
  }

  throw new Error(lastError || 'Tất cả các model Lite đều đang bận. Vui lòng thử lại sau ít giây.');
}

// ============================================================================
// CHUẨN HÓA PROMPTS (Trích xuất từ visionbox-web-main)
// ============================================================================

const LANG_NAMES = {
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  en: 'English',
  vi: 'Vietnamese',
  'manga-en': 'English'
};

const BLANK_MARKER_RE = /^[\s(\[{]*(?:bỏ\s*trống|để\s*trống|dòng\s*trống|trống|blank|empty|no\s*text|untranslated|n\/a)[\s)\]}]*$/i;

function stripEmptyLines(text) {
  if (!text) return '';
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (BLANK_MARKER_RE.test(trimmed)) return false;
      return true;
    })
    .join('\n');
}

function buildOcrPrompt(sourceLang = 'ja', skipSfx = true) {
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

  const outro = `
If a bubble/box truly has no legible text, skip that line entirely instead of writing a placeholder note/marker.
Return ONLY the scanned text lines. Do not add a title, numbering, or any explanation.`;

  if (sourceLang === 'ko') {
    return `This is a page from a Korean comic (manhwa). Your task is to OCR the text from the speech bubbles / text boxes on this page.
IMPORTANT INSTRUCTIONS:
1. Scan in true reading order: top to bottom, left to right.
2. Each separate bubble/box goes on its own output line.
3. Do NOT translate anything - extract the original Korean text exactly as written.
4. Preserve every character and punctuation mark from the source text.
5. Do not add any explanation or commentary besides the scanned text.
${bubbleRule}
${sfxInstruction}
${outro}`;
  }

  if (sourceLang === 'zh') {
    return `This is a page from a Chinese comic (manhua). Your task is to OCR the text from the speech bubbles / text boxes on this page.
IMPORTANT INSTRUCTIONS:
1. Scan in true reading order: top to bottom, left to right.
2. Each separate bubble/box goes on its own output line.
3. Do NOT translate anything - extract the original Chinese text exactly as written.
4. Keep the original Han characters as-is - do not convert between Simplified and Traditional.
5. Preserve every punctuation mark and special character.
${bubbleRule}
${sfxInstruction}
${outro}`;
  }

  if (sourceLang === 'manga-en') {
    return `This is a page from an English-language manga (keeping original Japanese manga panel layout right-to-left).
IMPORTANT INSTRUCTIONS:
1. Read panels and bubbles following Japanese manga layout: top to bottom, right to left.
2. Each separate bubble/box goes on its own single output line.
3. Do NOT translate anything - extract the original English text exactly as written.
${bubbleRule}
${sfxInstruction}
${outro}`;
  }

  // Default: Japanese Manga (ja)
  return `This is a page from a Japanese manga. Your task is to OCR the text from the speech bubbles / text boxes on this page.

IMPORTANT INSTRUCTIONS:
1. Each separate bubble/box goes on its own single output line, with all wrapped text inside that bubble merged into that one line.
2. The ORDER in which bubbles are listed on the page MUST always follow standard manga reading order: top to bottom, right to left. This is mandatory.
3. Do NOT translate anything - extract the original Japanese text of each bubble exactly as written.
4. If kanji is paired with furigana, scan only the main text (the kanji) and ignore the furigana.
5. Preserve punctuation marks and special characters from the source text.
6. Do not add any explanation or commentary besides the scanned text.
${bubbleRule}
${sfxInstruction}
${outro}`;
}

function buildTranslatePrompt(text, sourceLang = 'ja', targetLang = 'vi', tone = 'natural') {
  const sourceName = LANG_NAMES[sourceLang] || sourceLang;
  const targetName = LANG_NAMES[targetLang] || targetLang;

  let toneNote = '';
  if (tone === 'shounen') toneNote = `\n- Genre Tone: Shounen manga tone (energetic, dramatic, natural pronouns like tớ/cậu, mày/tao when appropriate).`;
  if (tone === 'romcom') toneNote = `\n- Genre Tone: Rom-Com manga tone (gentle, sweet, romantic, natural pronouns like anh/em, cậu/tớ).`;
  if (tone === 'historical') toneNote = `\n- Genre Tone: Historical / martial arts tone (honorifics like huynh đệ, tại hạ, các hạ).`;
  if (tone === 'raw') toneNote = `\n- Genre Tone: Literal translation to assist editor proofreading.`;

  return `You are a professional translator with 20+ years of experience translating comics from ${sourceName} to ${targetName}.

Below is the OCR text scanned from a comic page, along with the image of that same page. EACH LINE is a separate speech bubble / text box.

OCR text:
${text}

TRANSLATION INSTRUCTIONS:
1. Translate the OCR content into ${targetName} accurately.
2. IMPORTANT: use the IMAGE and the page's CONTEXT to translate with the correct meaning.
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

// Config Endpoint
app.get('/api/config', (req, res) => {
  const hasEnvKey = Boolean(process.env.API_KEY_GEMINI || process.env.GEMINI_API_KEY);
  res.json({
    hasEnvKey,
    defaultModel: 'gemini-3.1-flash-lite',
    liteModels: LITE_MODELS_FALLBACK,
    defaultTone: 'natural'
  });
});

// Process Batch Single Page
app.post('/api/process-batch', upload.single('image'), async (req, res) => {
  try {
    let base64Image = '';
    let mimeType = 'image/jpeg';

    if (req.file) {
      base64Image = req.file.buffer.toString('base64');
      mimeType = req.file.mimetype || 'image/jpeg';
    } else if (req.body.imageBase64) {
      const match = req.body.imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Image = match[2];
      } else {
        base64Image = req.body.imageBase64;
      }
    } else {
      return res.status(400).json({ error: 'Không tìm thấy dữ liệu ảnh.' });
    }

    const apiKey = getGeminiApiKey(req.body.apiKey);
    if (!apiKey) {
      return res.status(400).json({
        error: 'Chưa có API Key! Vui lòng cấu hình API_KEY_GEMINI trong .env hoặc nhập trong Cài đặt.'
      });
    }

    const modelName = req.body.model || 'gemini-3.1-flash-lite';
    const sourceLang = req.body.sourceLang || 'ja';
    const targetLang = req.body.targetLang || 'vi';
    const tone = req.body.tone || 'natural';
    const skipSFX = req.body.skipSFX === true || req.body.skipSFX === 'true';
    const mode = req.body.mode || 'all'; // 'all', 'ocr_only', 'translate_only'

    let ocrTextBlock = req.body.existingOcr || '';
    let viTextBlock = '';
    let modelUsedFinal = modelName;
    let totalElapsed = 0;

    // STEP 1: Run OCR if needed
    if (mode === 'all' || mode === 'ocr_only') {
      const ocrPrompt = buildOcrPrompt(sourceLang, skipSFX);
      const ocrPayload = {
        contents: [{
          parts: [
            { text: ocrPrompt },
            { inline_data: { mime_type: mimeType, data: base64Image } }
          ]
        }],
        generationConfig: {
          temperature: 0.1 // Low temperature for high accuracy OCR
        }
      };

      const startOcr = Date.now();
      const { data, modelUsed } = await callGeminiWithFallback(modelName, apiKey, ocrPayload);
      totalElapsed += (Date.now() - startOcr);
      modelUsedFinal = modelUsed;

      let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      rawText = rawText
        .replace(/\n\s*\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
      ocrTextBlock = stripEmptyLines(rawText);
    }

    // STEP 2: Run Translate if needed
    if ((mode === 'all' || mode === 'translate_only') && ocrTextBlock) {
      const transPrompt = buildTranslatePrompt(ocrTextBlock, sourceLang, targetLang, tone);
      const transPayload = {
        contents: [{
          parts: [
            { text: transPrompt },
            { inline_data: { mime_type: mimeType, data: base64Image } }
          ]
        }],
        generationConfig: {
          temperature: 0.6 // Suitable for natural dialogue translation
        }
      };

      const startTrans = Date.now();
      const { data, modelUsed } = await callGeminiWithFallback(modelName, apiKey, transPayload);
      totalElapsed += (Date.now() - startTrans);
      modelUsedFinal = modelUsed;

      let rawTrans = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      rawTrans = rawTrans.replace(/^(Translation:|Translated text:|Here is the translation:)/i, '').trim();
      viTextBlock = stripEmptyLines(rawTrans);
    }

    res.json({
      success: true,
      timeMs: totalElapsed,
      model: modelUsedFinal,
      ocrTextBlock,
      viTextBlock
    });

  } catch (error) {
    console.error('Batch process error:', error);
    res.status(500).json({ error: error.message || 'Lỗi xử lý ảnh.' });
  }
});

// Translate Raw Text (with image context if provided)
app.post('/api/translate-text', async (req, res) => {
  try {
    const { text_jp, apiKey: clientKey, model, tone, sourceLang = 'ja', targetLang = 'vi', imageBase64 } = req.body;
    if (!text_jp || !text_jp.trim()) return res.status(400).json({ error: 'Thiếu text tiếng Nhật.' });

    const apiKey = getGeminiApiKey(clientKey);
    if (!apiKey) return res.status(400).json({ error: 'Chưa có Gemini API Key.' });

    const modelName = model || 'gemini-3.1-flash-lite';
    const prompt = buildTranslatePrompt(text_jp.trim(), sourceLang, targetLang, tone);

    const parts = [{ text: prompt }];

    if (imageBase64) {
      const match = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        parts.push({ inline_data: { mime_type: match[1], data: match[2] } });
      } else {
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });
      }
    }

    const requestPayload = {
      contents: [{ parts }],
      generationConfig: { temperature: 0.6 }
    };

    const { data, modelUsed } = await callGeminiWithFallback(modelName, apiKey, requestPayload);
    let rawTrans = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    rawTrans = rawTrans.replace(/^(Translation:|Translated text:|Here is the translation:)/i, '').trim();
    const cleanTrans = stripEmptyLines(rawTrans);

    res.json({ success: true, text_vi: cleanTrans, modelUsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Download Script with robust attachment headers
app.post('/api/download-script', (req, res) => {
  try {
    const { content, filename = 'Manga_Chapter_Script.txt', format = 'txt' } = req.body;
    if (!content) return res.status(400).send('Không có nội dung kịch bản.');

    let safeName = filename.endsWith('.txt') ? filename : `${filename}.txt`;
    let contentType = 'text/plain; charset=utf-8';

    if (format === 'doc') {
      safeName = filename.replace(/\.txt$/i, '') + '.doc';
      contentType = 'application/msword; charset=utf-8';
    }

    // Prepend UTF-8 BOM (\uFEFF) for Windows
    const bomBuffer = Buffer.from('\uFEFF', 'utf-8');
    const contentBuffer = Buffer.from(content, 'utf-8');
    const finalBuffer = Buffer.concat([bomBuffer, contentBuffer]);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', finalBuffer.length);
    res.send(finalBuffer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🚀 Manga OCR Batch Studio (Standardized) is running!`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`⚡ Mode: Visionbox-Web Standardized Prompts Applied`);
  console.log(`=================================================`);
});
