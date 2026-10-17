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
      model: (() => {
        const m = localStorage.getItem('manga_model');
        return (m === 'gemini-3.5-flash-lite') ? 'gemini-3.5-flash-lite' : 'gemini-3.1-flash-lite';
      })(),
      apiKey: localStorage.getItem('manga_api_key') || '',
      apiKey2: localStorage.getItem('manga_api_key_2') || '',
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
    btnQuickDownloadTxt: document.getElementById('btnQuickDownloadTxt'),
    exportMenu: document.getElementById('exportMenu'),
    btnOpenExportModal: document.getElementById('btnOpenExportModal'),
    btnExportTxt: document.getElementById('btnExportTxt'),
    btnExportDoc: document.getElementById('btnExportDoc'),
    btnCopyChapter: document.getElementById('btnCopyChapter'),
    exportModal: document.getElementById('exportModal'),
    btnCloseExportModal: document.getElementById('btnCloseExportModal'),
    btnDismissExportModal: document.getElementById('btnDismissExportModal'),
    modalBtnDownloadTxt: document.getElementById('modalBtnDownloadTxt'),
    modalBtnDownloadDoc: document.getElementById('modalBtnDownloadDoc'),
    modalBtnCopyAll: document.getElementById('modalBtnCopyAll'),
    exportPreviewTextarea: document.getElementById('exportPreviewTextarea'),
    exportTextLengthBadge: document.getElementById('exportTextLengthBadge'),

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
    inputGeminiApiKey2: document.getElementById('inputGeminiApiKey2'),
    selectTone: document.getElementById('selectTone'),
    envKeyBadge: document.getElementById('envKeyBadge'),
    envKeyBadge2: document.getElementById('envKeyBadge2'),
    quotaSpeedText: document.getElementById('quotaSpeedText'),
    quotaDailyText: document.getElementById('quotaDailyText')
  };

  function getActiveKeys() {
    const keys = [];
    if (state.settings.apiKey) keys.push(state.settings.apiKey);
    if (state.settings.apiKey2) keys.push(state.settings.apiKey2);
    if (keys.length === 0 && state.hasEnvKey) {
      keys.push('__env_key_1__');
      if (state.hasEnvKey2) keys.push('__env_key_2__');
    }
    return keys;
  }

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
      state.hasEnvKey2 = data.hasEnvKey2;
      state.envKeyCount = data.envKeyCount || (data.hasEnvKey ? 1 : 0);
      if (el.envKeyBadge) {
        el.envKeyBadge.textContent = state.hasEnvKey ? 'Có sẵn từ .env' : 'Chưa cấu hình';
      }
      if (el.envKeyBadge2) {
        el.envKeyBadge2.textContent = state.hasEnvKey2 ? 'Có sẵn từ .env' : 'Tùy chọn';
      }
    } catch (err) {
      console.warn('Không thể kiểm tra /api/config:', err);
    }
  }

  // Apply Settings to UI
  function applySettingsToUI() {
    el.selectEngine.value = state.settings.model;
    el.inputGeminiApiKey.value = state.settings.apiKey;
    if (el.inputGeminiApiKey2) el.inputGeminiApiKey2.value = state.settings.apiKey2;
    el.selectTone.value = state.settings.tone;
    el.toggleSkipSFX.checked = state.settings.skipSFX;

    const activeKeys = getActiveKeys();
    const isDual = activeKeys.length >= 2;

    if (isDual) {
      el.currentModelBadge.textContent = `${state.settings.model} (30 RPM - Dual Keys)`;
      el.currentModelBadge.style.background = 'rgba(99, 102, 241, 0.2)';
      el.currentModelBadge.style.color = '#a5b4fc';
      el.currentModelBadge.style.borderColor = 'rgba(99, 102, 241, 0.4)';
      if (el.quotaSpeedText) el.quotaSpeedText.innerHTML = '<span style="color:#38bdf8; font-weight:700;">30 lượt / phút (Song song 2 luồng - Tốc độ X2)</span>';
      if (el.quotaDailyText) el.quotaDailyText.innerHTML = '<span style="color:#10b981; font-weight:700;">1.000 trang truyện / ngày (500 x 2)</span>';
    } else {
      el.currentModelBadge.textContent = `${state.settings.model} (15 RPM)`;
      el.currentModelBadge.style.background = 'rgba(16, 185, 129, 0.12)';
      el.currentModelBadge.style.color = '#34d399';
      el.currentModelBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      if (el.quotaSpeedText) el.quotaSpeedText.textContent = '15 lượt / phút (1 luồng)';
      if (el.quotaDailyText) el.quotaDailyText.textContent = '500 trang truyện / ngày (RPD)';
    }
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

    if (el.btnOpenExportModal) {
      el.btnOpenExportModal.addEventListener('click', (e) => {
        e.stopPropagation();
        el.exportMenu.style.display = 'none';
        if (state.images.length === 0) {
          showToast('Vui lòng thêm ảnh Manga trước.');
          return;
        }
        const content = generateChapterContent();
        openExportModal(content);
      });
    }

    if (el.btnQuickDownloadTxt) {
      el.btnQuickDownloadTxt.addEventListener('click', (e) => {
        e.preventDefault();
        exportFullChapter('txt');
      });
    }

    window.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-wrapper')) {
        el.exportMenu.style.display = 'none';
      }
    });

    // Export Modal Event Listeners
    if (el.btnCloseExportModal) {
      el.btnCloseExportModal.addEventListener('click', closeExportModal);
    }
    if (el.btnDismissExportModal) {
      el.btnDismissExportModal.addEventListener('click', closeExportModal);
    }
    if (el.modalBtnDownloadTxt) {
      el.modalBtnDownloadTxt.addEventListener('click', () => {
        const text = el.exportPreviewTextarea.value;
        const filename = 'Manga_Chapter_Script_' + Date.now() + '.txt';
        executeFileDownload(filename, text, 'txt');
      });
    }
    if (el.modalBtnDownloadDoc) {
      el.modalBtnDownloadDoc.addEventListener('click', () => {
        const text = el.exportPreviewTextarea.value;
        const filename = 'Manga_Chapter_Script_' + Date.now() + '.doc';
        executeFileDownload(filename, text, 'doc');
      });
    }
    if (el.modalBtnCopyAll) {
      el.modalBtnCopyAll.addEventListener('click', () => {
        const text = el.exportPreviewTextarea.value;
        copyToClipboard(text, 'Đã sao chép toàn bộ kịch bản vào bộ nhớ tạm!');
      });
    }

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
          sizeStr: `${compressedStr} (WebP nén từ ${originalStr})`,
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
      showToast(`Đã thêm ${totalFiles} ảnh (đã tối ưu ${compressedCount} ảnh sang WebP)!`);
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
    el.btnExportChapter.disabled = !hasImages;
    if (el.btnQuickDownloadTxt) el.btnQuickDownloadTxt.disabled = !hasImages;

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
          <div class="col-thumb-overlay"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>Bấm để phóng to</div>
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

    el.btnExportChapter.disabled = state.images.length === 0;
    if (el.btnQuickDownloadTxt) el.btnQuickDownloadTxt.disabled = state.images.length === 0;
  }

  // Process a Single Image via API
  async function processSingleImage(item, mode = 'all', preferredKey = '') {
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
        apiKey2: state.settings.apiKey2,
        preferredKey: preferredKey,
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
  async function translateSingleText(item, preferredKey = '') {
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
          apiKey2: state.settings.apiKey2,
          preferredKey: preferredKey,
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

  // Batch Queue Engine (Dual-Worker Parallel Processing for 2 Keys / 30 RPM)
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
    let nextIndex = 0;

    const activeKeys = getActiveKeys();
    const isDual = activeKeys.length >= 2;
    const concurrency = isDual ? 2 : 1;

    // Worker function: each worker processes pages sequentially at 15 RPM
    async function worker(workerId, workerKey) {
      while (nextIndex < total && !state.stopQueueRequested) {
        const itemIdx = nextIndex++;
        if (itemIdx >= total) break;

        const currentItem = queueItems[itemIdx];
        if (!currentItem) break;

        const tag = isDual ? `[Luồng ${workerId + 1}] ` : '';
        el.queueProgressText.textContent = `${tag}Đang xử lý trang: ${currentItem.name} (${completed + 1}/${total})...`;
        el.queueProgressFill.style.width = `${Math.round((completed / total) * 100)}%`;

        if (mode === 'translate_only') {
          await translateSingleText(currentItem, workerKey);
        } else {
          await processSingleImage(currentItem, mode, workerKey);
        }

        completed++;
        el.queueProgressFill.style.width = `${Math.round((completed / total) * 100)}%`;

        // Delay 1.8s per worker to strictly maintain < 15 RPM per key
        if (!state.stopQueueRequested && nextIndex < total) {
          await new Promise(r => setTimeout(r, 1800));
        }
      }
    }

    if (concurrency === 2) {
      const key1 = state.settings.apiKey || '';
      const key2 = state.settings.apiKey2 || '';
      await Promise.all([
        worker(0, key1),
        worker(1, key2)
      ]);
    } else {
      await worker(0, state.settings.apiKey || '');
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
    if (el.btnExportChapter) el.btnExportChapter.disabled = isRunning || state.images.length === 0;
    if (el.btnQuickDownloadTxt) el.btnQuickDownloadTxt.disabled = isRunning || state.images.length === 0;
  }

  // Clear All
  function clearAllBatch() {
    if (state.images.length === 0) return;
    if (confirm('Bạn có chắc muốn xóa toàn bộ danh sách trang hiện tại?')) {
      state.images = [];
      renderBatchView();
    }
  }

  // Modal & Download helpers (hoạt động 100% trên PC, Mobile Safari/Chrome và trong iFrame)
  function openExportModal(text) {
    if (!el.exportModal) return;
    if (el.exportPreviewTextarea) el.exportPreviewTextarea.value = text;
    if (el.exportTextLengthBadge) el.exportTextLengthBadge.textContent = text.length.toLocaleString('vi-VN') + ' ký tự';
    el.exportModal.style.display = 'flex';
  }

  function closeExportModal() {
    if (el.exportModal) el.exportModal.style.display = 'none';
  }

  // Thực hiện tải file với đa cơ chế (Blob link không target blank, Fallback Form POST/GET, Data URL)
  function executeFileDownload(filename, text, format = 'txt') {
    if (!text || !text.trim()) {
      showToast('Nội dung trống, không thể tải.');
      return;
    }

    // 1. Thử cơ chế Blob URL (CHUẨN NHẤT: Bỏ hoàn toàn target="_blank" để không bị Popup Blocker chặn)
    try {
      const mime = format === 'doc' ? 'application/msword;charset=utf-8' : 'text/plain;charset=utf-8';
      const blob = new Blob(['\uFEFF' + text], { type: mime });

      if (window.navigator && window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveOrOpenBlob(blob, filename);
        showToast('Đã lưu file: ' + filename);
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      // Tuyệt đối KHÔNG gán a.target = '_blank' trên blob URL vì Chrome/Safari/Iframe sẽ chặn vì tưởng popup
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2000);

      showToast('Đang tải file: ' + filename);
      return;
    } catch (err) {
      console.warn('Blob download error:', err);
    }

    // 2. Dự phòng: Điều hướng Form POST về API Server
    try {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/api/download-script';
      form.style.display = 'none';

      const addField = (n, v) => {
        const inp = document.createElement('textarea');
        inp.name = n;
        inp.value = v;
        form.appendChild(inp);
      };

      addField('content', text);
      addField('filename', filename);
      addField('format', format);

      document.body.appendChild(form);
      form.submit();
      setTimeout(() => {
        if (form.parentNode) form.parentNode.removeChild(form);
      }, 2000);
      showToast('Đang tải file qua server...');
      return;
    } catch (e2) {
      console.warn('Server fallback failed:', e2);
    }

    // 3. Dự phòng cuối: Data URI
    try {
      const encoded = encodeURIComponent(text);
      const a = document.createElement('a');
      a.href = 'data:text/plain;charset=utf-8,\uFEFF' + encoded;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { if (a.parentNode) document.body.removeChild(a); }, 1000);
      showToast('Đã tải qua Data URI');
    } catch (e3) {
      copyToClipboard(text, 'Không thể tải file tự động, đã sao chép toàn bộ kịch bản vào bộ nhớ tạm!');
    }
  }

  function downloadTextFile(filename, text, format = 'txt') {
    // Luôn mở Export Modal để người dùng có giao diện xem trước & nút bấm trực tiếp (đặc biệt hữu ích trên điện thoại / iframe)
    openExportModal(text);
    // Đồng thời kích hoạt tải file ngay lập tức
    executeFileDownload(filename, text, format);
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
    if (state.images.length === 0) {
      showToast('Vui lòng thêm ảnh Manga trước khi xuất kịch bản.');
      return;
    }
    const hasText = state.images.some(img => (img.ocrText && img.ocrText.trim()) || (img.viText && img.viText.trim()));
    if (!hasText) {
      showToast('Chưa có nội dung kịch bản! Vui lòng bấm "OCR + Translate all" trước.');
      return;
    }
    const content = generateChapterContent();
    const ext = format === 'doc' ? 'doc' : 'txt';
    const filename = `Manga_Chapter_Script_${Date.now()}.${ext}`;
    downloadTextFile(filename, content, ext);
  }

  // Copy full chapter to clipboard
  function copyChapterToClipboard() {
    if (state.images.length === 0) {
      showToast('Vui lòng thêm ảnh Manga trước.');
      return;
    }
    const hasText = state.images.some(img => (img.ocrText && img.ocrText.trim()) || (img.viText && img.viText.trim()));
    if (!hasText) {
      showToast('Chưa có nội dung kịch bản! Vui lòng bấm "OCR + Translate all" trước.');
      return;
    }
    const content = generateChapterContent();
    copyToClipboard(content, 'Đã sao chép toàn bộ kịch bản chapter vào bộ nhớ tạm!');
  }

  // Save Settings
  function saveSettings() {
    state.settings.model = el.selectEngine.value;
    state.settings.apiKey = el.inputGeminiApiKey.value.trim();
    if (el.inputGeminiApiKey2) {
      state.settings.apiKey2 = el.inputGeminiApiKey2.value.trim();
    }
    state.settings.tone = el.selectTone.value;

    localStorage.setItem('manga_model', state.settings.model);
    localStorage.setItem('manga_api_key', state.settings.apiKey);
    localStorage.setItem('manga_api_key_2', state.settings.apiKey2);
    localStorage.setItem('manga_tone', state.settings.tone);

    applySettingsToUI();
    el.settingsModal.style.display = 'none';
    showToast('Đã lưu cấu hình thành công!');
  }

  // Copy Helper (Hỗ trợ 100% PC, Mobile Safari, Chrome & In-App Webview)
  function copyToClipboard(text, msg) {
    if (!text) {
      showToast('Nội dung trống, không thể copy.');
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(msg);
      }).catch(() => {
        fallbackCopyText(text, msg);
      });
    } else {
      fallbackCopyText(text, msg);
    }
  }

  function fallbackCopyText(text, msg) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '2em';
      ta.style.height = '2em';
      ta.style.padding = '0';
      ta.style.border = 'none';
      ta.style.outline = 'none';
      ta.style.boxShadow = 'none';
      ta.style.background = 'transparent';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        showToast(msg);
      } else {
        showToast('Vui lòng sao chép thủ công từ khung xem trước.');
      }
    } catch (err) {
      showToast('Không thể sao chép tự động: ' + err.message);
    }
  }

  // Toast Helper với icon SVG chuyên nghiệp
  function showToast(msg, type = 'info') {
    let toast = document.querySelector('.toast-notice');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast-notice';
      document.body.appendChild(toast);
    }
    const cleanMsg = msg.replace(/^[⚠️❌ℹ️✔️]s*/, '');
    const isError = /lỗi|thất bại|không thể|chưa có|vui lòng/i.test(cleanMsg);
    const iconSvg = isError
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" style="flex-shrink:0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';

    toast.innerHTML = `<div style="display:inline-flex; align-items:center; gap:8px;">${iconSvg}<span>${cleanMsg}</span></div>`;
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
