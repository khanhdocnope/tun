// TAB 2: AI TRANSLATOR & BUBBLE OCR LOGIC
// -----------------------------------------------------------------------------
function initTranslator() {
  const dropzone = document.getElementById("trans-dropzone");
  const fileInput = document.getElementById("trans-file-input");
  const previewWrap = document.getElementById("trans-preview-wrap");
  const previewImg = document.getElementById("trans-preview-img");
  const clearBtn = document.getElementById("trans-clear-btn");
  const runBtn = document.getElementById("btn-run-translate");
  const badge = document.getElementById("trans-stats-badge");

  // Vision Mode elements
  const btnModeQuick = document.getElementById("trans-btn-mode-quick");
  const btnModePro = document.getElementById("trans-btn-mode-pro");
  const modeHint = document.getElementById("trans-mode-hint");
  const quickControls = document.getElementById("trans-quick-controls");
  const proControls = document.getElementById("trans-pro-controls");

  const btnRunQuick = document.getElementById("btn-run-quick-trans");
  const btnRunVisionOcr = document.getElementById("btn-run-vision-ocr");
  const btnRunVisionTranslate = document.getElementById("btn-run-vision-translate");

  const refineBox = document.getElementById("trans-refine-box");
  const refineInput = document.getElementById("trans-refine-input");
  const btnRefineTranslate = document.getElementById("btn-refine-translate");
  const btnRefineOcr = document.getElementById("btn-refine-ocr");

  let currentMode = "quick"; // 'quick' | 'pro'

  if (btnModeQuick && btnModePro) {
    btnModeQuick.addEventListener("click", () => {
      currentMode = "quick";
      btnModeQuick.classList.add("active");
      btnModePro.classList.remove("active");
      if (quickControls) quickControls.style.display = "block";
      if (proControls) proControls.style.display = "none";
      if (modeHint) {
        modeHint.innerHTML = "<b>Quick Mode</b>: Gửi ảnh trực tiếp tới Gemini Vision để nhận bản dịch tiếng Việt tức thì (~2s-4s).";
      }
    });

    btnModePro.addEventListener("click", () => {
      currentMode = "pro";
      btnModePro.classList.add("active");
      btnModeQuick.classList.remove("active");
      if (proControls) proControls.style.display = "flex";
      if (quickControls) quickControls.style.display = "none";
      if (modeHint) {
        modeHint.innerHTML = "<b>Pro Mode</b>: Quét OCR bóc tách từng bóng thoại (Temp 0.1) → Sửa chữ gốc → Dịch ngữ cảnh kèm ảnh (Temp 0.6).";
      }
    });
  }

  const ocrEngineSelect = document.getElementById("trans-ocr-engine");
  const sourceLangGroup = document.getElementById("trans-source-lang-group");

  if (ocrEngineSelect && sourceLangGroup) {
    ocrEngineSelect.addEventListener("change", () => {
      sourceLangGroup.style.display = ocrEngineSelect.value === "multilingual" ? "block" : "none";
    });
  }

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
    if (runBtn) runBtn.disabled = true;
    if (btnRunQuick) btnRunQuick.disabled = true;
    if (btnRunVisionOcr) btnRunVisionOcr.disabled = true;
    if (btnRunVisionTranslate) btnRunVisionTranslate.disabled = true;
    if (refineBox) refineBox.style.display = "none";
    if (badge) badge.textContent = "Chưa Xử Lý";
    state.transResultData = [];
    renderTranslationTable([]);
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

    if (runBtn) runBtn.disabled = false;
    if (btnRunQuick) btnRunQuick.disabled = false;
    if (btnRunVisionOcr) btnRunVisionOcr.disabled = false;
    if (btnRunVisionTranslate) btnRunVisionTranslate.disabled = true; // Enabled after OCR
    if (refineBox) refineBox.style.display = "none";

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

  // Vision API Caller Helper
  async function callVisionApi(task, extraPayload = {}) {
    const payload = {
      task,
      imageBase64: previewImg.src,
      readingOrder: document.getElementById("trans-reading-order")?.value || "manga",
      skipSfx: document.getElementById("trans-chat-only-toggle")?.checked ?? true,
      targetLang: document.getElementById("trans-target-lang")?.value.trim() || "Tiếng Việt",
      model: state.llmModel || "gemini-2.5-flash",
      apiKey: state.apiKey,
      ...extraPayload,
    };

    let res;
    try {
      res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });
    } catch (netErr) {
      if (state.apiKey) {
        return await callGeminiVisionDirect(payload);
      }
      throw netErr;
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }

    return await res.json();
  }

  async function callGeminiVisionDirect(payload) {
    const apiKey = state.apiKey;
    const model = state.llmModel || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const cleanBase64 = (payload.imageBase64 || "").replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");

    let prompt = "";
    if (payload.task === "quick_translate") {
      prompt = `Translate all speech bubbles in this manga into ${payload.targetLang}. Reading order: ${payload.readingOrder}. Output numbered lines: [1] ..., [2] ...`;
    } else if (payload.task === "ocr") {
      prompt = `Extract all speech bubble text from this manga. Reading order: ${payload.readingOrder}. Output numbered lines: [1] ..., [2] ...`;
    } else if (payload.task === "translate_with_image") {
      prompt = `Translate these speech bubbles into ${payload.targetLang} using image context:\n${payload.ocrText}\nOutput numbered lines: [1] ..., [2] ...`;
    } else {
      prompt = `${payload.userInstruction || "Improve translation"}:\n${payload.prevTranslation}`;
    }

    const parts = [{ text: prompt }];
    if (cleanBase64 && payload.task !== "refine_translate") {
      parts.push({ inline_data: { mime_type: "image/jpeg", data: cleanBase64 } });
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[\[(]?\d+[\])\.:：]\s*/, "").trim())
      .filter(Boolean);
    return { success: true, lines, elapsed_s: 1.5 };
  }

  // 1. QUICK MODE: 1-Click Translation via Gemini Vision
  if (btnRunQuick) {
    btnRunQuick.addEventListener("click", async () => {
      if (!state.transFile) return;

      btnRunQuick.disabled = true;
      btnRunQuick.innerHTML = `<span>⏳ Đang đọc ảnh & dịch bằng Gemini Vision...</span>`;
      badge.textContent = "Gemini Vision đang dịch...";

      const startT = performance.now();
      try {
        const data = await callVisionApi("quick_translate");
        const lines = data.lines || [];
        if (!lines.length) {
          throw new Error("Không phát hiện được nội dung thoại trên trang này.");
        }

        state.transResultData = lines.map((line, idx) => ({
          id: idx + 1,
          box: [0, 0, 0, 0],
          original_text: `[Bóng thoại #${idx + 1}]`,
          translated_text: line,
        }));

        renderTranslationTable(state.transResultData);
        updateScriptDownloadLink();

        const elapsed = (data.elapsed_s || ((performance.now() - startT) / 1000)).toFixed(1);
        badge.textContent = `[OK] ${lines.length} câu | ${elapsed}s (Gemini Vision)`;
        if (refineBox) refineBox.style.display = "block";

        showToast(`Gemini Vision đã dịch ${lines.length} câu trong ${elapsed}s!`, "success");
      } catch (err) {
        showToast(`Lỗi Gemini Vision: ${err.message}`, "error");
        badge.textContent = "Lỗi Xử Lý";
      } finally {
        btnRunQuick.disabled = false;
        btnRunQuick.innerHTML = `<span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>Dịch Thẳng 1-Click (Gemini Vision ~2s)</span>`;
      }
    });
  }

  // 2. PRO MODE STEP 1: Vision OCR & Bubble Segmentation (Temp 0.1)
  if (btnRunVisionOcr) {
    btnRunVisionOcr.addEventListener("click", async () => {
      if (!state.transFile) return;

      btnRunVisionOcr.disabled = true;
      btnRunVisionOcr.innerHTML = `<span>⏳ Đang quét OCR bằng Gemini Vision...</span>`;
      badge.textContent = "Gemini Vision đang OCR...";

      const startT = performance.now();
      try {
        const data = await callVisionApi("ocr");
        const lines = data.lines || [];
        if (!lines.length) {
          throw new Error("Không tìm thấy chữ trong bóng thoại.");
        }

        state.transResultData = lines.map((line, idx) => ({
          id: idx + 1,
          box: [0, 0, 0, 0],
          original_text: line,
          translated_text: "",
        }));

        renderTranslationTable(state.transResultData);
        updateScriptDownloadLink();

        if (btnRunVisionTranslate) btnRunVisionTranslate.disabled = false;
        if (refineBox) refineBox.style.display = "block";

        const elapsed = (data.elapsed_s || ((performance.now() - startT) / 1000)).toFixed(1);
        badge.textContent = `Đã OCR ${lines.length} câu (${elapsed}s)`;

        showToast(`Đã nhận diện ${lines.length} bóng thoại! Bạn có thể kiểm tra và sửa chữ gốc ở cột giữa.`, "info");
      } catch (err) {
        showToast(`Lỗi OCR: ${err.message}`, "error");
        badge.textContent = "Lỗi OCR";
      } finally {
        btnRunVisionOcr.disabled = false;
        btnRunVisionOcr.innerHTML = `<span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:4px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>Bước 1: Quét OCR & Tách Bóng Thoại (Temp 0.1)</span>`;
      }
    });
  }

  // 2. PRO MODE STEP 2: Translation with Original Image Context (Temp 0.6)
  if (btnRunVisionTranslate) {
    btnRunVisionTranslate.addEventListener("click", async () => {
      if (!state.transResultData.length) {
        showToast("Vui lòng chạy Bước 1 (Quét OCR) trước!", "warning");
        return;
      }

      btnRunVisionTranslate.disabled = true;
      btnRunVisionTranslate.innerHTML = `<span>⏳ Đang dịch ngữ cảnh kèm ảnh gốc...</span>`;
      badge.textContent = "Đang dịch ngữ cảnh...";

      const startT = performance.now();
      try {
        const ocrText = state.transResultData.map((it) => it.original_text).join("\n");
        const data = await callVisionApi("translate_with_image", { ocrText });
        const lines = data.lines || [];

        state.transResultData.forEach((it, idx) => {
          if (lines[idx] !== undefined) {
            it.translated_text = lines[idx];
          }
        });

        renderTranslationTable(state.transResultData);
        updateScriptDownloadLink();

        const elapsed = (data.elapsed_s || ((performance.now() - startT) / 1000)).toFixed(1);
        badge.textContent = `[OK] Đã dịch ${state.transResultData.length} câu (${elapsed}s)`;

        showToast(`Đã hoàn tất dịch ${state.transResultData.length} câu kèm ngữ cảnh ảnh!`, "success");
      } catch (err) {
        showToast(`Lỗi dịch: ${err.message}`, "error");
        badge.textContent = "Lỗi Dịch";
      } finally {
        btnRunVisionTranslate.disabled = false;
        btnRunVisionTranslate.innerHTML = `<span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:4px;"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"></path></svg>Bước 2: Dịch Sang Tiếng Việt (Kèm Ảnh Bối Cảnh)</span>`;
      }
    });
  }

  // 3. REFINE LOOP: Refine Translation & Refine OCR
  if (btnRefineTranslate) {
    btnRefineTranslate.addEventListener("click", async () => {
      if (!state.transResultData.length) return;
      const userInstruction = refineInput?.value.trim() || "";
      const ocrText = state.transResultData.map((it) => it.original_text).join("\n");
      const prevTranslation = state.transResultData.map((it) => it.translated_text || "").join("\n");

      btnRefineTranslate.disabled = true;
      btnRefineTranslate.textContent = "⏳ Đang sửa...";

      try {
        const data = await callVisionApi("refine_translate", {
          ocrText,
          prevTranslation,
          userInstruction,
        });
        const lines = data.lines || [];
        state.transResultData.forEach((it, idx) => {
          if (lines[idx] !== undefined) {
            it.translated_text = lines[idx];
          }
        });
        renderTranslationTable(state.transResultData);
        updateScriptDownloadLink();
        showToast("Đã tinh chỉnh bản dịch thành công!", "success");
      } catch (err) {
        showToast(`Lỗi tinh chỉnh: ${err.message}`, "error");
      } finally {
        btnRefineTranslate.disabled = false;
        btnRefineTranslate.textContent = "Sửa Bản Dịch";
      }
    });
  }

  if (btnRefineOcr) {
    btnRefineOcr.addEventListener("click", async () => {
      if (!state.transResultData.length) return;
      const ocrText = state.transResultData.map((it) => it.original_text).join("\n");

      btnRefineOcr.disabled = true;
      btnRefineOcr.textContent = "⏳ Đang soát...";

      try {
        const data = await callVisionApi("refine_ocr", { ocrText });
        const lines = data.lines || [];
        state.transResultData = lines.map((line, idx) => ({
          id: idx + 1,
          box: [0, 0, 0, 0],
          original_text: line,
          translated_text: state.transResultData[idx]?.translated_text || "",
        }));
        renderTranslationTable(state.transResultData);
        updateScriptDownloadLink();
        showToast("Đã soát lỗi và cập nhật cấu trúc bong bóng thoại!", "success");
      } catch (err) {
        showToast(`Lỗi soát OCR: ${err.message}`, "error");
      } finally {
        btnRefineOcr.disabled = false;
        btnRefineOcr.textContent = "Soát Lỗi OCR";
      }
    });
  }

  // 4. LEGACY / DETECTOR PIPELINE (Python Backend)
  if (runBtn) {
    runBtn.addEventListener("click", async () => {
      if (!state.transFile) return;

      runBtn.disabled = true;
      runBtn.innerHTML = `<span>Đang bóc tách bóng thoại & OCR...</span>`;
      badge.textContent = "AI Đang OCR...";

      const targetLang = document.getElementById("trans-target-lang")?.value.trim() || "vi";

      const formData = new FormData();
      formData.append("file", state.transFile);
      formData.append("reading_order", document.getElementById("trans-reading-order")?.value || "manga");
      formData.append("ocr_engine", document.getElementById("trans-ocr-engine")?.value || "ja_manga");
      formData.append("source_lang", document.getElementById("trans-source-lang")?.value || "ch");
      formData.append("target_lang", targetLang);
      formData.append("chat_only", document.getElementById("trans-chat-only-toggle")?.checked ? "true" : "false");
      formData.append("ocr_only", "true");

      const startT = performance.now();
      try {
        let res;
        try {
          const ocrPayload = {
            imageBase64: previewImg.src,
            readingOrder: document.getElementById("trans-reading-order")?.value || "manga",
            ocrEngine: document.getElementById("trans-ocr-engine")?.value || "ja_manga",
            chatOnly: document.getElementById("trans-chat-only-toggle")?.checked ?? true,
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
        badge.textContent = `Đã nhận diện ${totalCount} bóng thoại (${ocrElapsed}ms)`;

        renderBubbleOverlay(state.transResultData);
        renderTranslationTable(state.transResultData);
        updateScriptDownloadLink();

        const chosenModel = document.getElementById("trans-llm-model")?.value || state.llmModel;
        state.llmModel = chosenModel;

        runBtn.innerHTML = `<span>Đang dịch ngữ cảnh bằng ${chosenModel}...</span>`;
        badge.textContent = `Đang dịch (${chosenModel})...`;

        await translateSpeechBubblesFrontend(state.transResultData, targetLang);

        const totalElapsed = Math.round(performance.now() - startT);
        badge.textContent = `[OK] ${totalCount} câu | OCR: ${ocrElapsed}ms | Tổng: ${totalElapsed}ms`;

        renderBubbleOverlay(state.transResultData);
        renderTranslationTable(state.transResultData);
        updateScriptDownloadLink();
        if (refineBox) refineBox.style.display = "block";

        showToast(`Đã dịch thành công ${totalCount} câu thoại sang Tiếng Việt!`, "success");
      } catch (err) {
        showToast(`Lỗi khi xử lý: ${err.message}`, "error");
        badge.textContent = "Lỗi Xử Lý";
      } finally {
        runBtn.disabled = false;
        runBtn.innerHTML = `<span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Chạy Python Bóc Tách Bounding Box (ZeroGPU)</span>`;
      }
    });
  }

  // Copy Script Button (Format: === filename ===)
  const copyScriptBtn = document.getElementById("btn-copy-script");
  if (copyScriptBtn) {
    copyScriptBtn.addEventListener("click", () => {
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

  const activeModel = (state.llmModel || "gemini-2.5-flash").trim();
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
      <td class="text-orig" style="vertical-align:top;">
        <textarea class="form-input trans-edit-orig" data-id="${it.id}" rows="2" style="width:100%; resize:vertical; font-size:0.88rem; padding:0.4rem 0.6rem; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:6px; color:var(--text-muted);" placeholder="Chữ gốc (OCR)...">${escapeHtml(it.original_text || "")}</textarea>
      </td>
      <td class="text-trans">
        <textarea class="form-input trans-edit-input" data-id="${it.id}" rows="2" style="width:100%; resize:vertical; font-size:0.9rem; padding:0.4rem 0.6rem; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff;" placeholder="Chưa có bản dịch...">${escapeHtml(it.translated_text || "")}</textarea>
      </td>
    </tr>
  `
    )
    .join("");

  // Allow live editing of original text in table (Pro Mode)
  tbody.querySelectorAll(".trans-edit-orig").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const id = Number(e.target.dataset.id);
      const it = items.find((x) => x.id === id);
      if (it) it.original_text = e.target.value;
    });
  });

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
      logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [ZIP] Đã giải nén: Tìm thấy <strong>${totalPages} trang ảnh</strong>. Bắt đầu xử lý song song...<br>`;
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
            logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [OK] [${completedCount}/${totalPages}] <strong>${filename}</strong>: Xóa sạch chữ (${pageSec}s)<br>`;
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
            logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [OCR] [${completedCount}/${totalPages}] <strong>${filename}</strong>: Nhận diện ${boxes.length} bóng thoại (${pageSec}s)<br>`;
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
          logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [WARN] [${completedCount}/${totalPages}] <strong>${filename}</strong>: Lỗi (${pageErr.message})<br>`;
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
        logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [DỊCH] Bắt đầu [Giai đoạn 2/2]: Dịch ngữ cảnh toàn bộ chương...<br>`;
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
          logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [WARN] Không tìm thấy câu thoại tiếng Nhật nào cần dịch.<br>`;
        } else {
          logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [KỊCH BẢN] Tìm thấy tổng cộng ${allItems.length} câu thoại từ ${totalPages} trang. Bắt đầu dịch AI...<br>`;
          logBox.scrollTop = logBox.scrollHeight;

          // Chia thành các đợt (chunks) 50 câu theo yêu cầu người dùng
          const chunkSize = 50;
          const totalChunks = Math.ceil(allItems.length / chunkSize);

          for (let c = 0; c < totalChunks; c++) {
            const chunk = allItems.slice(c * chunkSize, (c + 1) * chunkSize);
            const chunkIdx = c + 1;
            const tStartChunk = performance.now();

            progressStatus.textContent = `[Giai đoạn 2/2] Đang dịch AI kịch bản cả chap (Đợt ${chunkIdx}/${totalChunks})...`;
            logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [AI] Đang dịch phần ${chunkIdx}/${totalChunks} (${chunk.length} câu thoại)...<br>`;
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
                logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [OK] Hoàn tất dịch đợt ${chunkIdx}/${totalChunks} (${chunkSec}s)<br>`;
                chunkSuccess = true;
                break;
              } catch (chunkErr) {
                if (attempt === 1) {
                  logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [THỬ LẠI] Đợt ${chunkIdx} gặp trục trặc mạng (${chunkErr.message}), đang thử lại...<br>`;
                  logBox.scrollTop = logBox.scrollHeight;
                  await new Promise((r) => setTimeout(r, 1500));
                } else {
                  logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [WARN] Đợt ${chunkIdx} không thể kết nối AI (${chunkErr.message}) - giữ nguyên câu gốc tiếng Nhật.<br>`;
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
      progressStatus.textContent = `Hoàn tất toàn bộ ${totalPages} trang (${totalElapsed}s)!`;
      logBox.innerHTML += `[${new Date().toLocaleTimeString()}] [XONG] Hoàn thành toàn bộ ${totalPages} trang trong ${totalElapsed}s!<br>`;
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
      progressStatus.textContent = "[Thất bại]";
      logBox.innerHTML += `[LỖI] ${err.message}<br>`;
    } finally {
      runBtn.disabled = false;
      runBtn.innerHTML = `<span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Bắt Đầu Xử Lý Hàng Loạt</span>`;
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

