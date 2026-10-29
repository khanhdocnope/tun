/**
 * Tab 3: Single Manga Cleaner Logic
 */

async function optimizeImageBase64(file, maxDim = 2048, quality = 0.92) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        const maxCurrent = Math.max(w, h);

        if (maxCurrent <= maxDim && e.target.result.length < 2 * 1024 * 1024 && !e.target.result.startsWith("data:image/png")) {
          return resolve(e.target.result);
        }

        if (maxCurrent > maxDim) {
          const ratio = maxDim / maxCurrent;
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function initSingleCleaner() {
  const dropzone = document.getElementById("cleanerDropzone");
  const fileInput = document.getElementById("cleanerFileInput");
  const previewWrap = document.getElementById("cleanerPreviewWrap");
  const imgOriginal = document.getElementById("cleanerImgOriginal");
  const imgCleaned = document.getElementById("cleanerImgCleaned");
  const btnRun = document.getElementById("btnCleanerRun");
  const btnClear = document.getElementById("btnCleanerClear");
  const btnDownload = document.getElementById("btnCleanerDownload");
  const btnToggleView = document.getElementById("btnCleanerToggleView");

  let rawImageB64 = null;
  let cleanedImageB64 = null;
  let isViewingCleaned = true;

  if (!dropzone || !fileInput) return;

  // Dilation & Threshold range display
  const dilationInput = document.getElementById("cleanerDilation");
  const dilationVal = document.getElementById("cleanerDilationVal");
  dilationInput?.addEventListener("input", () => {
    if (dilationVal) dilationVal.textContent = `${dilationInput.value}px`;
  });

  const thresholdInput = document.getElementById("cleanerThreshold");
  const thresholdVal = document.getElementById("cleanerThresholdVal");
  thresholdInput?.addEventListener("input", () => {
    if (thresholdVal) thresholdVal.textContent = Number(thresholdInput.value).toFixed(2);
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
      handleFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
    }
  });

  async function handleFile(file) {
    if (!file.type.startsWith("image/")) {
      alert("Vui lòng chọn một tệp hình ảnh (.jpg, .png, .webp)!");
      return;
    }

    try {
      rawImageB64 = await optimizeImageBase64(file, 2048, 0.92);
      cleanedImageB64 = null;
      imgOriginal.src = rawImageB64;
      imgCleaned.src = rawImageB64;

      dropzone.style.display = "none";
      previewWrap.style.display = "flex";
      btnRun.disabled = false;
      btnDownload.disabled = true;
      btnToggleView.style.display = "none";
    } catch (e) {
      alert(`Lỗi đọc file: ${e.message}`);
    }
  }

  btnClear.addEventListener("click", () => {
    rawImageB64 = null;
    cleanedImageB64 = null;
    fileInput.value = "";
    previewWrap.style.display = "none";
    dropzone.style.display = "flex";
    btnRun.disabled = true;
    btnDownload.disabled = true;
  });

  btnToggleView.addEventListener("click", () => {
    if (!cleanedImageB64) return;
    isViewingCleaned = !isViewingCleaned;
    imgCleaned.style.display = isViewingCleaned ? "block" : "none";
    imgOriginal.style.display = isViewingCleaned ? "none" : "block";
    btnToggleView.textContent = isViewingCleaned ? "Xem ảnh gốc" : "Xem ảnh đã tẩy";
  });

  btnRun.addEventListener("click", async () => {
    if (!rawImageB64) return;
    btnRun.disabled = true;
    btnRun.innerHTML = `<span class="spinner-mini"></span> Đang tẩy chữ AI...`;

    try {
      const model = document.getElementById("cleanerModelSelect")?.value || "aot";
      const cleanSFX = document.getElementById("cleanerCheckSFX")?.checked || false;
      const dilation = Number(dilationInput?.value || 4);
      const threshold = Number(thresholdInput?.value || 0.2);

      const resp = await fetch("/api/clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: rawImageB64,
          detector: "default",
          inpainter: model === "aot" ? "aot" : model,
          inpaintModel: model,
          cleanSFX: cleanSFX,
          dilation_offset: dilation,
          dilationPx: dilation,
          detThreshold: threshold,
        }),
      });

      if (!resp.ok) {
        let errText = "";
        try {
          const errObj = await resp.json();
          errText = errObj.error || errObj.detail || JSON.stringify(errObj);
        } catch (_) {
          errText = await resp.text();
        }
        throw new Error(errText);
      }

      const data = await resp.json();
      if (data.cleanedImageBase64) {
        cleanedImageB64 = data.cleanedImageBase64;
        imgCleaned.src = cleanedImageB64;
        imgCleaned.style.display = "block";
        imgOriginal.style.display = "none";
        isViewingCleaned = true;

        btnDownload.disabled = false;
        btnToggleView.style.display = "inline-flex";
        btnToggleView.textContent = "Xem ảnh gốc";
      }
    } catch (e) {
      alert(`Lỗi tẩy chữ: ${e.message}`);
    } finally {
      btnRun.disabled = false;
      btnRun.innerHTML = `✨ Bắt đầu xóa chữ`;
    }
  });

  btnDownload.addEventListener("click", () => {
    if (!cleanedImageB64) return;
    const a = document.createElement("a");
    a.href = cleanedImageB64;
    a.download = `cleaned_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
}
