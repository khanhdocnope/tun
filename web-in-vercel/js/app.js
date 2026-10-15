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
  llmBaseUrl: localStorage.getItem("manga_llm_base_url") || "https://generativelanguage.googleapis.com/v1beta/openai",
  llmModel: localStorage.getItem("manga_llm_model") || "gemini-3-flash-preview",
  
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
  let url = (state.llmBaseUrl || "https://generativelanguage.googleapis.com/v1beta/openai").trim().replace(/\/+$/, "");
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

  const transLlmSelect = document.getElementById("trans-llm-model");
  if (transLlmSelect) {
    transLlmSelect.value = state.llmModel;
    transLlmSelect.addEventListener("change", () => {
      state.llmModel = transLlmSelect.value;
      localStorage.setItem("manga_llm_model", state.llmModel);
      const sModel = document.getElementById("setting-llm-model");
      if (sModel) sModel.value = state.llmModel;
      const bModel = document.getElementById("batch-llm-model");
      if (bModel) bModel.value = state.llmModel;
    });
  }

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
      const totalCount = data.total_boxes || data.totalBoxes || state.transResultData.length || 0;
      badge.textContent = `🔍 Đã nhận diện ${totalCount} bóng thoại (${ocrElapsed}ms)`;

      // Render ngay lập tức kết quả OCR lên canvas và bảng
      renderBubbleOverlay(state.transResultData);
      renderTranslationTable(state.transResultData);
      updateScriptDownloadLink();

      const chosenModel = document.getElementById("trans-llm-model")?.value || state.llmModel;
      state.llmModel = chosenModel;

      // Bước 2: Dịch ngữ cảnh bằng AI LLM (dùng API Key người dùng hoặc Cloud fallback)
      runBtn.innerHTML = `<span>🤖 Đang dịch ngữ cảnh bằng ${chosenModel}...</span>`;
      badge.textContent = `🤖 Đang dịch (${chosenModel})...`;

      await translateSpeechBubblesFrontend(state.transResultData, targetLang);

      const totalElapsed = Math.round(performance.now() - startT);
      badge.textContent = `✅ ${totalCount} câu | OCR: ${ocrElapsed}ms | Tổng: ${totalElapsed}ms`;

      // Cập nhật lại giao diện với bản dịch tiếng Việt hoàn chỉnh
      renderBubbleOverlay(state.transResultData);
      renderTranslationTable(state.transResultData);
      updateScriptDownloadLink();

      showToast(`Đã dịch thành công ${totalCount} câu thoại sang Tiếng Việt!`, "success");
    } catch (err) {
      showToast(`Lỗi khi xử lý: ${err.message}`, "error");
      badge.textContent = "Lỗi Xử Lý";
    } finally {
      runBtn.disabled = false;
      runBtn.innerHTML = `<span>🚀 AI Nhận Diện & Dịch Toàn Trang</span>`;
    }
  });

  // Copy Script Button (Format: === filename ===)
  document.getElementById("btn-copy-script").addEventListener("click", () => {
    if (!state.transResultData.length) {
      showToast("Chưa có kịch bản để sao chép!", "info");
      return;
    }
    const fileName = state.transFile?.name || "script.webp";
    const lines = [`=== ${fileName} ===`];
    state.transResultData.forEach((it) => {
      const text = (it.translated_text || it.original_text || "").trim();
      if (text) lines.push(text);
    });
    navigator.clipboard.writeText(lines.join("\n"));
    showToast("Đã sao chép kịch bản vào Clipboard!", "success");
  });
}

// -----------------------------------------------------------------------------
// FRONTEND CLIENT-SIDE TRANSLATION ENGINE (Prompt.txt Compliant)
// -----------------------------------------------------------------------------
function buildMangaSystemPrompt(targetLang = "vi") {
  const targetName = targetLang === "vi" ? "Tiếng Việt" : targetLang;
  return `You are a professional comic/manga/manhwa localization expert with 20+ years of experience translating comics into ${targetName}.

## TRANSLATION INSTRUCTIONS & RULES:
1. Phù hợp văn phong truyện tranh: Sử dụng câu từ TỰ NHIÊN, hiện đại, bắt tai, giàu cảm xúc, đúng chất manga/webtoon, không dùng từ ngữ cứng nhắc kiểu dịch máy.
2. Xưng hô & Đại từ (Pronouns & Honorifics): Xác định chuẩn xác mối quan hệ giữa các nhân vật (tuổi tác, giới tính, mức độ thân mật: anh/em, cậu/tớ, mày/tao, ông/tôi, chú/cháu...) để xưng hô tự nhiên và nhất quán trong suốt ngữ cảnh.
3. Câu thoại ngắt nhiều bóng (Multi-bubble Flow): Khi một câu hoàn chỉnh bị ngắt ra 2-3 bóng thoại liên tiếp, hãy nắm trọn vẹn ý nghĩa của cả câu trước, sau đó phân bổ bản dịch mượt mà vào từng dòng tương ứng mà không làm gãy ngữ pháp.
4. Xử lý chữ IN HOA (De-capitalize ALL-CAPS): Chữ gốc thường viết in hoa toàn bộ do kiểu font truyện tranh chứ KHÔNG PHẢI nhân vật đang hét. Bản dịch BẮT BUỘC dùng Sentence case (chỉ viết hoa chữ cái đầu câu và tên riêng).
5. Ký tự Ngã Sóng Manga ("〜" hoặc "～"): Ký tự này biểu thị giọng điệu ngân nga, vui vẻ, trêu đùa hoặc kéo dài âm thanh. TUYỆT ĐỐI KHÔNG thay bằng dấu ba chấm "..." (vì dấu ba chấm gây cảm giác ngập ngừng, lúng túng). Hãy giữ nguyên dấu "〜" hoặc kéo dài vần cuối theo cách tự nhiên.
6. Từ tượng thanh / SFX: Nếu dòng thoại là từ tượng thanh (tiếng va chạm, bước chân, tiếng kêu...), hãy dịch hoặc phiên âm NGẮN GỌN, súc tích, giữ đúng âm vang hiệu ứng truyện; KHÔNG dịch thành câu miêu tả dài dòng.
7. Tự sửa lỗi OCR: Tự động phát hiện và sửa các ký tự quét mờ hoặc sai dấu do OCR dựa vào mạch truyện.
8. Nguyên tắc 1-đổi-1 (Strict 1-to-1 Line Contract): Mỗi mã [#ID] phải có chính xác 1 dòng dịch tương ứng. Tuyệt đối KHÔNG viết các chữ giữ chỗ như (blank), (empty), (bỏ trống), (để trống), (no text), N/A... Nếu bóng thoại không có chữ, hãy để trống.

QUY ĐỊNH ĐẦU RA BẮT BUỘC:
Trả về kết quả dịch theo từng dòng theo đúng định dạng:
[#ID] Câu dịch ${targetName}
Ví dụ:
[#1] Về sớm nhỉ.
[#2] Ừ, hôm nay xong việc sớm.

Tuyệt đối KHÔNG sinh JSON, KHÔNG giải thích, KHÔNG chào hỏi.`;
}

async function translateSpeechBubblesFrontend(items, targetLang = "vi") {
  if (!items || items.length === 0) return items;

  const activeKey = (state.apiKey || localStorage.getItem("manga_api_key") || "").trim();
  if (!activeKey) return items;

  const systemPrompt = buildMangaSystemPrompt(targetLang);
  const userMessage = items.map((it) => `[#${it.id}] ${it.original_text}`).join("\n");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  let responseData = null;
  let lastError = "";

  const activeModel = (state.llmModel || "gemini-3-flash-preview").trim();
  const isGemini = activeModel.toLowerCase().includes("gemini");

  // 1. Thử gọi trực tiếp từ trình duyệt đến OpenAI-Compatible Endpoint (Client-side)
  try {
    const directPayload = {
      model: activeModel,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    };
    if (!isGemini) directPayload.thinking = { type: "disabled" };

    const directRes = await fetch(`${getCleanLlmUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeKey}`,
      },
      body: JSON.stringify(directPayload),
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
      const proxyPayload = {
        messages,
        model: activeModel,
        baseUrl: state.llmBaseUrl,
        apiKey: activeKey,
        temperature: 0.3,
        max_tokens: 4096,
      };
      if (!isGemini) proxyPayload.thinking = { type: "disabled" };

      const proxyRes = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proxyPayload),
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
      const hfPayload = {
        messages,
        model: activeModel,
        base_url: state.llmBaseUrl,
        api_key: activeKey,
        temperature: 0.3,
        max_tokens: 4096,
      };
      if (!isGemini) hfPayload.thinking = { type: "disabled" };

      const hfRes = await fetch(`${getCleanBackendUrl()}/api/v1/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hfPayload),
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
  const msgObj = responseData?.choices?.[0]?.message;
  let rawContent = msgObj?.content || "";
  if (!rawContent && msgObj?.reasoning_content) {
    console.warn("LLM content empty, falling back to reasoning_content");
    rawContent = msgObj.reasoning_content;
  }
  rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Ưu tiên trích xuất theo từng dòng [#ID] Câu dịch
  const map = new Map();
  const lines = rawContent.split("\n");
  for (const l of lines) {
    const match = l.trim().match(/^\[?#?(\d+)\]?[:\.\-\s]+(.*)$/);
    if (match) {
      map.set(Number(match[1]), match[2].trim());
    }
  }

  let translatedCount = 0;
  if (map.size > 0) {
    items.forEach((it) => {
      if (map.has(it.id)) {
        it.translated_text = map.get(it.id);
        translatedCount++;
      }
    });
  } else {
    // Fallback JSON parser nếu model vẫn cố tình xuất JSON
    let parsedArray = null;
    const jsonMatch = rawContent.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      try { parsedArray = JSON.parse(jsonMatch[0]); } catch (e) {}
    }
    if (!parsedArray) {
      try {
        const cleanJson = rawContent.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
        parsedArray = JSON.parse(cleanJson);
      } catch (e) {}
    }

    if (Array.isArray(parsedArray)) {
      parsedArray.forEach((p) => {
        if (p && p.id !== undefined) {
          map.set(Number(p.id), String(p.translated || p.translation || p.text || "").trim());
        }
      });
      items.forEach((it) => {
        if (map.has(it.id)) {
          it.translated_text = map.get(it.id);
          translatedCount++;
        }
      });
    } else {
      const cleanLines = rawContent.split("\n").map((l) => l.trim()).filter(Boolean);
      items.forEach((it, idx) => {
        if (cleanLines[idx]) {
          it.translated_text = cleanLines[idx].replace(/^\[#?\d+\]\s*/, "");
          translatedCount++;
        }
      });
    }
  }

  if (translatedCount === 0) {
    throw new Error(`AI trả về nội dung rỗng hoặc không có bản dịch tiếng Việt (${rawContent.slice(0, 80)}...)`);
  }

  return items;
}

function updateScriptDownloadLink() {
  if (!state.transResultData || !state.transResultData.length) return;
  const fileName = state.transFile?.name || "17.webp";
  const lines = [`=== ${fileName} ===`];
  state.transResultData.forEach((it) => {
    const text = (it.translated_text || it.original_text || "").trim();
    if (text) lines.push(text);
  });
  const scriptContent = lines.join("\n");
  const blob = new Blob([scriptContent], { type: "text/plain;charset=utf-8" });
  const dlBtn = document.getElementById("btn-download-script-txt");
  if (dlBtn) {
    dlBtn.href = URL.createObjectURL(blob);
    const baseName = fileName.replace(/\.[^/.]+$/, "") || "kich_ban";
    dlBtn.download = `${baseName}.txt`;
    dlBtn.style.display = "inline-flex";
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

  const batchLlmSelect = document.getElementById("batch-llm-model");
  if (batchLlmSelect) {
    batchLlmSelect.value = state.llmModel;
    batchLlmSelect.addEventListener("change", () => {
      state.llmModel = batchLlmSelect.value;
      localStorage.setItem("manga_llm_model", state.llmModel);
      const sModel = document.getElementById("setting-llm-model");
      if (sModel) sModel.value = state.llmModel;
      const tModel = document.getElementById("trans-llm-model");
      if (tModel) tModel.value = state.llmModel;
    });
  }

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

  // Run Batch (Client-Side Real-Time Engine với JSZip & Báo % thực tế)
  runBtn.addEventListener("click", async () => {
    if (!state.batchFile) return;

    const mode = modeSelect.value;
    runBtn.disabled = true;
    runBtn.innerHTML = `<span>⏳ Đang xử lý tệp ZIP...</span>`;

    const progressCard = document.getElementById("batch-progress-card");
    const progressBar = document.getElementById("batch-progress-bar");
    const progressStatus = document.getElementById("batch-progress-status");
    const progressPct = document.getElementById("batch-progress-pct");
    const logBox = document.getElementById("batch-log-box");

    progressCard.style.display = "block";
    progressBar.style.width = "3%";
    progressPct.textContent = "3%";
    progressStatus.textContent = "Đang đọc và giải nén tệp ZIP trên trình duyệt...";
    logBox.innerHTML = `[${new Date().toLocaleTimeString()}] Bắt đầu đọc tệp: <strong>${state.batchFile.name}</strong> (${(state.batchFile.size / 1024 / 1024).toFixed(2)} MB)...<br>`;

    try {
      // 1. Đảm bảo thư viện JSZip sẵn sàng
      if (typeof JSZip === "undefined") {
        logBox.innerHTML += `[${new Date().toLocaleTimeString()}] Đang tải thư viện JSZip...<br>`;
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      const inZip = new JSZip();
      const zipData = await inZip.loadAsync(state.batchFile);
      
      const validExts = [".png", ".jpg", ".jpeg", ".webp", ".bmp"];
      const imageEntries = [];
      zipData.forEach((relPath, file) => {
        if (!file.dir && !relPath.startsWith("__MACOSX/") && !file.name.startsWith(".")) {
          const lower = file.name.toLowerCase();
          if (validExts.some((ext) => lower.endsWith(ext))) {
            imageEntries.push(file);
          }
        }
      });

      // Sắp xếp thứ tự tự nhiên (01, 02, ... 10, ...)
      imageEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

      if (imageEntries.length === 0) {
        throw new Error("Không tìm thấy tệp ảnh hợp lệ (.jpg, .png, .webp) bên trong file ZIP.");
      }

      const totalPages = imageEntries.length;
      logBox.innerHTML += `[${new Date().toLocaleTimeString()}] 📦 Đã giải nén: Tìm thấy <strong>${totalPages} trang ảnh</strong>. Bắt đầu xử lý song song...<br>`;
      progressBar.style.width = "5%";
      progressPct.textContent = "5%";
      progressStatus.textContent = `0/${totalPages} trang (0%)...`;

      const readingOrder = document.getElementById("batch-trans-order").value;
      const ocrEngine = document.getElementById("batch-trans-engine").value;
      const chatOnly = document.getElementById("batch-trans-chat-only").checked;
      const inpaintModel = document.getElementById("batch-clean-model").value;
      const cleanSFX = document.getElementById("batch-clean-sfx-toggle").checked;

      let completedCount = 0;
      const results = new Array(totalPages);
      const startTime = performance.now();
      const outZip = mode === "clean" ? new JSZip() : null;

      // Hàm xử lý từng trang độc lập với cập nhật tiến trình % thực tế
      async function processPage(fileEntry, index) {
        const pageIdx = index + 1;
        const filename = fileEntry.name;
        const tStartPage = performance.now();

        try {
          const blob = await fileEntry.async("blob");

          if (mode === "clean") {
            // Chế độ XÓA CHỮ (Inpainting)
            const base64Img = await fileToBase64(blob);
            const cleanResp = await fetch(`${getCleanBackendUrl()}/clean_page`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageBase64: base64Img,
                cleanSFX: Boolean(cleanSFX),
                dilationPx: 4,
                detThreshold: 0.20,
                inpaintModel,
              }),
            });

            if (!cleanResp.ok) throw new Error(`HTTP ${cleanResp.status}`);
            const cleanData = await cleanResp.json();
            
            const b64 = cleanData.cleanedImageBase64.includes(";base64,")
              ? cleanData.cleanedImageBase64.split(";base64,").pop()
              : cleanData.cleanedImageBase64;
            outZip.file(filename, b64, { base64: true });

            const pageSec = ((performance.now() - tStartPage) / 1000).toFixed(1);
            results[index] = {
              pageIndex: pageIdx,
              filename,
              success: true,
              cleanedImageBase64: cleanData.cleanedImageBase64,
              stats: cleanData.stats,
              totalBoxes: cleanData.stats?.chat_count ?? 0,
            };

            completedCount++;
            const pct = Math.round((completedCount / totalPages) * 100);
            progressBar.style.width = `${pct}%`;
            progressPct.textContent = `${pct}%`;
            progressStatus.textContent = `Đang xóa chữ: ${completedCount}/${totalPages} trang (${pct}%)...`;
            logBox.innerHTML += `[${new Date().toLocaleTimeString()}] ✅ [${completedCount}/${totalPages}] <strong>${filename}</strong>: Xóa sạch chữ (${pageSec}s)<br>`;
            logBox.scrollTop = logBox.scrollHeight;

          } else {
            // Chế độ DỊCH THUẬT: Bước 1 chỉ OCR bóc tách bóng thoại
            const formData = new FormData();
            formData.append("file", blob, filename);
            formData.append("reading_order", readingOrder);
            formData.append("ocr_engine", ocrEngine);
            formData.append("chat_only", chatOnly ? "true" : "false");
            formData.append("target_lang", "vi");
            formData.append("ocr_only", "true");

            const ocrRes = await fetch(`${getCleanBackendUrl()}/api/v1/translate-page`, {
              method: "POST",
              body: formData,
            });

            if (!ocrRes.ok) {
              const errTxt = await ocrRes.text().catch(() => "");
              throw new Error(`OCR HTTP ${ocrRes.status} ${errTxt.slice(0, 80)}`);
            }
            const ocrData = await ocrRes.json();
            const boxes = ocrData.data || [];

            const pageSec = ((performance.now() - tStartPage) / 1000).toFixed(1);
            results[index] = {
              pageIndex: pageIdx,
              filename,
              success: true,
              data: boxes,
              totalBoxes: boxes.length,
            };

            completedCount++;
            // OCR chiếm 60% tiến trình đầu
            const pct = Math.round((completedCount / totalPages) * 60);
            progressBar.style.width = `${pct}%`;
            progressPct.textContent = `${pct}%`;
            progressStatus.textContent = `[Giai đoạn 1/2] Đang quét OCR: ${completedCount}/${totalPages} trang (${pct}%)...`;
            logBox.innerHTML += `[${new Date().toLocaleTimeString()}] 🔍 [${completedCount}/${totalPages}] <strong>${filename}</strong>: Nhận diện ${boxes.length} bóng thoại (${pageSec}s)<br>`;
            logBox.scrollTop = logBox.scrollHeight;
          }

        } catch (pageErr) {
          console.error(`Lỗi xử lý trang ${filename}:`, pageErr);
          completedCount++;
          results[index] = {
            pageIndex: pageIdx,
            filename,
            success: false,
            error: pageErr.message,
            data: [],
          };
          const basePct = mode === "clean" ? 100 : 60;
          const pct = Math.round((completedCount / totalPages) * basePct);
          progressBar.style.width = `${pct}%`;
          progressPct.textContent = `${pct}%`;
          logBox.innerHTML += `[${new Date().toLocaleTimeString()}] ⚠️ [${completedCount}/${totalPages}] <strong>${filename}</strong>: Lỗi (${pageErr.message})<br>`;
          logBox.scrollTop = logBox.scrollHeight;
        }
      }

      // Worker pool xử lý song song 2 luồng (Giai đoạn 1)
      const concurrency = 2;
      let nextIndex = 0;
      async function worker() {
        while (nextIndex < totalPages) {
          const idx = nextIndex++;
          await processPage(imageEntries[idx], idx);
        }
      }

      const workers = [];
      for (let w = 0; w < Math.min(concurrency, totalPages); w++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      // GIAI ĐOẠN 2: DỊCH THUẬT TOÀN BỘ CHƯƠNG THEO MẠCH CỐT TRUYỆN
      if (mode === "translate") {
        progressBar.style.width = "60%";
        progressPct.textContent = "60%";
        progressStatus.textContent = `[Giai đoạn 2/2] Đang gom kịch bản cả chap để dịch AI theo mạch truyện...`;
        logBox.innerHTML += `[${new Date().toLocaleTimeString()}] 🌐 Bắt đầu [Giai đoạn 2/2]: Dịch ngữ cảnh toàn bộ chương...<br>`;
        logBox.scrollTop = logBox.scrollHeight;

        // Gom tất cả bóng thoại của cả chương theo thứ tự trang
        const allItems = [];
        let globalId = 1;
        results.forEach((r) => {
          if (!r || !r.success) return;
          (r.data || []).forEach((b) => {
            const rawText = (b.original_text || "").trim();
            if (rawText) {
              b.globalId = globalId++;
              allItems.push(b);
            }
          });
        });

        if (allItems.length === 0) {
          logBox.innerHTML += `[${new Date().toLocaleTimeString()}] ⚠️ Không tìm thấy câu thoại tiếng Nhật nào cần dịch.<br>`;
        } else {
          logBox.innerHTML += `[${new Date().toLocaleTimeString()}] 📝 Tìm thấy tổng cộng ${allItems.length} câu thoại từ ${totalPages} trang. Bắt đầu dịch AI...<br>`;
          logBox.scrollTop = logBox.scrollHeight;

          // Chia thành các đợt (chunks) 50 câu theo yêu cầu người dùng
          const chunkSize = 50;
          const totalChunks = Math.ceil(allItems.length / chunkSize);

          for (let c = 0; c < totalChunks; c++) {
            const chunk = allItems.slice(c * chunkSize, (c + 1) * chunkSize);
            const chunkIdx = c + 1;
            const tStartChunk = performance.now();

            progressStatus.textContent = `[Giai đoạn 2/2] Đang dịch AI kịch bản cả chap (Đợt ${chunkIdx}/${totalChunks})...`;
            logBox.innerHTML += `[${new Date().toLocaleTimeString()}] 🤖 Đang dịch phần ${chunkIdx}/${totalChunks} (${chunk.length} câu thoại)...<br>`;
            logBox.scrollTop = logBox.scrollHeight;

            const translationItems = chunk.map((b) => ({
              id: b.globalId,
              original_text: b.original_text,
            }));

            let chunkSuccess = false;
            for (let attempt = 1; attempt <= 2; attempt++) {
              try {
                await translateSpeechBubblesFrontend(translationItems, "vi");
                translationItems.forEach((tItem, idx) => {
                  if (tItem.translated_text) {
                    chunk[idx].translated_text = tItem.translated_text;
                  }
                });
                const chunkSec = ((performance.now() - tStartChunk) / 1000).toFixed(1);
                logBox.innerHTML += `[${new Date().toLocaleTimeString()}] ✅ Hoàn tất dịch đợt ${chunkIdx}/${totalChunks} (${chunkSec}s)<br>`;
                chunkSuccess = true;
                break;
              } catch (chunkErr) {
                if (attempt === 1) {
                  logBox.innerHTML += `[${new Date().toLocaleTimeString()}] 🔄 Đợt ${chunkIdx} gặp trục trặc mạng (${chunkErr.message}), đang thử lại...<br>`;
                  logBox.scrollTop = logBox.scrollHeight;
                  await new Promise((r) => setTimeout(r, 1500));
                } else {
                  logBox.innerHTML += `[${new Date().toLocaleTimeString()}] ⚠️ Đợt ${chunkIdx} không thể kết nối AI (${chunkErr.message}) - giữ nguyên câu gốc tiếng Nhật.<br>`;
                }
              }
            }

            // Tiến độ tăng dần từ 60% -> 100%
            const transPct = 60 + Math.round((chunkIdx / totalChunks) * 40);
            progressBar.style.width = `${transPct}%`;
            progressPct.textContent = `${transPct}%`;
            logBox.scrollTop = logBox.scrollHeight;
          }
        }
      }

      // Hoàn tất 100%
      const totalElapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      progressBar.style.width = "100%";
      progressPct.textContent = "100%";
      progressStatus.textContent = `🎉 Hoàn tất toàn bộ ${totalPages} trang (${totalElapsed}s)!`;
      logBox.innerHTML += `[${new Date().toLocaleTimeString()}] 🚀 Hoàn thành toàn bộ ${totalPages} trang trong ${totalElapsed}s!<br>`;
      logBox.scrollTop = logBox.scrollHeight;

      let downloadBlob, downloadFilename;
      if (mode === "clean") {
        downloadBlob = await outZip.generateAsync({ type: "blob" });
        downloadFilename = `cleaned_${state.batchFile.name}`;
      } else {
        // Gom kịch bản thoại text theo đúng format chuẩn === filename ===
        const scriptLines = [];
        results.forEach((r) => {
          if (!r) return;
          scriptLines.push(`=== ${r.filename} ===`);
          if (!r.success) {
            scriptLines.push(`[Lỗi: ${r.error}]`);
          } else {
            (r.data || []).forEach((b) => {
              const text = (b.translated_text || b.original_text || "").trim();
              if (text) scriptLines.push(text);
            });
          }
          scriptLines.push("");
        });
        downloadBlob = new Blob([scriptLines.join("\n")], { type: "text/plain;charset=utf-8" });
        downloadFilename = `kich_ban_${state.batchFile.name.replace(/\.zip$/i, "")}.txt`;
      }

      showBatchResult({
        title: `Đã xử lý xong ${totalPages} trang truyện`,
        desc: `Thời gian thực thi: ${totalElapsed}s | Chế độ: ${mode.toUpperCase()} (${concurrency} luồng song song)`,
        downloadBlob: downloadBlob,
        filename: downloadFilename,
        pages: results,
      });

      showToast(`Đã xử lý thành công toàn bộ ${totalPages} trang!`, "success");

    } catch (err) {
      showToast(`Lỗi xử lý hàng loạt: ${err.message}`, "error");
      progressStatus.textContent = "❌ Thất bại";
      logBox.innerHTML += `[LỖI] ${err.message}<br>`;
    } finally {
      runBtn.disabled = false;
      runBtn.innerHTML = `<span>🚀 Bắt Đầu Xử Lý Hàng Loạt</span>`;
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
    state.llmBaseUrl = (llmUrlInput?.value.trim()) || "https://generativelanguage.googleapis.com/v1beta/openai";
    state.llmModel = (modelInput?.value.trim()) || "gemini-3-flash-preview";
    state.apiKey = keyInput.value.trim();

    localStorage.setItem("manga_backend_url", state.backendUrl);
    localStorage.setItem("manga_llm_base_url", state.llmBaseUrl);
    localStorage.setItem("manga_llm_model", state.llmModel);
    localStorage.setItem("manga_api_key", state.apiKey);

    const tModel = document.getElementById("trans-llm-model");
    if (tModel) tModel.value = state.llmModel;
    const bModel = document.getElementById("batch-llm-model");
    if (bModel) bModel.value = state.llmModel;
    const rModel = document.getElementById("retrans-model-select");
    if (rModel) rModel.value = state.llmModel;

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
// TAB 4: RE-TRANSLATE SCRIPT (.TXT)
// -----------------------------------------------------------------------------
function initScriptRetranslator() {
  const dropzone = document.getElementById("retrans-dropzone");
  const fileInput = document.getElementById("retrans-file-input");
  const rawInput = document.getElementById("retrans-raw-input");
  const clearBtn = document.getElementById("btn-clear-retrans");
  const runBtn = document.getElementById("btn-run-retrans");
  const modeSelect = document.getElementById("retrans-mode-select");
  const modelSelect = document.getElementById("retrans-model-select");

  const statPages = document.getElementById("retrans-stat-pages");
  const statLines = document.getElementById("retrans-stat-lines");
  const statJa = document.getElementById("retrans-stat-ja");

  const progressCard = document.getElementById("retrans-progress-card");
  const progressBar = document.getElementById("retrans-progress-bar");
  const progressPct = document.getElementById("retrans-progress-pct");
  const progressStatus = document.getElementById("retrans-progress-status");
  const logBox = document.getElementById("retrans-log-box");

  const emptyView = document.getElementById("retrans-empty-view");
  const resultView = document.getElementById("retrans-result-view");
  const resultOutput = document.getElementById("retrans-result-output");
  const copyBtn = document.getElementById("btn-copy-retrans");
  const dlBtn = document.getElementById("btn-download-retrans");

  if (!dropzone || !rawInput) return;
  if (modelSelect) modelSelect.value = state.llmModel;

  function isJapaneseText(str) {
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(str);
  }

  function analyzeScript() {
    const text = rawInput.value.trim();
    if (!text) {
      statPages.textContent = "0";
      statLines.textContent = "0";
      statJa.textContent = "0";
      runBtn.disabled = true;
      return;
    }

    const lines = text.split(/\r?\n/);
    let pages = 0;
    let dialogueLines = 0;
    let jaLines = 0;

    lines.forEach((l) => {
      const trimmed = l.trim();
      if (!trimmed) return;
      if (/^===\s*.*?===\s*$/.test(trimmed)) {
        pages++;
      } else {
        dialogueLines++;
        if (isJapaneseText(trimmed)) jaLines++;
      }
    });

    statPages.textContent = String(pages || (dialogueLines ? 1 : 0));
    statLines.textContent = String(dialogueLines);
    statJa.textContent = String(jaLines);
    runBtn.disabled = dialogueLines === 0;
  }

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files?.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files?.length) {
      handleFile(e.target.files[0]);
    }
  });

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      rawInput.value = e.target.result;
      analyzeScript();
      showToast(`Đã đọc tệp: ${file.name}`, "info");
    };
    reader.readAsText(file, "utf-8");
  }

  rawInput.addEventListener("input", analyzeScript);
  clearBtn.addEventListener("click", () => {
    rawInput.value = "";
    fileInput.value = "";
    analyzeScript();
  });

  // RUN RE-TRANSLATION
  runBtn.addEventListener("click", async () => {
    const text = rawInput.value.trim();
    if (!text) return;

    const mode = modeSelect.value;
    const originalModel = state.llmModel;
    if (modelSelect.value) {
      state.llmModel = modelSelect.value;
    }

    runBtn.disabled = true;
    runBtn.innerHTML = `<span>⏳ Đang Dịch Lại...</span>`;
    progressCard.style.display = "block";
    progressBar.style.width = "0%";
    progressPct.textContent = "0%";
    progressStatus.textContent = "Đang phân tích cấu trúc kịch bản...";
    logBox.innerHTML = `[${new Date().toLocaleTimeString()}] Bắt đầu phân tích kịch bản...<br>`;

    try {
      const rawLines = rawInput.value.split(/\r?\n/);
      const parsedItems = [];
      let currentHeader = "=== script ===";
      let globalId = 1;

      rawLines.forEach((l) => {
        const trimmed = l.trim();
        if (/^===\s*.*?===\s*$/.test(trimmed)) {
          currentHeader = trimmed;
          parsedItems.push({ type: "header", text: trimmed });
        } else if (!trimmed) {
          parsedItems.push({ type: "empty", text: "" });
        } else {
          const needsTrans = mode === "all" || isJapaneseText(trimmed);
          const item = {
            type: "dialogue",
            id: needsTrans ? globalId++ : null,
            original_text: trimmed,
            translated_text: needsTrans ? null : trimmed,
            needsTrans,
            header: currentHeader,
          };
          parsedItems.push(item);
        }
      });

      const itemsToTranslate = parsedItems.filter((it) => it.needsTrans);
      const totalToTranslate = itemsToTranslate.length;

      logBox.innerHTML += `[${new Date().toLocaleTimeString()}] 📝 Tìm thấy ${totalToTranslate} câu cần dịch (${mode === "only_japanese" ? "Chỉ câu tiếng Nhật" : "Toàn bộ"}).<br>`;
      logBox.scrollTop = logBox.scrollHeight;

      if (totalToTranslate === 0) {
        showToast("Tất cả câu thoại đã là tiếng Việt, không cần dịch lại!", "info");
        progressBar.style.width = "100%";
        progressPct.textContent = "100%";
        progressStatus.textContent = "Không có câu nào cần dịch.";
        return;
      }

      const chunkSize = 50;
      const totalChunks = Math.ceil(totalToTranslate / chunkSize);
      const startTime = performance.now();

      for (let c = 0; c < totalChunks; c++) {
        const chunk = itemsToTranslate.slice(c * chunkSize, (c + 1) * chunkSize);
        const chunkIdx = c + 1;
        const tStartChunk = performance.now();

        progressStatus.textContent = `Đang dịch đợt ${chunkIdx}/${totalChunks}...`;
        logBox.innerHTML += `[${new Date().toLocaleTimeString()}] 🤖 Dịch đợt ${chunkIdx}/${totalChunks} (${chunk.length} câu)...<br>`;
        logBox.scrollTop = logBox.scrollHeight;

        const transPayload = chunk.map((b) => ({
          id: b.id,
          original_text: b.original_text,
        }));

        let chunkOk = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            await translateSpeechBubblesFrontend(transPayload, "vi");
            transPayload.forEach((tItem, idx) => {
              if (tItem.translated_text) {
                chunk[idx].translated_text = tItem.translated_text;
              }
            });
            const chunkSec = ((performance.now() - tStartChunk) / 1000).toFixed(1);
            logBox.innerHTML += `[${new Date().toLocaleTimeString()}] ✅ Hoàn tất đợt ${chunkIdx}/${totalChunks} (${chunkSec}s)<br>`;
            chunkOk = true;
            break;
          } catch (chunkErr) {
            if (attempt === 1) {
              logBox.innerHTML += `[${new Date().toLocaleTimeString()}] 🔄 Đợt ${chunkIdx} gặp lỗi (${chunkErr.message}), đang thử lại...<br>`;
              logBox.scrollTop = logBox.scrollHeight;
              await new Promise((r) => setTimeout(r, 1200));
            } else {
              logBox.innerHTML += `[${new Date().toLocaleTimeString()}] ⚠️ Đợt ${chunkIdx} thất bại (${chunkErr.message}) - giữ nguyên câu gốc.<br>`;
            }
          }
        }

        const pct = Math.round((chunkIdx / totalChunks) * 100);
        progressBar.style.width = `${pct}%`;
        progressPct.textContent = `${pct}%`;
        logBox.scrollTop = logBox.scrollHeight;
      }

      const totalElapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      progressBar.style.width = "100%";
      progressPct.textContent = "100%";
      progressStatus.textContent = `🎉 Hoàn tất dịch lại toàn bộ ${totalToTranslate} câu (${totalElapsed}s)!`;
      logBox.innerHTML += `[${new Date().toLocaleTimeString()}] 🚀 Hoàn thành toàn bộ kịch bản trong ${totalElapsed}s!<br>`;
      logBox.scrollTop = logBox.scrollHeight;

      // Gom kịch bản đầu ra
      const outLines = [];
      parsedItems.forEach((it) => {
        if (it.type === "header") {
          outLines.push(it.text);
        } else if (it.type === "empty") {
          outLines.push("");
        } else {
          outLines.push((it.translated_text || it.original_text || "").trim());
        }
      });

      const finalScriptText = outLines.join("\n");
      emptyView.style.display = "none";
      resultView.style.display = "block";
      resultOutput.value = finalScriptText;

      copyBtn.disabled = false;
      const blob = new Blob([finalScriptText], { type: "text/plain;charset=utf-8" });
      dlBtn.href = URL.createObjectURL(blob);
      dlBtn.style.display = "inline-block";

      showToast(`Đã dịch lại xong toàn bộ ${totalToTranslate} câu (${totalElapsed}s)!`, "success");

    } catch (err) {
      showToast(`Lỗi khi dịch lại kịch bản: ${err.message}`, "error");
      progressStatus.textContent = "❌ Thất bại";
      logBox.innerHTML += `[LỖI] ${err.message}<br>`;
    } finally {
      state.llmModel = originalModel;
      runBtn.disabled = false;
      runBtn.innerHTML = `<span>🚀 Bắt Đầu Dịch Lại Kịch Bản Bằng AI</span>`;
    }
  });

  copyBtn.addEventListener("click", () => {
    if (!resultOutput.value) return;
    navigator.clipboard.writeText(resultOutput.value);
    showToast("Đã sao chép kịch bản hoàn chỉnh vào Clipboard!", "success");
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
  initScriptRetranslator();
  initSettings();

  checkBackendHealth();
  setInterval(checkBackendHealth, 30000);
});
