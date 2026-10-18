// -----------------------------------------------------------------------------
// State & Storage
// -----------------------------------------------------------------------------
const state = {
  backendUrl: localStorage.getItem("manga_backend_url") || "https://dobietdc-backe-manga-remove.hf.space",
  apiKey: localStorage.getItem("manga_api_key") || "",
  llmBaseUrl: localStorage.getItem("manga_llm_base_url") || "https://generativelanguage.googleapis.com/v1beta/openai",
  llmModel: (() => {
    const m = localStorage.getItem("manga_llm_model");
    if (!m || m === "gemini-3-flash-preview" || m === "gemini-1.5-flash") return "gemini-2.5-flash";
    return m;
  })(),
  
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
  
      const icon = type === "success"
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" style="vertical-align:-2px; margin-right:6px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'
        : type === "error"
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" style="vertical-align:-2px; margin-right:6px;"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" style="vertical-align:-2px; margin-right:6px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';

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
    text.textContent = "Backend Offline (Bấm biểu tượng Cài đặt để đổi URL)";
  }
}

// -----------------------------------------------------------------------------
// Tab Switching
// -----------------------------------------------------------------------------
// Các tab cũ (Dịch Bubble OCR, ZIP Batch) được ẩn: luồng dịch nay nằm ở /batch-studio ("Chương (hàng loạt)").
// Đặt true để hiện lại 2 tab cũ (mã cũ vẫn còn nguyên, chưa xóa).
var isLegacyTabs = (typeof LEGACY_TABS !== "undefined") ? LEGACY_TABS : false;

function initTabs() {
  if (isLegacyTabs || (typeof LEGACY_TABS !== "undefined" && LEGACY_TABS)) {
    document.querySelectorAll(".tab-btn.legacy-tab").forEach((b) => b.removeAttribute("hidden"));
  }
  const tabBtns = document.querySelectorAll(".tab-btn:not([hidden])");
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
    state.llmModel = (modelInput?.value.trim()) || "gemini-2.5-flash";
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
      testBtn.textContent = "Kiểm Tra Kết Nối Backend";
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
        testLlmBtn.textContent = "Kiểm Tra Kết Nối AI Dịch (Ping LLM)";
      }
    });
  }

  // Server status pill click also opens settings
  document.getElementById("server-status-pill").addEventListener("click", () => {
    modal.classList.add("open");
  });
}

// -----------------------------------------------------------------------------
