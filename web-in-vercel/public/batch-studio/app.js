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
      readingOrder: localStorage.getItem('manga_reading_order') || 'manga',
      skipSFX: localStorage.getItem('manga_skip_sfx') !== 'false',
      cleanModel: localStorage.getItem('manga_clean_model') || 'anime-lama',
      cleanDilation: parseInt(localStorage.getItem('manga_clean_dilation') || '4', 10),
      cleanThreshold: parseFloat(localStorage.getItem('manga_clean_threshold') || '0.20'),
      cleanSFX: localStorage.getItem('manga_clean_sfx') === 'true'
    },
    // Giai Đoạn 2: Mobile UI State
    currentFilter: 'all',
    isAllCollapsed: false,
    proofreadIndex: 0,
    proofreadZoom: 100
  };

  // Thumbnail Size & Zoom Controller (0 -> 100)
  let currentZoomVal = parseInt(localStorage.getItem('manga_zoom_val') || '0', 10);

  function applyThumbZoom(val) {
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
  const el = {
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
    btnExportCleanZip: document.getElementById('btnExportCleanZip'),
    btnExportTxt: document.getElementById('btnExportTxt'),
    btnExportDoc: document.getElementById('btnExportDoc'),
    btnExportBundleZip: document.getElementById('btnExportBundleZip'),
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
    btnCleanAll: document.getElementById('btnCleanAll'),
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
    selectCleanModel: document.getElementById('selectCleanModel'),
    inputCleanDilation: document.getElementById('inputCleanDilation'),
    inputCleanThreshold: document.getElementById('inputCleanThreshold'),
    toggleCleanSFX: document.getElementById('toggleCleanSFX'),
    envKeyBadge: document.getElementById('envKeyBadge'),
    envKeyBadge2: document.getElementById('envKeyBadge2'),
    quotaSpeedText: document.getElementById('quotaSpeedText'),
    quotaDailyText: document.getElementById('quotaDailyText'),

    // Giai Đoạn 2: Collapse All & Proofread Button
    btnToggleCollapseAll: document.getElementById('btnToggleCollapseAll'),
    textToggleCollapse: document.getElementById('textToggleCollapse'),
    btnOpenProofread: document.getElementById('btnOpenProofread'),

    // Filter Chips Bar
    filterAll: document.getElementById('filterAll'),
    filterDone: document.getElementById('filterDone'),
    filterPending: document.getElementById('filterPending'),
    filterError: document.getElementById('filterError'),
    countAll: document.getElementById('countAll'),
    countDone: document.getElementById('countDone'),
    countPending: document.getElementById('countPending'),
    countError: document.getElementById('countError'),
    btnJumpPending: document.getElementById('btnJumpPending'),

    // Bottom Action Bar
    btnOpenBottomSheet: document.getElementById('btnOpenBottomSheet'),
    btnBottomProcessAll: document.getElementById('btnBottomProcessAll'),
    btnBottomCleanAll: document.getElementById('btnBottomCleanAll'),
    btnBottomQuickTxt: document.getElementById('btnBottomQuickTxt'),

    // Bottom Sheet Menu
    bottomSheetBackdrop: document.getElementById('bottomSheetBackdrop'),
    bottomSheetCard: document.getElementById('bottomSheetCard'),
    btnCloseBottomSheet: document.getElementById('btnCloseBottomSheet'),
    sheetBtnOcrAll: document.getElementById('sheetBtnOcrAll'),
    sheetBtnTransAll: document.getElementById('sheetBtnTransAll'),
    sheetBtnCleanAll: document.getElementById('sheetBtnCleanAll'),
    sheetBtnDownloadTxt: document.getElementById('sheetBtnDownloadTxt'),
    sheetBtnCleanZip: document.getElementById('sheetBtnCleanZip'),
    sheetBtnBundleZip: document.getElementById('sheetBtnBundleZip'),
    sheetBtnDownloadDoc: document.getElementById('sheetBtnDownloadDoc'),
    sheetBtnCopyAll: document.getElementById('sheetBtnCopyAll'),
    sheetBtnOpenExport: document.getElementById('sheetBtnOpenExport'),
    sheetBtnClearAll: document.getElementById('sheetBtnClearAll'),

    // Proofreading Fullscreen Overlay
    proofreadOverlay: document.getElementById('proofreadOverlay'),
    btnCloseProofread: document.getElementById('btnCloseProofread'),
    proofreadTitle: document.getElementById('proofreadTitle'),
    proofreadSubtitle: document.getElementById('proofreadSubtitle'),
    proofreadStatusBadge: document.getElementById('proofreadStatusBadge'),
    btnProofreadCleanSingle: document.getElementById('btnProofreadCleanSingle'),
    btnProofreadTransSingle: document.getElementById('btnProofreadTransSingle'),
    proofreadImg: document.getElementById('proofreadImg'),
    proofreadJpText: document.getElementById('proofreadJpText'),
    proofreadViText: document.getElementById('proofreadViText'),
    btnProofreadPrev: document.getElementById('btnProofreadPrev'),
    btnProofreadNext: document.getElementById('btnProofreadNext'),
    proofreadPageCounter: document.getElementById('proofreadPageCounter'),
    btnProofreadZoomIn: document.getElementById('btnProofreadZoomIn'),
    btnProofreadZoomOut: document.getElementById('btnProofreadZoomOut'),
    btnProofreadZoomReset: document.getElementById('btnProofreadZoomReset'),
    proofreadZoomText: document.getElementById('proofreadZoomText'),
    btnProofreadCopyJp: document.getElementById('btnProofreadCopyJp'),
    btnProofreadCopyVi: document.getElementById('btnProofreadCopyVi')
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

  // ---------------------------------------------------------------------------
  // LƯU TIẾN TRÌNH (IndexedDB v2): tải lại trang / mất tab vẫn giữ ảnh, ảnh đã tẩy, OCR, bản dịch
  //  - kho "pages": ảnh gốc (nặng, chỉ ghi 1 lần khi thêm trang)
  //  - kho "state": trạng thái + văn bản (nhẹ, ghi mỗi khi có thay đổi)
  //  - kho "cleaned": ảnh đã tẩy chữ (lưu khi tẩy xong, tăng version lên 2 kèm migrate)
  // ---------------------------------------------------------------------------
  const store = (function () {
    const DB_NAME = 'manga_studio_batch';
    const DB_VERSION = 2;
    const PAGES = 'pages';
    const STATE = 'state';
    const CLEANED = 'cleaned';
    let dbPromise = null;
    let dbHandle = null;

    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve) => {
        if (!('indexedDB' in window) || !window.indexedDB) return resolve(null);
        let req;
        try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return resolve(null); }
        req.onupgradeneeded = (e) => {
          const db = req.result;
          if (!db.objectStoreNames.contains(PAGES)) db.createObjectStore(PAGES, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(CLEANED)) db.createObjectStore(CLEANED, { keyPath: 'id' });
        };
        req.onsuccess = () => { dbHandle = req.result; resolve(dbHandle); };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      });
      return dbPromise;
    }

    // Chạy 1 giao dịch trên các kho đã chọn; fn nhận tx và trả về request cần đọc kết quả
    async function run(mode, names, fn) {
      const db = await open();
      if (!db) return { ok: false, result: null };
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(names, mode);
          const out = fn(tx);
          tx.oncomplete = () => resolve({ ok: true, result: out });
          tx.onerror = () => resolve({ ok: false, result: null });
          tx.onabort = () => resolve({ ok: false, result: null });
        } catch (e) {
          resolve({ ok: false, result: null });
        }
      });
    }

    return {
      async loadAll() {
        const r = await run('readonly', [PAGES, STATE, CLEANED], (tx) => ({
          pages: tx.objectStore(PAGES).getAll(),
          states: tx.objectStore(STATE).getAll(),
          cleaned: tx.objectStore(CLEANED).getAll()
        }));
        if (!r.ok) return [];
        const pages = r.result.pages.result || [];
        const statesById = new Map((r.result.states.result || []).map((x) => [x.id, x]));
        const cleanedById = new Map((r.result.cleaned.result || []).map((x) => [x.id, x]));
        return pages
          .sort((x, y) => (x.seq || 0) - (y.seq || 0))
          .map((pg) => {
            const st = statesById.get(pg.id) || {};
            const cl = cleanedById.get(pg.id) || {};
            return Object.assign({}, pg, st, {
              cleanedBase64: cl.cleanedBase64 || ''
            });
          });
      },
      async putPage(rec) { return (await run('readwrite', [PAGES], (tx) => { tx.objectStore(PAGES).put(rec); })).ok; },
      async putState(rec) { return (await run('readwrite', [STATE], (tx) => { tx.objectStore(STATE).put(rec); })).ok; },
      async putCleaned(rec) { return (await run('readwrite', [CLEANED], (tx) => { tx.objectStore(CLEANED).put(rec); })).ok; },
      async getCleaned(id) {
        const r = await run('readonly', [CLEANED], (tx) => tx.objectStore(CLEANED).get(id));
        return r.ok ? r.result.result : null;
      },
      // Dùng khi tab sắp đóng: không có await nào giữa chừng nên giao dịch được tạo ngay trong sự kiện
      putStateSync(rec) {
        if (!dbHandle) return;
        try { dbHandle.transaction([STATE], 'readwrite').objectStore(STATE).put(rec); } catch (e) { /* bỏ qua */ }
      },
      async remove(id) {
        return (await run('readwrite', [PAGES, STATE, CLEANED], (tx) => {
          tx.objectStore(PAGES).delete(id);
          tx.objectStore(STATE).delete(id);
          tx.objectStore(CLEANED).delete(id);
        })).ok;
      },
      async clear() {
        return (await run('readwrite', [PAGES, STATE, CLEANED], (tx) => {
          tx.objectStore(PAGES).clear();
          tx.objectStore(STATE).clear();
          tx.objectStore(CLEANED).clear();
        })).ok;
      },
      open
    };
  })();

  let seqCounter = 0;
  let saveFailureShown = false;
  const pendingSaves = new Map(); // id -> { timer, item }

  function nextSeq() {
    seqCounter = (seqCounter + 1) % 1000;
    return Date.now() * 1000 + seqCounter; // tăng dần -> giữ đúng thứ tự trang khi khôi phục
  }

  function serializePage(item) {
    return { id: item.id, seq: item.seq, name: item.name, sizeStr: item.sizeStr, base64: item.base64 };
  }

  function serializeState(item) {
    return {
      id: item.id,
      // 'processing' không phải trạng thái bền vững: nếu bị ngắt giữa chừng thì quay về 'idle'
      status: item.status === 'processing' ? 'idle' : item.status,
      cleanStatus: item.cleanStatus === 'processing' ? 'idle' : (item.cleanStatus || 'idle'),
      stage: item.stage || 0, // 0: chưa làm gì | 1: đã OCR | 2: đã dịch
      ocrText: item.ocrText || '',
      viText: item.viText || '',
      updatedAt: Date.now()
    };
  }

  function reportSaveFailure() {
    if (saveFailureShown) return;
    saveFailureShown = true;
    showToast('Lỗi: không lưu được tiến trình vào trình duyệt (bộ nhớ đầy hoặc đang ở chế độ ẩn danh). Hãy xuất .txt thường xuyên.');
  }

  // Thêm trang mới: ghi ảnh (1 lần) + trạng thái
  async function persistNewPage(item) {
    const okPage = await store.putPage(serializePage(item));
    const okState = await store.putState(serializeState(item));
    if (!okPage || !okState) reportSaveFailure();
  }

  async function persistNow(item) {
    if (!state.images.includes(item)) return; // trang đã bị xóa
    if (!(await store.putState(serializeState(item)))) reportSaveFailure();
  }

  function scheduleSave(item, delay = 300) {
    const prev = pendingSaves.get(item.id);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
      pendingSaves.delete(item.id);
      persistNow(item);
    }, delay);
    pendingSaves.set(item.id, { timer, item });
  }

  // Ghi ngay mọi thay đổi đang chờ (gọi khi ẩn tab / đóng trang)
  function flushPendingSaves() {
    for (const { timer, item } of pendingSaves.values()) {
      clearTimeout(timer);
      if (state.images.includes(item)) store.putStateSync(serializeState(item));
    }
    pendingSaves.clear();
  }

  function dropPendingSave(id) {
    const prev = pendingSaves.get(id);
    if (prev) clearTimeout(prev.timer);
    pendingSaves.delete(id);
  }

  window.addEventListener('pagehide', flushPendingSaves);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSaves();
  });

  async function restoreSession() {
    await store.open();
    const rows = await store.loadAll();
    if (!rows.length) return;

    state.images = rows.map((r) => {
      const status = r.status === 'done' ? 'done' : (r.status === 'error' ? 'error' : 'idle');
      const cleanStatus = r.cleanStatus === 'done' ? 'done' : (r.cleanStatus === 'error' ? 'error' : (r.cleanedBase64 ? 'done' : 'idle'));
      return {
        id: r.id,
        seq: r.seq || nextSeq(),
        name: r.name,
        sizeStr: r.sizeStr || '',
        base64: r.base64,
        status,
        cleanStatus,
        cleanedBase64: r.cleanedBase64 || '',
        currentView: r.cleanedBase64 ? 'cleaned' : 'original',
        stage: typeof r.stage === 'number' ? r.stage : (status === 'done' ? 2 : 0),
        dialogues: [],
        ocrText: r.ocrText || '',
        viText: r.viText || '',
        tokens: 0
      };
    });

    const finished = state.images.filter((i) => i.stage >= 2).length;
    const cleaned = state.images.filter((i) => !!i.cleanedBase64).length;
    const remaining = state.images.length - finished;
    showToast(
      remaining > 0
        ? `Đã khôi phục ${state.images.length} trang (${finished} đã dịch, ${cleaned} đã tẩy chữ, ${remaining} chưa dịch). Bấm "Tẩy chữ" hoặc "OCR + Dịch" để làm tiếp phần còn lại.`
        : `Đã khôi phục ${state.images.length} trang (${cleaned} đã tẩy chữ, tất cả đã dịch xong). Bạn có thể xuất ZIP ảnh sạch hoặc script.`
    );
  }

  // Ngữ cảnh truyện: vài dòng dịch cuối của trang gần nhất đã có bản dịch (lùi tối đa 3 trang,
  // vì khi chạy 2 luồng song song thì trang ngay trước có thể chưa xong)
  function getPrevContext(item) {
    const idx = state.images.indexOf(item);
    for (let i = idx - 1; i >= Math.max(0, idx - 3); i--) {
      const text = (state.images[i].viText || '').trim();
      if (text) {
        return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-12);
      }
    }
    return [];
  }

  // Trang nào cần xử lý trong chế độ hàng đợi tương ứng (không làm lại phần đã xong)
  function needsWork(img, mode) {
    const stage = img.stage || 0;
    if (mode === 'ocr_only') return stage < 1;
    if (mode === 'translate_only') return stage < 2 && !!(img.ocrText && img.ocrText.trim());
    return stage < 2;
  }

  // Initialize
  async function init() {
    bindEvents();
    await checkConfig();
    applySettingsToUI();
    await restoreSession();
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
    if (el.selectReadingOrder) el.selectReadingOrder.value = state.settings.readingOrder;

    if (el.selectCleanModel) el.selectCleanModel.value = state.settings.cleanModel;
    if (el.inputCleanDilation) el.inputCleanDilation.value = state.settings.cleanDilation;
    if (el.inputCleanThreshold) el.inputCleanThreshold.value = state.settings.cleanThreshold;
    if (el.toggleCleanSFX) el.toggleCleanSFX.checked = state.settings.cleanSFX;

    if (el.btnModeManga && el.btnModeWebtoon) {
      el.btnModeManga.classList.toggle('active', state.settings.readingOrder === 'manga');
      el.btnModeWebtoon.classList.toggle('active', state.settings.readingOrder === 'webtoon');
    }

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

    // Manga vs Webtoon Reading Order Mode
    function setReadingOrder(order) {
      state.settings.readingOrder = order === 'webtoon' ? 'webtoon' : 'manga';
      localStorage.setItem('manga_reading_order', state.settings.readingOrder);
      if (el.btnModeManga && el.btnModeWebtoon) {
        el.btnModeManga.classList.toggle('active', state.settings.readingOrder === 'manga');
        el.btnModeWebtoon.classList.toggle('active', state.settings.readingOrder === 'webtoon');
      }
      if (el.selectReadingOrder) {
        el.selectReadingOrder.value = state.settings.readingOrder;
      }
      showToast(state.settings.readingOrder === 'webtoon'
        ? 'Đã chọn chế độ Webtoon: Quét dọc từ trên xuống dưới'
        : 'Đã chọn chế độ Manga: Quét từ phải sang trái');
    }

    if (el.btnModeManga) {
      el.btnModeManga.addEventListener('click', () => setReadingOrder('manga'));
    }
    if (el.btnModeWebtoon) {
      el.btnModeWebtoon.addEventListener('click', () => setReadingOrder('webtoon'));
    }
    if (el.selectReadingOrder) {
      el.selectReadingOrder.addEventListener('change', () => setReadingOrder(el.selectReadingOrder.value));
    }

    // Apply saved Image Zoom & Size
    applyThumbZoom(currentZoomVal);

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
    if (el.btnCleanAll) el.btnCleanAll.addEventListener('click', runCleanQueue);
    el.btnProcessAll.addEventListener('click', () => runBatchQueue('all'));
    el.btnClearAll.addEventListener('click', clearAllBatch);
    el.btnOcrAll.addEventListener('click', () => runBatchQueue('ocr_only'));
    el.btnTranslateAll.addEventListener('click', () => runBatchQueue('translate_only'));
    // Export Dropdown Trigger
    el.btnExportChapter.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = el.exportMenu.style.display === 'flex';
      el.exportMenu.style.display = isVisible ? 'none' : 'flex';
    });

    if (el.btnExportCleanZip) {
      el.btnExportCleanZip.addEventListener('click', (e) => {
        e.stopPropagation();
        el.exportMenu.style.display = 'none';
        exportCleanedImagesZip();
      });
    }

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

    if (el.btnExportBundleZip) {
      el.btnExportBundleZip.addEventListener('click', (e) => {
        e.stopPropagation();
        el.exportMenu.style.display = 'none';
        exportBundleZip();
      });
    }

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

    // =========================================================================
    // GIAI ĐOẠN 2: EVENT LISTENERS
    // =========================================================================

    // 1. Thu gọn tất cả & Soát bản dịch
    if (el.btnToggleCollapseAll) {
      el.btnToggleCollapseAll.addEventListener('click', toggleCollapseAll);
    }
    if (el.btnOpenProofread) {
      el.btnOpenProofread.addEventListener('click', () => openProofread(0));
    }

    // 2. Bộ lọc tiến độ
    if (el.filterAll) el.filterAll.addEventListener('click', () => setFilter('all'));
    if (el.filterDone) el.filterDone.addEventListener('click', () => setFilter('done'));
    if (el.filterPending) el.filterPending.addEventListener('click', () => setFilter('pending'));
    if (el.filterError) el.filterError.addEventListener('click', () => setFilter('error'));
    if (el.btnJumpPending) el.btnJumpPending.addEventListener('click', jumpToFirstPending);

    // 3. Bottom Action Bar
    if (el.btnOpenBottomSheet) {
      el.btnOpenBottomSheet.addEventListener('click', openBottomSheet);
    }
    if (el.btnCloseBottomSheet) {
      el.btnCloseBottomSheet.addEventListener('click', closeBottomSheet);
    }
    if (el.bottomSheetBackdrop) {
      el.bottomSheetBackdrop.addEventListener('click', closeBottomSheet);
    }
    if (el.btnBottomProcessAll) {
      el.btnBottomProcessAll.addEventListener('click', () => {
        if (state.isQueueRunning) {
          state.stopQueueRequested = true;
          if (el.btnStopQueue) el.btnStopQueue.click();
        } else {
          runBatchQueue('all');
        }
      });
    }
    if (el.btnBottomCleanAll) {
      el.btnBottomCleanAll.addEventListener('click', runCleanQueue);
    }
    if (el.btnBottomQuickTxt) {
      el.btnBottomQuickTxt.addEventListener('click', () => exportFullChapter('txt'));
    }

    // 4. Bottom Sheet Menu Items
    if (el.sheetBtnOcrAll) {
      el.sheetBtnOcrAll.addEventListener('click', () => {
        closeBottomSheet();
        runBatchQueue('ocr_only');
      });
    }
    if (el.sheetBtnTransAll) {
      el.sheetBtnTransAll.addEventListener('click', () => {
        closeBottomSheet();
        runBatchQueue('translate_only');
      });
    }
    if (el.sheetBtnCleanAll) {
      el.sheetBtnCleanAll.addEventListener('click', () => {
        closeBottomSheet();
        runCleanQueue();
      });
    }
    if (el.sheetBtnDownloadTxt) {
      el.sheetBtnDownloadTxt.addEventListener('click', () => {
        closeBottomSheet();
        exportFullChapter('txt');
      });
    }
    if (el.sheetBtnCleanZip) {
      el.sheetBtnCleanZip.addEventListener('click', () => {
        closeBottomSheet();
        exportCleanedImagesZip();
      });
    }
    if (el.sheetBtnBundleZip) {
      el.sheetBtnBundleZip.addEventListener('click', () => {
        closeBottomSheet();
        exportBundleZip();
      });
    }
    if (el.sheetBtnDownloadDoc) {
      el.sheetBtnDownloadDoc.addEventListener('click', () => {
        closeBottomSheet();
        exportFullChapter('doc');
      });
    }
    if (el.sheetBtnCopyAll) {
      el.sheetBtnCopyAll.addEventListener('click', () => {
        closeBottomSheet();
        copyChapterToClipboard();
      });
    }
    if (el.sheetBtnOpenExport) {
      el.sheetBtnOpenExport.addEventListener('click', () => {
        closeBottomSheet();
        if (el.btnOpenExportModal) el.btnOpenExportModal.click();
      });
    }
    if (el.sheetBtnClearAll) {
      el.sheetBtnClearAll.addEventListener('click', () => {
        closeBottomSheet();
        clearAllBatch();
      });
    }

    // 5. Proofreading Overlay Events
    if (el.btnCloseProofread) {
      el.btnCloseProofread.addEventListener('click', closeProofread);
    }
    if (el.btnProofreadPrev) {
      el.btnProofreadPrev.addEventListener('click', () => navigateProofread(-1));
    }
    if (el.btnProofreadNext) {
      el.btnProofreadNext.addEventListener('click', () => navigateProofread(1));
    }
    if (el.btnProofreadZoomIn) {
      el.btnProofreadZoomIn.addEventListener('click', () => zoomProofread(25));
    }
    if (el.btnProofreadZoomOut) {
      el.btnProofreadZoomOut.addEventListener('click', () => zoomProofread(-25));
    }
    if (el.btnProofreadZoomReset) {
      el.btnProofreadZoomReset.addEventListener('click', () => {
        state.proofreadZoom = 100;
        renderProofreadCurrentPage();
      });
    }
    if (el.btnProofreadCopyJp) {
      el.btnProofreadCopyJp.addEventListener('click', () => {
        const item = state.images[state.proofreadIndex];
        if (item) copyToClipboard(item.ocrText, 'Đã copy tiếng Nhật!');
      });
    }
    if (el.btnProofreadCopyVi) {
      el.btnProofreadCopyVi.addEventListener('click', () => {
        const item = state.images[state.proofreadIndex];
        if (item) copyToClipboard(item.viText, 'Đã copy bản dịch!');
      });
    }
    if (el.proofreadViText) {
      el.proofreadViText.addEventListener('input', () => {
        const item = state.images[state.proofreadIndex];
        if (item) {
          item.viText = el.proofreadViText.value;
          scheduleSave(item);
          updateCardDOM(item);
        }
      });
    }
    if (el.proofreadJpText) {
      el.proofreadJpText.addEventListener('input', () => {
        const item = state.images[state.proofreadIndex];
        if (item) {
          item.ocrText = el.proofreadJpText.value;
          scheduleSave(item);
          updateCardDOM(item);
        }
      });
    }
    if (el.btnProofreadCleanSingle) {
      el.btnProofreadCleanSingle.addEventListener('click', () => {
        const item = state.images[state.proofreadIndex];
        if (item) cleanSingleImage(item);
      });
    }
    if (el.btnProofreadTransSingle) {
      el.btnProofreadTransSingle.addEventListener('click', () => {
        const item = state.images[state.proofreadIndex];
        if (item) translateSingleText(item);
      });
    }

    // Touch Swipe trên Proofreading Overlay (Dành riêng cho màn hình cảm ứng di động)
    let touchStartX = 0;
    let touchEndX = 0;
    if (el.proofreadImg) {
      el.proofreadImg.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });

      el.proofreadImg.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchEndX - touchStartX;
        if (Math.abs(diff) > 50) {
          if (diff > 0) navigateProofread(-1); // Vuốt sang phải -> về trang trước
          else navigateProofread(1); // Vuốt sang trái -> sang trang sau
        }
      }, { passive: true });
    }

    // Keyboard Shortcuts khi Soát Bản Dịch (ArrowLeft, ArrowRight, Escape)
    window.addEventListener('keydown', (e) => {
      if (el.proofreadOverlay && el.proofreadOverlay.style.display === 'flex') {
        if (document.activeElement === el.proofreadViText || document.activeElement === el.proofreadJpText) {
          return; // Đang gõ văn bản thì không bắt phím mũi tên
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateProofread(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateProofread(1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeProofread();
        }
      }
    });
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
        cleanStatus: 'idle',
        cleanedBase64: '',
        currentView: 'original',
        dialogues: [],
        ocrText: '',
        viText: '',
        tokens: 0,
        seq: nextSeq(),
        stage: 0
      };

      state.images.push(item);
      persistNewPage(item);
    }

    renderBatchView();
    if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(() => {}); }
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
    updateToolbarStates(state.isQueueRunning);

    el.statBadge.textContent = `${state.images.length} trang trong danh sách`;
    updateFilterCounts();

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

    // Áp dụng bộ lọc hiện tại
    applyCurrentFilterToDOM();
  }

  // Create Single Row Element
  function createRowElement(item, displayIndex) {
    const card = document.createElement('div');
    card.className = `manga-row-card ${item.status}${state.isAllCollapsed ? ' is-collapsed' : ''}`;
    card.id = `row-${item.id}`;

    const cleanLabel = item.cleanStatus === 'done'
      ? 'TẨY: XONG'
      : (item.cleanStatus === 'processing' ? 'ĐANG TẨY...' : (item.cleanStatus === 'error' ? 'TẨY LỖI' : 'CHƯA TẨY'));

    const summaryText = (item.viText || item.ocrText || '').trim().replace(/\s+/g, ' ').slice(0, 45);

    card.innerHTML = `
      <div class="row-header">
        <div class="row-header-left">
          <button type="button" class="btn-row-collapse-toggle" title="Thu gọn / Mở rộng thẻ này">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <button class="btn-zoom-preview" title="Chỉnh kích thước ảnh (Phóng to / Thu nhỏ)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
            </svg>
          </button>
          <span class="row-title">Trang ${displayIndex}: ${escapeHtml(item.name)}</span>
          <span class="row-size">${item.sizeStr}</span>
          <span class="badge-status ${item.status}">${item.status.toUpperCase()}</span>
          <span class="badge-clean ${item.cleanStatus || 'idle'}">${cleanLabel}</span>
          <span class="row-collapsed-summary">${escapeHtml(summaryText || 'Chưa dịch')}</span>
        </div>
        <div class="row-header-right">
          <button class="btn-row-action btn-row-proofread" title="Soát bản dịch toàn màn hình cho trang này">Soát</button>
          <button class="btn-row-action btn-row-clean">Tẩy chữ</button>
          <button class="btn-row-action btn-row-ocr">OCR</button>
          <button class="btn-row-action btn-row-trans">Dịch</button>
          <button class="btn-row-action btn-row-all" style="color:var(--accent-red); font-weight:700;">OCR + Dịch</button>
          <button class="btn-row-delete" title="Xóa trang này">&times;</button>
        </div>
      </div>

      <div class="row-body">
        <!-- Col 1: Thumbnail with sticky Image Size controller at top left -->
        <div class="col-thumb">
          <div class="image-size-widget card-size-widget">
            <span class="size-label">Image size</span>
            <input type="range" class="size-slider card-slider" min="0" max="100" value="${currentZoomVal}" step="1">
            <button type="button" class="btn-reset-size card-reset-size" title="Khôi phục kích thước ban đầu">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
              </svg>
            </button>
          </div>
          <div class="thumb-switcher" style="${item.cleanedBase64 ? 'display:flex;' : 'display:none;'}">
            <button type="button" class="thumb-switch-btn btn-view-orig ${item.currentView !== 'cleaned' ? 'active' : ''}">Gốc</button>
            <button type="button" class="thumb-switch-btn cleaned btn-view-clean ${item.currentView === 'cleaned' ? 'active' : ''}">Đã tẩy</button>
          </div>
          <img src="${(item.currentView === 'cleaned' && item.cleanedBase64) ? item.cleanedBase64 : item.base64}" alt="${escapeHtml(item.name)}" title="Bấm để xem toàn màn hình (hoặc kéo rê để di chuyển)">
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
            <span class="text-panel-title">Bản dịch (VI)</span>
            <div class="text-panel-actions" style="display:flex; align-items:center; gap:4px;">
              <button type="button" class="btn-panel-copy btn-mini-clean" title="Tẩy chữ riêng trang này">✨ Tẩy</button>
              <button type="button" class="btn-panel-copy btn-mini-trans" title="Dịch lại riêng trang này">⚡ Dịch</button>
              <button type="button" class="btn-panel-copy btn-copy-vi" title="Copy bản dịch">Copy</button>
            </div>
          </div>
          <textarea class="text-panel-editor textarea-vi" placeholder="Chưa có bản dịch...">${escapeHtml(item.viText)}</textarea>
        </div>
      </div>
    `;

    // Bind item events
    const thumbCol = card.querySelector('.col-thumb');
    const btnZoom = card.querySelector('.btn-zoom-preview');
    const cardSizeWidget = card.querySelector('.card-size-widget');
    const cardSlider = card.querySelector('.card-slider');
    const cardReset = card.querySelector('.card-reset-size');
    const imgEl = card.querySelector('.col-thumb img');

    // Switcher Gốc vs Đã tẩy
    const btnViewOrig = card.querySelector('.btn-view-orig');
    const btnViewClean = card.querySelector('.btn-view-clean');
    if (btnViewOrig && btnViewClean) {
      btnViewOrig.addEventListener('click', (e) => {
        e.stopPropagation();
        item.currentView = 'original';
        imgEl.src = item.base64;
        btnViewOrig.classList.add('active');
        btnViewClean.classList.remove('active');
      });
      btnViewClean.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!item.cleanedBase64) return;
        item.currentView = 'cleaned';
        imgEl.src = item.cleanedBase64;
        btnViewClean.classList.add('active');
        btnViewOrig.classList.remove('active');
      });
    }

    // 1. Chỉ hiện thanh trượt khi ấn vào nút [⤢] (toggle bật/tắt)
    btnZoom.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = cardSizeWidget.classList.toggle('show');
      btnZoom.classList.toggle('active', isVisible);
    });

    // Ngăn chặn sự kiện click bên trong widget làm tắt chính nó hoặc kéo ảnh
    const preventDragThroughWidget = (e) => e.stopPropagation();
    ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach(evt => {
      cardSizeWidget.addEventListener(evt, preventDragThroughWidget);
    });

    // Đóng widget khi click ra bên ngoài card
    const handleOutsideClick = (e) => {
      if (!card.contains(e.target)) {
        cardSizeWidget.classList.remove('show');
        btnZoom.classList.remove('active');
      }
    };
    document.addEventListener('click', handleOutsideClick);

    // Xử lý kéo thanh trượt zoom
    cardSlider.addEventListener('input', (e) => {
      applyThumbZoom(e.target.value);
    });

    // Nút reset zoom về 0%
    cardReset.addEventListener('click', (e) => {
      e.stopPropagation();
      applyThumbZoom(0);
      thumbCol.scrollTop = 0;
      thumbCol.scrollLeft = 0;
    });

    // 2. Kéo rê chuột hoặc chạm vuốt (touch) vào ảnh để di chuyển ảnh khi phóng to
    let isPointerDown = false;
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;
    let hasDragged = false;

    // Chặn kéo thả hình ảnh mặc định của trình duyệt
    imgEl.setAttribute('draggable', 'false');
    imgEl.addEventListener('dragstart', (e) => e.preventDefault());

    thumbCol.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.card-size-widget') || e.target.closest('.thumb-switcher')) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return; // Chỉ nhận click chuột trái hoặc chạm ngón tay
      isPointerDown = true;
      hasDragged = false;
      startX = e.clientX;
      startY = e.clientY;
      startScrollLeft = thumbCol.scrollLeft;
      startScrollTop = thumbCol.scrollTop;
      try {
        thumbCol.setPointerCapture(e.pointerId);
      } catch (err) {}
    });

    thumbCol.addEventListener('pointermove', (e) => {
      if (!isPointerDown) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        hasDragged = true;
        thumbCol.classList.add('is-panning');
      }

      if (hasDragged) {
        thumbCol.scrollLeft = startScrollLeft - deltaX;
        thumbCol.scrollTop = startScrollTop - deltaY;
      }
    });

    const handlePointerEnd = (e) => {
      if (!isPointerDown) return;
      isPointerDown = false;
      thumbCol.classList.remove('is-panning');
      try {
        if (thumbCol.hasPointerCapture(e.pointerId)) {
          thumbCol.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}
      if (hasDragged) {
        // Trì hoãn 1 chút để không kích hoạt nhầm sự kiện click mở lightbox
        setTimeout(() => { hasDragged = false; }, 80);
      }
    };

    thumbCol.addEventListener('pointerup', handlePointerEnd);
    thumbCol.addEventListener('pointercancel', handlePointerEnd);

    // Chỉ mở lightbox khi người dùng bấm click đơn thuần (không phải sau khi rê/kéo ảnh)
    imgEl.addEventListener('click', (e) => {
      if (hasDragged) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      el.lightboxImg.src = imgEl.src;
      el.lightboxModal.style.display = 'flex';
    });

    // Text inputs
    const textareaJp = card.querySelector('.textarea-jp');
    const textareaVi = card.querySelector('.textarea-vi');

    textareaJp.addEventListener('input', () => {
      item.ocrText = textareaJp.value;
      scheduleSave(item);
    });

    textareaVi.addEventListener('input', () => {
      item.viText = textareaVi.value;
      scheduleSave(item);
    });

    // Rời ô nhập (blur) là lưu ngay, không chờ debounce
    textareaJp.addEventListener('change', () => scheduleSave(item, 0));
    textareaVi.addEventListener('change', () => scheduleSave(item, 0));

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
      dropPendingSave(item.id);
      store.remove(item.id);
      renderBatchView();
    });

    // Giai Đoạn 2: Nút thu gọn thẻ và Soát bản dịch
    const btnCollapse = card.querySelector('.btn-row-collapse-toggle');
    if (btnCollapse) {
      btnCollapse.addEventListener('click', (e) => {
        e.stopPropagation();
        card.classList.toggle('is-collapsed');
      });
    }

    const btnRowProofread = card.querySelector('.btn-row-proofread');
    if (btnRowProofread) {
      btnRowProofread.addEventListener('click', () => {
        const idx = state.images.findIndex(x => x.id === item.id);
        if (idx !== -1) openProofread(idx);
      });
    }

    const btnMiniClean = card.querySelector('.btn-mini-clean');
    if (btnMiniClean) {
      btnMiniClean.addEventListener('click', (e) => {
        e.stopPropagation();
        cleanSingleImage(item);
      });
    }

    const btnMiniTrans = card.querySelector('.btn-mini-trans');
    if (btnMiniTrans) {
      btnMiniTrans.addEventListener('click', (e) => {
        e.stopPropagation();
        translateSingleText(item);
      });
    }

    const btnClean = card.querySelector('.btn-row-clean');
    if (btnClean) btnClean.addEventListener('click', () => cleanSingleImage(item));

    const btnOcr = card.querySelector('.btn-row-ocr');
    if (btnOcr) btnOcr.addEventListener('click', () => processSingleImage(item, 'ocr_only'));

    const btnTrans = card.querySelector('.btn-row-trans');
    if (btnTrans) btnTrans.addEventListener('click', () => translateSingleText(item));

    const btnAll = card.querySelector('.btn-row-all');
    if (btnAll) btnAll.addEventListener('click', () => processSingleImage(item, 'all'));

    return card;
  }

  // Update a single card DOM without re-rendering everything
  function updateCardDOM(item) {
    const card = document.getElementById(`row-${item.id}`);
    if (!card) return;

    card.className = `manga-row-card ${item.status}${card.classList.contains('is-collapsed') ? ' is-collapsed' : ''}`;
    const badge = card.querySelector('.badge-status');
    if (badge) {
      badge.className = `badge-status ${item.status}`;
      badge.textContent = item.status.toUpperCase();
    }

    const badgeClean = card.querySelector('.badge-clean');
    if (badgeClean) {
      badgeClean.className = `badge-clean ${item.cleanStatus || 'idle'}`;
      badgeClean.textContent = item.cleanStatus === 'done'
        ? 'TẨY: XONG'
        : (item.cleanStatus === 'processing' ? 'ĐANG TẨY...' : (item.cleanStatus === 'error' ? 'TẨY LỖI' : 'CHƯA TẨY'));
    }

    const summaryEl = card.querySelector('.row-collapsed-summary');
    if (summaryEl) {
      const summaryText = (item.viText || item.ocrText || '').trim().replace(/\s+/g, ' ').slice(0, 45);
      summaryEl.textContent = summaryText || 'Chưa dịch';
    }

    const switcher = card.querySelector('.thumb-switcher');
    if (switcher) switcher.style.display = item.cleanedBase64 ? 'flex' : 'none';

    const btnViewOrig = card.querySelector('.btn-view-orig');
    const btnViewClean = card.querySelector('.btn-view-clean');
    if (btnViewOrig && btnViewClean) {
      btnViewOrig.classList.toggle('active', item.currentView !== 'cleaned');
      btnViewClean.classList.toggle('active', item.currentView === 'cleaned');
    }

    const imgEl = card.querySelector('.col-thumb img');
    if (imgEl) {
      imgEl.src = (item.currentView === 'cleaned' && item.cleanedBase64) ? item.cleanedBase64 : item.base64;
    }

    const textareaJp = card.querySelector('.textarea-jp');
    if (textareaJp) textareaJp.value = item.ocrText;

    const textareaVi = card.querySelector('.textarea-vi');
    if (textareaVi) textareaVi.value = item.viText;

    el.btnExportChapter.disabled = state.images.length === 0;
    if (el.btnQuickDownloadTxt) el.btnQuickDownloadTxt.disabled = state.images.length === 0;

    // Cập nhật bộ lọc và tiến độ
    updateFilterCounts();
    applyFilterToCardElement(card, item);

    // Cập nhật Proofreading Overlay nếu đang mở đúng trang này
    if (el.proofreadOverlay && el.proofreadOverlay.style.display === 'flex') {
      const curItem = state.images[state.proofreadIndex];
      if (curItem && curItem.id === item.id) {
        renderProofreadCurrentPage();
      }
    }
  }

  // Tẩy chữ cho 1 ảnh đơn lẻ (với cơ chế retry 2 lần khi gặp lỗi kết nối/500/timeout)
  async function cleanSingleImage(item, maxRetries = 2) {
    if (item.cleanStatus === 'processing') return false;
    item.cleanStatus = 'processing';
    updateCardDOM(item);

    const payload = {
      imageBase64: item.base64,
      cleanSFX: Boolean(state.settings.cleanSFX),
      dilationPx: Number(state.settings.cleanDilation || 4),
      detThreshold: Number(state.settings.cleanThreshold || 0.20),
      inpaintModel: String(state.settings.cleanModel || 'anime-lama')
    };

    let attempt = 0;
    let lastError = null;

    while (attempt <= maxRetries) {
      try {
        const res = await fetch('/api/clean', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok || !data.cleanedImageBase64) {
          throw new Error(data.error || `Server lỗi mã ${res.status}`);
        }

        let cleanB64 = data.cleanedImageBase64;
        if (!cleanB64.startsWith('data:image/')) {
          cleanB64 = 'data:image/png;base64,' + cleanB64;
        }

        item.cleanedBase64 = cleanB64;
        item.cleanStatus = 'done';
        item.currentView = 'cleaned'; // Tự động hiển thị bản đã tẩy trên thumbnail

        await store.putCleaned({ id: item.id, cleanedBase64: item.cleanedBase64 });
        scheduleSave(item, 0);
        updateCardDOM(item);
        showToast(`Đã tẩy chữ thành công trang: ${item.name}`);
        return true;
      } catch (err) {
        lastError = err;
        attempt++;
        if (attempt <= maxRetries) {
          console.warn(`[Clean Retry] Trang ${item.name} lỗi lần ${attempt}, đang thử lại sau 1.5s...`);
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    item.cleanStatus = 'error';
    updateCardDOM(item);
    scheduleSave(item, 0);
    showToast(`Lỗi tẩy chữ trang ${item.name}: ${lastError ? lastError.message : 'Thất bại'}`);
    return false;
  }

  // Tẩy chữ hàng loạt cho Chapter (Giới hạn 2 request đồng thời, có retry)
  async function runCleanQueue() {
    if (state.isQueueRunning) return;

    const queueItems = state.images.filter(img => !img.cleanedBase64 || img.cleanStatus !== 'done');
    if (queueItems.length === 0) {
      showToast('Tất cả các trang trong danh sách đã được tẩy chữ xong!');
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
    const concurrency = 2; // Giới hạn 2 request đồng thời

    async function cleanWorker(workerId) {
      while (nextIndex < total && !state.stopQueueRequested) {
        const itemIdx = nextIndex++;
        if (itemIdx >= total) break;

        const currentItem = queueItems[itemIdx];
        if (!currentItem) break;

        el.queueProgressText.textContent = `[Luồng ${workerId + 1}] Đang tẩy chữ: ${currentItem.name} (${completed + 1}/${total})...`;
        el.queueProgressFill.style.width = `${Math.round((completed / total) * 100)}%`;

        await cleanSingleImage(currentItem);

        completed++;
        el.queueProgressFill.style.width = `${Math.round((completed / total) * 100)}%`;

        if (!state.stopQueueRequested && nextIndex < total) {
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }

    await Promise.all([
      cleanWorker(0),
      cleanWorker(1)
    ]);

    el.queueProgressFill.style.width = '100%';
    el.queueProgressText.textContent = `Hoàn thành tẩy chữ ${completed} / ${total} trang!`;

    setTimeout(() => {
      el.queueProgressBar.style.display = 'none';
      state.isQueueRunning = false;
      updateToolbarStates(false);
      renderBatchView();
    }, 1500);
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
        readingOrder: state.settings.readingOrder,
        sourceLang: 'ja',
        targetLang: 'vi',
        prevContext: mode === 'ocr_only' ? [] : getPrevContext(item)
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
      item.stage = (mode === 'ocr_only') ? Math.max(item.stage || 0, 1) : 2;

      updateCardDOM(item);
      scheduleSave(item, 0);

      const missing = data.missingTranslation || [];
      if (missing.length) {
        showToast(`Trang ${item.name}: dòng ${missing.join(', ')} chưa dịch được, đã giữ nguyên bản gốc. Hãy kiểm tra lại.`);
      }
      return true;

    } catch (err) {
      console.error(err);
      item.status = 'error';
      updateCardDOM(item);
      scheduleSave(item, 0);
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
          readingOrder: state.settings.readingOrder,
          sourceLang: 'ja',
          targetLang: 'vi',
          prevContext: getPrevContext(item)
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Lỗi dịch text.');

      item.status = 'done';
      item.stage = 2;
      item.viText = data.text_vi || '';
      updateCardDOM(item);
      scheduleSave(item, 0);
      return true;
    } catch (err) {
      item.status = 'error';
      updateCardDOM(item);
      scheduleSave(item, 0);
      alert('Lỗi dịch: ' + err.message);
      return false;
    }
  }

  // Batch Queue Engine (Dual-Worker Parallel Processing for 2 Keys / 30 RPM)
  async function runBatchQueue(mode = 'all') {
    if (state.isQueueRunning) return;

    const queueItems = state.images.filter(img => needsWork(img, mode));
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

        // Giai Đoạn 2: Hiển thị tiến độ x/N trên nút Dừng lại
        if (el.btnBottomProcessAll) {
          const bText = el.btnBottomProcessAll.querySelector('.btn-bottom-process-text');
          if (bText) bText.textContent = `Dừng lại (${completed}/${total})`;
        }
        if (el.btnProcessAll) {
          const sText = el.btnProcessAll.querySelector('.btn-process-text');
          if (sText) sText.textContent = `Dừng lại (${completed}/${total})`;
        }
        updateFilterCounts();

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
    const hasImages = state.images.length > 0;

    // Subbar buttons
    if (el.btnCleanAll) el.btnCleanAll.disabled = isRunning || !hasImages;
    el.btnProcessAll.disabled = !hasImages;
    el.btnOcrAll.disabled = isRunning || !hasImages;
    el.btnTranslateAll.disabled = isRunning || !hasImages;
    el.btnClearAll.disabled = isRunning || !hasImages;
    if (el.btnExportChapter) el.btnExportChapter.disabled = isRunning || !hasImages;
    if (el.btnQuickDownloadTxt) el.btnQuickDownloadTxt.disabled = isRunning || !hasImages;

    // Bottom Action Bar
    if (el.btnBottomProcessAll) {
      el.btnBottomProcessAll.disabled = !hasImages;
      el.btnBottomProcessAll.classList.toggle('is-running', isRunning);
      const textEl = el.btnBottomProcessAll.querySelector('.btn-bottom-process-text');
      if (textEl) {
        textEl.textContent = isRunning ? 'Dừng lại' : 'OCR + Dịch tất cả';
      }
    }
    if (el.btnBottomCleanAll) el.btnBottomCleanAll.disabled = isRunning || !hasImages;
    if (el.btnBottomQuickTxt) el.btnBottomQuickTxt.disabled = isRunning || !hasImages;
    if (el.btnOpenBottomSheet) el.btnOpenBottomSheet.disabled = isRunning;

    const subbarProcessText = el.btnProcessAll ? el.btnProcessAll.querySelector('.btn-process-text') : null;
    if (subbarProcessText) {
      subbarProcessText.textContent = isRunning ? 'Dừng lại' : 'OCR + Dịch tất cả';
    }

    updateFilterCounts();
  }

  // ---------------------------------------------------------------------------
  // Giai Đoạn 2: Quản lý Bộ Lọc & Tiến Độ (Filter & Counts)
  // ---------------------------------------------------------------------------
  function updateFilterCounts() {
    const total = state.images.length;
    let done = 0;
    let pending = 0;
    let error = 0;

    state.images.forEach(img => {
      const isErr = img.status === 'error' || img.cleanStatus === 'error';
      const isDone = (img.stage || 0) >= 2 && img.status === 'done';
      if (isErr) error++;
      if (isDone) done++;
      if (!isDone && !isErr) pending++;
    });

    if (el.countAll) el.countAll.textContent = total;
    if (el.countDone) el.countDone.textContent = done;
    if (el.countPending) el.countPending.textContent = pending;
    if (el.countError) el.countError.textContent = error;
  }

  function applyFilterToCardElement(card, item) {
    if (!card || !item) return;
    const filter = state.currentFilter || 'all';
    if (filter === 'all') {
      card.style.display = '';
      return;
    }
    const isErr = item.status === 'error' || item.cleanStatus === 'error';
    const isDone = (item.stage || 0) >= 2 && item.status === 'done';

    let show = true;
    if (filter === 'done') show = isDone;
    else if (filter === 'pending') show = !isDone;
    else if (filter === 'error') show = isErr;

    card.style.display = show ? '' : 'none';
  }

  function applyCurrentFilterToDOM() {
    state.images.forEach(item => {
      const card = document.getElementById(`row-${item.id}`);
      if (card) applyFilterToCardElement(card, item);
    });
  }

  function setFilter(filterType) {
    state.currentFilter = filterType;
    [el.filterAll, el.filterDone, el.filterPending, el.filterError].forEach(btn => {
      if (btn) btn.classList.toggle('active', btn.dataset.filter === filterType);
    });
    applyCurrentFilterToDOM();
  }

  function jumpToFirstPending() {
    const firstPending = state.images.find(img => (img.stage || 0) < 2);
    if (!firstPending) {
      showToast('Tất cả các trang đã hoàn thành!');
      return;
    }
    if (state.currentFilter === 'done') {
      setFilter('all');
    }
    const card = document.getElementById(`row-${firstPending.id}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.style.outline = '2px solid #f59e0b';
      card.style.boxShadow = '0 0 20px rgba(245, 158, 11, 0.4)';
      setTimeout(() => {
        card.style.outline = '';
        card.style.boxShadow = '';
      }, 2500);
      showToast(`Đã cuộn tới trang chưa xong: ${firstPending.name}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Giai Đoạn 2: Thu Gọn / Mở Rộng Tất Cả
  // ---------------------------------------------------------------------------
  function toggleCollapseAll() {
    state.isAllCollapsed = !state.isAllCollapsed;
    document.querySelectorAll('.manga-row-card').forEach(card => {
      card.classList.toggle('is-collapsed', state.isAllCollapsed);
    });
    if (el.textToggleCollapse) {
      el.textToggleCollapse.textContent = state.isAllCollapsed ? 'Mở rộng' : 'Thu gọn';
    }
    showToast(state.isAllCollapsed ? 'Đã thu gọn danh sách trang' : 'Đã mở rộng toàn bộ danh sách');
  }

  // ---------------------------------------------------------------------------
  // Giai Đoạn 2: Bottom Sheet Menu
  // ---------------------------------------------------------------------------
  function openBottomSheet() {
    if (el.bottomSheetBackdrop && el.bottomSheetCard) {
      el.bottomSheetBackdrop.style.display = 'block';
      el.bottomSheetCard.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  }

  function closeBottomSheet() {
    if (el.bottomSheetBackdrop && el.bottomSheetCard) {
      el.bottomSheetBackdrop.style.display = 'none';
      el.bottomSheetCard.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Giai Đoạn 2: Chế Độ Soát Bản Dịch (Proofreading Mode)
  // ---------------------------------------------------------------------------
  function openProofread(index = 0) {
    if (state.images.length === 0) {
      showToast('Vui lòng thêm ảnh Manga trước khi soát bản dịch.');
      return;
    }
    state.proofreadIndex = Math.max(0, Math.min(state.images.length - 1, index));
    state.proofreadZoom = 100;
    renderProofreadCurrentPage();
    if (el.proofreadOverlay) {
      el.proofreadOverlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  }

  function closeProofread() {
    if (el.proofreadOverlay) {
      el.proofreadOverlay.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  function renderProofreadCurrentPage() {
    const item = state.images[state.proofreadIndex];
    if (!item) return;

    if (el.proofreadTitle) el.proofreadTitle.textContent = `Soát bản dịch: ${item.name}`;
    if (el.proofreadSubtitle) el.proofreadSubtitle.textContent = `Trang ${state.proofreadIndex + 1} / ${state.images.length} (${item.sizeStr})`;
    if (el.proofreadPageCounter) el.proofreadPageCounter.textContent = `${state.proofreadIndex + 1} / ${state.images.length}`;

    if (el.proofreadStatusBadge) {
      el.proofreadStatusBadge.className = `badge-status ${item.status}`;
      el.proofreadStatusBadge.textContent = item.status.toUpperCase();
    }

    if (el.proofreadImg) {
      el.proofreadImg.src = (item.currentView === 'cleaned' && item.cleanedBase64) ? item.cleanedBase64 : item.base64;
      el.proofreadImg.style.transform = `scale(${state.proofreadZoom / 100})`;
    }
    if (el.proofreadZoomText) el.proofreadZoomText.textContent = `${state.proofreadZoom}%`;

    if (el.proofreadJpText) el.proofreadJpText.value = item.ocrText || '';
    if (el.proofreadViText) el.proofreadViText.value = item.viText || '';

    if (el.btnProofreadPrev) el.btnProofreadPrev.disabled = state.proofreadIndex <= 0;
    if (el.btnProofreadNext) el.btnProofreadNext.disabled = state.proofreadIndex >= state.images.length - 1;
  }

  function navigateProofread(step) {
    const nextIdx = state.proofreadIndex + step;
    if (nextIdx >= 0 && nextIdx < state.images.length) {
      state.proofreadIndex = nextIdx;
      state.proofreadZoom = 100;
      renderProofreadCurrentPage();
    }
  }

  function zoomProofread(delta) {
    state.proofreadZoom = Math.max(50, Math.min(300, state.proofreadZoom + delta));
    if (el.proofreadImg) {
      el.proofreadImg.style.transform = `scale(${state.proofreadZoom / 100})`;
    }
    if (el.proofreadZoomText) el.proofreadZoomText.textContent = `${state.proofreadZoom}%`;
  }

  // Tải file nhị phân Blob an toàn (không target=_blank)
  function executeBlobDownload(filename, blob) {
    try {
      if (window.navigator && window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveOrOpenBlob(blob, filename);
        showToast('Đã lưu file: ' + filename);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2000);
      showToast('Đang tải file: ' + filename);
    } catch (err) {
      showToast('Lỗi khi tải file ZIP: ' + err.message);
    }
  }

  // Xuất ZIP ảnh đã tẩy chữ (giữ nguyên tên file gốc)
  async function exportCleanedImagesZip() {
    if (typeof JSZip === 'undefined') {
      showToast('Thư viện nén ZIP chưa tải xong, vui lòng thử lại sau giây lát.');
      return;
    }
    const cleanedItems = state.images.filter(img => !!img.cleanedBase64);
    if (cleanedItems.length === 0) {
      showToast('Chưa có ảnh nào được tẩy chữ! Vui lòng bấm "Tẩy chữ" trước khi xuất.');
      return;
    }

    showToast(`Đang đóng gói ${cleanedItems.length} ảnh đã tẩy vào file ZIP...`);
    const zip = new JSZip();

    cleanedItems.forEach((img) => {
      const b64 = img.cleanedBase64.includes(';base64,')
        ? img.cleanedBase64.split(';base64,').pop()
        : img.cleanedBase64;
      zip.file(img.name, b64, { base64: true });
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const filename = `Manga_Cleaned_Pages_${Date.now()}.zip`;
    executeBlobDownload(filename, blob);
  }

  // Xuất gói ZIP đầy đủ: Ảnh sạch (cleaned_images/) + Kịch bản dịch (.txt)
  async function exportBundleZip() {
    if (typeof JSZip === 'undefined') {
      showToast('Thư viện nén ZIP chưa tải xong, vui lòng thử lại sau giây lát.');
      return;
    }
    const cleanedItems = state.images.filter(img => !!img.cleanedBase64);
    const scriptContent = generateChapterContent();

    if (cleanedItems.length === 0 && (!scriptContent || !scriptContent.trim())) {
      showToast('Chưa có ảnh đã tẩy hoặc bản dịch để xuất gói.');
      return;
    }

    showToast('Đang đóng gói ảnh sạch và kịch bản vào file ZIP...');
    const zip = new JSZip();

    if (cleanedItems.length > 0) {
      const imgFolder = zip.folder('cleaned_images');
      cleanedItems.forEach((img) => {
        const b64 = img.cleanedBase64.includes(';base64,')
          ? img.cleanedBase64.split(';base64,').pop()
          : img.cleanedBase64;
        imgFolder.file(img.name, b64, { base64: true });
      });
    }

    if (scriptContent && scriptContent.trim()) {
      zip.file('chapter_script.txt', '\uFEFF' + scriptContent);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const filename = `Manga_Chapter_Cleaned_Bundle_${Date.now()}.zip`;
    executeBlobDownload(filename, blob);
  }

  // Clear All
  function clearAllBatch() {
    if (state.images.length === 0) return;
    if (confirm('Bạn có chắc muốn xóa toàn bộ danh sách trang hiện tại?')) {
      state.images = [];
      pendingSaves.forEach(({ timer }) => clearTimeout(timer));
      pendingSaves.clear();
      store.clear();
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
    const pageBlocks = [];

    state.images.forEach((img) => {
      let lines = [];
      if (img.dialogues && img.dialogues.length > 0) {
        lines = img.dialogues
          .map(d => (d.vi || d.jp || '').trim())
          .filter(Boolean);
      } else if (img.viText && img.viText.trim()) {
        lines = img.viText
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean);
      } else if (img.ocrText && img.ocrText.trim()) {
        lines = img.ocrText
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean);
      }

      const body = lines.join('\n');
      if (body) {
        pageBlocks.push(`=== ${img.name} ===\n${body}`);
      } else {
        pageBlocks.push(`=== ${img.name} ===`);
      }
    });

    return pageBlocks.join('\n\n') + '\n';
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
    if (el.selectReadingOrder) {
      state.settings.readingOrder = el.selectReadingOrder.value;
      localStorage.setItem('manga_reading_order', state.settings.readingOrder);
    }

    localStorage.setItem('manga_model', state.settings.model);
    localStorage.setItem('manga_api_key', state.settings.apiKey);
    localStorage.setItem('manga_api_key_2', state.settings.apiKey2);
    localStorage.setItem('manga_tone', state.settings.tone);

    if (el.selectCleanModel) {
      state.settings.cleanModel = el.selectCleanModel.value;
      localStorage.setItem('manga_clean_model', state.settings.cleanModel);
    }
    if (el.inputCleanDilation) {
      state.settings.cleanDilation = parseInt(el.inputCleanDilation.value, 10) || 4;
      localStorage.setItem('manga_clean_dilation', state.settings.cleanDilation);
    }
    if (el.inputCleanThreshold) {
      state.settings.cleanThreshold = parseFloat(el.inputCleanThreshold.value) || 0.20;
      localStorage.setItem('manga_clean_threshold', state.settings.cleanThreshold);
    }
    if (el.toggleCleanSFX) {
      state.settings.cleanSFX = el.toggleCleanSFX.checked;
      localStorage.setItem('manga_clean_sfx', state.settings.cleanSFX);
    }

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
