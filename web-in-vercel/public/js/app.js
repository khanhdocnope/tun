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
    runBtn.innerHTML = `<span>⏳ Đang nhận diện bubble, OCR & Dịch LLM...</span>`;
    const badge = document.getElementById("trans-stats-badge");
    badge.textContent = "AI Đang Dịch...";

    const formData = new FormData();
    formData.append("file", state.transFile);
    formData.append("reading_order", document.getElementById("trans-reading-order").value);
    formData.append("ocr_engine", document.getElementById("trans-ocr-engine").value);
    formData.append("source_lang", document.getElementById("trans-source-lang").value);
    formData.append("target_lang", document.getElementById("trans-target-lang").value.trim() || "vi");
    formData.append("chat_only", document.getElementById("trans-chat-only-toggle").checked ? "true" : "false");

    if (state.apiKey) {
      formData.append("api_key", state.apiKey);
    }

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
          targetLang: document.getElementById("trans-target-lang").value.trim() || "vi",
          apiKey: state.apiKey,
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
      const elapsed = Math.round(performance.now() - startT);
      badge.textContent = `✅ ${data.total_boxes} bóng thoại | ${elapsed}ms`;

      renderBubbleOverlay(state.transResultData);
      renderTranslationTable(state.transResultData);

      // Setup Script Download
      const scriptContent = state.transResultData
        .map((it) => `[#${it.id}] Gốc: ${it.original_text} -> Dịch: ${it.translated_text}`)
        .join("\n\n");
      const blob = new Blob([scriptContent], { type: "text/plain;charset=utf-8" });
      const dlBtn = document.getElementById("btn-download-script-txt");
      dlBtn.href = URL.createObjectURL(blob);
      dlBtn.download = `kịch_bản_dịch_${Date.now()}.txt`;
      dlBtn.style.display = "flex";

      showToast(`Đã dịch thành công ${data.total_boxes} câu thoại!`, "success");
    } catch (err) {
      showToast(`Lỗi khi dịch trang: ${err.message}`, "error");
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
      <td><span class="trans-id-pill">#${it.id}</span></td>
      <td class="text-orig">${escapeHtml(it.original_text)}</td>
      <td class="text-trans">${escapeHtml(it.translated_text)}</td>
    </tr>
  `
    )
    .join("");

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

          const blob = new Blob([cloudData.scriptText || "Hoàn thành"], { type: "text/plain;charset=utf-8" });
          showBatchResult({
            title: `Đã xử lý xong ${cloudData.totalPages} trang truyện trên Cloud`,
            desc: `Thời gian thực thi: ${cloudData.elapsedSeconds}s | Chế độ: ${mode.toUpperCase()}`,
            downloadBlob: blob,
            filename: `kich_ban_${state.batchFile.name.replace(/\.zip$/i, "")}.txt`,
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
        .map(
          (p) => `
        <tr>
          <td>#${p.page_index}</td>
          <td><code>${p.filename}</code></td>
          <td><b>${p.total_boxes}</b></td>
          <td><span style="color:var(--emerald);">Thành công</span></td>
        </tr>
      `
        )
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
  const keyInput = document.getElementById("setting-api-key");

  urlInput.value = state.backendUrl;
  keyInput.value = state.apiKey;

  openBtn.addEventListener("click", () => modal.classList.add("open"));
  closeBtn.addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("open");
  });

  saveBtn.addEventListener("click", () => {
    state.backendUrl = urlInput.value.trim() || "https://dobietdc-backe-manga-remove.hf.space";
    state.apiKey = keyInput.value.trim();

    localStorage.setItem("manga_backend_url", state.backendUrl);
    localStorage.setItem("manga_api_key", state.apiKey);

    showToast("Đã lưu cấu hình thành công!", "success");
    modal.classList.remove("open");
    checkBackendHealth();
  });

  testBtn.addEventListener("click", async () => {
    testBtn.textContent = "Đang ping...";
    const testUrl = urlInput.value.trim().replace(/\/+$/, "");
    try {
      const res = await fetch(`${testUrl}/health`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        showToast("Kết nối Backend thành công (Online)!", "success");
      } else {
        showToast(`Backend trả về mã lỗi HTTP ${res.status}`, "error");
      }
    } catch (e) {
      showToast(`Không thể kết nối tới: ${testUrl}`, "error");
    } finally {
      testBtn.textContent = "Kiểm Tra Kết Nối";
    }
  });

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
