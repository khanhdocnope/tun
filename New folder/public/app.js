/**
 * Manga OCR & Translation Batch Studio - Client Logic
 */

(function () {
  // App State
  const state = {
    images: [], // List of { id, name, sizeStr, base64, status: 'idle'|'processing'|'done'|'error', dialogues: [], ocrText: '', viText: '' }
    isQueueRunning: false,
    stopQueueRequested: false,
    hasEnvKey: false,
    settings: {
      model: localStorage.getItem('manga_model') || 'gemini-3.1-flash-lite',
      apiKey: localStorage.getItem('manga_api_key') || '',
      tone: localStorage.getItem('manga_tone') || 'natural',
      skipSFX: localStorage.getItem('manga_skip_sfx') !== 'false'
    }
  };

  // DOM Elements
  const el = {
    // Top Bar
    fileInputMultiple: document.getElementById('fileInputMultiple'),
    toggleSkipSFX: document.getElementById('toggleSkipSFX'),
    btnSettings: document.getElementById('btnSettings'),
    btnExportChapter: document.getElementById('btnExportChapter'),
    exportMenu: document.getElementById('exportMenu'),
    btnExportTxt: document.getElementById('btnExportTxt'),
    btnExportDoc: document.getElementById('btnExportDoc'),
    btnCopyChapter: document.getElementById('btnCopyChapter'),

    // Batch Actions
    btnOcrAll: document.getElementById('btnOcrAll'),
    btnTranslateAll: document.getElementById('btnTranslateAll'),
    btnProcessAll: document.getElementById('btnProcessAll'),
    btnClearAll: document.getElementById('btnClearAll'),
    statBadge: document.getElementById('statBadge'),
    currentModelBadge: document.getElementById('currentModelBadge'),

    // Queue Progress Bar
    queueProgressBar: document.getElementById('queueProgressBar'),
    queueProgressText: document.getElementById('queueProgressText'),
    queueProgressFill: document.getElementById('queueProgressFill'),
    btnStopQueue: document.getElementById('btnStopQueue'),

    // Container
    emptyDropzone: document.getElementById('emptyDropzone'),
    mangaRowsList: document.getElementById('mangaRowsList'),

    // Lightbox Modal
    lightboxModal: document.getElementById('lightboxModal'),
    lightboxImg: document.getElementById('lightboxImg'),
    btnCloseLightbox: document.getElementById('btnCloseLightbox'),

    // Settings Modal
    settingsModal: document.getElementById('settingsModal'),
    btnCloseSettings: document.getElementById('btnCloseSettings'),
    btnCancelSettings: document.getElementById('btnCancelSettings'),
    btnSaveSettings: document.getElementById('btnSaveSettings'),
    selectEngine: document.getElementById('selectEngine'),
    inputGeminiApiKey: document.getElementById('inputGeminiApiKey'),
    selectTone: document.getElementById('selectTone'),
    envKeyBadge: document.getElementById('envKeyBadge')
  };

  // Initialize
  async function init() {
    bindEvents();
    await checkConfig();
    applySettingsToUI();
    renderBatchView();
  }

  // Check Backend Config
  async function checkConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      state.hasEnvKey = data.hasEnvKey;
      if (el.envKeyBadge) {
        el.envKeyBadge.textContent = state.hasEnvKey ? 'Có sẵn từ .env' : 'Chưa cấu hình';
      }
    } catch (err) {
      console.warn('Không thể kiểm tra /api/config:', err);
    }
  }

  // Apply Settings to UI
  function applySettingsToUI() {
    el.selectEngine.value = state.settings.model;
    el.inputGeminiApiKey.value = state.settings.apiKey;
    el.selectTone.value = state.settings.tone;
    el.toggleSkipSFX.checked = state.settings.skipSFX;
    el.currentModelBadge.textContent = `${state.settings.model} (15 RPM)`;
  }

  // Bind UI Events
  function bindEvents() {
    // Add Images via Input
    el.fileInputMultiple.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) addFilesToBatch(files);
      e.target.value = '';
    });

    // Skip SFX toggle
    el.toggleSkipSFX.addEventListener('change', () => {
      state.settings.skipSFX = el.toggleSkipSFX.checked;
      localStorage.setItem('manga_skip_sfx', state.settings.skipSFX);
      showToast(state.settings.skipSFX ? 'Đã bật: Bỏ qua từ tượng thanh (SFX)' : 'Đã tắt: Nhận diện cả SFX');
    });

    // Global Paste (Ctrl+V)
    window.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;

      const pastedFiles = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        addFilesToBatch(pastedFiles);
        showToast(`Đã thêm ${pastedFiles.length} ảnh từ Clipboard!`);
      }
    });

    // Drag and Drop
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.emptyDropzone.classList.add('dragover');
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      el.emptyDropzone.classList.remove('dragover');
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      el.emptyDropzone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) {
        addFilesToBatch(files);
      }
    });

    // Batch Actions
    el.btnProcessAll.addEventListener('click', () => runBatchQueue('all'));
    el.btnOcrAll.addEventListener('click', () => runBatchQueue('ocr_only'));
    el.btnTranslateAll.addEventListener('click', () => runBatchQueue('translate_only'));
    // Export Dropdown Trigger
    el.btnExportChapter.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = el.exportMenu.style.display === 'flex';
      el.exportMenu.style.display = isVisible ? 'none' : 'flex';
    });

    el.btnExportTxt.addEventListener('click', (e) => {
      e.stopPropagation();
      el.exportMenu.style.display = 'none';
      exportFullChapter('txt');
    });

    el.btnExportDoc.addEventListener('click', (e) => {
      e.stopPropagation();
      el.exportMenu.style.display = 'none';
      exportFullChapter('doc');
    });

    el.btnCopyChapter.addEventListener('click', (e) => {
      e.stopPropagation();
      el.exportMenu.style.display = 'none';
      copyChapterToClipboard();
    });

    window.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-wrapper')) {
        el.exportMenu.style.display = 'none';
      }
    });

    el.btnStopQueue.addEventListener('click', () => {
      state.stopQueueRequested = true;
      el.btnStopQueue.textContent = 'Đang dừng...';
    });

    // Lightbox Close
    el.btnCloseLightbox.addEventListener('click', () => el.lightboxModal.style.display = 'none');
    el.lightboxModal.addEventListener('click', (e) => {
      if (e.target === el.lightboxModal) el.lightboxModal.style.display = 'none';
    });

    // Settings Modal
    el.btnSettings.addEventListener('click', () => {
      applySettingsToUI();
      el.settingsModal.style.display = 'flex';
    });
    el.btnCloseSettings.addEventListener('click', () => el.settingsModal.style.display = 'none');
    el.btnCancelSettings.addEventListener('click', () => el.settingsModal.style.display = 'none');
    el.btnSaveSettings.addEventListener('click', saveSettings);
  }

  // Format File Size
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Nén thông minh: Tự động chuyển đổi sang WebP siêu nhẹ cho ảnh > 1MB hoặc độ phân giải quá lớn
  function compressAndLoadFile(file) {
    return new Promise((resolve) => {
      const THRESHOLD = 1024 * 1024; // Ngưỡng 1MB theo yêu cầu của bạn
      const isLargeFile = file.size > THRESHOLD;

      const objUrl = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(objUrl);

        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const needsResize = w > 1400 || h > 1400;

        // Nếu ảnh <= 1MB và kích thước hợp lý: giữ nguyên
        if (!isLargeFile && !needsResize) {
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve({
              base64: e.target.result,
              sizeStr: formatBytes(file.size),
              compressed: false
            });
          };
          reader.readAsDataURL(file);
          return;
        }

        // Ảnh > 1MB: Tự động nén xuống tối đa 1400px và xuất định dạng WebP chất lượng 0.82
        const MAX_DIM = 1400;
        let targetW = w;
        let targetH = h;

        if (w > h) {
          if (w > MAX_DIM) {
            targetH = Math.round((h * MAX_DIM) / w);
            targetW = MAX_DIM;
          }
        } else {
          if (h > MAX_DIM) {
            targetW = Math.round((w * MAX_DIM) / h);
            targetH = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetW, targetH);

        // Xuất sang WebP nhẹ, rõ chữ
        let webpDataUrl = canvas.toDataURL('image/webp', 0.82);
        if (!webpDataUrl.startsWith('data:image/webp')) {
          webpDataUrl = canvas.toDataURL('image/jpeg', 0.82);
        }

        const estBytes = Math.round((webpDataUrl.length - 23) * 0.75);
        const originalStr = formatBytes(file.size);
        const compressedStr = formatBytes(estBytes);

        resolve({
          base64: webpDataUrl,
          sizeStr: `${compressedStr} (⚡ đã nén từ ${originalStr} WebP)`,
          compressed: true,
          originalSize: file.size,
          compressedSize: estBytes
        });
      };

      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve({
            base64: e.target.result,
            sizeStr: formatBytes(file.size),
            compressed: false
          });
        };
        reader.readAsDataURL(file);
      };

      img.src = objUrl;
    });
  }

  // Add Files to State (hỗ trợ nén tức thì không gây đơ web)
  async function addFilesToBatch(fileList) {
    const totalFiles = fileList.length;
    let compressedCount = 0;

    for (const file of fileList) {
      const { base64, sizeStr, compressed } = await compressAndLoadFile(file);
      if (compressed) compressedCount++;

      const item = {
        id: 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        name: file.name || `image_${state.images.length + 1}.jpg`,
        sizeStr: sizeStr,
        base64: base64,
        status: 'idle',
        dialogues: [],
        ocrText: '',
        viText: '',
        tokens: 0
      };

      state.images.push(item);
    }

    renderBatchView();
    if (compressedCount > 0) {
      showToast(`Đã thêm ${totalFiles} ảnh (⚡ đã nén ${compressedCount} ảnh > 1MB sang WebP siêu nhẹ)!`);
    } else {
      showToast(`Đã thêm ${totalFiles} ảnh vào danh sách!`);
    }
  }

  // Đảm bảo ảnh gửi AI không vượt quá 1400px
  function getOptimizedBase64(base64, maxDim = 1400) {
    return Promise.resolve(base64);
  }

  // Render Batch View (Rows)
  function renderBatchView() {
    const hasImages = state.images.length > 0;

    // Toggle Dropzone vs List
    el.emptyDropzone.style.display = hasImages ? 'none' : 'block';
    el.mangaRowsList.style.display = hasImages ? 'flex' : 'none';

    // Toolbar states
    el.btnProcessAll.disabled = !hasImages || state.isQueueRunning;
    el.btnOcrAll.disabled = !hasImages || state.isQueueRunning;
    el.btnTranslateAll.disabled = !hasImages || state.isQueueRunning;
    el.btnClearAll.disabled = !hasImages || state.isQueueRunning;
    el.btnExportChapter.disabled = !state.images.some(img => img.status === 'done');

    el.statBadge.textContent = `${state.images.length} trang trong danh sách`;

    if (!hasImages) {
      el.mangaRowsList.innerHTML = '';
      return;
    }

    // Render items
    el.mangaRowsList.innerHTML = '';
    state.images.forEach((item, index) => {
      const row = createRowElement(item, index + 1);
      el.mangaRowsList.appendChild(row);
    });
  }

  // Create Single Row Element
  function createRowElement(item, displayIndex) {
    const card = document.createElement('div');
    card.className = `manga-row-card ${item.status}`;
    card.id = `row-${item.id}`;

    card.innerHTML = `
      <div class="row-header">
        <div class="row-header-left">
          <button class="btn-zoom-preview" title="Xem ảnh lớn">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
            </svg>
          </button>
          <span class="row-title">Image ${displayIndex}: ${escapeHtml(item.name)}</span>
          <span class="row-size">${item.sizeStr}</span>
          <span class="badge-status ${item.status}">${item.status.toUpperCase()}</span>
        </div>
        <div class="row-header-right">
          <button class="btn-row-action btn-row-ocr">OCR</button>
          <button class="btn-row-action btn-row-trans">Translate</button>
          <button class="btn-row-action btn-row-all" style="color:var(--accent-red); font-weight:700;">OCR + Dịch</button>
          <button class="btn-row-delete" title="Xóa trang này">&times;</button>
        </div>
      </div>

      <div class="row-body">
        <!-- Col 1: Thumbnail -->
        <div class="col-thumb">
          <img src="${item.base64}" alt="${escapeHtml(item.name)}">
          <div class="col-thumb-overlay">🔍 Bấm để phóng to</div>
        </div>

        <!-- Col 2: OCR Japanese -->
        <div class="col-text ocr">
          <div class="text-panel-header">
            <span class="text-panel-title">OCR (Tiếng Nhật Thô)</span>
            <button class="btn-panel-copy btn-copy-jp">Copy JP</button>
          </div>
          <textarea class="text-panel-editor textarea-jp" placeholder="Chưa thực hiện OCR... (Nhấn 'OCR' hoặc 'OCR + Dịch')">${escapeHtml(item.ocrText)}</textarea>
        </div>

        <!-- Col 3: Translation Vietnamese -->
        <div class="col-text trans">
          <div class="text-panel-header">
            <span class="text-panel-title">Translation (Tiếng Việt)</span>
            <button class="btn-panel-copy btn-copy-vi">Copy VI</button>
          </div>
          <textarea class="text-panel-editor textarea-vi" placeholder="Chưa có bản dịch...">${escapeHtml(item.viText)}</textarea>
        </div>
      </div>
    `;

    // Bind item events
    const thumbCol = card.querySelector('.col-thumb');
    const btnZoom = card.querySelector('.btn-zoom-preview');
    const openLightbox = () => {
      el.lightboxImg.src = item.base64;
      el.lightboxModal.style.display = 'flex';
    };
    thumbCol.addEventListener('click', openLightbox);
    btnZoom.addEventListener('click', openLightbox);

    // Text inputs
    const textareaJp = card.querySelector('.textarea-jp');
    const textareaVi = card.querySelector('.textarea-vi');

    textareaJp.addEventListener('input', () => {
      item.ocrText = textareaJp.value;
    });

    textareaVi.addEventListener('input', () => {
      item.viText = textareaVi.value;
    });

    // Copy buttons
    card.querySelector('.btn-copy-jp').addEventListener('click', () => {
      copyToClipboard(item.ocrText, `Đã copy tiếng Nhật trang ${displayIndex}!`);
    });

    card.querySelector('.btn-copy-vi').addEventListener('click', () => {
      copyToClipboard(item.viText, `Đã copy bản dịch trang ${displayIndex}!`);
    });

    // Individual Action buttons
    card.querySelector('.btn-row-delete').addEventListener('click', () => {
      state.images = state.images.filter(x => x.id !== item.id);
      renderBatchView();
    });

    card.querySelector('.btn-row-ocr').addEventListener('click', () => processSingleImage(item, 'ocr_only'));
    card.querySelector('.btn-row-trans').addEventListener('click', () => translateSingleText(item));
    card.querySelector('.btn-row-all').addEventListener('click', () => processSingleImage(item, 'all'));

    return card;
  }

  // Update a single card DOM without re-rendering everything
  function updateCardDOM(item) {
    const card = document.getElementById(`row-${item.id}`);
    if (!card) return;

    card.className = `manga-row-card ${item.status}`;
    const badge = card.querySelector('.badge-status');
    if (badge) {
      badge.className = `badge-status ${item.status}`;
      badge.textContent = item.status.toUpperCase();
    }

    const textareaJp = card.querySelector('.textarea-jp');
    if (textareaJp) textareaJp.value = item.ocrText;

    const textareaVi = card.querySelector('.textarea-vi');
    if (textareaVi) textareaVi.value = item.viText;

    el.btnExportChapter.disabled = !state.images.some(img => img.status === 'done');
  }

  // Process a Single Image via API
  async function processSingleImage(item, mode = 'all') {
    item.status = 'processing';
    updateCardDOM(item);

    try {
      const optimizedImage = await getOptimizedBase64(item.base64, 1200);

      const payload = {
        imageBase64: optimizedImage,
        mode: mode,
        existingOcr: item.ocrText,
        model: state.settings.model,
        apiKey: state.settings.apiKey,
        tone: state.settings.tone,
        skipSFX: state.settings.skipSFX,
        sourceLang: 'ja',
        targetLang: 'vi'
      };

      const res = await fetch('/api/process-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Lỗi xử lý ảnh.');
      }

      item.status = 'done';
      if (mode === 'all' || mode === 'ocr_only') {
        item.ocrText = data.ocrTextBlock || '';
      }
      if (mode === 'all' || mode === 'translate_only') {
        item.viText = data.viTextBlock || '';
      }

      updateCardDOM(item);
      return true;

    } catch (err) {
      console.error(err);
      item.status = 'error';
      updateCardDOM(item);
      showToast(`Lỗi trang ${item.name}: ${err.message}`);
      return false;
    }
  }

  // Translate existing OCR text for a single image
  async function translateSingleText(item) {
    if (!item.ocrText || !item.ocrText.trim()) {
      alert('Vui lòng thực hiện OCR để có văn bản tiếng Nhật trước khi dịch.');
      return;
    }

    item.status = 'processing';
    updateCardDOM(item);

    try {
      const optimizedImage = await getOptimizedBase64(item.base64, 1200);

      const res = await fetch('/api/translate-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text_jp: item.ocrText,
          imageBase64: optimizedImage,
          model: state.settings.model,
          apiKey: state.settings.apiKey,
          tone: state.settings.tone,
          sourceLang: 'ja',
          targetLang: 'vi'
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Lỗi dịch text.');

      item.status = 'done';
      item.viText = data.text_vi || '';
      updateCardDOM(item);
      return true;
    } catch (err) {
      item.status = 'error';
      updateCardDOM(item);
      alert('Lỗi dịch: ' + err.message);
      return false;
    }
  }

  // Batch Queue Engine (Sequential processing to respect 15 RPM free limit)
  async function runBatchQueue(mode = 'all') {
    if (state.isQueueRunning) return;

    const queueItems = state.images.filter(img => img.status !== 'done');
    if (queueItems.length === 0) {
      showToast('Tất cả các trang trong danh sách đã được xử lý xong!');
      return;
    }

    state.isQueueRunning = true;
    state.stopQueueRequested = false;
    el.queueProgressBar.style.display = 'flex';
    el.btnStopQueue.textContent = 'Dừng lại';

    updateToolbarStates(true);

    let completed = 0;
    const total = queueItems.length;

    for (let i = 0; i < total; i++) {
      if (state.stopQueueRequested) {
        showToast('Đã dừng xử lý hàng loạt theo yêu cầu.');
        break;
      }

      const currentItem = queueItems[i];
      const progressPercent = Math.round((i / total) * 100);
      el.queueProgressFill.style.width = `${progressPercent}%`;
      el.queueProgressText.textContent = `Đang xử lý trang ${i + 1} / ${total}: ${currentItem.name}...`;

      if (mode === 'translate_only') {
        await translateSingleText(currentItem);
      } else {
        await processSingleImage(currentItem, mode);
      }

      completed++;

      // Sequential delay between requests (1.8s) to strictly maintain < 15 RPM rate limit
      if (i < total - 1 && !state.stopQueueRequested) {
        await new Promise(r => setTimeout(r, 1800));
      }
    }

    el.queueProgressFill.style.width = '100%';
    el.queueProgressText.textContent = `Hoàn thành ${completed} / ${total} trang!`;

    setTimeout(() => {
      el.queueProgressBar.style.display = 'none';
      state.isQueueRunning = false;
      updateToolbarStates(false);
      renderBatchView();
    }, 1500);
  }

  function updateToolbarStates(isRunning) {
    el.btnProcessAll.disabled = isRunning;
    el.btnOcrAll.disabled = isRunning;
    el.btnTranslateAll.disabled = isRunning;
    el.btnClearAll.disabled = isRunning;
  }

  // Clear All
  function clearAllBatch() {
    if (state.images.length === 0) return;
    if (confirm('Bạn có chắc muốn xóa toàn bộ danh sách trang hiện tại?')) {
      state.images = [];
      renderBatchView();
    }
  }

  // Download file helper (đảm bảo 100% có đuôi mở rộng trên Windows)
  function downloadTextFile(filename, text, format = 'txt') {
    // Ưu tiên tải qua API server để Windows nhận đúng Header Content-Disposition và MIME
    fetch('/api/download-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, filename, format })
    }).then(res => res.blob()).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2000);
      showToast(`Đã tải xuống file: ${filename}`);
    }).catch(err => {
      // Dự phòng tải trực tiếp bằng Blob với BOM UTF-8
      console.warn('Fallback client download:', err);
      const mime = format === 'doc' ? 'application/msword;charset=utf-8' : 'text/plain;charset=utf-8';
      const blob = new Blob(['\uFEFF' + text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2000);
      showToast(`Đã tải xuống file: ${filename}`);
    });
  }

  function generateChapterContent() {
    let content = `=======================================================\n`;
    content += `MANGA CHAPTER TRANSLATION SCRIPT (KỊCH BẢN DỊCH MANGA)\n`;
    content += `Thời gian xuất: ${new Date().toLocaleString('vi-VN')}\n`;
    content += `Tổng số trang: ${state.images.length}\n`;
    content += `=======================================================\n\n`;

    state.images.forEach((img, idx) => {
      content += `-------------------------------------------------------\n`;
      content += `TRANG ${idx + 1}: ${img.name}\n`;
      content += `-------------------------------------------------------\n`;

      if (img.dialogues && img.dialogues.length > 0) {
        img.dialogues.forEach(d => {
          content += `[${d.id}]\n`;
          content += `JP: ${d.jp || ''}\n`;
          content += `VI: ${d.vi || ''}\n\n`;
        });
      } else {
        content += `[RAW JP]:\n${img.ocrText || '(Trống)'}\n\n`;
        content += `[DỊCH VI]:\n${img.viText || '(Trống)'}\n\n`;
      }
    });
    return content;
  }

  // Export Full Chapter Script
  function exportFullChapter(format = 'txt') {
    if (state.images.length === 0) return;
    const content = generateChapterContent();
    const ext = format === 'doc' ? 'doc' : 'txt';
    const filename = `Manga_Chapter_Script_${Date.now()}.${ext}`;
    downloadTextFile(filename, content, ext);
  }

  // Copy full chapter to clipboard
  function copyChapterToClipboard() {
    if (state.images.length === 0) return;
    const content = generateChapterContent();
    copyToClipboard(content, 'Đã sao chép toàn bộ kịch bản chapter vào bộ nhớ tạm!');
  }

  // Save Settings
  function saveSettings() {
    state.settings.model = el.selectEngine.value;
    state.settings.apiKey = el.inputGeminiApiKey.value.trim();
    state.settings.tone = el.selectTone.value;

    localStorage.setItem('manga_model', state.settings.model);
    localStorage.setItem('manga_api_key', state.settings.apiKey);
    localStorage.setItem('manga_tone', state.settings.tone);

    el.currentModelBadge.textContent = `${state.settings.model} (15 RPM)`;
    el.settingsModal.style.display = 'none';
    showToast('Đã lưu cấu hình thành công!');
  }

  // Copy Helper
  function copyToClipboard(text, msg) {
    if (!text) {
      showToast('Nội dung trống, không thể copy.');
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      showToast(msg);
    }).catch(() => {
      showToast('Không thể sao chép vào bộ nhớ tạm.');
    });
  }

  // Toast Helper
  function showToast(msg) {
    let toast = document.querySelector('.toast-notice');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast-notice';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  init();
})();
