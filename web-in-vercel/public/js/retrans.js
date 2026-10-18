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

      logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [KỊCH BẢN] Tìm thấy ${totalToTranslate} câu cần dịch (${mode === "only_japanese" ? "Chỉ câu tiếng Nhật" : "Toàn bộ"}).<br>`;
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
        logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [AI] Dịch đợt ${chunkIdx}/${totalChunks} (${chunk.length} câu)...<br>`;
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
            logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [OK] Hoàn tất đợt ${chunkIdx}/${totalChunks} (${chunkSec}s)<br>`;
            chunkOk = true;
            break;
          } catch (chunkErr) {
            if (attempt === 1) {
              logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [THỬ LẠI] Đợt ${chunkIdx} gặp lỗi (${chunkErr.message}), đang thử lại...<br>`;
              logBox.scrollTop = logBox.scrollHeight;
              await new Promise((r) => setTimeout(r, 1200));
            } else {
              logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [WARN] Đợt ${chunkIdx} thất bại (${chunkErr.message}) - giữ nguyên câu gốc.<br>`;
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
      progressStatus.textContent = `Hoàn tất dịch lại toàn bộ ${totalToTranslate} câu (${totalElapsed}s)!`;
      logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [XONG] Hoàn thành toàn bộ kịch bản trong ${totalElapsed}s!<br>`;
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
      progressStatus.textContent = "Thất bại";
      logBox.innerHTML += `[LỖI] ${err.message}<br>`;
    } finally {
      state.llmModel = originalModel;
      runBtn.disabled = false;
      runBtn.innerHTML = `<span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Bắt Đầu Dịch Lại Kịch Bản Bằng AI</span>`;
    }
  });

  copyBtn.addEventListener("click", () => {
    if (!resultOutput.value) return;
    navigator.clipboard.writeText(resultOutput.value);
    showToast("Đã sao chép kịch bản hoàn chỉnh vào Clipboard!", "success");
  });
}

