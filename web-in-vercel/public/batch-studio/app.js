/**
 * Manga OCR & Translation Batch Studio - Client Main Orchestrator (ES Module)
 */

import { state, el, showToast, applyThumbZoom, currentZoomVal, copyToClipboard } from './js/state.js';
import { store, pendingSaves, restoreSession, scheduleSave } from './js/storage.js';
import { checkConfig, addInputFiles, addFilesToBatch, isZipFile } from './js/api.js';
import { runCleanQueue, runBatchQueue, runSelectedSteps, updateProcessAllLabel } from './js/queue.js';
import {
  applySettingsToUI,
  saveSettings,
  closeLightbox,
  renderBatchView,
  updateCardDOM,
  setFilter,
  jumpToFirstPending,
  toggleCollapseAll,
  openBottomSheet,
  closeBottomSheet,
  openProofread,
  closeProofread,
  navigateProofread,
  applyProofreadZoom,
  toggleProofreadClean,
  updateRowTextsFromProofread
} from './js/ui.js';
import {
  exportFullChapter,
  exportCleanZip,
  copyChapterToClipboard,
  openExportModal,
  closeExportModal,
  executeFileDownload,
  generateChapterContent
} from './js/export.js';

  export async function clearAllBatch() {
    if (state.images.length === 0) return;
    if (confirm('Bạn có chắc muốn xóa toàn bộ danh sách trang hiện tại?')) {
      if (state.isQueueRunning) {
        state.stopQueueRequested = true;
      }
      state.images = [];
      pendingSaves.forEach(({ timer }) => clearTimeout(timer));
      pendingSaves.clear();
      closeProofread();
      await store.clear();
      renderBatchView();
      showToast('Đã xóa toàn bộ danh sách trang.');
    }
  }

  // Modal & Download helpers (hoạt động 100% trên PC, Mobile Safari/Chrome và trong iFrame)

  function bindEvents() {
    // Add Images via Input
    el.fileInputMultiple.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) addInputFiles(files);
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
      const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/') || isZipFile(f));
      if (files.length > 0) {
        addInputFiles(files);
      }
    });

    // Batch Actions
    el.btnProcessAll.addEventListener('click', () => runSelectedSteps());
    el.btnCleanAll.addEventListener('click', () => runCleanQueue());
    el.toggleStepClean.addEventListener('change', () => {
      state.settings.stepClean = el.toggleStepClean.checked;
      localStorage.setItem('manga_step_clean', state.settings.stepClean);
      updateProcessAllLabel();
    });
    el.toggleStepTranslate.addEventListener('change', () => {
      state.settings.stepTranslate = el.toggleStepTranslate.checked;
      localStorage.setItem('manga_step_translate', state.settings.stepTranslate);
      updateProcessAllLabel();
    });
    el.btnExportZipClean.addEventListener('click', (e) => {
      e.stopPropagation();
      el.exportMenu.style.display = 'none';
      exportCleanZip(false);
    });
    el.btnExportZipBoth.addEventListener('click', (e) => {
      e.stopPropagation();
      el.exportMenu.style.display = 'none';
      exportCleanZip(true);
    });
    el.rangeCleanDilation.addEventListener('input', () => { el.cleanDilationVal.textContent = el.rangeCleanDilation.value; });
    el.rangeCleanThreshold.addEventListener('input', () => { el.cleanThresholdVal.textContent = parseFloat(el.rangeCleanThreshold.value).toFixed(2); });
    el.btnClearAll.addEventListener('click', clearAllBatch);
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
    el.btnCloseLightbox.addEventListener('click', closeLightbox);
    el.lightboxModal.addEventListener('click', (e) => {
      if (e.target === el.lightboxModal) closeLightbox();
    });

    // Settings Modal
    el.btnSettings.addEventListener('click', () => {
      applySettingsToUI();
      el.settingsModal.style.display = 'flex';
    });
    el.btnCloseSettings.addEventListener('click', () => el.settingsModal.style.display = 'none');
    el.btnCancelSettings.addEventListener('click', () => el.settingsModal.style.display = 'none');
    el.btnSaveSettings.addEventListener('click', saveSettings);
    bindPhase2Events();
  }

  // Format File Size

  function bindPhase2Events() {
    // Filter chips
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => setFilter(chip.dataset.filter));
    });

    if (el.btnJumpPending) {
      el.btnJumpPending.addEventListener('click', jumpToFirstPending);
    }

    if (el.btnToggleCollapseAll) {
      el.btnToggleCollapseAll.addEventListener('click', toggleCollapseAll);
    }

    if (el.btnOpenProofread) {
      el.btnOpenProofread.addEventListener('click', () => openProofread(0));
    }

    // Bottom Action Bar
    if (el.btnOpenBottomSheet) {
      el.btnOpenBottomSheet.addEventListener('click', openBottomSheet);
    }
    if (el.btnCloseBottomSheet) {
      el.btnCloseBottomSheet.addEventListener('click', closeBottomSheet);
    }
    if (el.bottomSheetBackdrop) {
      el.bottomSheetBackdrop.addEventListener('click', (e) => {
        if (e.target === el.bottomSheetBackdrop) closeBottomSheet();
      });
    }

    if (el.btnBottomCleanAll) {
      el.btnBottomCleanAll.addEventListener('click', () => {
        if (!state.isQueueRunning) runCleanQueue();
      });
    }

    if (el.btnBottomProcessAll) {
      el.btnBottomProcessAll.addEventListener('click', () => {
        if (state.isQueueRunning) {
          state.stopQueueRequested = true;
          if (el.btnStopQueue) el.btnStopQueue.click();
        } else {
          runSelectedSteps();
        }
      });
    }

    if (el.btnBottomQuickTxt) {
      el.btnBottomQuickTxt.addEventListener('click', () => {
        if (el.btnQuickDownloadTxt && !el.btnQuickDownloadTxt.disabled) {
          el.btnQuickDownloadTxt.click();
        }
      });
    }

    // Bottom Sheet items
    if (el.sheetBtnCleanAll) {
      el.sheetBtnCleanAll.addEventListener('click', () => {
        closeBottomSheet();
        if (!state.isQueueRunning) runCleanQueue();
      });
    }
    if (el.sheetBtnOcrAll) {
      el.sheetBtnOcrAll.addEventListener('click', () => {
        closeBottomSheet();
        if (!state.isQueueRunning) runBatchQueue('ocr');
      });
    }
    if (el.sheetBtnTranslateAll) {
      el.sheetBtnTranslateAll.addEventListener('click', () => {
        closeBottomSheet();
        if (!state.isQueueRunning) runBatchQueue('trans');
      });
    }
    if (el.sheetBtnDownloadTxt) {
      el.sheetBtnDownloadTxt.addEventListener('click', () => {
        closeBottomSheet();
        if (el.btnQuickDownloadTxt && !el.btnQuickDownloadTxt.disabled) el.btnQuickDownloadTxt.click();
      });
    }
    if (el.sheetBtnExportZipClean) {
      el.sheetBtnExportZipClean.addEventListener('click', () => {
        closeBottomSheet();
        if (el.btnExportZipClean) el.btnExportZipClean.click();
      });
    }
    if (el.sheetBtnExportZipBoth) {
      el.sheetBtnExportZipBoth.addEventListener('click', () => {
        closeBottomSheet();
        if (el.btnExportZipBoth) el.btnExportZipBoth.click();
      });
    }
    if (el.sheetBtnOpenExportModal) {
      el.sheetBtnOpenExportModal.addEventListener('click', () => {
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

    // Proofreading Overlay
    if (el.btnCloseProofread) {
      el.btnCloseProofread.addEventListener('click', closeProofread);
    }
    if (el.btnProofreadPrev) {
      el.btnProofreadPrev.addEventListener('click', () => navigateProofread(-1));
    }
    if (el.btnProofreadNext) {
      el.btnProofreadNext.addEventListener('click', () => navigateProofread(1));
    }
    if (el.btnProofreadToggleClean) {
      el.btnProofreadToggleClean.addEventListener('click', toggleProofreadClean);
    }

    if (el.btnProofreadZoomIn) {
      el.btnProofreadZoomIn.addEventListener('click', () => {
        state.proofreadZoom = Math.min(300, state.proofreadZoom + 25);
        applyProofreadZoom();
      });
    }
    if (el.btnProofreadZoomOut) {
      el.btnProofreadZoomOut.addEventListener('click', () => {
        state.proofreadZoom = Math.max(50, state.proofreadZoom - 25);
        applyProofreadZoom();
      });
    }
    if (el.btnProofreadZoomReset) {
      el.btnProofreadZoomReset.addEventListener('click', () => {
        state.proofreadZoom = 100;
        applyProofreadZoom();
      });
    }

    if (el.btnProofreadCopyJp) {
      el.btnProofreadCopyJp.addEventListener('click', () => {
        if (el.proofreadJpText) copyToClipboard(el.proofreadJpText.value, 'Đã sao chép OCR tiếng Nhật!');
      });
    }
    if (el.btnProofreadCopyVi) {
      el.btnProofreadCopyVi.addEventListener('click', () => {
        if (el.proofreadViText) copyToClipboard(el.proofreadViText.value, 'Đã sao chép bản dịch tiếng Việt!');
      });
    }

    if (el.proofreadJpText) {
      el.proofreadJpText.addEventListener('input', (e) => {
        const item = state.images[state.proofreadIndex];
        if (item) {
          item.ocrText = e.target.value;
          updateRowTextsFromProofread(item);
          scheduleSave(item);
        }
      });
    }
    if (el.proofreadViText) {
      el.proofreadViText.addEventListener('input', (e) => {
        const item = state.images[state.proofreadIndex];
        if (item) {
          item.viText = e.target.value;
          updateRowTextsFromProofread(item);
          scheduleSave(item);
        }
      });
    }

    // Keyboard navigation for proofread
    document.addEventListener('keydown', (e) => {
      if (el.proofreadOverlay && el.proofreadOverlay.style.display === 'flex') {
        if (e.target === el.proofreadJpText || e.target === el.proofreadViText) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateProofread(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateProofread(1);
        } else if (e.key === 'Escape') {
          closeProofread();
        }
      }
    });

    // Touch swipe for proofreading overlay on mobile
    if (el.proofreadImgWrapper) {
      let touchStartX = 0;
      let touchEndX = 0;
      el.proofreadImgWrapper.addEventListener('touchstart', (e) => {
        if (e.changedTouches && e.changedTouches.length) {
          touchStartX = e.changedTouches[0].screenX;
        }
      }, { passive: true });
      el.proofreadImgWrapper.addEventListener('touchend', (e) => {
        if (e.changedTouches && e.changedTouches.length) {
          touchEndX = e.changedTouches[0].screenX;
          const diff = touchEndX - touchStartX;
          if (diff > 60) navigateProofread(-1);
          else if (diff < -60) navigateProofread(1);
        }
      }, { passive: true });
    }
  }

  async function init() {
    bindEvents();
    await checkConfig();
    applySettingsToUI();
    await restoreSession();
    renderBatchView();
  }

  // Check Backend Config

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
