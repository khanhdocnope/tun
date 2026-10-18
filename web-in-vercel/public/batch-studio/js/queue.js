/**
 * Manga Studio Batch - Queue Coordination & Concurrent Runners
 */

import { state, el, showToast, sleep, getActiveKeys, CLEAN_CONCURRENCY } from './state.js';
import { store, scheduleSave } from './storage.js';
import { cleanSingleImage, processSingleImage, translateSingleText } from './api.js';
import { updateCardDOM, updateFilterCounts, renderBatchView } from './ui.js';

  export function getPrevContext(item) {
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
  export function needsWork(img, mode) {
    const stage = img.stage || 0;
    if (mode === 'ocr_only') return stage < 1;
    if (mode === 'translate_only') return stage < 2 && !!(img.ocrText && img.ocrText.trim());
    return stage < 2;
  }

  // Initialize

  export function updateStatBadge() {
    if (!el.statBadge) return;
    const cleaned = state.images.filter((i) => i.hasCleaned).length;
    el.statBadge.textContent = `${state.images.length} trang trong danh sách` + (cleaned ? ` · ${cleaned} đã tẩy` : '');
  }

  export function updateProcessAllLabel() {
    if (!el.btnProcessAllLabel) return;
    const c = state.settings.stepClean;
    const t = state.settings.stepTranslate;
    const lbl = (c && t) ? 'Tẩy chữ + OCR + Dịch tất cả' : (c ? 'Tẩy chữ tất cả' : 'OCR + Dịch tất cả');
    el.btnProcessAllLabel.textContent = lbl;
    if (el.btnBottomProcessAllLabel) el.btnBottomProcessAllLabel.textContent = lbl;
  }

  let lightboxObjUrl = null;

  export function updateToolbarStates(isRunning) {
    if (el.btnCleanAll) el.btnCleanAll.disabled = isRunning;
    el.btnProcessAll.disabled = isRunning;
    el.btnOcrAll.disabled = isRunning;
    el.btnTranslateAll.disabled = isRunning;
    el.btnClearAll.disabled = isRunning;
    if (el.btnExportChapter) el.btnExportChapter.disabled = isRunning || state.images.length === 0;
    if (el.btnQuickDownloadTxt) el.btnQuickDownloadTxt.disabled = isRunning || state.images.length === 0;

    if (el.btnBottomCleanAll) el.btnBottomCleanAll.disabled = isRunning;
    if (el.btnBottomProcessAll) {
      if (!isRunning) {
        el.btnBottomProcessAll.disabled = (state.images.length === 0);
        updateProcessAllLabel();
      }
    }
  }

  // Clear All

  export async function runBatchQueue(mode = 'all') {
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
        if (el.btnProcessAllLabel) el.btnProcessAllLabel.textContent = `Dừng lại (${completed}/${total})`;
        if (el.btnBottomProcessAllLabel) el.btnBottomProcessAllLabel.textContent = `Dừng lại (${completed}/${total})`;
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

  // ---------------------------------------------------------------------------
  // BƯỚC TẨY CHỮ + ZIP (Giai đoạn 1)
  //  - Ảnh nguồn: bản gốc trong kho "originals" (nếu bản hiển thị đã bị nén), ngược lại dùng chính base64
  //  - Gọi /api/clean trước; lỗi/quá giới hạn dung lượng thì gọi thẳng backend (giống tab Xóa chữ)
  //  - Tối đa 2 request đồng thời, mỗi trang thử lại tối đa 3 lần với lỗi tạm thời
  //  - OCR/dịch luôn chạy trên ảnh GỐC (ảnh đã tẩy không còn chữ)
  // ---------------------------------------------------------------------------

  export async function runCleanQueue() {
    if (state.isQueueRunning) return;
    const queueItems = state.images.filter((img) => img.cleanStatus !== 'done');
    if (queueItems.length === 0) {
      showToast('Tất cả các trang đã được tẩy chữ xong!');
      return;
    }

    state.isQueueRunning = true;
    state.stopQueueRequested = false;
    el.queueProgressBar.style.display = 'flex';
    el.btnStopQueue.textContent = 'Dừng lại';
    updateToolbarStates(true);

    const total = queueItems.length;
    let nextIndex = 0;
    let completed = 0;
    let failed = 0;

    async function worker(workerId) {
      while (nextIndex < total && !state.stopQueueRequested) {
        const current = queueItems[nextIndex++];
        el.queueProgressText.textContent = `Tẩy chữ [Luồng ${workerId + 1}]: ${current.name} (${completed + 1}/${total})...`;
        const ok = await cleanSingleImage(current);
        completed++;
        if (!ok) failed++;
        el.queueProgressFill.style.width = `${Math.round((completed / total) * 100)}%`;
        if (el.btnProcessAllLabel) el.btnProcessAllLabel.textContent = `Dừng lại (${completed}/${total})`;
        if (el.btnBottomProcessAllLabel) el.btnBottomProcessAllLabel.textContent = `Dừng lại (${completed}/${total})`;
        updateFilterCounts();
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(CLEAN_CONCURRENCY, total); i++) workers.push(worker(i));
    await Promise.all(workers);

    el.queueProgressFill.style.width = '100%';
    el.queueProgressText.textContent = state.stopQueueRequested
      ? `Đã dừng tẩy chữ: ${completed - failed}/${total} trang xong${failed ? `, ${failed} lỗi` : ''}.`
      : `Tẩy chữ xong ${completed - failed}/${total} trang${failed ? `, ${failed} lỗi` : ''}.`;

    state.isQueueRunning = false;
    updateToolbarStates(false);
    setTimeout(() => {
      if (!state.isQueueRunning) el.queueProgressBar.style.display = 'none';
    }, 2000);
  }

  // Nút chính: chạy các bước đang bật cho cả chapter (tẩy chữ trước, rồi OCR + dịch)
  export async function runSelectedSteps() {
    if (state.isQueueRunning) return;
    if (!state.settings.stepClean && !state.settings.stepTranslate) {
      showToast('Vui lòng bật ít nhất một bước: Tẩy chữ hoặc OCR + Dịch.');
      return;
    }
    if (state.settings.stepClean) await runCleanQueue();
    if (state.settings.stepTranslate && !state.stopQueueRequested) await runBatchQueue('all');
  }

  // ----- Nhập ZIP (giữ tính năng nhập ZIP của tab cũ) -----
