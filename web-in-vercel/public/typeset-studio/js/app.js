/**
 * Manga Studio Typeset Pro - Main Application Controller
 */

import { TypesetEngine } from './typeset-engine.js';

// Global State
const appState = {
  db: null,
  pages: [],
  activePageIndex: 0,
  activeBubbleIndex: -1,
  scale: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  isSpaceDown: false,
  panStartX: 0,
  panStartY: 0,
  isDraggingBubble: false,
  isResizingBubble: false,
  dragHandle: null,
  dragStartX: 0,
  dragStartY: 0,
  initialBubbleRect: null,
  currentImageElement: null,
  displayLang: 'vi', // 'vi' (Vietnamese typeset) or 'jp' (Original Japanese OCR)
  isAiProcessing: false,
  aiSettings: {
    dilationPx: parseInt(localStorage.getItem('manga_clean_dilation') || '8', 10),
    detThreshold: parseFloat(localStorage.getItem('manga_clean_threshold') || '0.18'),
    inpaintModel: localStorage.getItem('manga_clean_model') || 'anime-lama',
    cleanSFX: localStorage.getItem('manga_clean_sfx') === 'true'
  }
};

// DOM Elements
const el = {
  canvas: document.getElementById('typesetCanvas'),
  canvasWrapper: document.getElementById('canvasWrapper'),
  viewport: document.getElementById('viewportContainer'),
  pagesList: document.getElementById('pagesList'),
  pageCounter: document.getElementById('pageCounterLabel'),
  zoomIndicator: document.getElementById('zoomIndicator'),
  activeBubbleBadge: document.getElementById('activeBubbleBadge'),

  // Inspector
  propSrcText: document.getElementById('propSrcText'),
  btnCopyJp: document.getElementById('btnCopyJp'),
  btnTranslateBubble: document.getElementById('btnTranslateBubble'),
  propText: document.getElementById('propText'),
  propFont: document.getElementById('propFont'),
  propAutoFit: document.getElementById('propAutoFit'),
  propFontSize: document.getElementById('propFontSize'),
  valFontSize: document.getElementById('valFontSize'),
  fontSizeRow: document.getElementById('fontSizeRow'),
  propTextColor: document.getElementById('propTextColor'),
  valTextColor: document.getElementById('valTextColor'),
  propStrokeColor: document.getElementById('propStrokeColor'),
  valStrokeColor: document.getElementById('valStrokeColor'),
  propStrokeWidth: document.getElementById('propStrokeWidth'),
  valStrokeWidth: document.getElementById('valStrokeWidth'),
  propLineHeight: document.getElementById('propLineHeight'),
  valLineHeight: document.getElementById('valLineHeight'),
  alignSegmented: document.getElementById('alignSegmented'),
  customFontsOptgroup: document.getElementById('customFontsOptgroup'),
  fontFileInput: document.getElementById('fontFileInput'),

  // Typography Formatting & Bubble Styles
  propBtnBold: document.getElementById('propBtnBold'),
  propBtnItalic: document.getElementById('propBtnItalic'),
  propBtnUppercase: document.getElementById('propBtnUppercase'),
  propVerticalAlign: document.getElementById('propVerticalAlign'),
  propPadding: document.getElementById('propPadding'),
  valPadding: document.getElementById('valPadding'),
  propBgFill: document.getElementById('propBgFill'),
  btnDeleteCurrentPage: document.getElementById('btnDeleteCurrentPage'),

  // Buttons & Controls
  btnPrevPage: document.getElementById('btnPrevPage'),
  btnNextPage: document.getElementById('btnNextPage'),
  btnAutoFitAll: document.getElementById('btnAutoFitAll'),
  btnAiCleanAndBox: document.getElementById('btnAiCleanAndBox'),
  btnAiCleanSettings: document.getElementById('btnAiCleanSettings'),
  aiCleanSettingsPopover: document.getElementById('aiCleanSettingsPopover'),
  btnCloseAiSettings: document.getElementById('btnCloseAiSettings'),
  settingDilation: document.getElementById('settingDilation'),
  valSettingDilation: document.getElementById('valSettingDilation'),
  settingThreshold: document.getElementById('settingThreshold'),
  valSettingThreshold: document.getElementById('valSettingThreshold'),
  settingInpaintModel: document.getElementById('settingInpaintModel'),
  settingCleanSFX: document.getElementById('settingCleanSFX'),
  btnSaveAndReClean: document.getElementById('btnSaveAndReClean'),

  btnToggleViewLang: document.getElementById('btnToggleViewLang'),
  viewLangLabel: document.getElementById('viewLangLabel'),
  btnExportCurrentPng: document.getElementById('btnExportCurrentPng'),
  btnExportFullZip: document.getElementById('btnExportFullZip'),
  btnSyncFromBatch: document.getElementById('btnSyncFromBatch'),
  inputAddLocalImages: document.getElementById('inputAddLocalImages'),
  btnAddBubble: document.getElementById('btnAddBubble'),
  btnDeleteBubble: document.getElementById('btnDeleteBubble'),
  btnZoomIn: document.getElementById('btnZoomIn'),
  btnZoomOut: document.getElementById('btnZoomOut'),
  btnFitScreen: document.getElementById('btnFitScreen'),
  btnUploadFontTrigger: document.getElementById('btnUploadFontTrigger'),
  toastContainer: document.getElementById('toastContainer')
};

const ctx = el.canvas.getContext('2d');

/* ==========================================================================
   Toast Notification Helper
   ========================================================================== */
function showToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  el.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function blobToBase64(blobOrFile) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blobOrFile);
  });
}

function naturalSort(a, b) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

/* ==========================================================================
   IndexedDB Connection (v3)
   ========================================================================== */
const DB_NAME = 'manga_studio_batch';
const DB_VERSION = 3;

async function openDB() {
  if (appState.db) return appState.db;
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      ['pages', 'state', 'cleaned', 'originals', 'typeset'].forEach((name) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      });
    };
    req.onsuccess = () => {
      appState.db = req.result;
      resolve(appState.db);
    };
    req.onerror = () => resolve(null);
  });
}

async function loadDataFromIndexedDB() {
  const db = await openDB();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(['pages', 'state', 'cleaned', 'typeset'], 'readonly');
      const pagesReq = tx.objectStore('pages').getAll();
      const stateReq = tx.objectStore('state').getAll();
      const cleanedReq = tx.objectStore('cleaned').getAll();
      const typesetReq = tx.objectStore('typeset').getAll();

      tx.oncomplete = () => {
        const pages = pagesReq.result || [];
        const stateMap = new Map((stateReq.result || []).map(s => [s.id, s]));
        const cleanedMap = new Map((cleanedReq.result || []).map(c => [c.id, c]));
        const typesetMap = new Map((typesetReq.result || []).map(t => [t.id, t]));

        const combined = pages
          .sort((a, b) => (a.seq || 0) - (b.seq || 0))
          .map((page) => {
            const st = stateMap.get(page.id) || {};
            const cl = cleanedMap.get(page.id) || null;
            const ts = typesetMap.get(page.id) || null;

            // Ưu tiên ảnh đã tẩy sạch bong bóng chat
            let displayBlob = null;
            if (cl && cl.blob) {
              displayBlob = cl.blob;
            } else if (page.base64) {
              displayBlob = page.base64;
            }

            // Danh sách bóng thoại đã lưu hoặc tạo từ text dịch
            let bubbles = [];
            if (ts && Array.isArray(ts.bubbles) && ts.bubbles.length) {
              bubbles = ts.bubbles;
            } else if (Array.isArray(st.bubbles) && st.bubbles.length) {
              bubbles = st.bubbles.map(b => ({
                rawBox: b.box || b.box_2d || null,
                srcText: b.src || b.original_text || '',
                text: b.tgt || b.translated_text || b.text || '',
                font: 'Yuki Arenzi',
                fontSize: 22,
                autoFit: true,
                color: '#000000',
                strokeColor: '#ffffff',
                strokeWidth: 3,
                align: 'center',
                lineHeightRatio: 1.25,
                padding: 8
              }));
            } else if (st.viText) {
              const lines = st.viText.split('\n').map(l => l.trim()).filter(Boolean);
              bubbles = lines.map((line, idx) => ({
                srcText: '',
                text: line,
                font: 'Yuki Arenzi',
                fontSize: 22,
                autoFit: true,
                color: '#000000',
                strokeColor: '#ffffff',
                strokeWidth: 3,
                align: 'center',
                lineHeightRatio: 1.25,
                padding: 8,
                relRect: {
                  xPct: 0.15,
                  yPct: 0.1 + (idx * 0.15) % 0.75,
                  wPct: 0.35,
                  hPct: 0.12
                }
              }));
            }

            return {
              id: page.id,
              name: page.name || `Trang ${page.seq || 1}`,
              base64: page.base64 || (typeof displayBlob === 'string' ? displayBlob : null),
              displayBlob,
              hasCleaned: !!cl,
              hasTranslated: !!st.viText,
              viText: st.viText || '',
              bubbles,
              isLoaded: false
            };
          });

        resolve(combined);
      };
      tx.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

async function saveTypesetToDB(page) {
  const db = await openDB();
  if (!db || !page) return;

  try {
    const tx = db.transaction(['typeset'], 'readwrite');
    tx.objectStore('typeset').put({
      id: page.id,
      bubbles: page.bubbles || [],
      updatedAt: Date.now()
    });
  } catch (e) {
    console.warn('Lỗi lưu typeset vào IndexedDB:', e);
  }
}

/* ==========================================================================
   Direct Upload (Files, ZIP & Drag and Drop)
   ========================================================================== */
async function handleFilesAdded(files) {
  if (!files || !files.length) return;
  const fileList = Array.from(files);
  const newPages = [];
  showToast(`Đang nạp ${fileList.length} tệp...`);

  for (const file of fileList) {
    if (file.name.endsWith('.zip') || file.type.includes('zip')) {
      if (typeof JSZip !== 'undefined') {
        try {
          const zip = await JSZip.loadAsync(file);
          const entries = [];
          zip.forEach((relPath, entry) => {
            if (!entry.dir && !relPath.startsWith('__MACOSX') && /\.(png|jpe?g|webp|bmp)$/i.test(relPath)) {
              entries.push(entry);
            }
          });
          entries.sort(naturalSort);
          for (const entry of entries) {
            const blob = await entry.async('blob');
            const b64 = await blobToBase64(blob);
            newPages.push({
              name: entry.name.split('/').pop(),
              base64: b64,
              displayBlob: b64
            });
          }
        } catch (e) {
          showToast(`Lỗi giải nén ZIP: ${e.message}`);
        }
      }
    } else if (/\.(png|jpe?g|webp|bmp)$/i.test(file.name) || file.type.startsWith('image/')) {
      const b64 = await blobToBase64(file);
      newPages.push({
        name: file.name,
        base64: b64,
        displayBlob: b64
      });
    }
  }

  if (!newPages.length) {
    showToast('Không tìm thấy tệp ảnh hợp lệ.');
    return;
  }

  const db = await openDB();
  const startIndex = appState.pages.length;

  for (let i = 0; i < newPages.length; i++) {
    const p = newPages[i];
    const item = {
      id: 'ts_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '_' + i,
      seq: startIndex + i + 1,
      name: p.name,
      base64: p.base64,
      displayBlob: p.displayBlob,
      bubbles: [],
      hasCleaned: false,
      hasTranslated: false
    };

    if (db) {
      try {
        const tx = db.transaction(['pages', 'state'], 'readwrite');
        tx.objectStore('pages').put({
          id: item.id,
          seq: item.seq,
          name: item.name,
          base64: item.base64,
          sizeStr: 'Mới'
        });
        tx.objectStore('state').put({
          id: item.id,
          status: 'idle',
          cleanStatus: 'idle',
          viText: '',
          ocrText: '',
          bubbles: []
        });
      } catch (e) {}
    }

    appState.pages.push(item);
  }

  renderSidebar();
  updateNavigationUI();
  await switchPage(startIndex);
  showToast(`Đã thêm thành công ${newPages.length} trang mới!`);
}

function setupDirectUploadEvents() {
  if (el.inputAddLocalImages) {
    el.inputAddLocalImages.addEventListener('change', (e) => {
      handleFilesAdded(e.target.files);
      e.target.value = '';
    });
  }

  // Kéo thả ảnh trực tiếp vào màn hình Canvas
  ['dragenter', 'dragover'].forEach(name => {
    el.viewport.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.viewport.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    el.viewport.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.viewport.classList.remove('drag-over');
    });
  });

  el.viewport.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) {
      handleFilesAdded(e.dataTransfer.files);
    }
  });
}

/* ==========================================================================
   Backend AI: Clean Speech Bubbles & Detect Text Coordinates (Comic-Text-Detector)
   ========================================================================== */
async function runBackendCleanAndBox(pageIndex) {
  const page = appState.pages[pageIndex];
  if (!page) return;

  if (appState.isAiProcessing) {
    showToast('Đang có tác vụ AI đang chạy, vui lòng chờ...');
    return;
  }
  appState.isAiProcessing = true;
  el.btnAiCleanAndBox.disabled = true;
  showToast(`[${page.name}] Đang gọi Backend AI xóa chữ bong bóng chat và bắt tọa độ box...`, 4000);

  try {
    // 1. Lấy dữ liệu ảnh dạng base64
    let base64 = page.base64;
    if (!base64 && page.displayBlob) {
      base64 = await blobToBase64(page.displayBlob);
    }
    if (!base64) {
      throw new Error('Không tìm thấy dữ liệu ảnh gốc để xử lý.');
    }

    // 2. Gọi song song /api/clean (xóa chữ) và /api/ocr (bóc tách bounding box theo Comic-Text-Detector + manga-ocr)
    const [cleanRes, ocrRes] = await Promise.all([
      fetch('/api/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          cleanSFX: appState.aiSettings.cleanSFX,
          dilationPx: appState.aiSettings.dilationPx,
          detThreshold: appState.aiSettings.detThreshold,
          inpaintModel: appState.aiSettings.inpaintModel
        })
      }).then(r => r.ok ? r.json() : null).catch(() => null),

      fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          readingOrder: 'manga',
          ocrEngine: 'ja_manga',
          chatOnly: true
        })
      }).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    // 3. Xử lý ảnh sạch (đã xóa chữ trong bong bóng chat)
    if (cleanRes && cleanRes.cleanedImageBase64) {
      page.displayBlob = cleanRes.cleanedImageBase64;
      page.hasCleaned = true;
      const db = await openDB();
      if (db) {
        try {
          const tx = db.transaction(['cleaned'], 'readwrite');
          tx.objectStore('cleaned').put({ id: page.id, blob: cleanRes.cleanedImageBase64 });
        } catch (e) {}
      }
    }

    // 4. Xử lý tọa độ bóng thoại và chữ tiếng Nhật nhận diện được
    const imgW = el.canvas.width || 1000;
    const imgH = el.canvas.height || 1400;

    if (ocrRes && Array.isArray(ocrRes.data) && ocrRes.data.length) {
      page.bubbles = ocrRes.data.map((item, idx) => {
        const box = item.box || [0, 0, 0, 0];
        const [ymin, xmin, ymax, xmax] = box;

        let x, y, width, height;
        if (ymax <= 1000 && xmax <= 1000 && ymin >= 0 && xmin >= 0 && (imgW > 1000 || imgH > 1000)) {
          x = Math.round((xmin / 1000) * imgW);
          y = Math.round((ymin / 1000) * imgH);
          width = Math.max(30, Math.round(((xmax - xmin) / 1000) * imgW));
          height = Math.max(25, Math.round(((ymax - ymin) / 1000) * imgH));
        } else {
          x = Math.round(xmin);
          y = Math.round(ymin);
          width = Math.max(30, Math.round(xmax - xmin));
          height = Math.max(25, Math.round(ymax - ymin));
        }

        return {
          id: item.id || idx + 1,
          x,
          y,
          width,
          height,
          srcText: item.original_text || '',
          text: item.translated_text || '',
          font: 'Yuki Arenzi',
          fontSize: 22,
          autoFit: true,
          color: '#000000',
          strokeColor: '#ffffff',
          strokeWidth: 3,
          align: 'center',
          verticalAlign: 'middle',
          lineHeightRatio: 1.25,
          padding: 8,
          bgFill: 'transparent',
          isBold: false,
          isItalic: false,
          isUppercase: false
        };
      });
      showToast(`Backend AI đã xóa chữ và bắt được ${page.bubbles.length} bóng thoại!`);
    } else {
      showToast('Backend AI đã xử lý xong (không tìm thấy bóng thoại mới).');
    }

    // 5. Cập nhật IndexedDB và vẽ lại giao diện
    await saveTypesetToDB(page);
    appState.activeBubbleIndex = page.bubbles && page.bubbles.length ? 0 : -1;
    await switchPage(pageIndex, true);
  } catch (err) {
    showToast(`Lỗi xử lý Backend AI: ${err.message || err}`);
  } finally {
    appState.isAiProcessing = false;
    el.btnAiCleanAndBox.disabled = false;
  }
}

/* ==========================================================================
   Image Loader & Canvas Rendering
   ========================================================================== */
function loadImageElement(blobOrBase64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);

    if (blobOrBase64 instanceof Blob) {
      img.src = URL.createObjectURL(blobOrBase64);
    } else if (typeof blobOrBase64 === 'string') {
      img.src = blobOrBase64;
    } else {
      resolve(null);
    }
  });
}

async function switchPage(index, preserveBubble = false) {
  if (index < 0 || index >= appState.pages.length) return;
  appState.activePageIndex = index;
  if (!preserveBubble) {
    appState.activeBubbleIndex = -1;
  }

  updateNavigationUI();
  renderSidebar();

  const page = appState.pages[index];
  if (!page) return;

  const img = await loadImageElement(page.displayBlob);
  appState.currentImageElement = img;

  if (img) {
    el.canvas.width = img.naturalWidth || 1000;
    el.canvas.height = img.naturalHeight || 1400;
    initPageBubblesCoordinates(page, el.canvas.width, el.canvas.height);
    fitCanvasToScreen();
  }

  updateInspector();
  renderCanvas();
}

function initPageBubblesCoordinates(page, imgW, imgH) {
  if (!page.bubbles) page.bubbles = [];

  page.bubbles.forEach((b, idx) => {
    if (b.rawBox && Array.isArray(b.rawBox)) {
      const [ymin, xmin, ymax, xmax] = b.rawBox;
      b.x = Math.round((xmin / 1000) * imgW);
      b.y = Math.round((ymin / 1000) * imgH);
      b.width = Math.max(40, Math.round(((xmax - xmin) / 1000) * imgW));
      b.height = Math.max(30, Math.round(((ymax - ymin) / 1000) * imgH));
      delete b.rawBox;
    } else if (b.relRect) {
      b.x = Math.round(b.relRect.xPct * imgW);
      b.y = Math.round(b.relRect.yPct * imgH);
      b.width = Math.round(b.relRect.wPct * imgW);
      b.height = Math.round(b.relRect.hPct * imgH);
      delete b.relRect;
    } else if (b.x == null) {
      b.x = Math.round(imgW * 0.2);
      b.y = Math.round(imgH * (0.15 + (idx * 0.15) % 0.65));
      b.width = Math.round(imgW * 0.35);
      b.height = Math.round(imgH * 0.12);
    }
  });
}

function renderCanvas() {
  const img = appState.currentImageElement;

  ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);

  if (img) {
    ctx.drawImage(img, 0, 0, el.canvas.width, el.canvas.height);
  } else {
    ctx.fillStyle = '#1e2330';
    ctx.fillRect(0, 0, el.canvas.width, el.canvas.height);
  }

  const activePage = appState.pages[appState.activePageIndex];
  if (!activePage || !activePage.bubbles) return;

  activePage.bubbles.forEach((bubble) => {
    TypesetEngine.renderBubble(ctx, bubble, { displayLang: appState.displayLang });
  });

  if (appState.activeBubbleIndex >= 0 && appState.activeBubbleIndex < activePage.bubbles.length) {
    const sel = activePage.bubbles[appState.activeBubbleIndex];
    drawSelectionHandles(ctx, sel);
  }
}

function drawSelectionHandles(ctx, bubble) {
  const { x, y, width, height } = bubble;
  ctx.save();

  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, width, height);

  const handleSize = 8;
  const handles = getResizeHandles(bubble);

  ctx.setLineDash([]);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#4f46e5';
  ctx.lineWidth = 1.5;

  Object.values(handles).forEach(h => {
    ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
  });

  ctx.restore();
}

function getResizeHandles(bubble) {
  const { x, y, width, height } = bubble;
  return {
    nw: { x, y, cursor: 'nwse-resize' },
    n: { x: x + width / 2, y, cursor: 'ns-resize' },
    ne: { x: x + width, y, cursor: 'nesw-resize' },
    e: { x: x + width, y: y + height / 2, cursor: 'ew-resize' },
    se: { x: x + width, y: y + height, cursor: 'nwse-resize' },
    s: { x: x + width / 2, y, cursor: 'ns-resize' },
    sw: { x, y: y + height, cursor: 'nesw-resize' },
    w: { x, y: y + height / 2, cursor: 'ew-resize' }
  };
}

/* ==========================================================================
   Viewport Controls: Zoom, Pan & Fit Screen
   ========================================================================== */
function applyTransform() {
  el.canvasWrapper.style.transform = `translate(${appState.panX}px, ${appState.panY}px) scale(${appState.scale})`;
  el.zoomIndicator.textContent = `${Math.round(appState.scale * 100)}%`;
}

function fitCanvasToScreen() {
  if (!el.canvas.width || !el.canvas.height) return;
  const containerW = el.viewport.clientWidth;
  const containerH = el.viewport.clientHeight;

  const scaleX = (containerW - 80) / el.canvas.width;
  const scaleY = (containerH - 80) / el.canvas.height;
  appState.scale = Math.min(1.5, Math.max(0.2, Math.min(scaleX, scaleY)));
  appState.panX = 0;
  appState.panY = 0;
  applyTransform();
}

/* ==========================================================================
   Canvas Mouse & Gesture Interaction
   ========================================================================== */
function getCanvasCoords(e) {
  const rect = el.canvas.getBoundingClientRect();
  const scaleX = el.canvas.width / rect.width;
  const scaleY = el.canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function hitTestHandle(bubble, mouseX, mouseY) {
  if (!bubble) return null;
  const handles = getResizeHandles(bubble);
  const threshold = 10 / appState.scale;

  for (const [key, h] of Object.entries(handles)) {
    if (Math.abs(mouseX - h.x) <= threshold && Math.abs(mouseY - h.y) <= threshold) {
      return key;
    }
  }
  return null;
}

function hitTestBubble(bubbles, mouseX, mouseY) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (mouseX >= b.x && mouseX <= b.x + b.width && mouseY >= b.y && mouseY <= b.y + b.height) {
      return i;
    }
  }
  return -1;
}

el.viewport.addEventListener('mousedown', (e) => {
  if (e.target.closest('.viewport-floating-bar') || e.target.closest('.ai-clean-settings-popover')) return;

  // Spacebar pan, middle-click pan, or right-click pan:
  if (appState.isSpaceDown || e.button === 1 || e.button === 2) {
    appState.isPanning = true;
    appState.panStartX = e.clientX - appState.panX;
    appState.panStartY = e.clientY - appState.panY;
    el.viewport.classList.add('panning');
    return;
  }

  if (e.button !== 0) return;

  // Left-click on viewport background outside canvas:
  if (e.target === el.viewport) {
    appState.isPanning = true;
    appState.panStartX = e.clientX - appState.panX;
    appState.panStartY = e.clientY - appState.panY;
    el.viewport.classList.add('panning');
    appState.activeBubbleIndex = -1;
    updateInspector();
    renderCanvas();
    return;
  }

  const coords = getCanvasCoords(e);
  const page = appState.pages[appState.activePageIndex];
  if (!page || !page.bubbles) {
    appState.isPanning = true;
    appState.panStartX = e.clientX - appState.panX;
    appState.panStartY = e.clientY - appState.panY;
    el.viewport.classList.add('panning');
    return;
  }

  // 1. Check if clicking on an active bubble resize handle
  if (appState.activeBubbleIndex >= 0) {
    const activeBubble = page.bubbles[appState.activeBubbleIndex];
    const handle = hitTestHandle(activeBubble, coords.x, coords.y);
    if (handle) {
      appState.isResizingBubble = true;
      appState.dragHandle = handle;
      appState.dragStartX = coords.x;
      appState.dragStartY = coords.y;
      appState.initialBubbleRect = { ...activeBubble };
      return;
    }
  }

  // 2. Check if clicking on any bubble to select/drag it
  const hitIndex = hitTestBubble(page.bubbles, coords.x, coords.y);
  if (hitIndex >= 0) {
    appState.activeBubbleIndex = hitIndex;
    appState.isDraggingBubble = true;
    appState.dragStartX = coords.x;
    appState.dragStartY = coords.y;
    appState.initialBubbleRect = { ...page.bubbles[hitIndex] };
    updateInspector();
    renderCanvas();
    return;
  }

  // 3. Clicked on empty area of canvas -> Start Panning directly for easy image navigation!
  appState.isPanning = true;
  appState.panStartX = e.clientX - appState.panX;
  appState.panStartY = e.clientY - appState.panY;
  el.viewport.classList.add('panning');

  appState.activeBubbleIndex = -1;
  updateInspector();
  renderCanvas();
});

// Prevent context menu on viewport (enables smooth right-click panning)
el.viewport.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input, textarea')) return;
  e.preventDefault();
});

// Spacebar drag navigation
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;

  if (e.code === 'Space' && !appState.isSpaceDown) {
    e.preventDefault();
    appState.isSpaceDown = true;
    el.viewport.classList.add('space-pressed');
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    appState.isSpaceDown = false;
    el.viewport.classList.remove('space-pressed');
  }
});

window.addEventListener('blur', () => {
  appState.isSpaceDown = false;
  appState.isPanning = false;
  el.viewport.classList.remove('space-pressed');
  el.viewport.classList.remove('panning');
});

window.addEventListener('mousemove', (e) => {
  if (appState.isPanning) {
    appState.panX = e.clientX - appState.panStartX;
    appState.panY = e.clientY - appState.panStartY;
    applyTransform();
    return;
  }

  if (appState.isSpaceDown) {
    el.canvas.style.cursor = 'grab';
    return;
  }

  const coords = getCanvasCoords(e);
  const page = appState.pages[appState.activePageIndex];
  if (!page || !page.bubbles) return;

  if (appState.activeBubbleIndex >= 0) {
    const activeBubble = page.bubbles[appState.activeBubbleIndex];
    const handle = hitTestHandle(activeBubble, coords.x, coords.y);
    if (handle) {
      el.canvas.style.cursor = getResizeHandles(activeBubble)[handle].cursor;
    } else if (hitTestBubble(page.bubbles, coords.x, coords.y) === appState.activeBubbleIndex) {
      el.canvas.style.cursor = 'move';
    } else {
      el.canvas.style.cursor = 'default';
    }
  } else {
    el.canvas.style.cursor = hitTestBubble(page.bubbles, coords.x, coords.y) >= 0 ? 'pointer' : 'default';
  }

  if (appState.isDraggingBubble && appState.activeBubbleIndex >= 0) {
    const dx = coords.x - appState.dragStartX;
    const dy = coords.y - appState.dragStartY;
    const b = page.bubbles[appState.activeBubbleIndex];
    b.x = Math.round(appState.initialBubbleRect.x + dx);
    b.y = Math.round(appState.initialBubbleRect.y + dy);
    renderCanvas();
    return;
  }

  if (appState.isResizingBubble && appState.activeBubbleIndex >= 0) {
    const dx = coords.x - appState.dragStartX;
    const dy = coords.y - appState.dragStartY;
    const b = page.bubbles[appState.activeBubbleIndex];
    const init = appState.initialBubbleRect;
    const h = appState.dragHandle;

    if (h.includes('e')) b.width = Math.max(30, init.width + dx);
    if (h.includes('s')) b.height = Math.max(25, init.height + dy);
    if (h.includes('w')) {
      const newW = Math.max(30, init.width - dx);
      b.x = init.x + (init.width - newW);
      b.width = newW;
    }
    if (h.includes('n')) {
      const newH = Math.max(25, init.height - dy);
      b.y = init.y + (init.height - newH);
      b.height = newH;
    }

    renderCanvas();
  }
});

window.addEventListener('mouseup', () => {
  if (appState.isPanning) {
    appState.isPanning = false;
    el.viewport.classList.remove('panning');
  }
  if (appState.isDraggingBubble || appState.isResizingBubble) {
    appState.isDraggingBubble = false;
    appState.isResizingBubble = false;
    const page = appState.pages[appState.activePageIndex];
    if (page) saveTypesetToDB(page);
  }
});

// Focal-point zoom with mouse wheel
el.viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
  const oldScale = appState.scale;
  const newScale = Math.min(5.0, Math.max(0.15, oldScale * zoomFactor));
  if (newScale === oldScale) return;

  const rect = el.viewport.getBoundingClientRect();
  const relX = (e.clientX - rect.left) - rect.width / 2;
  const relY = (e.clientY - rect.top) - rect.height / 2;

  // Anchor the point under cursor
  appState.panX = relX - (relX - appState.panX) * (newScale / oldScale);
  appState.panY = relY - (relY - appState.panY) * (newScale / oldScale);
  appState.scale = newScale;

  applyTransform();
}, { passive: false });

/* ==========================================================================
   Property Inspector Sync
   ========================================================================== */
function updateInspector() {
  const page = appState.pages[appState.activePageIndex];
  if (!page || appState.activeBubbleIndex < 0 || !page.bubbles[appState.activeBubbleIndex]) {
    el.activeBubbleBadge.textContent = 'Chưa chọn';
    el.propSrcText.value = '';
    el.propSrcText.disabled = true;
    el.btnCopyJp.disabled = true;
    el.btnTranslateBubble.disabled = true;
    el.propText.value = '';
    el.propText.disabled = true;
    el.propFont.disabled = true;
    el.propAutoFit.disabled = true;
    el.propFontSize.disabled = true;
    el.propTextColor.disabled = true;
    el.propStrokeColor.disabled = true;
    el.propStrokeWidth.disabled = true;
    el.propLineHeight.disabled = true;
    if (el.propBtnBold) el.propBtnBold.disabled = true;
    if (el.propBtnItalic) el.propBtnItalic.disabled = true;
    if (el.propBtnUppercase) el.propBtnUppercase.disabled = true;
    if (el.propVerticalAlign) el.propVerticalAlign.disabled = true;
    if (el.propPadding) el.propPadding.disabled = true;
    if (el.propBgFill) el.propBgFill.disabled = true;
    return;
  }

  const b = page.bubbles[appState.activeBubbleIndex];
  el.activeBubbleBadge.textContent = `Thoại #${appState.activeBubbleIndex + 1}`;

  el.propSrcText.disabled = false;
  el.btnCopyJp.disabled = false;
  el.btnTranslateBubble.disabled = false;
  el.propText.disabled = false;
  el.propFont.disabled = false;
  el.propAutoFit.disabled = false;
  el.propFontSize.disabled = false;
  el.propTextColor.disabled = false;
  el.propStrokeColor.disabled = false;
  el.propStrokeWidth.disabled = false;
  el.propLineHeight.disabled = false;
  if (el.propBtnBold) el.propBtnBold.disabled = false;
  if (el.propBtnItalic) el.propBtnItalic.disabled = false;
  if (el.propBtnUppercase) el.propBtnUppercase.disabled = false;
  if (el.propVerticalAlign) el.propVerticalAlign.disabled = false;
  if (el.propPadding) el.propPadding.disabled = false;
  if (el.propBgFill) el.propBgFill.disabled = false;

  el.propSrcText.value = b.srcText || '';
  el.propText.value = b.text || '';
  el.propFont.value = b.font || 'Yuki Arenzi';
  el.propAutoFit.checked = b.autoFit !== false;
  el.fontSizeRow.style.opacity = b.autoFit !== false ? '0.4' : '1';
  el.propFontSize.value = b.fontSize || 22;
  el.valFontSize.textContent = `${b.fontSize || 22}px`;

  el.propTextColor.value = b.color || '#000000';
  el.valTextColor.textContent = b.color || '#000000';

  el.propStrokeColor.value = b.strokeColor || '#ffffff';
  el.valStrokeColor.textContent = b.strokeColor || '#ffffff';

  el.propStrokeWidth.value = b.strokeWidth != null ? b.strokeWidth : 3;
  el.valStrokeWidth.textContent = `${b.strokeWidth != null ? b.strokeWidth : 3}px`;

  el.propLineHeight.value = b.lineHeightRatio || 1.25;
  el.valLineHeight.textContent = String(b.lineHeightRatio || 1.25);

  document.querySelectorAll('#alignSegmented .btn-seg').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.align === (b.align || 'center'));
  });

  if (el.propBtnBold) el.propBtnBold.classList.toggle('active', !!b.isBold);
  if (el.propBtnItalic) el.propBtnItalic.classList.toggle('active', !!b.isItalic);
  if (el.propBtnUppercase) el.propBtnUppercase.classList.toggle('active', !!b.isUppercase);
  if (el.propVerticalAlign) el.propVerticalAlign.value = b.verticalAlign || 'middle';
  if (el.propPadding) {
    el.propPadding.value = b.padding != null ? b.padding : 8;
    if (el.valPadding) el.valPadding.textContent = `${b.padding != null ? b.padding : 8}px`;
  }
  if (el.propBgFill) el.propBgFill.value = b.bgFill || 'transparent';
}

function bindInspectorEvents() {
  const getActiveBubble = () => {
    const page = appState.pages[appState.activePageIndex];
    return (page && appState.activeBubbleIndex >= 0) ? page.bubbles[appState.activeBubbleIndex] : null;
  };

  el.propSrcText.addEventListener('input', (e) => {
    const b = getActiveBubble();
    if (!b) return;
    b.srcText = e.target.value;
    if (appState.displayLang === 'jp') renderCanvas();
    saveTypesetToDB(appState.pages[appState.activePageIndex]);
  });

  el.btnCopyJp.addEventListener('click', () => {
    const text = el.propSrcText.value;
    if (!text) {
      showToast('Chưa có chữ tiếng Nhật để sao chép.');
      return;
    }
    navigator.clipboard.writeText(text).then(() => showToast('Đã sao chép tiếng Nhật!'));
  });

  el.btnTranslateBubble.addEventListener('click', async () => {
    const b = getActiveBubble();
    if (!b || !b.srcText) {
      showToast('Không có chữ tiếng Nhật để dịch.');
      return;
    }
    showToast('Đang dịch tiếng Nhật sang tiếng Việt...');
    try {
      const res = await fetch('/api/translate-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: b.srcText, sourceLang: 'ja', targetLang: 'vi' })
      });
      const data = await res.json();
      if (data && data.translatedText) {
        b.text = data.translatedText;
        el.propText.value = b.text;
        renderCanvas();
        saveTypesetToDB(appState.pages[appState.activePageIndex]);
        showToast('Đã dịch xong!');
      } else {
        showToast('Không nhận được bản dịch từ API.');
      }
    } catch (err) {
      showToast(`Lỗi dịch: ${err.message || err}`);
    }
  });

  el.propText.addEventListener('input', (e) => {
    const b = getActiveBubble();
    if (!b) return;
    b.text = e.target.value;
    if (appState.displayLang === 'vi') renderCanvas();
    saveTypesetToDB(appState.pages[appState.activePageIndex]);
  });

  el.propFont.addEventListener('change', (e) => {
    const b = getActiveBubble();
    if (!b) return;
    b.font = e.target.value;
    renderCanvas();
    saveTypesetToDB(appState.pages[appState.activePageIndex]);
  });

  el.propAutoFit.addEventListener('change', (e) => {
    const b = getActiveBubble();
    if (!b) return;
    b.autoFit = e.target.checked;
    el.fontSizeRow.style.opacity = b.autoFit ? '0.4' : '1';
    renderCanvas();
    saveTypesetToDB(appState.pages[appState.activePageIndex]);
  });

  el.propFontSize.addEventListener('input', (e) => {
    const b = getActiveBubble();
    if (!b) return;
    b.fontSize = parseInt(e.target.value, 10);
    el.valFontSize.textContent = `${b.fontSize}px`;
    renderCanvas();
    saveTypesetToDB(appState.pages[appState.activePageIndex]);
  });

  el.propTextColor.addEventListener('input', (e) => {
    const b = getActiveBubble();
    if (!b) return;
    b.color = e.target.value;
    el.valTextColor.textContent = e.target.value;
    renderCanvas();
    saveTypesetToDB(appState.pages[appState.activePageIndex]);
  });

  el.propStrokeColor.addEventListener('input', (e) => {
    const b = getActiveBubble();
    if (!b) return;
    b.strokeColor = e.target.value;
    el.valStrokeColor.textContent = e.target.value;
    renderCanvas();
    saveTypesetToDB(appState.pages[appState.activePageIndex]);
  });

  el.propStrokeWidth.addEventListener('input', (e) => {
    const b = getActiveBubble();
    if (!b) return;
    b.strokeWidth = parseFloat(e.target.value);
    el.valStrokeWidth.textContent = `${b.strokeWidth}px`;
    renderCanvas();
    saveTypesetToDB(appState.pages[appState.activePageIndex]);
  });

  el.propLineHeight.addEventListener('input', (e) => {
    const b = getActiveBubble();
    if (!b) return;
    b.lineHeightRatio = parseFloat(e.target.value);
    el.valLineHeight.textContent = String(b.lineHeightRatio);
    renderCanvas();
    saveTypesetToDB(appState.pages[appState.activePageIndex]);
  });

  document.querySelectorAll('#alignSegmented .btn-seg').forEach(btn => {
    btn.addEventListener('click', () => {
      const b = getActiveBubble();
      if (!b) return;
      b.align = btn.dataset.align;
      document.querySelectorAll('#alignSegmented .btn-seg').forEach(x => x.classList.remove('active'));
      btn.classList.add('active');
      renderCanvas();
      saveTypesetToDB(appState.pages[appState.activePageIndex]);
    });
  });

  // Typography Formatting Toolbar Events
  if (el.propBtnBold) {
    el.propBtnBold.addEventListener('click', () => {
      const b = getActiveBubble();
      if (!b) return;
      b.isBold = !b.isBold;
      el.propBtnBold.classList.toggle('active', !!b.isBold);
      renderCanvas();
      saveTypesetToDB(appState.pages[appState.activePageIndex]);
    });
  }

  if (el.propBtnItalic) {
    el.propBtnItalic.addEventListener('click', () => {
      const b = getActiveBubble();
      if (!b) return;
      b.isItalic = !b.isItalic;
      el.propBtnItalic.classList.toggle('active', !!b.isItalic);
      renderCanvas();
      saveTypesetToDB(appState.pages[appState.activePageIndex]);
    });
  }

  if (el.propBtnUppercase) {
    el.propBtnUppercase.addEventListener('click', () => {
      const b = getActiveBubble();
      if (!b) return;
      b.isUppercase = !b.isUppercase;
      el.propBtnUppercase.classList.toggle('active', !!b.isUppercase);
      renderCanvas();
      saveTypesetToDB(appState.pages[appState.activePageIndex]);
    });
  }

  if (el.propVerticalAlign) {
    el.propVerticalAlign.addEventListener('change', (e) => {
      const b = getActiveBubble();
      if (!b) return;
      b.verticalAlign = e.target.value;
      renderCanvas();
      saveTypesetToDB(appState.pages[appState.activePageIndex]);
    });
  }

  if (el.propPadding) {
    el.propPadding.addEventListener('input', (e) => {
      const b = getActiveBubble();
      if (!b) return;
      b.padding = parseInt(e.target.value, 10);
      if (el.valPadding) el.valPadding.textContent = `${b.padding}px`;
      renderCanvas();
      saveTypesetToDB(appState.pages[appState.activePageIndex]);
    });
  }

  if (el.propBgFill) {
    el.propBgFill.addEventListener('change', (e) => {
      const b = getActiveBubble();
      if (!b) return;
      b.bgFill = e.target.value;
      renderCanvas();
      saveTypesetToDB(appState.pages[appState.activePageIndex]);
    });
  }

  if (el.btnDeleteCurrentPage) {
    el.btnDeleteCurrentPage.addEventListener('click', () => {
      deletePage(appState.activePageIndex);
    });
  }
}

/* ==========================================================================
   Custom Font Upload
   ========================================================================== */
function setupCustomFontUpload() {
  el.btnUploadFontTrigger.addEventListener('click', () => el.fontFileInput.click());

  el.fontFileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const fontName = file.name.replace(/\.[^/.]+$/, '').trim();
      const buffer = await file.arrayBuffer();
      const fontFace = new FontFace(fontName, buffer);
      await fontFace.load();
      document.fonts.add(fontFace);

      const opt = document.createElement('option');
      opt.value = fontName;
      opt.textContent = `${fontName} (Tùy chỉnh)`;
      el.customFontsOptgroup.appendChild(opt);
      el.propFont.value = fontName;

      const page = appState.pages[appState.activePageIndex];
      if (page && appState.activeBubbleIndex >= 0) {
        page.bubbles[appState.activeBubbleIndex].font = fontName;
        renderCanvas();
        saveTypesetToDB(page);
      }

      showToast(`Đã nạp font thành công: ${fontName}`);
    } catch (err) {
      showToast(`Lỗi nạp font: ${err.message || 'Font không hợp lệ'}`);
    }
  });
}

/* ==========================================================================
   Add / Delete Bubble & Toggle Language View
   ========================================================================== */
function setupBubbleActions() {
  el.btnAddBubble.addEventListener('click', () => {
    const page = appState.pages[appState.activePageIndex];
    if (!page) return;

    if (!page.bubbles) page.bubbles = [];
    const newBubble = {
      x: Math.round(el.canvas.width * 0.35),
      y: Math.round(el.canvas.height * 0.35),
      width: Math.round(el.canvas.width * 0.3),
      height: Math.round(el.canvas.height * 0.12),
      srcText: '新しいテキスト',
      text: 'Lời thoại mới',
      font: 'Yuki Arenzi',
      fontSize: 22,
      autoFit: true,
      color: '#000000',
      strokeColor: '#ffffff',
      strokeWidth: 3,
      align: 'center',
      lineHeightRatio: 1.25,
      padding: 8
    };

    page.bubbles.push(newBubble);
    appState.activeBubbleIndex = page.bubbles.length - 1;
    updateInspector();
    renderCanvas();
    saveTypesetToDB(page);
    showToast('Đã thêm bóng thoại mới');
  });

  const deleteActiveBubble = () => {
    const page = appState.pages[appState.activePageIndex];
    if (!page || appState.activeBubbleIndex < 0 || !page.bubbles[appState.activeBubbleIndex]) return;

    page.bubbles.splice(appState.activeBubbleIndex, 1);
    appState.activeBubbleIndex = -1;
    updateInspector();
    renderCanvas();
    saveTypesetToDB(page);
    showToast('Đã xóa bóng thoại');
  };

  el.btnDeleteBubble.addEventListener('click', deleteActiveBubble);

  // Toggle View Language (Dịch VI vs Gốc JP)
  if (el.btnToggleViewLang) {
    el.btnToggleViewLang.addEventListener('click', () => {
      appState.displayLang = appState.displayLang === 'vi' ? 'jp' : 'vi';
      if (el.viewLangLabel) {
        el.viewLangLabel.textContent = appState.displayLang === 'vi' ? 'Xem: Dịch (VI)' : 'Xem: Gốc (JP)';
      }
      renderCanvas();
      showToast(`Đang hiển thị chế độ: ${appState.displayLang === 'vi' ? 'Bản dịch tiếng Việt' : 'Tiếng Nhật gốc'}`);
    });
  }

  // Phím tắt bàn phím
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Del') && document.activeElement !== el.propText && document.activeElement !== el.propSrcText) {
      deleteActiveBubble();
    }
    if (document.activeElement !== el.propText && document.activeElement !== el.propSrcText) {
      if (e.key === 'ArrowLeft') switchPage(appState.activePageIndex - 1);
      if (e.key === 'ArrowRight') switchPage(appState.activePageIndex + 1);
    }
  });

  // Nút Tự căn chữ tất cả
  el.btnAutoFitAll.addEventListener('click', () => {
    const page = appState.pages[appState.activePageIndex];
    if (!page || !page.bubbles || !page.bubbles.length) return;

    page.bubbles.forEach(b => {
      b.autoFit = true;
    });
    updateInspector();
    renderCanvas();
    saveTypesetToDB(page);
    showToast(`Đã tự động căn chữ cho ${page.bubbles.length} bóng thoại`);
  });

  // Nút Tẩy chữ & Bắt Box AI (Backend)
  if (el.btnAiCleanAndBox) {
    el.btnAiCleanAndBox.addEventListener('click', () => {
      runBackendCleanAndBox(appState.activePageIndex);
    });
  }
}

/* ==========================================================================
   UI Updates: Sidebar & Navigation & Page Deletion
   ========================================================================== */
function updateNavigationUI() {
  const total = appState.pages.length;
  const current = total > 0 ? appState.activePageIndex + 1 : 0;
  el.pageCounter.innerHTML = `Trang <b>${current} / ${total}</b>`;
  el.btnPrevPage.disabled = appState.activePageIndex <= 0;
  el.btnNextPage.disabled = appState.activePageIndex >= total - 1;
}

async function deletePage(idx) {
  if (idx < 0 || idx >= appState.pages.length) return;
  const page = appState.pages[idx];
  const pageName = page.name || `Trang ${idx + 1}`;

  const db = await openDB();
  if (db) {
    try {
      const tx = db.transaction(['pages', 'state', 'cleaned', 'typeset'], 'readwrite');
      tx.objectStore('pages').delete(page.id);
      tx.objectStore('state').delete(page.id);
      try { tx.objectStore('cleaned').delete(page.id); } catch(e) {}
      try { tx.objectStore('typeset').delete(page.id); } catch(e) {}
    } catch (e) {
      console.warn('DB delete error:', e);
    }
  }

  appState.pages.splice(idx, 1);
  appState.pages.forEach((p, i) => { p.seq = i + 1; });

  if (appState.pages.length === 0) {
    appState.activePageIndex = 0;
    appState.activeBubbleIndex = -1;
    appState.currentImageElement = null;
    const c = el.canvas.getContext('2d');
    c.clearRect(0, 0, el.canvas.width, el.canvas.height);
    updateNavigationUI();
    renderSidebar();
    updateInspector();
    renderCanvas();
    showToast(`Đã xóa ${pageName}. Hiện không còn trang nào.`);
    return;
  }

  let nextIndex = appState.activePageIndex;
  if (idx <= appState.activePageIndex) {
    nextIndex = Math.max(0, appState.activePageIndex - 1);
  }
  if (nextIndex >= appState.pages.length) {
    nextIndex = appState.pages.length - 1;
  }

  showToast(`Đã xóa ${pageName}`);
  await switchPage(nextIndex);
}

function renderSidebar() {
  el.pagesList.innerHTML = '';
  appState.pages.forEach((page, idx) => {
    const card = document.createElement('div');
    card.className = `page-thumb-card ${idx === appState.activePageIndex ? 'active' : ''}`;

    const img = document.createElement('img');
    img.className = 'page-thumb-img';
    if (page.displayBlob instanceof Blob) {
      img.src = URL.createObjectURL(page.displayBlob);
    } else if (page.displayBlob) {
      img.src = page.displayBlob;
    }

    const info = document.createElement('div');
    info.className = 'page-thumb-info';
    info.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="page-thumb-title">Trang ${idx + 1} (${page.name || ''})</div>
        <button type="button" class="btn-delete-page" title="Xóa trang này" data-index="${idx}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
      <div class="page-thumb-badges">
        ${page.hasCleaned ? '<span class="mini-badge mini-badge-cleaned">Đã tẩy</span>' : ''}
        ${page.hasTranslated ? '<span class="mini-badge mini-badge-translated">Đã dịch</span>' : ''}
        ${page.bubbles && page.bubbles.length ? `<span class="mini-badge mini-badge-typeset">${page.bubbles.length} thoại</span>` : ''}
      </div>
    `;

    card.appendChild(img);
    card.appendChild(info);

    const btnDel = info.querySelector('.btn-delete-page');
    if (btnDel) {
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePage(idx);
      });
    }

    card.addEventListener('click', () => switchPage(idx));
    el.pagesList.appendChild(card);
  });
}

/* ==========================================================================
   Export Features: Single PNG & Full Chapter ZIP
   ========================================================================== */
function triggerDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportCurrentPagePNG() {
  const page = appState.pages[appState.activePageIndex];
  if (!page) {
    showToast('Chưa có trang nào để xuất.');
    return;
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = (appState.currentImageElement && appState.currentImageElement.naturalWidth) || el.canvas.width || 1000;
  offscreen.height = (appState.currentImageElement && appState.currentImageElement.naturalHeight) || el.canvas.height || 1400;
  const octx = offscreen.getContext('2d');

  if (appState.currentImageElement) {
    octx.drawImage(appState.currentImageElement, 0, 0, offscreen.width, offscreen.height);
  } else {
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, offscreen.width, offscreen.height);
  }

  if (page.bubbles) {
    page.bubbles.forEach(b => TypesetEngine.renderBubble(octx, b, { displayLang: appState.displayLang }));
  }

  offscreen.toBlob((blob) => {
    if (blob) {
      const filename = `${page.name || `page_${appState.activePageIndex + 1}`}.png`;
      triggerDownloadBlob(blob, filename);
      showToast(`Đã xuất ảnh: ${filename}`);
    }
  }, 'image/png');
}

async function exportFullChapterZIP() {
  if (!appState.pages.length) {
    showToast('Chưa có trang truyện nào.');
    return;
  }

  if (typeof JSZip === 'undefined') {
    showToast('Lỗi: Thư viện JSZip chưa tải xong.');
    return;
  }

  const zip = new JSZip();
  showToast('Đang kết xuất và đóng gói file ZIP...');

  try {
    for (let i = 0; i < appState.pages.length; i++) {
      const page = appState.pages[i];
      showToast(`Đang kết xuất trang ${i + 1} / ${appState.pages.length}...`, 1000);

      const img = await loadImageElement(page.displayBlob);

      const offscreen = document.createElement('canvas');
      offscreen.width = (img && img.naturalWidth) || 1000;
      offscreen.height = (img && img.naturalHeight) || 1400;
      const octx = offscreen.getContext('2d');

      if (img) {
        octx.drawImage(img, 0, 0, offscreen.width, offscreen.height);
      } else {
        octx.fillStyle = '#ffffff';
        octx.fillRect(0, 0, offscreen.width, offscreen.height);
      }
      initPageBubblesCoordinates(page, offscreen.width, offscreen.height);

      if (page.bubbles) {
        page.bubbles.forEach(b => TypesetEngine.renderBubble(octx, b, { displayLang: appState.displayLang }));
      }

      const blob = await new Promise(res => offscreen.toBlob(res, 'image/png'));
      if (blob) {
        const paddedIndex = String(i + 1).padStart(3, '0');
        const filename = `${paddedIndex}_${page.name || 'page'}.png`;
        zip.file(filename, blob);
      }
    }

    showToast('Đang nén file ZIP...');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    triggerDownloadBlob(zipBlob, `manga_typeset_chapter_${Date.now()}.zip`);
    showToast('Xuất ZIP truyện hoàn chỉnh thành công!');
  } catch (err) {
    showToast(`Lỗi xuất ZIP: ${err.message || err}`);
  }
}

/* ==========================================================================
   AI Clean Settings Setup & Popover
   ========================================================================== */
function setupAiCleanSettings() {
  if (!el.btnAiCleanSettings || !el.aiCleanSettingsPopover) return;

  el.btnAiCleanSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = el.aiCleanSettingsPopover.style.display === 'none';
    el.aiCleanSettingsPopover.style.display = isHidden ? 'flex' : 'none';
  });

  if (el.btnCloseAiSettings) {
    el.btnCloseAiSettings.addEventListener('click', () => {
      el.aiCleanSettingsPopover.style.display = 'none';
    });
  }

  document.addEventListener('click', (e) => {
    if (el.aiCleanSettingsPopover && !el.aiCleanSettingsPopover.contains(e.target) && e.target !== el.btnAiCleanSettings && !el.btnAiCleanSettings.contains(e.target)) {
      el.aiCleanSettingsPopover.style.display = 'none';
    }
  });

  if (el.settingDilation) {
    el.settingDilation.value = appState.aiSettings.dilationPx;
    if (el.valSettingDilation) el.valSettingDilation.textContent = `${appState.aiSettings.dilationPx}px`;
    el.settingDilation.addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      appState.aiSettings.dilationPx = v;
      localStorage.setItem('manga_clean_dilation', String(v));
      if (el.valSettingDilation) el.valSettingDilation.textContent = `${v}px`;
    });
  }

  if (el.settingThreshold) {
    el.settingThreshold.value = appState.aiSettings.detThreshold;
    if (el.valSettingThreshold) el.valSettingThreshold.textContent = String(appState.aiSettings.detThreshold);
    el.settingThreshold.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      appState.aiSettings.detThreshold = v;
      localStorage.setItem('manga_clean_threshold', String(v));
      if (el.valSettingThreshold) el.valSettingThreshold.textContent = String(v);
    });
  }

  if (el.settingInpaintModel) {
    el.settingInpaintModel.value = appState.aiSettings.inpaintModel;
    el.settingInpaintModel.addEventListener('change', (e) => {
      appState.aiSettings.inpaintModel = e.target.value;
      localStorage.setItem('manga_clean_model', e.target.value);
    });
  }

  if (el.settingCleanSFX) {
    el.settingCleanSFX.checked = appState.aiSettings.cleanSFX;
    el.settingCleanSFX.addEventListener('change', (e) => {
      appState.aiSettings.cleanSFX = e.target.checked;
      localStorage.setItem('manga_clean_sfx', String(e.target.checked));
    });
  }

  if (el.btnSaveAndReClean) {
    el.btnSaveAndReClean.addEventListener('click', () => {
      el.aiCleanSettingsPopover.style.display = 'none';
      runBackendCleanAndBox(appState.activePageIndex);
    });
  }
}

/* ==========================================================================
   App Initialization
   ========================================================================== */
async function initApp() {
  bindInspectorEvents();
  setupCustomFontUpload();
  setupBubbleActions();
  setupDirectUploadEvents();
  setupAiCleanSettings();

  // Navigation Buttons
  el.btnPrevPage.addEventListener('click', () => switchPage(appState.activePageIndex - 1));
  el.btnNextPage.addEventListener('click', () => switchPage(appState.activePageIndex + 1));
  el.btnZoomIn.addEventListener('click', () => { appState.scale = Math.min(3.0, appState.scale * 1.2); applyTransform(); });
  el.btnZoomOut.addEventListener('click', () => { appState.scale = Math.max(0.15, appState.scale / 1.2); applyTransform(); });
  el.btnFitScreen.addEventListener('click', fitCanvasToScreen);

  // Export Buttons
  el.btnExportCurrentPng.addEventListener('click', exportCurrentPagePNG);
  el.btnExportFullZip.addEventListener('click', exportFullChapterZIP);

  // Sync Data
  el.btnSyncFromBatch.addEventListener('click', async () => {
    showToast('Đang nạp dữ liệu từ Batch Studio...');
    appState.pages = await loadDataFromIndexedDB();
    if (appState.pages.length) {
      await switchPage(0);
      showToast(`Đã đồng bộ ${appState.pages.length} trang từ Batch Studio!`);
    } else {
      showToast('Chưa có trang nào trong Batch Studio.');
    }
  });

  // Load Initial Data
  appState.pages = await loadDataFromIndexedDB();
  if (appState.pages.length) {
    await switchPage(0);
  } else {
    updateNavigationUI();
    renderSidebar();
    showToast('Chào mừng đến Typeset Pro! Bấm "Đồng bộ" hoặc kéo thả ảnh để bắt đầu.');
  }

  window.addEventListener('resize', fitCanvasToScreen);
}

document.addEventListener('DOMContentLoaded', initApp);
