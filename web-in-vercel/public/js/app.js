/**
 * ⚡ MangaStudio AI - Frontend Application Logic (Vercel Edition)
 * Autonomous Manga Cleaner & Speech Bubble Context Translator
 */

// -----------------------------------------------------------------------------
// State & Storage
// -----------------------------------------------------------------------------
const state = {
  backendUrl: localStorage.getItem("manga_backend_url") || "https://dobietdc-backe-manga-remove.hf.space",
  apiKey: localStorage.getItem("manga_api_key") || "",
  llmBaseUrl: localStorage.getItem("manga_llm_base_url") || "https://discovery-api.intern-ai.org.cn/v1",
  llmModel: localStorage.getItem("manga_llm_model") || "deepseek-v4-flash-0731",
  
  // Cleaner Tab State
  cleanerFile: null,
  cleanerOriginalB64: null,
  cleanerCleanedB64: null,
  cleanerMaskB64: null,
  isSplitDragging: false,
  sliderPct: 50,
  
  // Translator Tab State
  transFile: null,
  transImgData: null,
  transResultData: [],
  transDimensions: { naturalW: 0, naturalH: 0 },
  
  // Batch Tab State
  batchFile: null,
};

// Clean backend URL
function getCleanBackendUrl() {
  return state.backendUrl.trim().replace(/\/+$/, "");
}

function getCleanLlmUrl() {
  let url = (state.llmBaseUrl || "https://discovery-api.intern-ai.org.cn/v1").trim().replace(/\/+$/, "");
  url = url.replace(/\/chat\/completions\/?$/, "").replace(/\/chat\/?$/, "");
  return url.replace(/\/+$/, "");
}

// -----------------------------------------------------------------------------
// Toast Notifications
// -----------------------------------------------------------------------------
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const icon = type === "success" ? "✅" : type === "error" ? "❌" : "ℹ️";
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// -----------------------------------------------------------------------------
// Backend Health Check & Ping
// -----------------------------------------------------------------------------
async function checkBackendHealth() {
  const pill = document.getElementById("server-status-pill");
  const text = document.getElementById("server-status-text");
  const start = performance.now();

  // 1. Thử gọi Vercel Cloud Node.js API trước
  try {
    const res = await fetch("/api/health", {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      const latency = Math.round(performance.now() - start);
      pill.className = "status-pill";
      text.textContent = `Cloud Node.js (${latency}ms)`;
      return;
    }
  } catch (e) {
    // Không chạy Node.js hoặc 404 -> Fallback kiểm tra trực tiếp
  }

  // 2. Fallback trực tiếp Backend URL
  try {
    const res = await fetch(`${getCleanBackendUrl()}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    const latency = Math.round(performance.now() - start);

    if (res.ok) {
      const data = await res.json();
      pill.className = "status-pill";
      text.textContent = `Online: ${data.device || "GPU"} (${latency}ms)`;
    } else {
      pill.className = "status-pill offline";
      text.textContent = `Lỗi HTTP ${res.status}`;
    }
  } catch (err) {
    pill.className = "status-pill offline";
    text.textContent = "Backend Offline (Bấm ⚙️ đổi URL)";
  }
}

// -----------------------------------------------------------------------------
// Tab Switching
// -----------------------------------------------------------------------------
function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabPanes.forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add("active");
    });
  });
}

// -----------------------------------------------------------------------------
// Helper: File to Base64
// -----------------------------------------------------------------------------
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// -----------------------------------------------------------------------------
// TAB 1: AI MANGA CLEANER LOGIC
// -----------------------------------------------------------------------------
function initCleaner() {
  const dropzone = document.getElementById("cleaner-dropzone");
  const fileInput = document.getElementById("cleaner-file-input");
  const previewWrap = document.getElementById("cleaner-preview-wrap");
  const previewImg = document.getElementById("cleaner-preview-img");
  const clearBtn = document.getElementById("cleaner-clear-btn");
  const runBtn = document.getElementById("btn-run-clean");

  // Dilation & Threshold range display
  const dilationInput = document.getElementById("cleaner-dilation");
  const valDilation = document.getElementById("val-dilation");
  dilationInput.addEventListener("input", () => {
    valDilation.textContent = `${dilationInput.value}px`;
  });

  const thresholdInput = document.getElementById("cleaner-threshold");
  const valThreshold = document.getElementById("val-threshold");
  thresholdInput.addEventListener("input", () => {
    valThreshold.textContent = Number(thresholdInput.value).toFixed(2);
  });

  // Dropzone drag-and-drop
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      handleCleanerFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      handleCleanerFile(fileInput.files[0]);
    }
  });

  clearBtn.addEventListener("click", () => {
    state.cleanerFile = null;
    state.cleanerOriginalB64 = null;
    state.cleanerCleanedB64 = null;
    state.cleanerMaskB64 = null;
    fileInput.value = "";
    previewWrap.style.display = "none";
    dropzone.style.display = "block";
    runBtn.disabled = true;
  });

  async function handleCleanerFile(file) {
    if (!file.type.startsWith("image/")) {
      showToast("Vui lòng chọn một tệp hình ảnh (.jpg, .png, .webp)!", "error");
      return;
    }
    state.cleanerFile = file;
    state.cleanerOriginalB64 = await fileToBase64(file);
    previewImg.src = state.cleanerOriginalB64;
    previewWrap.style.display = "block";
    dropzone.style.display = "none";
    runBtn.disabled = false;
  }

  // Run Cleaning API
  runBtn.addEventListener("click", async () => {
    if (!state.cleanerOriginalB64) return;

    runBtn.disabled = true;
    runBtn.innerHTML = `<span>⏳ Đang xử lý bóc tách & inpainting...</span>`;
    const badge = document.getElementById("cleaner-stats-badge");
    badge.textContent = "AI Đang Chạy...";

    const payload = {
      imageBase64: state.cleanerOriginalB64,
      cleanSFX: document.getElementById("cleaner-sfx-toggle").checked,
      dilationPx: parseInt(dilationInput.value, 10),
      detThreshold: parseFloat(thresholdInput.value),
      inpaintModel: document.getElementById("cleaner-model-select").value,
    };

    const startT = performance.now();
    try {
      let res;
      try {
        // 1. Thử gọi qua Node.js Cloud Function trước
        res = await fetch("/api/clean", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        // Fallback
      }

      if (!res || !res.ok) {
        // 2. Fallback gọi trực tiếp backend HF Space
        res = await fetch(`${getCleanBackendUrl()}/clean_page`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || errJson.error || `Server trả về mã lỗi ${res.status}`);
      }

      const data = await res.json();
      state.cleanerCleanedB64 = data.cleanedImageBase64;
      state.cleanerMaskB64 = data.colorMaskBase64;

      const elapsed = Math.round(performance.now() - startT);
      badge.textContent = `⚡ ${data.stats?.total_time_ms || elapsed}ms | ${payload.inpaintModel}`;

      // Update comparison views
      document.getElementById("comp-before").src = state.cleanerOriginalB64;
      document.getElementById("comp-after").src = state.cleanerCleanedB64;
      setSplitPosition(50);

      // Download buttons
      const btnJpg = document.getElementById("btn-download-jpg");
      const btnPng = document.getElementById("btn-download-png");
      btnJpg.href = state.cleanerCleanedB64;
      btnJpg.download = `cleaned_${Date.now()}.jpg`;
      btnJpg.style.display = "flex";

      btnPng.href = state.cleanerCleanedB64;
      btnPng.download = `cleaned_${Date.now()}.png`;
      btnPng.style.display = "flex";

      showToast("Đã bóc tách và khôi phục nét tranh thành công!", "success");
    } catch (err) {
      showToast(`Lỗi khi xử lý xóa ảnh: ${err.message}`, "error");
      badge.textContent = "Thất Bại";
    } finally {
      runBtn.disabled = false;
      runBtn.innerHTML = `<span>🚀 AI Bóc Tách & Làm Sạch Nét Vẽ</span>`;
    }
  });

  initComparisonSlider();
}

// Before / After Draggable Slider
function initComparisonSlider() {
  const container = document.getElementById("cleaner-result-container");
  const handle = document.getElementById("comp-handle");
  const afterWrap = document.getElementById("comp-after-wrap");

  function onMove(e) {
    if (!state.isSplitDragging) return;
    const rect = container.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let pos = ((clientX - rect.left) / rect.width) * 100;
    pos = Math.max(0, Math.min(100, pos));
    setSplitPosition(pos);
  }

  window.setSplitPosition = (pct) => {
    state.sliderPct = pct;
    handle.style.left = `${pct}%`;
    afterWrap.style.clipPath = `polygon(0 0, ${pct}% 0, ${pct}% 100%, 0 100%)`;
  };

  handle.addEventListener("mousedown", () => (state.isSplitDragging = true));
  window.addEventListener("mouseup", () => (state.isSplitDragging = false));
  window.addEventListener("mousemove", onMove);

  handle.addEventListener("touchstart", () => (state.isSplitDragging = true));
  window.addEventListener("touchend", () => (state.isSplitDragging = false));
  window.addEventListener("touchmove", onMove);

  // View modes buttons
  document.getElementById("btn-mode-split").addEventListener("click", function () {
    document.querySelectorAll(".btn-view-mode").forEach((b) => b.classList.remove("active"));
    this.classList.add("active");
    handle.style.display = "block";
    setSplitPosition(50);
    document.getElementById("comp-after").src = state.cleanerCleanedB64 || "";
  });

  document.getElementById("btn-mode-cleaned").addEventListener("click", function () {
    document.querySelectorAll(".btn-view-mode").forEach((b) => b.classList.remove("active"));
    this.classList.add("active");
    handle.style.display = "none";
    setSplitPosition(100);
    document.getElementById("comp-after").src = state.cleanerCleanedB64 || "";
  });

  document.getElementById("btn-mode-mask").addEventListener("click", function () {
    if (!state.cleanerMaskB64) {
      showToast("Chưa có Color Mask!", "info");
      return;
    }
    document.querySelectorAll(".btn-view-mode").forEach((b) => b.classList.remove("active"));
    this.classList.add("active");
    handle.style.display = "none";
    setSplitPosition(100);
    document.getElementById("comp-after").src = state.cleanerMaskB64;
  });
}

// -----------------------------------------------------------------------------
// TAB 2: AI TRANSLATOR & BUBBLE OCR LOGIC
// -----------------------------------------------------------------------------
function initTranslator() {
  const dropzone = document.getElementById("trans-dropzone");
  const fileInput = document.getElementById("trans-file-input");
  const previewWrap = document.getElementById("trans-preview-wrap");
  const previewImg = document.getElementById("trans-preview-img");
  const clearBtn = document.getElementById("trans-clear-btn");
  const runBtn = document.getElementById("btn-run-translate");

  const ocrEngineSelect = document.getElementById("trans-ocr-engine");
  const sourceLangGroup = document.getElementById("trans-source-lang-group");

  ocrEngineSelect.addEventListener("change", () => {
    sourceLangGroup.style.display = ocrEngineSelect.value === "multilingual" ? "block" : "none";
  });

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) handleTransFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) handleTransFile(fileInput.files[0]);
  });

  clearBtn.addEventListener("click", () => {
    state.transFile = null;
    fileInput.value = "";
    previewWrap.style.display = "none";
    dropzone.style.display = "block";
    runBtn.disabled = true;
  });

  async function handleTransFile(file) {
    if (!file.type.startsWith("image/")) {
      showToast("Vui lòng chọn tệp ảnh!", "error");
      return;
    }
    state.transFile = file;
    const b64 = await fileToBase64(file);
    previewImg.src = b64;
    previewWrap.style.display = "block";
    dropzone.style.display = "none";
    runBtn.disabled = false;

    // Load annotated image preview
    const annotImg = document.getElementById("trans-annotated-img");
    annotImg.src = b64;
    annotImg.onload = () => {
      state.transDimensions = {
        naturalW: annotImg.naturalWidth,
        naturalH: annotImg.naturalHeight,
      };
    };
  }

  // Run Translation
  runBtn.addEventListener("click", async () => {
    if (!state.transFile) return;

    runBtn.disabled = true;
    runBtn.innerHTML = `<span>🔍 Đang bóc tách bóng thoại & OCR...</span>`;
    const badge = document.getElementById("trans-stats-badge");
    badge.textContent = "AI Đang OCR...";

    const targetLang = document.getElementById("trans-target-lang").value.trim() || "vi";

    const formData = new FormData();
    formData.append("file", state.transFile);
    formData.append("reading_order", document.getElementById("trans-reading-order").value);
    formData.append("ocr_engine", document.getElementById("trans-ocr-engine").value);
    formData.append("source_lang", document.getElementById("trans-source-lang").value);
    formData.append("target_lang", targetLang);
    formData.append("chat_only", document.getElementById("trans-chat-only-toggle").checked ? "true" : "false");
    formData.append("ocr_only", "true"); // OCR only on backend!

    const startT = performance.now();
    try {
      let res;
      try {
        // 1. Thử gọi Node.js Cloud OCR
        const ocrPayload = {
          imageBase64: previewImg.src,
          readingOrder: document.getElementById("trans-reading-order").value,
          ocrEngine: document.getElementById("trans-ocr-engine").value,
          chatOnly: document.getElementById("trans-chat-only-toggle").checked,
          targetLang: targetLang,
          ocrOnly: true,
        };
        res = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ocrPayload),
        });
      } catch (err) {
        // Fallback
      }

      if (!res || !res.ok) {
        // 2. Fallback gọi trực tiếp backend
        res = await fetch(`${getCleanBackendUrl()}/api/v1/translate-page`, {
          method: "POST",
          body: formData,
        });
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || errJson.error || `Lỗi máy chủ HTTP ${res.status}`);
      }

      const data = await res.json();
      state.transResultData = data.data || [];
      const ocrElapsed = Math.round(performance.now() - startT);
      badge.textContent = `🔍 Đã nhận diện ${data.total_boxes} bóng thoại (${ocrElapsed}ms)`;

      // Render ngay lập tức kết quả OCR lên canvas và bảng
      renderBubbleOverlay(state.transResultData);
      renderTranslationTable(state.transResultData);
      updateScriptDownloadLink();

      const activeKey = (state.apiKey || localStorage.getItem("manga_api_key") || "").trim();
      if (!activeKey) {
        showToast(`✅ Đã nhận diện ${data.total_boxes} câu thoại! (Bấm ⚙️ Cài Đặt để nhập API Key dịch sang Tiếng Việt)`, "info");
        return;
      }

      // Bước 2: Dịch ngữ cảnh trực tiếp ở phía Frontend bằng Client-Side LLM
      runBtn.innerHTML = `<span>🤖 Đang dịch ngữ cảnh trực tiếp từ Frontend...</span>`;
      badge.textContent = "🤖 AI đang dịch ngữ cảnh...";

      await translateSpeechBubblesFrontend(state.transResultData, targetLang);

      const totalElapsed = Math.round(performance.now() - startT);
      badge.textContent = `✅ ${data.total_boxes} câu | OCR: ${ocrElapsed}ms | Tổng: ${totalElapsed}ms`;

      // Cập nhật lại giao diện với bản dịch tiếng Việt hoàn chỉnh
      renderBubbleOverlay(state.transResultData);
      renderTranslationTable(state.transResultData);
      updateScriptDownloadLink();

      showToast(`Đã dịch thành công ${data.total_boxes} câu thoại sang Tiếng Việt!`, "success");
    } catch (err) {
      showToast(`Lỗi khi xử lý: ${err.message}`, "error");
      badge.textContent = "Lỗi Xử Lý";
    } finally {
      runBtn.disabled = false;
      runBtn.innerHTML = `<span>🚀 AI Nhận Diện & Dịch Toàn Trang</span>`;
    }
  });

  // Copy Markdown Script Button
  document.getElementById("btn-copy-script").addEventListener("click", () => {
    if (!state.transResultData.length) {
      showToast("Chưa có kịch bản để sao chép!", "info");
      return;
    }
    const md = state.transResultData
      .map((it) => `**[#${it.id}]**\n* Gốc: \`${it.original_text}\`\n* Dịch: **${it.translated_text}**`)
      .join("\n\n");
    navigator.clipboard.writeText(md);
    showToast("Đã sao chép kịch bản Markdown vào Clipboard!", "success");
  });
}

// -----------------------------------------------------------------------------
// FRONTEND CLIENT-SIDE TRANSLATION ENGINE (Prompt.txt Compliant)
// -----------------------------------------------------------------------------
function buildMangaSystemPrompt(targetLang = "vi") {
  const targetName = targetLang === "vi" ? "Vietnamese" : targetLang;
  return `You are a professional comic/manga/manhwa localization expert with 20+ years of experience translating to ${targetName}.

## TRANSLATION GUIDELINES & RULES

### 1. Contextual Cohesion & Natural Flow
- Multi-bubble Sentences: When a single sentence is split across consecutive bubbles, comprehend the complete thought first, then distribute the translation naturally across those exact corresponding lines without losing grammatical coherence.
- OCR Error Auto-Correction: Comics frequently suffer from OCR noise (broken punctuation, confused characters like l/I/|, or artifact characters). Automatically infer and repair OCR typos using visual and narrative context.

### 2. Tone, Honorifics & Addressing
- Adapt pronouns and forms of address (honorifics, intimacy levels, formality - xưng hô: anh, em, cậu, tớ, tôi, mày, tao, chú, bác...) to accurately reflect character relationships, ages, and social dynamics in ${targetName}.
- Keep dialogue natural, punchy, modern, and true to the comic genre (shonen, shojo, seinen, webtoon, etc.).

### 3. Sound Effects (SFX)
- If a line is a standalone sound effect / onomatopoeia (e.g., BANG, THUD, DOKI-DOKI, MEOW):
  - Provide a concise, punchy equivalent in ${targetName} that preserves the acoustic impact.
  - Do NOT translate sound effects literally as full descriptive sentences.

### 4. Capitalization & Typography Conventions
- De-capitalize ALL-CAPS: Source text in comics is often rendered in ALL-CAPS solely due to comic font styling, NOT shouting. Always convert to natural sentence case (capitalize only the first letter and proper nouns) following standard ${targetName} orthography.
- Wave Dash ("〜" / "～"): Represents a drawn-out, sing-song, or playful trailing tone. Do NOT replace it with an ellipsis ("..."). Preserve the wave dash or naturally elongate the final sound/vowel in ${targetName}.

### 5. Strict 1-to-1 Line Contract
- Output MUST contain an exact translation corresponding to each item ID.
- For truly blank or unreadable noise, leave an empty string. NEVER output placeholder text such as (blank), (empty), (no text), N/A, or (để trống).

## OUTPUT FORMAT
Return ONLY a valid JSON array of objects with "id" (number) and "translated" (string).
Example:
[
  {"id": 1, "translated": "Về sớm thế nhỉ."},
  {"id": 2, "translated": "..."}
]
Do not wrap in any extra text or conversational filler.`;
}

async function translateSpeechBubblesFrontend(items, targetLang = "vi") {
  if (!items || items.length === 0) return items;

  const activeKey = (state.apiKey || localStorage.getItem("manga_api_key") || "").trim();
  if (!activeKey) return items;

  const systemPrompt = buildMangaSystemPrompt(targetLang);
  const userPayload = items.map((it) => ({ id: it.id, text: it.original_text }));
  const userMessage =
    `Hãy dịch danh sách ${items.length} câu thoại truyện tranh sau sang ${targetLang === "vi" ? "Tiếng Việt" : targetLang}:\n` +
    JSON.stringify(userPayload, null, 2);

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  let responseData = null;
  let lastError = "";

  // 1. Thử gọi trực tiếp từ trình duyệt đến OpenAI-Compatible Endpoint (Client-side)
  try {
    const directRes = await fetch(`${getCleanLlmUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeKey}`,
      },
      body: JSON.stringify({
        model: state.llmModel || "deepseek-v4-flash-0731",
        messages,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (directRes.ok) {
      responseData = await directRes.json();
    } else {
      const errTxt = await directRes.text();
      lastError = `Trực tiếp (${directRes.status}): ${errTxt}`;
      console.warn("Direct LLM failed:", lastError);
    }
  } catch (directErr) {
    lastError = `Lỗi mạng trình duyệt/CORS: ${directErr.message}`;
    console.warn("Direct LLM fetch error:", directErr);
  }

  // 2. Fallback sang Vercel Serverless proxy (/api/translate)
  if (!responseData) {
    try {
      const proxyRes = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          model: state.llmModel,
          baseUrl: state.llmBaseUrl,
          apiKey: activeKey,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(65000),
      });
      if (proxyRes.ok) {
        responseData = await proxyRes.json();
      } else {
        const pErr = await proxyRes.json().catch(() => ({}));
        lastError = pErr.error || `Vercel Proxy HTTP ${proxyRes.status}`;
      }
    } catch (proxyErr) {
      lastError = `Vercel Proxy lỗi: ${proxyErr.message}`;
    }
  }

  // 3. Fallback sang Hugging Face Backend Proxy (/api/v1/translate)
  if (!responseData) {
    try {
      const hfRes = await fetch(`${getCleanBackendUrl()}/api/v1/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          model: state.llmModel,
          base_url: state.llmBaseUrl,
          api_key: activeKey,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(70000),
      });
      if (hfRes.ok) {
        responseData = await hfRes.json();
      } else {
        const hfErr = await hfRes.json().catch(() => ({}));
        lastError = hfErr.detail || `HF Backend Proxy HTTP ${hfRes.status}`;
      }
    } catch (hfErr) {
      lastError = `HF Backend Proxy lỗi: ${hfErr.message}`;
    }
  }

  if (!responseData) {
    throw new Error(lastError || "Không thể kết nối AI Dịch qua tất cả các cổng kết nối.");
  }

  // 4. Trích xuất và phân tích kết quả dịch
  let rawContent = responseData?.choices?.[0]?.message?.content || "";

  // Loại bỏ reasoning <think>...</think> của DeepSeek reasoning models
  rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Loại bỏ markdown code block nếu có
  const jsonMatch = rawContent.match(/\[\s*\{[\s\S]*\}\s*\]/);
  let parsedArray = null;
  if (jsonMatch) {
    try {
      parsedArray = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.warn("Lỗi parse JSON regex match:", e);
    }
  }

  if (!parsedArray) {
    try {
      const cleanJson = rawContent.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsedArray = JSON.parse(cleanJson);
    } catch (e) {
      console.warn("Lỗi parse toàn bộ JSON:", e);
    }
  }

  // Áp dụng kết quả vào items
  if (Array.isArray(parsedArray)) {
    const map = new Map();
    parsedArray.forEach((p) => {
      if (p && p.id !== undefined) {
        map.set(Number(p.id), String(p.translated || p.translation || p.text || "").trim());
      }
    });

    items.forEach((it) => {
      if (map.has(it.id)) {
        it.translated_text = map.get(it.id);
      }
    });
  } else {
    // Fallback theo từng dòng nếu LLM trả về dạng text thông thường
    const lines = rawContent.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      items.forEach((it, idx) => {
        if (lines[idx]) {
          const cleanedLine = lines[idx].replace(/^\[#?\d+\]\s*/, "").replace(/^Line\s*\d+:\s*/i, "");
          it.translated_text = cleanedLine;
        }
      });
    }
  }

  return items;
}

function updateScriptDownloadLink() {
  if (!state.transResultData || !state.transResultData.length) return;
  const scriptContent = state.transResultData
    .map((it) => `[#${it.id}] Gốc: ${it.original_text} -> Dịch: ${it.translated_text}`)
    .join("\n\n");
  const blob = new Blob([scriptContent], { type: "text/plain;charset=utf-8" });
  const dlBtn = document.getElementById("btn-download-script-txt");
  if (dlBtn) {
    dlBtn.href = URL.createObjectURL(blob);
    dlBtn.download = `kịch_bản_dịch_${Date.now()}.txt`;
    dlBtn.style.display = "flex";
  }
}

// Render Numbered Bubble Badges over Image
function renderBubbleOverlay(items) {
  const wrap = document.getElementById("bubble-canvas-wrap");
  const annotImg = document.getElementById("trans-annotated-img");

  // Remove existing overlays
  wrap.querySelectorAll(".bubble-badge-overlay").forEach((el) => el.remove());

  const nw = annotImg.naturalWidth;
  const nh = annotImg.naturalHeight;
  if (!nw || !nh) return;

  items.forEach((it) => {
    const [ymin, xmin, ymax, xmax] = it.box;
    const topPct = (ymin / nh) * 100;
    const leftPct = (xmin / nw) * 100;
    const widthPct = ((xmax - xmin) / nw) * 100;
    const heightPct = ((ymax - ymin) / nh) * 100;

    const boxEl = document.createElement("div");
    boxEl.className = "bubble-badge-overlay";
    boxEl.style.top = `${topPct}%`;
    boxEl.style.left = `${leftPct}%`;
    boxEl.style.width = `${widthPct}%`;
    boxEl.style.height = `${heightPct}%`;
    boxEl.dataset.id = it.id;

    const tag = document.createElement("div");
    tag.className = "bubble-number-tag";
    tag.textContent = `#${it.id}`;
    boxEl.appendChild(tag);

    boxEl.addEventListener("mouseenter", () => highlightTableRow(it.id));
    boxEl.addEventListener("mouseleave", () => unhighlightTableRow(it.id));
    boxEl.addEventListener("click", () => scrollToTableRow(it.id));

    wrap.appendChild(boxEl);
  });
}

function renderTranslationTable(items) {
  const tbody = document.getElementById("trans-table-body");
  if (!items || !items.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-dim); padding:2rem;">Không tìm thấy bong bóng thoại nào trên trang này.</td></tr>`;
    return;
  }

  tbody.innerHTML = items
    .map(
      (it) => `
    <tr id="row-bubble-${it.id}" data-id="${it.id}">
      <td style="vertical-align:top;"><span class="trans-id-pill">#${it.id}</span></td>
      <td class="text-orig" style="vertical-align:top;">${escapeHtml(it.original_text)}</td>
      <td class="text-trans">
        <textarea class="form-input trans-edit-input" data-id="${it.id}" rows="2" style="width:100%; resize:vertical; font-size:0.9rem; padding:0.4rem 0.6rem; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff;" placeholder="Chưa có bản dịch...">${escapeHtml(it.translated_text || "")}</textarea>
      </td>
    </tr>
  `
    )
    .join("");

  // Allow live editing of translated text in table
  tbody.querySelectorAll(".trans-edit-input").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const id = Number(e.target.dataset.id);
      const it = items.find((x) => x.id === id);
      if (it) it.translated_text = e.target.value;
      updateScriptDownloadLink();
    });
  });

  // Table row hover highlights bubble
  tbody.querySelectorAll("tr").forEach((row) => {
    const id = row.dataset.id;
    row.addEventListener("mouseenter", () => {
      const box = document.querySelector(`.bubble-badge-overlay[data-id="${id}"]`);
      if (box) box.classList.add("highlight");
    });
    row.addEventListener("mouseleave", () => {
      const box = document.querySelector(`.bubble-badge-overlay[data-id="${id}"]`);
      if (box) box.classList.remove("highlight");
    });
  });
}

function highlightTableRow(id) {
  const row = document.getElementById(`row-bubble-${id}`);
  if (row) row.classList.add("highlight");
}
function unhighlightTableRow(id) {
  const row = document.getElementById(`row-bubble-${id}`);
  if (row) row.classList.remove("highlight");
}
function scrollToTableRow(id) {
  const row = document.getElementById(`row-bubble-${id}`);
  if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// -----------------------------------------------------------------------------
// TAB 3: BATCH ZIP PROCESSING
// -----------------------------------------------------------------------------
function initBatch() {
  const dropzone = document.getElementById("batch-dropzone");
  const fileInput = document.getElementById("batch-file-input");
  const runBtn = document.getElementById("btn-run-batch");
  const modeSelect = document.getElementById("batch-mode-select");

  const cleanOpts = document.getElementById("batch-clean-options");
  const transOpts = document.getElementById("batch-translate-options");

  modeSelect.addEventListener("change", () => {
    if (modeSelect.value === "clean") {
      cleanOpts.style.display = "block";
      transOpts.style.display = "none";
    } else {
      cleanOpts.style.display = "none";
      transOpts.style.display = "block";
    }
  });

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) handleBatchFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) handleBatchFile(fileInput.files[0]);
  });

  function handleBatchFile(file) {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      showToast("Vui lòng chọn tệp định dạng .zip!", "error");
      return;
    }
    state.batchFile = file;
    dropzone.querySelector("h4").textContent = `Đã chọn: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    runBtn.disabled = false;
  }

  // Run Batch
  runBtn.addEventListener("click", async () => {
    if (!state.batchFile) return;

    const mode = modeSelect.value;
    runBtn.disabled = true;
    runBtn.innerHTML = `<span>⏳ Đang xử lý toàn bộ tệp ZIP...</span>`;

    const progressCard = document.getElementById("batch-progress-card");
    const progressBar = document.getElementById("batch-progress-bar");
    const progressStatus = document.getElementById("batch-progress-status");
    const progressPct = document.getElementById("batch-progress-pct");
    const logBox = document.getElementById("batch-log-box");

    progressCard.style.display = "block";
    progressBar.style.width = "25%";
    progressPct.textContent = "25%";
    progressStatus.textContent = "Đang tải tệp lên server và giải nén...";
    logBox.innerHTML = `[${new Date().toLocaleTimeString()}] Bắt đầu tải lên: ${state.batchFile.name}...<br>`;

    const formData = new FormData();
    formData.append("file", state.batchFile);

    try {
      let isCloudHandled = false;

      // 1. Ưu tiên xử lý trên Vercel Cloud Node.js (tiết kiệm 100% RAM client)
      try {
        logBox.innerHTML += `[${new Date().toLocaleTimeString()}] Đang tải lên Cloud Serverless Node.js...<br>`;
        progressBar.style.width = "40%";
        progressPct.textContent = "40%";
        const zipBase64 = await fileToBase64(state.batchFile);

        const cloudRes = await fetch("/api/batch-zip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            zipBase64,
            action: mode,
            readingOrder: document.getElementById("batch-trans-order").value,
            ocrEngine: document.getElementById("batch-trans-engine").value,
            chatOnly: document.getElementById("batch-trans-chat-only").checked,
            apiKey: state.apiKey,
            inpaintModel: document.getElementById("batch-clean-model").value,
            cleanSFX: document.getElementById("batch-clean-sfx-toggle").checked,
          }),
        });

        if (cloudRes.ok) {
          const cloudData = await cloudRes.json();
          isCloudHandled = true;
          progressBar.style.width = "100%";
          progressPct.textContent = "100%";
          progressStatus.textContent = `✅ Đã xử lý xong ${cloudData.totalPages} trang trên Cloud!`;
          logBox.innerHTML += `[${new Date().toLocaleTimeString()}] Hoàn thành xử lý ${cloudData.totalPages} trang trong ${cloudData.elapsedSeconds}s!<br>`;

          let downloadBlob, downloadFilename;
          if (mode === "clean" && cloudData.cleanedZipBase64) {
            const byteChars = atob(cloudData.cleanedZipBase64);
            const byteNums = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
              byteNums[i] = byteChars.charCodeAt(i);
            }
            downloadBlob = new Blob([new Uint8Array(byteNums)], { type: "application/zip" });
            downloadFilename = `cleaned_${state.batchFile.name}`;
          } else {
            downloadBlob = new Blob([cloudData.scriptText || "Hoàn thành"], { type: "text/plain;charset=utf-8" });
            downloadFilename = `kich_ban_${state.batchFile.name.replace(/\.zip$/i, "")}.txt`;
          }

          showBatchResult({
            title: `Đã xử lý xong ${cloudData.totalPages} trang truyện trên Cloud`,
            desc: `Thời gian thực thi: ${cloudData.elapsedSeconds}s | Chế độ: ${mode.toUpperCase()}`,
            downloadBlob: downloadBlob,
            filename: downloadFilename,
            pages: cloudData.results || [],
          });
          showToast("Đã xử lý xong tệp ZIP trên Cloud!", "success");
          return;
        }
      } catch (cloudErr) {
        logBox.innerHTML += `[Chú ý] Chuyển tiếp sang xử lý trực tiếp: ${cloudErr.message}<br>`;
      }

      // 2. Fallback gọi trực tiếp backend nếu không có Cloud API
      if (!isCloudHandled) {
        if (mode === "clean") {
          formData.append("inpaint_model", document.getElementById("batch-clean-model").value);
          formData.append("clean_sfx", document.getElementById("batch-clean-sfx-toggle").checked ? "true" : "false");
          formData.append("dilation_px", "4");

          logBox.innerHTML += `[${new Date().toLocaleTimeString()}] Đang chạy Anime/Big-LaMa inpainting toàn bộ các trang...<br>`;
          progressBar.style.width = "65%";
          progressPct.textContent = "65%";

          const res = await fetch(`${getCleanBackendUrl()}/api/clean_zip`, {
            method: "POST",
            body: formData,
          });

          if (!res.ok) throw new Error(`Lỗi server HTTP ${res.status}`);
          const blob = await res.blob();

          progressBar.style.width = "100%";
          progressPct.textContent = "100%";
          progressStatus.textContent = "✅ Hoàn tất xử lý tệp ZIP!";
          logBox.innerHTML += `[${new Date().toLocaleTimeString()}] Hoàn thành tạo file ZIP ảnh đã xóa!<br>`;

          showBatchResult({
            title: "Đã làm sạch toàn bộ trang trong tệp ZIP",
            desc: "Tất cả bóng thoại đã được khôi phục nét vẽ nguyên bản.",
            downloadBlob: blob,
            filename: `cleaned_${state.batchFile.name}`,
          });
        } else {
          formData.append("reading_order", document.getElementById("batch-trans-order").value);
          formData.append("ocr_engine", document.getElementById("batch-trans-engine").value);
          formData.append("chat_only", document.getElementById("batch-trans-chat-only").checked ? "true" : "false");
          formData.append("target_lang", "vi");
          if (state.apiKey) formData.append("api_key", state.apiKey);

          logBox.innerHTML += `[${new Date().toLocaleTimeString()}] Đang bóc tách bóng thoại & OCR...<br>`;
          progressBar.style.width = "75%";
          progressPct.textContent = "75%";

          const res = await fetch(`${getCleanBackendUrl()}/api/v1/translate-zip`, {
            method: "POST",
            body: formData,
          });

          if (!res.ok) throw new Error(`Lỗi server HTTP ${res.status}`);
          const data = await res.json();

          progressBar.style.width = "100%";
          progressPct.textContent = "100%";
          progressStatus.textContent = `✅ Đã dịch xong ${data.total_pages} trang!`;
          logBox.innerHTML += `[${new Date().toLocaleTimeString()}] Đã dịch ${data.total_dialogue_boxes || 0} câu trong ${data.execution_time_seconds}s!<br>`;

          const fullTxt = (data.pages || [])
            .map(
              (p) =>
                `=== ${p.filename} (Trang ${p.page_index}) ===\n` +
                (p.data || []).map((d) => `[#${d.id}] Gốc: ${d.original_text} -> Dịch: ${d.translated_text}`).join("\n")
            )
            .join("\n\n--------------------------------------------\n\n");

          const blob = new Blob([fullTxt], { type: "text/plain;charset=utf-8" });

          showBatchResult({
            title: `Đã dịch xong ${data.total_pages} trang truyện (${data.total_dialogue_boxes} câu thoại)`,
            desc: `Thời gian thực thi: ${data.execution_time_seconds}s | Lọc bong bóng chat: Bật`,
            downloadBlob: blob,
            filename: `translated_script_${state.batchFile.name.replace(/\.zip$/i, "")}.txt`,
            pages: data.pages || [],
          });
        }
        showToast("Đã xử lý xong tệp ZIP!", "success");
      }
    } catch (err) {
      showToast(`Lỗi xử lý hàng loạt: ${err.message}`, "error");
      progressStatus.textContent = "❌ Thất bại";
      logBox.innerHTML += `[LỖI] ${err.message}<br>`;
    } finally {
      runBtn.disabled = false;
      runBtn.innerHTML = `<span>🚀 Bắt Đầu Xử Lý Hàng Loạt Tệp ZIP</span>`;
    }
  });

  function showBatchResult({ title, desc, downloadBlob, filename, pages }) {
    document.getElementById("batch-empty-view").style.display = "none";
    const resView = document.getElementById("batch-result-view");
    resView.style.display = "block";

    document.getElementById("batch-result-title").textContent = title;
    document.getElementById("batch-result-desc").textContent = desc;

    const dlBtn = document.getElementById("btn-download-batch-zip");
    dlBtn.href = URL.createObjectURL(downloadBlob);
    dlBtn.download = filename;

    const tableWrap = document.getElementById("batch-pages-table-wrap");
    const tbody = document.getElementById("batch-pages-table-body");
    if (pages && pages.length) {
      tableWrap.style.display = "block";
      tbody.innerHTML = pages
        .map((p, idx) => {
          const pageNum = p.page_index ?? p.pageIndex ?? idx + 1;
          const boxCount =
            p.total_boxes ??
            p.totalBoxes ??
            (p.data ? p.data.length : p.stats ? (p.stats.chat_count ?? p.stats.total_boxes ?? 0) : 0);
          const isSuccess = p.success !== false && !p.error;
          const statusHtml = isSuccess
            ? `<span style="color:var(--emerald);">Thành công</span>`
            : `<span style="color:var(--rose);" title="${escapeHtml(p.error || '')}">Lỗi</span>`;
          return `
            <tr>
              <td>#${pageNum}</td>
              <td><code>${escapeHtml(p.filename || `Trang ${pageNum}`)}</code></td>
              <td><b>${boxCount}</b></td>
              <td>${statusHtml}</td>
            </tr>
          `;
        })
        .join("");
    } else {
      tableWrap.style.display = "none";
    }
  }
}

// -----------------------------------------------------------------------------
// SETTINGS MODAL
// -----------------------------------------------------------------------------
function initSettings() {
  const modal = document.getElementById("settings-modal");
  const openBtn = document.getElementById("btn-open-settings");
  const closeBtn = document.getElementById("btn-close-settings");
  const saveBtn = document.getElementById("btn-save-settings");
  const testBtn = document.getElementById("btn-test-connection");

  const urlInput = document.getElementById("setting-backend-url");
  const llmUrlInput = document.getElementById("setting-llm-base-url");
  const modelInput = document.getElementById("setting-llm-model");
  const keyInput = document.getElementById("setting-api-key");
  const testLlmBtn = document.getElementById("btn-test-llm");

  urlInput.value = state.backendUrl;
  if (llmUrlInput) llmUrlInput.value = state.llmBaseUrl;
  if (modelInput) modelInput.value = state.llmModel;
  keyInput.value = state.apiKey;

  openBtn.addEventListener("click", () => modal.classList.add("open"));
  closeBtn.addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("open");
  });

  saveBtn.addEventListener("click", () => {
    state.backendUrl = urlInput.value.trim() || "https://dobietdc-backe-manga-remove.hf.space";
    state.llmBaseUrl = (llmUrlInput?.value.trim()) || "https://discovery-api.intern-ai.org.cn/v1";
    state.llmModel = (modelInput?.value.trim()) || "deepseek-v4-flash-0731";
    state.apiKey = keyInput.value.trim();

    localStorage.setItem("manga_backend_url", state.backendUrl);
    localStorage.setItem("manga_llm_base_url", state.llmBaseUrl);
    localStorage.setItem("manga_llm_model", state.llmModel);
    localStorage.setItem("manga_api_key", state.apiKey);

    showToast("Đã lưu cấu hình thành công!", "success");
    modal.classList.remove("open");
    checkBackendHealth();
  });

  testBtn.addEventListener("click", async () => {
    testBtn.textContent = "Đang ping Backend...";
    const testUrl = urlInput.value.trim().replace(/\/+$/, "");
    try {
      const res = await fetch(`${testUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        showToast("Kết nối Backend thành công (Online)!", "success");
      } else {
        showToast(`Backend trả về mã lỗi HTTP ${res.status}`, "error");
      }
    } catch (e) {
      showToast(`Không thể kết nối tới Backend: ${testUrl}`, "error");
    } finally {
      testBtn.textContent = "🔌 Kiểm Tra Kết Nối Backend";
    }
  });

  if (testLlmBtn) {
    testLlmBtn.addEventListener("click", async () => {
      const activeKey = keyInput.value.trim() || state.apiKey;
      if (!activeKey) {
        showToast("Vui lòng nhập API Key trước khi kiểm tra!", "error");
        return;
      }
      testLlmBtn.textContent = "Đang ping AI Dịch...";
      let activeUrl = (llmUrlInput?.value.trim() || state.llmBaseUrl).replace(/\/+$/, "");
      activeUrl = activeUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/chat\/?$/, "");
      const activeModel = modelInput?.value.trim() || state.llmModel;

      try {
        let ok = false;
        // 1. Thử gọi trực tiếp
        try {
          const directRes = await fetch(`${activeUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${activeKey}`,
            },
            body: JSON.stringify({
              model: activeModel,
              messages: [{ role: "user", content: "Ping" }],
              max_tokens: 10,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (directRes.ok) ok = true;
        } catch (e) {
          // fallback proxy
        }

        // 2. Thử qua Vercel proxy
        if (!ok) {
          try {
            const proxyRes = await fetch("/api/translate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                messages: [{ role: "user", content: "Ping" }],
                model: activeModel,
                baseUrl: activeUrl,
                apiKey: activeKey,
              }),
              signal: AbortSignal.timeout(20000),
            });
            if (proxyRes.ok) ok = true;
          } catch (e) {
            // fallback HF proxy
          }
        }

        // 3. Thử qua HF Backend proxy
        if (!ok) {
          try {
            const hfRes = await fetch(`${getCleanBackendUrl()}/api/v1/translate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                messages: [{ role: "user", content: "Ping" }],
                model: activeModel,
                base_url: activeUrl,
                api_key: activeKey,
              }),
              signal: AbortSignal.timeout(20000),
            });
            if (hfRes.ok) ok = true;
          } catch (e) {
            // failed
          }
        }

        if (ok) {
          showToast(`Kết nối AI Dịch (${activeModel}) thành công!`, "success");
        } else {
          showToast("AI Dịch phản hồi không thành công. Kiểm tra lại Key / URL.", "error");
        }
      } catch (err) {
        showToast(`Không thể kết nối AI Dịch: ${err.message}`, "error");
      } finally {
        testLlmBtn.textContent = "🤖 Kiểm Tra Kết Nối AI Dịch (Ping LLM)";
      }
    });
  }

  // Server status pill click also opens settings
  document.getElementById("server-status-pill").addEventListener("click", () => {
    modal.classList.add("open");
  });
}

// -----------------------------------------------------------------------------
// INIT
// -----------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  initCleaner();
  initTranslator();
  initBatch();
  initSettings();

  checkBackendHealth();
  setInterval(checkBackendHealth, 30000);
});
