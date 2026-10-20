/**
 * Manga Studio Batch - State, DOM Elements & Shared Helpers
 */

  export const state = {
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
      readingOrder: localStorage.getItem('manga_reading_order') || 'manga',
      skipSFX: localStorage.getItem('manga_skip_sfx') !== 'false',
      // Bước tẩy chữ (khóa mới; manga_backend_url dùng chung với trang chính)
      stepClean: localStorage.getItem('manga_step_clean') === 'true',
      stepTranslate: localStorage.getItem('manga_step_translate') !== 'false',
      cleanModel: localStorage.getItem('manga_clean_model') || 'anime-lama',
      cleanSFX: localStorage.getItem('manga_clean_sfx') === 'true',
      cleanDilation: parseInt(localStorage.getItem('manga_clean_dilation') || '4', 10),
      cleanThreshold: parseFloat(localStorage.getItem('manga_clean_threshold') || '0.20'),
      backendUrl: localStorage.getItem('manga_backend_url') || 'https://dobietdc-backe-manga-remove.hf.space',
      glossary: localStorage.getItem('manga_glossary') || ''
    },
    // Giai đoạn 2: Mobile UI State
    currentFilter: 'all',
    isAllCollapsed: false,
    proofreadIndex: 0,
    proofreadZoom: 100,
    proofreadShowClean: false
  };

  // Thumbnail Size & Zoom Controller (0 -> 100)
  export let currentZoomVal = parseInt(localStorage.getItem('manga_zoom_val') || '0', 10);

  export function applyThumbZoom(val) {
    const v = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
    currentZoomVal = v;
    localStorage.setItem('manga_zoom_val', v);

    // Chiều rộng cột dãn từ 200px đến 680px (bao trọn 100% chiều rộng ảnh)
    // 2 ô box dịch (OCR và Translation) tự động co dãn tỉ lệ thích ứng
    const colWidth = Math.round(200 + (v / 100) * 480);

    document.documentElement.style.setProperty('--thumb-width', colWidth + 'px');
    document.documentElement.style.setProperty('--thumb-img-width', '100%');

    // Sync all sliders on page
    document.querySelectorAll('.card-slider').forEach(s => {
      if (parseInt(s.value, 10) !== v) s.value = v;
    });
  }

  // DOM Elements

  export const el = {
    // Top Bar
    fileInputMultiple: document.getElementById('fileInputMultiple'),
    toggleSkipSFX: document.getElementById('toggleSkipSFX'),
    btnModeManga: document.getElementById('btnModeManga'),
    btnModeWebtoon: document.getElementById('btnModeWebtoon'),
    selectReadingOrder: document.getElementById('selectReadingOrder'),
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
    btnCleanAll: document.getElementById('btnCleanAll'),
    toggleStepClean: document.getElementById('toggleStepClean'),
    toggleStepTranslate: document.getElementById('toggleStepTranslate'),
    btnProcessAllLabel: document.getElementById('btnProcessAllLabel'),
    btnExportZipClean: document.getElementById('btnExportZipClean'),
    btnExportZipBoth: document.getElementById('btnExportZipBoth'),
    selectCleanModel: document.getElementById('selectCleanModel'),
    checkCleanSFX: document.getElementById('checkCleanSFX'),
    rangeCleanDilation: document.getElementById('rangeCleanDilation'),
    rangeCleanThreshold: document.getElementById('rangeCleanThreshold'),
    cleanDilationVal: document.getElementById('cleanDilationVal'),
    cleanThresholdVal: document.getElementById('cleanThresholdVal'),
    inputBackendUrl: document.getElementById('inputBackendUrl'),
    statBadge: document.getElementById('statBadge'),
    currentModelBadge: document.getElementById('currentModelBadge'),

    // Giai đoạn 2: Elements
    filterProgressBar: document.getElementById('filterProgressBar'),
    filterAll: document.getElementById('filterAll'),
    filterPending: document.getElementById('filterPending'),
    filterError: document.getElementById('filterError'),
    filterDone: document.getElementById('filterDone'),
    countAll: document.getElementById('countAll'),
    countPending: document.getElementById('countPending'),
    countError: document.getElementById('countError'),
    countDone: document.getElementById('countDone'),
    btnJumpPending: document.getElementById('btnJumpPending'),
    btnToggleCollapseAll: document.getElementById('btnToggleCollapseAll'),
    btnToggleCollapseAllLabel: document.getElementById('btnToggleCollapseAllLabel'),
    btnOpenProofread: document.getElementById('btnOpenProofread'),

    bottomActionBar: document.getElementById('bottomActionBar'),
    btnOpenBottomSheet: document.getElementById('btnOpenBottomSheet'),
    btnBottomCleanAll: document.getElementById('btnBottomCleanAll'),
    btnBottomProcessAll: document.getElementById('btnBottomProcessAll'),
    btnBottomProcessAllLabel: document.getElementById('btnBottomProcessAllLabel'),
    btnBottomQuickTxt: document.getElementById('btnBottomQuickTxt'),

    bottomSheetBackdrop: document.getElementById('bottomSheetBackdrop'),
    bottomSheetCard: document.getElementById('bottomSheetCard'),
    btnCloseBottomSheet: document.getElementById('btnCloseBottomSheet'),
    sheetBtnCleanAll: document.getElementById('sheetBtnCleanAll'),
    sheetBtnOcrAll: document.getElementById('sheetBtnOcrAll'),
    sheetBtnTranslateAll: document.getElementById('sheetBtnTranslateAll'),
    sheetBtnDownloadTxt: document.getElementById('sheetBtnDownloadTxt'),
    sheetBtnExportZipClean: document.getElementById('sheetBtnExportZipClean'),
    sheetBtnExportZipBoth: document.getElementById('sheetBtnExportZipBoth'),
    sheetBtnOpenExportModal: document.getElementById('sheetBtnOpenExportModal'),
    sheetBtnClearAll: document.getElementById('sheetBtnClearAll'),

    proofreadOverlay: document.getElementById('proofreadOverlay'),
    proofreadPageIndicator: document.getElementById('proofreadPageIndicator'),
    btnProofreadToggleClean: document.getElementById('btnProofreadToggleClean'),
    btnProofreadToggleCleanLabel: document.getElementById('btnProofreadToggleCleanLabel'),
    btnCloseProofread: document.getElementById('btnCloseProofread'),
    proofreadImgWrapper: document.getElementById('proofreadImgWrapper'),
    proofreadImgViewport: document.getElementById('proofreadImgViewport'),
    proofreadImg: document.getElementById('proofreadImg'),
    btnProofreadZoomOut: document.getElementById('btnProofreadZoomOut'),
    btnProofreadZoomIn: document.getElementById('btnProofreadZoomIn'),
    btnProofreadZoomReset: document.getElementById('btnProofreadZoomReset'),
    proofreadZoomLevel: document.getElementById('proofreadZoomLevel'),
    proofreadJpText: document.getElementById('proofreadJpText'),
    proofreadViText: document.getElementById('proofreadViText'),
    btnProofreadCopyJp: document.getElementById('btnProofreadCopyJp'),
    btnProofreadCopyVi: document.getElementById('btnProofreadCopyVi'),
    btnProofreadPrev: document.getElementById('btnProofreadPrev'),
    btnProofreadNext: document.getElementById('btnProofreadNext'),
    proofreadFooterName: document.getElementById('proofreadFooterName'),

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
    inputGlossary: document.getElementById('inputGlossary'),
    envKeyBadge: document.getElementById('envKeyBadge'),
    envKeyBadge2: document.getElementById('envKeyBadge2'),
    quotaSpeedText: document.getElementById('quotaSpeedText'),
    quotaDailyText: document.getElementById('quotaDailyText')
  };

  export function getActiveKeys() {
    const keys = [];
    if (state.settings.apiKey) keys.push(state.settings.apiKey);
    if (state.settings.apiKey2) keys.push(state.settings.apiKey2);
    if (keys.length === 0 && state.hasEnvKey) {
      keys.push('__env_key_1__');
      if (state.hasEnvKey2) keys.push('__env_key_2__');
    }
    return keys;
  }

  // ---------------------------------------------------------------------------
  // LƯU TIẾN TRÌNH (IndexedDB): tải lại trang / mất tab vẫn giữ ảnh, OCR, bản dịch
  //  - kho "pages": ảnh (nặng, chỉ ghi 1 lần khi thêm trang)
  //  - kho "state": trạng thái + văn bản (nhẹ, ghi mỗi khi có thay đổi)
  // ---------------------------------------------------------------------------

  export const CLEAN_CONCURRENCY = 2;
  export const CLEAN_MAX_ATTEMPTS = 3;
  export const IMG_EXT_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;

  export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  export function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Không đọc được tệp'));
      reader.readAsArrayBuffer(file);
    });
  }

  export function dataUrlToBuffer(dataUrl) {
    const m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl || '');
    if (!m) throw new Error('Dữ liệu ảnh không hợp lệ');
    const mime = m[1] || 'image/png';
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime, buffer: bytes.buffer };
  }

  export function bufferToDataUrl(buffer, mime) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Không đọc được ảnh'));
      reader.readAsDataURL(new Blob([buffer], { type: mime || 'image/jpeg' }));
    });
  }

  export function cleanBadgeText(item) {
    const labels = { idle: 'CHỜ', processing: 'ĐANG XỬ LÝ', done: 'XONG', error: 'LỖI' };
    return 'Tẩy: ' + (labels[item.cleanStatus || 'idle'] || 'CHỜ');
  }

  export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Nén thông minh: Tự động chuyển đổi sang WebP siêu nhẹ cho ảnh > 1MB hoặc độ phân giải quá lớn

  export function copyToClipboard(text, msg) {
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

  export function fallbackCopyText(text, msg) {
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
  export function showToast(msg, type = 'info') {
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

  export function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }


  // ==========================================================================
  // GIAI ĐOẠN 2: HELPER FUNCTIONS & EVENT HANDLERS
  // ==========================================================================

  export function statusViText(status) {
    switch (status) {
      case 'processing': return 'ĐANG XỬ LÝ';
      case 'done': return 'XONG';
      case 'error': return 'LỖI';
      default: return 'CHỜ';
    }
  }

  export function getFirstLineVi(text) {
    if (!text) return '(Chưa có bản dịch)';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    return lines[0] || '(Chưa có bản dịch)';
  }
