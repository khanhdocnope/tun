/**
 * Manga Studio Batch - UI Rendering, Card Elements, Lightbox & Proofreading Overlay
 */

import {
  state,
  el,
  showToast,
  escapeHtml,
  statusViText,
  cleanBadgeText,
  getFirstLineVi,
  formatBytes,
  copyToClipboard,
  applyThumbZoom,
  currentZoomVal,
  bufferToDataUrl,
  getActiveKeys
} from './state.js';
import { store, scheduleSave, dropPendingSave } from './storage.js';
import { processSingleImage, translateSingleText, cleanSingleImage } from './api.js';
import { updateStatBadge, updateProcessAllLabel } from './queue.js';

  export function applySettingsToUI() {
    el.selectEngine.value = state.settings.model;
    el.inputGeminiApiKey.value = state.settings.apiKey;
    if (el.inputGeminiApiKey2) el.inputGeminiApiKey2.value = state.settings.apiKey2;
    el.selectTone.value = state.settings.tone;
    el.toggleSkipSFX.checked = state.settings.skipSFX;
    if (el.selectReadingOrder) el.selectReadingOrder.value = state.settings.readingOrder;

    el.toggleStepClean.checked = state.settings.stepClean;
    el.toggleStepTranslate.checked = state.settings.stepTranslate;
    el.selectCleanModel.value = state.settings.cleanModel;
    el.checkCleanSFX.checked = state.settings.cleanSFX;
    el.rangeCleanDilation.value = state.settings.cleanDilation;
    el.cleanDilationVal.textContent = state.settings.cleanDilation;
    el.rangeCleanThreshold.value = state.settings.cleanThreshold;
    el.cleanThresholdVal.textContent = Number(state.settings.cleanThreshold).toFixed(2);
    el.inputBackendUrl.value = state.settings.backendUrl;
    updateProcessAllLabel();

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

  export function saveSettings() {
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

    state.settings.cleanModel = el.selectCleanModel.value;
    state.settings.cleanSFX = el.checkCleanSFX.checked;
    state.settings.cleanDilation = parseInt(el.rangeCleanDilation.value, 10) || 0;
    state.settings.cleanThreshold = parseFloat(el.rangeCleanThreshold.value) || 0.2;
    state.settings.backendUrl = (el.inputBackendUrl.value || '').trim() || 'https://dobietdc-backe-manga-remove.hf.space';
    localStorage.setItem('manga_clean_model', state.settings.cleanModel);
    localStorage.setItem('manga_clean_sfx', state.settings.cleanSFX);
    localStorage.setItem('manga_clean_dilation', state.settings.cleanDilation);
    localStorage.setItem('manga_clean_threshold', state.settings.cleanThreshold);
    localStorage.setItem('manga_backend_url', state.settings.backendUrl);

    localStorage.setItem('manga_model', state.settings.model);
    localStorage.setItem('manga_api_key', state.settings.apiKey);
    localStorage.setItem('manga_api_key_2', state.settings.apiKey2);
    localStorage.setItem('manga_tone', state.settings.tone);

    applySettingsToUI();
    el.settingsModal.style.display = 'none';
    showToast('Đã lưu cấu hình thành công!');
  }

  // Copy Helper (Hỗ trợ 100% PC, Mobile Safari, Chrome & In-App Webview)

  export function closeLightbox() {
    el.lightboxModal.style.display = 'none';
    if (lightboxObjUrl) { URL.revokeObjectURL(lightboxObjUrl); lightboxObjUrl = null; }
  }

  export async function openCleanedPreview(item) {
    const rec = await store.getCleaned(item.id);
    if (!rec || !rec.data) { showToast('Lỗi: không đọc được ảnh sạch trong bộ nhớ trình duyệt.'); return; }
    if (lightboxObjUrl) URL.revokeObjectURL(lightboxObjUrl);
    lightboxObjUrl = URL.createObjectURL(new Blob([rec.data], { type: rec.mime || 'image/png' }));
    el.lightboxImg.src = lightboxObjUrl;
    el.lightboxModal.style.display = 'flex';
  }

  export function renderBatchView() {
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

    updateStatBadge();
    updateFilterCounts();
    if (el.btnCleanAll) el.btnCleanAll.disabled = !hasImages || state.isQueueRunning;
    if (el.btnBottomCleanAll) el.btnBottomCleanAll.disabled = !hasImages || state.isQueueRunning;
    if (el.btnBottomProcessAll) el.btnBottomProcessAll.disabled = !hasImages || state.isQueueRunning;
    if (el.btnBottomQuickTxt) el.btnBottomQuickTxt.disabled = !hasImages;

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
  export function createRowElement(item, displayIndex) {
    const card = document.createElement('div');
    card.className = `manga-row-card ${item.status}`;
    card.id = `row-${item.id}`;

    card.className = `manga-row-card ${item.status}${item.isCollapsed ? ' is-collapsed' : ''}`;
    card.innerHTML = `
      <div class="row-header">
        <div class="row-header-left">
          <button type="button" class="btn-toggle-collapse" title="Thu gọn / Mở rộng trang">
            <svg class="collapse-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <button class="btn-zoom-preview" title="Chỉnh kích thước ảnh (Phóng to / Thu nhỏ)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
            </svg>
          </button>
          <span class="row-title">Trang ${displayIndex}: ${escapeHtml(item.name)}</span>
          <span class="row-size">${item.sizeStr}</span>
          <span class="badge-status ${item.status}" data-status-vi="${statusViText(item.status)}">${item.status.toUpperCase()}</span>
          <span class="badge-clean ${item.cleanStatus || 'idle'}">${cleanBadgeText(item)}</span>
        </div>
        <div class="row-header-right">
          <button class="btn-row-action btn-row-clean">Tẩy chữ</button>
          <button class="btn-row-action btn-row-view-clean" style="${item.hasCleaned ? '' : 'display:none;'}">Xem ảnh sạch</button>
          <button class="btn-row-action btn-row-ocr">OCR</button>
          <button class="btn-row-action btn-row-trans">Dịch</button>
          <button class="btn-row-action btn-row-all" style="color:var(--accent-red); font-weight:700;">OCR + Dịch</button>
          <a href="/typeset-studio/" class="btn-row-action btn-row-typeset" title="Mở trang này trong Typeset Studio" style="color:#818cf8; text-decoration:none; display:inline-flex; align-items:center;">🎨 Chèn chữ</a>
          <button class="btn-row-action btn-row-proofread" title="Soát bản dịch trang này">Soát</button>
          <button class="btn-row-delete" title="Xóa trang này">&times;</button>
        </div>
      </div>

      <!-- Dòng tóm tắt hiển thị khi thu gọn -->
      <div class="collapsed-preview-bar">
        <span class="preview-line-icon">💬</span>
        <span class="preview-line-text">${escapeHtml(getFirstLineVi(item.viText))}</span>
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
          <img src="${item.base64}" alt="${escapeHtml(item.name)}" title="Bấm để xem toàn màn hình (hoặc kéo rê để di chuyển)">
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
    const cardSizeWidget = card.querySelector('.card-size-widget');
    const cardSlider = card.querySelector('.card-slider');
    const cardReset = card.querySelector('.card-reset-size');
    const imgEl = card.querySelector('.col-thumb img');

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
      if (e.target.closest('.card-size-widget')) return;
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
      el.lightboxImg.src = item.base64;
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
    card.querySelector('.btn-row-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      const targetId = item.id;
      state.images = state.images.filter(x => x.id !== targetId);
      dropPendingSave(targetId);
      await store.remove(targetId);
      if (state.proofreadIndex >= state.images.length) {
        state.proofreadIndex = Math.max(0, state.images.length - 1);
      }
      if (state.images.length === 0) {
        closeProofread();
      } else if (el.proofreadOverlay && el.proofreadOverlay.style.display === 'flex') {
        renderProofreadView();
      }
      renderBatchView();
    });

    card.querySelector('.btn-row-clean').addEventListener('click', () => cleanSingleImage(item));
    card.querySelector('.btn-row-view-clean').addEventListener('click', () => openCleanedPreview(item));
    card.querySelector('.btn-row-ocr').addEventListener('click', () => processSingleImage(item, 'ocr_only'));
    card.querySelector('.btn-row-trans').addEventListener('click', () => translateSingleText(item));
    card.querySelector('.btn-row-all').addEventListener('click', () => processSingleImage(item, 'all'));

    const btnCollapse = card.querySelector('.btn-toggle-collapse');
    if (btnCollapse) {
      btnCollapse.addEventListener('click', (e) => {
        e.stopPropagation();
        item.isCollapsed = !item.isCollapsed;
        card.classList.toggle('is-collapsed', item.isCollapsed);
      });
    }

    const btnProof = card.querySelector('.btn-row-proofread');
    if (btnProof) {
      btnProof.addEventListener('click', () => {
        const idx = state.images.findIndex(x => x.id === item.id);
        if (idx !== -1) openProofread(idx);
      });
    }

    return card;
  }

  // Update a single card DOM without re-rendering everything
  export function updateCardDOM(item) {
    const card = document.getElementById(`row-${item.id}`);
    if (!card) return;

    card.className = `manga-row-card ${item.status}${item.isCollapsed ? ' is-collapsed' : ''}`;
    const badge = card.querySelector('.badge-status');
    if (badge) {
      badge.className = `badge-status ${item.status}`;
      badge.textContent = item.status.toUpperCase();
      badge.setAttribute('data-status-vi', statusViText(item.status));
    }

    const cleanBadge = card.querySelector('.badge-clean');
    if (cleanBadge) {
      cleanBadge.className = `badge-clean ${item.cleanStatus || 'idle'}`;
      cleanBadge.textContent = cleanBadgeText(item);
      if (item.cleanStatus === 'error' && item.cleanError) cleanBadge.title = item.cleanError;
    }
    const btnViewClean = card.querySelector('.btn-row-view-clean');
    if (btnViewClean) btnViewClean.style.display = item.hasCleaned ? '' : 'none';

    const textareaJp = card.querySelector('.textarea-jp');
    if (textareaJp) textareaJp.value = item.ocrText;

    const textareaVi = card.querySelector('.textarea-vi');
    if (textareaVi) textareaVi.value = item.viText;

    const previewLine = card.querySelector('.preview-line-text');
    if (previewLine) previewLine.textContent = getFirstLineVi(item.viText);

    updateStatBadge();
    updateFilterCounts();
    el.btnExportChapter.disabled = state.images.length === 0;
    if (el.btnQuickDownloadTxt) el.btnQuickDownloadTxt.disabled = state.images.length === 0;
  }

  // Process a Single Image via API

  export function updateFilterCounts() {
    const total = state.images.length;
    let doneCount = 0;
    let errorCount = 0;
    let pendingCount = 0;

    state.images.forEach(img => {
      const isDone = (img.status === 'done' || !state.settings.stepTranslate) &&
                     (!state.settings.stepClean || img.cleanStatus === 'done');
      const isErr = img.status === 'error' || img.cleanStatus === 'error';
      if (isDone) {
        doneCount++;
      } else if (isErr) {
        errorCount++;
      } else {
        pendingCount++;
      }
    });

    if (el.countAll) el.countAll.textContent = total;
    if (el.countDone) el.countDone.textContent = doneCount;
    if (el.countError) el.countError.textContent = errorCount;
    if (el.countPending) el.countPending.textContent = pendingCount;
  }

  export function setFilter(filterType) {
    state.currentFilter = filterType;
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === filterType);
    });

    state.images.forEach(img => {
      const card = document.getElementById(`row-${img.id}`);
      if (!card) return;
      let show = true;
      const isDone = (img.status === 'done' || !state.settings.stepTranslate) &&
                     (!state.settings.stepClean || img.cleanStatus === 'done');
      const isErr = img.status === 'error' || img.cleanStatus === 'error';
      const isPending = !isDone && !isErr;

      if (filterType === 'done') show = isDone;
      else if (filterType === 'error') show = isErr;
      else if (filterType === 'pending') show = isPending;

      card.classList.toggle('filter-hidden', !show);
    });
  }

  export function jumpToFirstPending() {
    const firstPending = state.images.find(img => {
      const isDone = (img.status === 'done' || !state.settings.stepTranslate) &&
                     (!state.settings.stepClean || img.cleanStatus === 'done');
      return !isDone;
    });
    if (firstPending) {
      const card = document.getElementById(`row-${firstPending.id}`);
      if (card) {
        card.classList.remove('filter-hidden');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  export function toggleCollapseAll() {
    state.isAllCollapsed = !state.isAllCollapsed;
    state.images.forEach(img => {
      img.isCollapsed = state.isAllCollapsed;
      const card = document.getElementById(`row-${img.id}`);
      if (card) card.classList.toggle('is-collapsed', state.isAllCollapsed);
    });
    if (el.btnToggleCollapseAllLabel) {
      el.btnToggleCollapseAllLabel.textContent = state.isAllCollapsed ? 'Mở rộng' : 'Thu gọn';
    }
  }

  export function openBottomSheet() {
    if (el.bottomSheetBackdrop) el.bottomSheetBackdrop.style.display = 'flex';
  }

  export function closeBottomSheet() {
    if (el.bottomSheetBackdrop) el.bottomSheetBackdrop.style.display = 'none';
  }

  export function openProofread(index = 0) {
    if (!state.images.length) return;
    state.proofreadIndex = Math.max(0, Math.min(state.images.length - 1, index));
    state.proofreadShowClean = false;
    state.proofreadZoom = 100;
    renderProofreadView();
    if (el.proofreadOverlay) el.proofreadOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  export function closeProofread() {
    if (el.proofreadOverlay) el.proofreadOverlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  export function navigateProofread(step) {
    if (!state.images.length) return;
    const next = state.proofreadIndex + step;
    if (next >= 0 && next < state.images.length) {
      state.proofreadIndex = next;
      state.proofreadShowClean = false;
      renderProofreadView();
    }
  }

  export function renderProofreadView() {
    const item = state.images[state.proofreadIndex];
    if (!item) return;

    if (el.proofreadPageIndicator) {
      el.proofreadPageIndicator.textContent = `Trang ${state.proofreadIndex + 1} / ${state.images.length}`;
    }
    if (el.proofreadFooterName) {
      el.proofreadFooterName.textContent = item.name;
    }

    if (el.btnProofreadToggleClean) {
      if (item.hasCleaned) {
        el.btnProofreadToggleClean.style.display = 'inline-flex';
        if (el.btnProofreadToggleCleanLabel) {
          el.btnProofreadToggleCleanLabel.textContent = state.proofreadShowClean ? 'Xem ảnh gốc' : 'Xem ảnh sạch';
        }
      } else {
        el.btnProofreadToggleClean.style.display = 'none';
      }
    }

    if (el.proofreadImg) {
      if (state.proofreadShowClean && item.hasCleaned) {
        store.getCleaned(item.id).then(record => {
          if (record && record.data) {
            const blob = new Blob([record.data], { type: record.mime || 'image/png' });
            el.proofreadImg.src = URL.createObjectURL(blob);
          } else {
            el.proofreadImg.src = item.base64;
          }
        }).catch(() => {
          el.proofreadImg.src = item.base64;
        });
      } else {
        el.proofreadImg.src = item.base64;
      }
      applyProofreadZoom();
    }

    if (el.proofreadJpText) el.proofreadJpText.value = item.ocrText || '';
    if (el.proofreadViText) el.proofreadViText.value = item.viText || '';

    if (el.btnProofreadPrev) el.btnProofreadPrev.disabled = (state.proofreadIndex <= 0);
    if (el.btnProofreadNext) el.btnProofreadNext.disabled = (state.proofreadIndex >= state.images.length - 1);
  }

  export function applyProofreadZoom() {
    if (!el.proofreadImg) return;
    el.proofreadImg.style.transform = `scale(${state.proofreadZoom / 100})`;
    if (el.proofreadZoomLevel) el.proofreadZoomLevel.textContent = `${state.proofreadZoom}%`;
  }

  export function toggleProofreadClean() {
    state.proofreadShowClean = !state.proofreadShowClean;
    renderProofreadView();
  }

  export function updateRowTextsFromProofread(item) {
    const card = document.getElementById(`row-${item.id}`);
    if (!card) return;
    const txtJp = card.querySelector('.textarea-jp');
    if (txtJp) txtJp.value = item.ocrText;
    const txtVi = card.querySelector('.textarea-vi');
    if (txtVi) txtVi.value = item.viText;
    const prevText = card.querySelector('.preview-line-text');
    if (prevText) prevText.textContent = getFirstLineVi(item.viText);
  }

  // Bind Phase 2 Events
