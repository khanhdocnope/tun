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
  panStartX: 0,
  panStartY: 0,
  isDraggingBubble: false,
  isResizingBubble: false,
  dragHandle: null,
  dragStartX: 0,
  dragStartY: 0,
  initialBubbleRect: null,
  currentImageElement: null
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

  // Buttons
  btnPrevPage: document.getElementById('btnPrevPage'),
  btnNextPage: document.getElementById('btnNextPage'),
  btnAutoFitAll: document.getElementById('btnAutoFitAll'),
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

/* ==========================================================================
   IndexedDB Connection (v3)
   ========================================================================== */
const DB_NAME = 'manga_studio_batch';
const DB_VERSION = 3;

async function openDB() {
  if (appState.db) return appState.db;
  return new Promise((resolve, reject) => {
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

            // Lấy ảnh hiển thị: ưu tiên ảnh đã tẩy sạch bóng thoại
            let displayBlob = null;
            if (cl && cl.blob) {
              displayBlob = cl.blob;
            } else if (page.base64) {
              displayBlob = page.base64;
            }

            // Lấy danh sách bóng thoại đã lưu hoặc tạo từ text dịch
            let bubbles = [];
            if (ts && Array.isArray(ts.bubbles) && ts.bubbles.length) {
              bubbles = ts.bubbles;
            } else if (Array.isArray(st.bubbles) && st.bubbles.length) {
              // Chuyển đổi từ định dạng Gemini [ymin, xmin, ymax, xmax] sang pixel sau khi load ảnh
              bubbles = st.bubbles.map(b => ({
                rawBox: b.box || b.box_2d || null,
                srcText: b.src || '',
                text: b.tgt || b.text || '',
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
              // Tách các dòng viText thành các bóng thoại mẫu nếu chưa có tọa độ
              const lines = st.viText.split('\n').map(l => l.trim()).filter(Boolean);
              bubbles = lines.map((line, idx) => ({
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
                // Tạm thời đặt tỷ lệ % khung hình
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

async function switchPage(index) {
  if (index < 0 || index >= appState.pages.length) return;
  appState.activePageIndex = index;
  appState.activeBubbleIndex = -1;

  updateNavigationUI();
  renderSidebar();

  const page = appState.pages[index];
  if (!page) return;

  // Tải hình ảnh của trang
  const img = await loadImageElement(page.displayBlob);
  appState.currentImageElement = img;

  if (img) {
    el.canvas.width = img.naturalWidth || 1000;
    el.canvas.height = img.naturalHeight || 1400;

    // Chuẩn hóa tọa độ các bóng thoại theo kích thước thật của ảnh nếu cần
    initPageBubblesCoordinates(page, el.canvas.width, el.canvas.height);

    fitCanvasToScreen();
  }

  updateInspector();
  renderCanvas();
}

function initPageBubblesCoordinates(page, imgW, imgH) {
  if (!page.bubbles) page.bubbles = [];

  page.bubbles.forEach((b, idx) => {
    // 1. Tọa độ từ Gemini box_2d: [ymin, xmin, ymax, xmax] (chuẩn hóa 0-1000)
    if (b.rawBox && Array.isArray(b.rawBox)) {
      const [ymin, xmin, ymax, xmax] = b.rawBox;
      b.x = Math.round((xmin / 1000) * imgW);
      b.y = Math.round((ymin / 1000) * imgH);
      b.width = Math.max(40, Math.round(((xmax - xmin) / 1000) * imgW));
      b.height = Math.max(30, Math.round(((ymax - ymin) / 1000) * imgH));
      delete b.rawBox;
    }
    // 2. Tọa độ từ tỷ lệ tương đối
    else if (b.relRect) {
      b.x = Math.round(b.relRect.xPct * imgW);
      b.y = Math.round(b.relRect.yPct * imgH);
      b.width = Math.round(b.relRect.wPct * imgW);
      b.height = Math.round(b.relRect.hPct * imgH);
      delete b.relRect;
    }
    // 3. Mặc định nếu chưa có tọa độ
    else if (b.x == null) {
      b.x = Math.round(imgW * 0.2);
      b.y = Math.round(imgH * (0.15 + (idx * 0.15) % 0.65));
      b.width = Math.round(imgW * 0.35);
      b.height = Math.round(imgH * 0.12);
    }
  });
}

function renderCanvas() {
  const img = appState.currentImageElement;
  if (!img) return;

  ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);

  // 1. Vẽ ảnh nền (đã tẩy hoặc ảnh gốc)
  ctx.drawImage(img, 0, 0, el.canvas.width, el.canvas.height);

  const activePage = appState.pages[appState.activePageIndex];
  if (!activePage || !activePage.bubbles) return;

  // 2. Vẽ tất cả bóng thoại chữ
  activePage.bubbles.forEach((bubble) => {
    TypesetEngine.renderBubble(ctx, bubble);
  });

  // 3. Vẽ khung viền tương tác và 8 tay cầm co giãn cho bóng thoại đang chọn
  if (appState.activeBubbleIndex >= 0 && appState.activeBubbleIndex < activePage.bubbles.length) {
    const sel = activePage.bubbles[appState.activeBubbleIndex];
    drawSelectionHandles(ctx, sel);
  }
}

function drawSelectionHandles(ctx, bubble) {
  const { x, y, width, height } = bubble;
  ctx.save();

  // Đường viền nét đứt màu xanh Indigo
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, width, height);

  // 8 Tay cầm co giãn (NW, N, NE, E, SE, S, SW, W)
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
    s: { x: x + width / 2, y: y + height, cursor: 'ns-resize' },
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
  // Duyệt ngược từ trên xuống dưới
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (mouseX >= b.x && mouseX <= b.x + b.width && mouseY >= b.y && mouseY <= b.y + b.height) {
      return i;
    }
  }
  return -1;
}

// Mouse events on canvas viewport
el.viewport.addEventListener('mousedown', (e) => {
  // Giữ chuột giữa hoặc phím Space để Pan
  if (e.button === 1 || e.spaceKey || (e.button === 0 && e.target === el.viewport)) {
    appState.isPanning = true;
    appState.panStartX = e.clientX - appState.panX;
    appState.panStartY = e.clientY - appState.panY;
    el.viewport.classList.add('panning');
    return;
  }

  if (e.button !== 0) return; // Chỉ xử lý chuột trái

  const coords = getCanvasCoords(e);
  const page = appState.pages[appState.activePageIndex];
  if (!page || !page.bubbles) return;

  // 1. Kiểm tra bấm vào tay cầm resize của bóng thoại đang chọn
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

  // 2. Kiểm tra bấm vào một bóng thoại
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

  // 3. Bấm ra ngoài -> Hủy chọn bóng thoại
  appState.activeBubbleIndex = -1;
  updateInspector();
  renderCanvas();
});

window.addEventListener('mousemove', (e) => {
  if (appState.isPanning) {
    appState.panX = e.clientX - appState.panStartX;
    appState.panY = e.clientY - appState.panStartY;
    applyTransform();
    return;
  }

  const coords = getCanvasCoords(e);
  const page = appState.pages[appState.activePageIndex];
  if (!page || !page.bubbles) return;

  // Thay đổi con trỏ chuột
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

  // Xử lý kéo di chuyển bóng thoại
  if (appState.isDraggingBubble && appState.activeBubbleIndex >= 0) {
    const dx = coords.x - appState.dragStartX;
    const dy = coords.y - appState.dragStartY;
    const b = page.bubbles[appState.activeBubbleIndex];
    b.x = Math.round(appState.initialBubbleRect.x + dx);
    b.y = Math.round(appState.initialBubbleRect.y + dy);
    renderCanvas();
    return;
  }

  // Xử lý co giãn bóng thoại (Resize)
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

// Phóng to / Thu nhỏ bằng con lăn chuột (Mouse Wheel Zoom)
el.viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  const newScale = Math.min(3.0, Math.max(0.15, appState.scale * zoomFactor));
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
    el.propText.value = '';
    el.propText.disabled = true;
    el.propFont.disabled = true;
    el.propAutoFit.disabled = true;
    el.propFontSize.disabled = true;
    el.propTextColor.disabled = true;
    el.propStrokeColor.disabled = true;
    el.propStrokeWidth.disabled = true;
    el.propLineHeight.disabled = true;
    return;
  }

  const b = page.bubbles[appState.activeBubbleIndex];
  el.activeBubbleBadge.textContent = `Thoại #${appState.activeBubbleIndex + 1}`;

  el.propText.disabled = false;
  el.propFont.disabled = false;
  el.propAutoFit.disabled = false;
  el.propFontSize.disabled = false;
  el.propTextColor.disabled = false;
  el.propStrokeColor.disabled = false;
  el.propStrokeWidth.disabled = false;
  el.propLineHeight.disabled = false;

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

  // Segmented align buttons
  document.querySelectorAll('#alignSegmented .btn-seg').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.align === (b.align || 'center'));
  });
}

function bindInspectorEvents() {
  const getActiveBubble = () => {
    const page = appState.pages[appState.activePageIndex];
    return (page && appState.activeBubbleIndex >= 0) ? page.bubbles[appState.activeBubbleIndex] : null;
  };

  el.propText.addEventListener('input', (e) => {
    const b = getActiveBubble();
    if (!b) return;
    b.text = e.target.value;
    renderCanvas();
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

      // Thêm option vào dropdown
      const opt = document.createElement('option');
      opt.value = fontName;
      opt.textContent = `${fontName} (Tùy chỉnh)`;
      el.customFontsOptgroup.appendChild(opt);
      el.propFont.value = fontName;

      // Cập nhật cho bóng thoại đang chọn
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
   Add / Delete Bubble
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

  // Phím Delete hoặc Backspace để xóa bóng thoại
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Del') && document.activeElement !== el.propText) {
      deleteActiveBubble();
    }
    // Phím mũi tên chuyển trang
    if (document.activeElement !== el.propText) {
      if (e.key === 'ArrowLeft') switchPage(appState.activePageIndex - 1);
      if (e.key === 'ArrowRight') switchPage(appState.activePageIndex + 1);
    }
  });

  // Tự động căn chữ tất cả
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
}

/* ==========================================================================
   UI Updates: Sidebar & Navigation
   ========================================================================== */
function updateNavigationUI() {
  const total = appState.pages.length;
  const current = total > 0 ? appState.activePageIndex + 1 : 0;
  el.pageCounter.innerHTML = `Trang <b>${current} / ${total}</b>`;
  el.btnPrevPage.disabled = appState.activePageIndex <= 0;
  el.btnNextPage.disabled = appState.activePageIndex >= total - 1;
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
      <div class="page-thumb-title">Trang ${idx + 1} (${page.name || ''})</div>
      <div class="page-thumb-badges">
        ${page.hasCleaned ? '<span class="mini-badge mini-badge-cleaned">Đã tẩy</span>' : ''}
        ${page.hasTranslated ? '<span class="mini-badge mini-badge-translated">Đã dịch</span>' : ''}
        ${page.bubbles && page.bubbles.length ? `<span class="mini-badge mini-badge-typeset">${page.bubbles.length} thoại</span>` : ''}
      </div>
    `;

    card.appendChild(img);
    card.appendChild(info);

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

  // Tạo canvas ảo không có khung chọn
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
    page.bubbles.forEach(b => TypesetEngine.renderBubble(octx, b));
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
        page.bubbles.forEach(b => TypesetEngine.renderBubble(octx, b));
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
   App Initialization
   ========================================================================== */
async function initApp() {
  bindInspectorEvents();
  setupCustomFontUpload();
  setupBubbleActions();

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
