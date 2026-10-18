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
      badge.textContent = `${data.stats?.total_time_ms || elapsed}ms | ${payload.inpaintModel}`;

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
      runBtn.innerHTML = `<span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>AI Bóc Tách & Làm Sạch Nét Vẽ</span>`;
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
