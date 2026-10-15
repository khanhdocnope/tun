# Điểm sáng của VisionBox — Bài học để áp vào app riêng

> Phân tích từ source: https://github.com/Maditor/visionbox-web
> Mục tiêu: thoát khỏi "OCR truyền thống → AI dịch" thô, thay bằng pipeline Vision LLM thông minh hơn.

---

## 🏆 10 Điểm sáng cốt lõi

### 1. Dùng Vision LLM làm OCR engine — không phải OCR truyền thống

**Vấn đề với OCR truyền thống (Tesseract, PaddleOCR...):**
- Cần detect vùng text thủ công (bounding box)
- Không hiểu context, thứ tự đọc manga/webtoon
- Ghép text từ nhiều fragment → sai thứ tự, thiếu ngữ nghĩa
- Với font stylized (SFX, chữ nghệ thuật) → thất bại hoàn toàn

**Giải pháp của VisionBox:**
> Gửi toàn bộ ảnh + prompt chi tiết cho Vision LLM (Gemini) → nhận text đã sắp xếp đúng thứ tự đọc, đã gộp đúng từng bong bóng.

**Lợi ích:** Một bước duy nhất thay thế pipeline phức tạp: detect → crop → OCR → sort → merge.

---

### 2. Prompt Engineering cực kỳ chi tiết — đây là linh hồn của app

Không phải chỉ gửi "OCR this image". Họ xây prompt với các quy tắc cụ thể cho từng loại truyện:

#### BUBBLE BOUNDARY RULE (quy tắc quan trọng nhất)

```
- Một bong bóng thoại = MỘT dòng output, dù text wrap 2-5 dòng bên trong bubble.
- Hai bubble khác nhau dù đặt sát nhau → PHẢI là 2 dòng riêng.
- Hộp caption/narration cũng tính như bubble.
- Trước khi finalize: double-check từng dòng output có đúng 1 bubble không.
```

#### Reading Order (thứ tự đọc)

| Loại | Thứ tự |
|------|--------|
| Webtoon / Manhwa / Manhua | Trên→dưới, trái→phải |
| Manga Nhật | Trên→dưới, phải→trái |
| Manga-EN (bản Anh ngữ giữ layout Nhật) | Step-by-step 6 bước |

Manga-EN là trường hợp khó nhất — prompt có 6 bước để AI không bị nhầm thứ tự đọc do thấy chữ Latin.

#### SFX Rule

- Bật Skip SFX: Bỏ hoàn toàn chữ SFX vẽ ngoài bubble
- Tắt Skip SFX: Giữ SFX, đặt đúng vị trí thứ tự đọc (không gộp cuối)

---

### 3. Tách biệt hoàn toàn 4 luồng xử lý với temperature riêng

| Hàm | Mục đích | Temperature |
|-----|----------|-------------|
| buildOcrPrompt | OCR lần đầu | 0.1 (cực thấp, cần chính xác) |
| buildTranslatePrompt | Dịch từ OCR | 0.6 (cao hơn, cần sáng tạo) |
| buildRefineOcrPrompt | Sửa lại OCR đã có | 0.1 |
| buildRefineTranslatePrompt | Sửa bản dịch theo yêu cầu user | 0.6 |

OCR: temperature=0.1 → AI "đọc chính xác" không sáng tạo thêm.
Dịch: temperature=0.6 → AI được phép diễn đạt tự nhiên.

---

### 4. Refine = "Cho AI xem lại bài làm của chính nó"

Không dùng AI lần 2 như "người khác" mà frame như "proofread bài cũ":

```
PREVIOUS OCR RESULT (có thể sai):
[text đã OCR lần trước]

THE MOST COMMON MISTAKE: text trong 1 bubble bị tách thành nhiều dòng.

YOUR TASK:
1. So sánh lại với ảnh gốc
2. Merge text cùng bubble → 1 dòng
3. Tách bubble khác nhau bị merge nhầm
4. Nếu kết quả cũ đúng rồi → trả về nguyên si
```

Refine Translation còn cho phép user nhập thêm userInstruction (VD: "đổi xưng hô thành mày/tao")
→ instruction đó được inject với note "takes priority over general style choices".

---

### 5. Translate prompt gửi kèm ảnh gốc làm context

Khi dịch, gửi cả ảnh gốc kèm text OCR, không chỉ gửi text thuần:

```js
const prompt = buildTranslatePrompt(imageData.ocrResult, sourceLang, targetLang);
await callGemini({ promptText: prompt, base64Image: base64, ... })
// → AI nhìn thấy biểu cảm nhân vật, màu sắc, ngữ cảnh → dịch đúng cảm xúc hơn
```

---

### 6. Context liên ảnh khi dịch

Khi dịch ảnh thứ N, lấy OCR của ảnh N-1 làm context:

```js
const prev = uploadedImages[itemIndex - 1]?.ocrResult.split('\n').slice(-12);
// Inject vào prompt: "Previous page, for story context only (do NOT translate it)"
```

→ Giúp AI giữ nhất quán xưng hô và ngữ cảnh câu chuyện giữa các trang.

---

### 7. Numbered lines — tránh AI mất dòng khi dịch

Dùng format [1]...[N] cho cả input và output, parse robust với regex linh hoạt.
Nếu thiếu dòng → giữ dòng gốc ở đúng vị trí → số dòng output LUÔN = input.

---

### 8. Retry thông minh với UX tốt

- HTTP 429 (rate limit): chờ 10s, retry tối đa 6 lần
- HTTP 503 (model quá tải): tự động đổi model dự phòng
- User có thể bấm "Stop retry" → hủy ngay lập tức (không phải đợi hết timeout)
- Dùng Promise với cancel ref thay vì sleep cứng

---

### 9. Cleanup output — xử lý hallucination của AI

AI đôi khi viết placeholder thay vì để trống:

```js
const BLANK_MARKER_RE = /^[\s(\[{]*(?:bỏ\s*trống|để\s*trống|blank|empty|no\s*text|n\/a)[\s)\]}]*$/i;
// Sau OCR: xóa dòng trống thừa, chuẩn hóa khoảng trắng
// Sau dịch: strip "Translation:" prefix AI hay thêm vào
```

---

### 10. Cloudflare branch — Cắt ảnh dài thành lát (cho webtoon dài)

```
Ảnh dài → chunk 1, chunk 2, chunk 3... (có overlap nhỏ giữa các lát)
         → OCR song song (concurrency=3)
         → Ghép lại, bỏ dòng trùng ở overlap (similarity ≥ 0.8)
```

---

## 💡 Code Templates sẵn sàng dùng lại

### Template 1: callGemini — Gọi Vision API

```javascript
async function callGemini({
  apiKey, model, promptText, base64Image,
  mimeType = 'image/jpeg', temperature = 0.2, maxOutputTokens = 4096
}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{
      parts: [
        { text: promptText },
        { inline_data: { mime_type: mimeType, data: base64Image } }
      ]
    }],
    generationConfig: { temperature, topP: 0.9, topK: 40, maxOutputTokens }
    // Không cần safetySettings — task OCR (read text) không bị chặn
  };

  const MAX_RETRIES = 6;
  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 429 && attempt++ < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 10000));
      continue;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || '';
  }
}
```

---

### Template 2: buildOcrPrompt — Prompt OCR manga/webtoon

```javascript
function buildOcrPrompt(sourceLang, skipSfx = false) {
  const bubbleRule = `
BUBBLE BOUNDARY RULE:
- Một bong bóng (oval, cloud, jagged, rectangular box) = MỘT dòng output.
- Merge mọi text wrap bên trong cùng 1 bubble thành 1 dòng duy nhất (join bằng space).
- Hai bubble khác nhau dù sát nhau → 2 dòng riêng.
- Double-check trước khi output: mỗi dòng = đúng 1 bubble.`;

  const sfxRule = skipSfx
    ? `SFX RULE: BỎ QUA hoàn toàn text SFX vẽ trực tiếp lên artwork (không có outline bao quanh).`
    : `SFX RULE: Giữ SFX như 1 dòng riêng, đặt đúng vị trí thứ tự đọc (không gom cuối trang).`;

  const outro = `
Bong bóng thật sự trống → bỏ qua, KHÔNG viết placeholder như "(blank)", "(empty)".
Trả về CHỈ các dòng text đã quét. Không đánh số, không giải thích.`;

  const orders = {
    ko: 'Scan in true reading order: top to bottom, left to right.',
    zh: 'Scan in true reading order: top to bottom, left to right.',
    ja: 'Reading order: top to bottom, RIGHT to left (standard manga order). MANDATORY.',
    'manga-en': 'Reading order: right-to-left per tier (Japanese manga layout), even though text is English.',
  };
  const langMap = {
    ko: 'Korean manhwa', zh: 'Chinese manhua',
    ja: 'Japanese manga', 'manga-en': 'English-language manga (Japanese layout)'
  };
  const lang = langMap[sourceLang] || 'English comic';
  const order = orders[sourceLang] || 'Scan in true reading order: top to bottom, left to right.';

  return `This is a page from a ${lang}. OCR the text from speech bubbles / text boxes.

INSTRUCTIONS:
1. ${order}
2. Each bubble/box → its own output line.
3. Do NOT translate. Extract original text exactly.
${bubbleRule}
${sfxRule}
${outro}`;
}
```

---

### Template 3: buildTranslatePrompt — Prompt dịch (có ảnh + context trang trước)

```javascript
function buildTranslatePrompt(ocrText, sourceLang, targetLang, prevPageOcr = '') {
  const LANG = {
    ko: 'Korean', zh: 'Chinese', ja: 'Japanese', 'manga-en': 'English',
    vi: 'Vietnamese', en: 'English'
  };
  const S = LANG[sourceLang] || sourceLang;
  const T = LANG[targetLang] || targetLang;

  const prevContext = prevPageOcr
    ? `\nPrevious page context (do NOT translate, use for story/character reference only):\n`
      + prevPageOcr.split('\n').slice(-12).map(l => `- ${l}`).join('\n') + '\n'
    : '';

  return `You are a professional comic translator (20+ years experience) translating ${S} to ${T}.
${prevContext}
OCR text (each line = 1 speech bubble):
${ocrText}

INSTRUCTIONS:
1. Use the IMAGE for context — emotion, character relationships, scene.
2. Number of output lines MUST exactly match number of input lines. Never merge or split.
3. Natural ${T} phrasing — not word-for-word, sounds like a professionally translated comic.
4. Keep emotion and punctuation style (…, ?!, !!!).
5. Honorifics/address forms: match the characters' relationship, keep consistent.
6. SFX standalone words: translate briefly as a sound effect, not as a sentence.
7. ALL CAPS in source = comic font, NOT shouting. Use normal sentence case in ${T}.
8. Japanese 〜/～ = drawn-out playful sound, NOT hesitation. Never replace with "...".
9. Truly empty lines → leave as empty line, NEVER write "(blank)" or similar.

Return ONLY the translation. No notes, no original text.`;
}
```

---

### Template 4: buildRefineOcrPrompt — Sửa lại OCR đã có

```javascript
function buildRefineOcrPrompt(sourceLang, previousOcrText, contentType = 'webtoon', skipSfx = false) {
  const LANG = { ko: 'Korean', zh: 'Chinese', ja: 'Japanese' };
  const langName = LANG[sourceLang] || 'English';
  const readingOrder = contentType === 'manga'
    ? 'MANGA order: top to bottom, right to left. MANDATORY.'
    : 'WEBTOON order: top to bottom, left to right. MANDATORY.';

  return `You are proofreading an OCR scan of a ${langName} comic page against the actual image.

PREVIOUS OCR (may contain mistakes):
${previousOcrText}

MOST COMMON MISTAKE: Text inside ONE bubble got split into multiple lines.

YOUR TASK:
1. Compare carefully with image. Identify every bubble/box outline.
2. All text in ONE bubble → exactly ONE output line (join with space).
3. Two different bubbles merged wrongly → split back into 2 lines.
4. Reading order: ${readingOrder}
5. Do NOT translate. Keep original ${langName} text exactly.
6. Do NOT invent or drop any bubble text.
7. If the previous result was already correct → return it unchanged.
8. Truly empty bubble → skip, no placeholder.

Return ONLY the corrected text lines, one bubble per line.`;
}
```

---

### Template 5: buildRefineTranslatePrompt — Sửa lại bản dịch theo yêu cầu user

```javascript
function buildRefineTranslatePrompt(sourceLang, targetLang, ocrText, prevTranslation, userInstruction = '') {
  const LANG = { ko: 'Korean', zh: 'Chinese', ja: 'Japanese', vi: 'Vietnamese', en: 'English' };
  const S = LANG[sourceLang] || sourceLang;
  const T = LANG[targetLang] || targetLang;

  const extraBlock = userInstruction
    ? `\nADDITIONAL USER INSTRUCTION (takes priority over general style choices):\n${userInstruction}\n`
    : '';

  return `You are proofreading a ${T} translation of a ${S} comic page.

SOURCE OCR (${S}), one line per bubble:
${ocrText}

PREVIOUS TRANSLATION (${T}):
${prevTranslation}
${extraBlock}
YOUR TASK:
1. Fix mistranslations, awkward phrasing, wrong tone. Use the image for context.
2. Keep the SAME number of lines and SAME order. Never merge, split, add or remove lines.
3. Natural spoken ${T}, like a professionally translated comic.
4. If a line was already correct → keep it unchanged.
5. Truly empty lines → leave as empty, NEVER write placeholder.

Return ONLY the refined translation.`;
}
```

---

### Template 6: parseNumberedLines — Parse output có đánh số (robust)

```javascript
function parseNumberedLines(text, expectedCount) {
  // Xóa thinking tags (Gemma, DeepSeek, o1...)
  const clean = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[a-z]*/gi, '');

  const map = new Map();
  for (const raw of clean.split('\n')) {
    // Match: [1], (1), 1., 1:, 1：...
    const m = raw.match(/^\s*[\[(]?(\d{1,3})[\])\.:：]\s*(.*)$/);
    if (!m) continue;
    const k = Number(m[1]);
    if (k >= 1 && k <= expectedCount && !map.has(k)) map.set(k, m[2].trim());
  }

  // Fallback: AI không đánh số → dùng từng dòng theo thứ tự
  if (map.size === 0) {
    const plain = clean.split('\n').map(l => l.trim()).filter(Boolean);
    while (plain.length > expectedCount && /[:：]$/.test(plain[0])) plain.shift();
    return Array.from({ length: expectedCount }, (_, i) => plain[i] || '');
  }

  return Array.from({ length: expectedCount }, (_, i) => map.get(i + 1) ?? '');
}
```

---

### Template 7: stripEmptyLines + cleanOutput — Dọn sạch hallucination

```javascript
const BLANK_MARKER_RE = /^[\s(\[{]*(?:bỏ\s*trống|để\s*trống|blank|empty|no\s*text|untranslated|n\/a)[\s)\]}]*$/i;

function stripEmptyLines(text) {
  if (!text) return text;
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

function cleanOcrOutput(raw) {
  return stripEmptyLines(
    raw.replace(/\n\s*\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim()
  );
}

function cleanTranslateOutput(raw) {
  return stripEmptyLines(
    raw.replace(/^(Translation:|Translated text:|Here is the translation:)/i, '').trim()
  );
}
```

---

### Template 8: Cancelable retry — Retry với nút Stop

```javascript
let activeRetry = null;
let shouldStop = false;

async function callWithRetry(fn, { maxRetries = 6, waitMs = 10000, onWaiting } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (shouldStop) throw new Error('Stopped by user.');
      const isRateLimit = err.status === 429 || (err.message || '').includes('429');
      if (isRateLimit && attempt < maxRetries) {
        attempt++;
        onWaiting?.(attempt, maxRetries, waitMs / 1000);
        const cancelled = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), waitMs);
          activeRetry = { cancel: () => { clearTimeout(timer); resolve(true); } };
        });
        activeRetry = null;
        if (cancelled || shouldStop) throw new Error('Stopped by user.');
        continue;
      }
      throw err;
    }
  }
}

function stopRetry() { shouldStop = true; activeRetry?.cancel(); }
function resetStop() { shouldStop = false; activeRetry = null; }
```

---

## 🎯 Áp dụng vào app của bạn

### Vấn đề của "OCR truyền thống → AI dịch"

| Vấn đề | Nguyên nhân | Fix |
|--------|------------|-----|
| Thứ tự text bị loạn | OCR không hiểu layout manga | Vision LLM + reading order prompt |
| Text cùng bubble bị tách nhiều dòng | OCR detect từng dòng text vật lý | Bubble Boundary Rule |
| Dịch không đúng cảm xúc | AI chỉ nhận text, không thấy ảnh | Gửi ảnh gốc kèm khi dịch |
| Số dòng dịch bị lệch so với OCR | AI merge/split tự do | Numbered lines + parseNumberedLines |
| Xưng hô không nhất quán giữa trang | Mỗi trang là request độc lập | Inject 12 dòng cuối trang trước |

### Pipeline hoàn chỉnh sau upgrade

```
ảnh
  → buildOcrPrompt (temp=0.1) → callGemini → cleanOcrOutput()
  → [optional] buildRefineOcrPrompt (temp=0.1) → callGemini → cleanOcrOutput()
  → buildTranslatePrompt + ảnh gốc + context trang trước (temp=0.6) → callGemini
  → cleanTranslateOutput()
  → kết quả cuối
```

---

## 📌 Tóm tắt: Những gì làm nên chất lượng

| Yếu tố | Tại sao quan trọng |
|--------|-------------------|
| Vision LLM thay OCR | Hiểu layout, thứ tự đọc, font stylized |
| Bubble Boundary Rule | Lỗi #1 là split/merge bubble sai |
| Temperature 0.1 cho OCR | AI "đọc" thay vì "sáng tạo" |
| Gửi ảnh kèm khi dịch | Context cảm xúc, nhân vật, scene |
| Numbered lines | Số dòng output = input, không bao giờ lệch |
| Refine loop | Cho AI "xem lại bài làm" → quality cao hơn |
| Strip placeholders | Dọn sạch hallucination của AI |
| Previous page context | Nhất quán xưng hô giữa các trang |
| Cancelable retry | UX tốt khi gặp rate limit |

---

## 🚀 Mở rộng — Những kỹ thuật nâng cao hơn VisionBox

### M1. Gửi ảnh gốc kèm khi dịch — có bị đánh gậy không?

**Câu trả lời: Không — rủi ro tương tự OCR, không cao hơn.**

Gemini phân biệt task type, không phải nội dung ảnh đơn độc:

| Task | Risk |
|------|------|
| "Generate hentai" | Chặn ngay |
| "OCR text từ ảnh này" | Qua |
| "Dịch text này, dùng ảnh làm context" | Qua (task = translate text, ảnh chỉ là reference) |

Khi ảnh được frame rõ là reference document cho task text → safety filter nhìn vào intent của output (dịch text = lành mạnh), không phải nội dung ảnh đơn độc.

---

### M2. Dịch thẳng không OCR — nên hay không?

**1 prompt → AI vừa đọc ảnh vừa trả bản dịch luôn, không qua bước OCR.**

#### Ưu điểm
- Nhanh hơn 2x — 1 API call thay vì 2
- Chi phí giảm nửa
- AI có toàn bộ context ngay, không mất thông tin qua bước trung gian

#### Nhược điểm nghiêm trọng
- Mất khả năng edit: user sửa sai → phải chạy lại toàn bộ, tốn tiền
- Refine không còn ý nghĩa: mỗi lần refine phải gửi lại ảnh → tốn token ảnh
- Debug mù: OCR sai → dịch sai → không biết lỗi ở đâu
- Hallucination không kiểm soát: AI có thể thêm dialogue không có trong ảnh
- Mất text gốc: không có OCR để lưu database, tìm kiếm, tạo subtitle

#### Kết luận thực tế

| Scenario | Nên dùng |
|----------|---------|
| App cần chất lượng cao, user có thể edit | OCR → Dịch (như VisionBox) |
| Tool nhanh, dùng 1 lần, không cần edit | Dịch thẳng ổn |
| Batch lớn, cần tiết kiệm token | Dịch thẳng nhưng mất khả năng debug |

**Gợi ý tốt nhất:** Làm 2 chế độ:
- **Quick mode**: Dịch thẳng — 1 click, 1 API call, preview nhanh
- **Pro mode**: OCR → Edit → Dịch → Edit — kiểm soát đầy đủ

---

### M3. Gom 2 ảnh gửi cùng lúc — kỹ thuật nâng cao

Gemini API hỗ trợ multiple `inline_data` parts trong 1 request:

```javascript
const body = {
  contents: [{
    parts: [
      { text: promptText },
      { inline_data: { mime_type: 'image/jpeg', data: base64_prev } }, // trang trước
      { inline_data: { mime_type: 'image/jpeg', data: base64_current } } // trang hiện tại
    ]
  }]
};
```

#### 3 use case thực tế

**Use case 1: Dịch với context trang trước (ảnh)**
```
[prompt] + [ảnh trang N-1] + [ảnh trang N]
"Translate text in IMAGE 2. IMAGE 1 is the previous page for context only."
```
Tốt hơn cách inject text OCR của VisionBox: AI thấy biểu cảm, tên nhân vật, scene trực tiếp.

**Use case 2: Dịch 2 trang cùng lúc**
```
[prompt] + [ảnh trang N] + [ảnh trang N+1]
→ Dịch cả 2 trang trong 1 call, output phân biệt bằng separator
→ Tiết kiệm 50% API calls cho batch lớn
```

**Use case 3: Ảnh gốc + ảnh clean (đã xóa text)**
```
[ảnh gốc có chữ] + [ảnh clean không chữ]
→ "OCR from IMAGE 1, output will be rendered onto IMAGE 2"
→ Pipeline làm typesetting tự động
```

#### Prompt phải chỉ rõ ảnh nào làm gì

```
"IMAGE 1 is the PREVIOUS page — use it for context only, do NOT translate it.
 IMAGE 2 is the CURRENT page — translate all speech bubbles from this image."
```

Nếu không rõ, AI có thể nhầm và dịch cả 2 trang hoặc trộn lẫn.

#### Lưu ý token cost

- Gemini tính ~258 tokens/ảnh (base) + thêm theo độ phân giải
- 2 ảnh manga full page ~ 500–1600 tokens riêng phần ảnh
- Giới hạn 20MB/request — 2 ảnh manga thường ổn, webtoon dài nên resize trước

#### Pipeline tối ưu kết hợp tất cả

```
Lần 1: Dịch thẳng với 2 ảnh (trang N-1 + trang N)
        → Nhanh, context tốt, 1 API call

Nếu user muốn edit:
        → OCR riêng trang N (1 API call)
        → User sửa OCR → Re-translate (text only, không cần gửi ảnh lại)
```

Đây là pipeline tiết kiệm nhất mà vẫn giữ được khả năng edit đầy đủ.
