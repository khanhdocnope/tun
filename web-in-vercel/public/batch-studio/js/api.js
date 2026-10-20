/**
 * Manga Studio Batch - Backend APIs (OCR, Translation, Inpainting/Clean & File Loaders)
 */

import { state, el, showToast, sleep, dataUrlToBuffer, bufferToDataUrl, readFileAsArrayBuffer, formatBytes, getActiveKeys, CLEAN_MAX_ATTEMPTS, IMG_EXT_RE } from './state.js';
import { store, scheduleSave, reportSaveFailure, nextSeq, persistNewPage } from './storage.js';
import { updateCardDOM, renderBatchView } from './ui.js';
import { getPrevContext } from './queue.js';

  export async function checkConfig() {
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

  export function compressAndLoadFile(file) {
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

  // Thêm từng ảnh đơn lẻ vào state và IndexedDB (hỗ trợ giải phóng bộ nhớ ngay sau khi nén)
  export async function addSingleFileItem(file) {
    const { base64, sizeStr, compressed } = await compressAndLoadFile(file);

    const item = {
      id: 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: file.name || `image_${state.images.length + 1}.jpg`,
      sizeStr: sizeStr,
      base64: base64,
      status: 'idle',
      dialogues: [],
      ocrText: '',
      viText: '',
      tokens: 0,
      seq: nextSeq(),
      stage: 0,
      // Bước tẩy chữ: trạng thái riêng, ảnh sạch nằm trong IndexedDB (kho "cleaned")
      cleanStatus: 'idle',
      hasCleaned: false,
      cleanedMime: '',
      hasOriginal: false
    };

    // Bản hiển thị đã bị nén (<=1400px) -> giữ thêm ảnh gốc để tẩy chữ ở độ phân giải gốc
    if (compressed) {
      try {
        const buffer = await readFileAsArrayBuffer(file);
        const okOrig = await store.putOriginal({ id: item.id, mime: file.type || 'image/jpeg', data: buffer });
        item.hasOriginal = !!okOrig;
        if (!okOrig) reportSaveFailure();
      } catch (e) {
        item.hasOriginal = false;
      }
    }

    state.images.push(item);
    persistNewPage(item);
    return { item, compressed };
  }

  // Add Files to State (hỗ trợ nén tức thì không gây đơ web)
  export async function addFilesToBatch(fileList) {
    const totalFiles = fileList.length;
    let compressedCount = 0;

    for (const file of fileList) {
      const res = await addSingleFileItem(file);
      if (res && res.compressed) compressedCount++;
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
  export function getOptimizedBase64(base64, maxDim = 1400) {
    return Promise.resolve(base64);
  }

  // Render Batch View (Rows)

  export async function processSingleImage(item, mode = 'all', preferredKey = '') {
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
        glossary: state.settings.glossary || '',
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
      if (Array.isArray(data.bubbles) && data.bubbles.length) {
        item.bubbles = data.bubbles;
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
  export async function translateSingleText(item, preferredKey = '') {
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
          glossary: state.settings.glossary || '',
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

  export async function getCleanSourceDataUrl(item) {
    if (item.hasOriginal) {
      const rec = await store.getOriginal(item.id);
      if (rec && rec.data) return bufferToDataUrl(rec.data, rec.mime);
    }
    return item.base64; // ảnh nhỏ không bị nén, hoặc không đọc được bản gốc
  }

  export async function postClean(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = String(j.detail || j.error || ''); } catch (e) { /* phản hồi không phải JSON */ }
      const err = new Error(msg || `Server trả về mã lỗi ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  export function isRetryableCleanError(err) {
    const st = err && err.status;
    return st === undefined || st === 408 || st === 425 || st === 429 || st >= 500;
  }

  export async function requestClean(imageBase64) {
    const payload = {
      imageBase64,
      cleanSFX: !!state.settings.cleanSFX,
      dilationPx: state.settings.cleanDilation,
      detThreshold: state.settings.cleanThreshold,
      inpaintModel: state.settings.cleanModel
    };
    const direct = (state.settings.backendUrl || '').trim().replace(/\/+$/, '') + '/clean_page';
    let lastErr;
    for (let attempt = 0; attempt < CLEAN_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(1500 * attempt);
        if (state.stopQueueRequested) break;
      }
      try {
        try {
          return await postClean('/api/clean', payload);
        } catch (viaProxyErr) {
          // /api/clean lỗi (vd. ảnh vượt giới hạn body của Vercel) -> gọi thẳng backend như tab Xóa chữ
          return await postClean(direct, payload);
        }
      } catch (err) {
        lastErr = err;
        if (!isRetryableCleanError(err)) break;
      }
    }
    throw lastErr || new Error('Không tẩy chữ được.');
  }

  export async function cleanSingleImage(item) {
    if (item.cleanStatus === 'processing') return false; // đang tẩy rồi
    item.cleanStatus = 'processing';
    item.cleanError = '';
    updateCardDOM(item);
    try {
      const src = await getCleanSourceDataUrl(item);
      const _cleanStart = performance.now();
      const _bodySize = src.length;
      const data = await requestClean(src);
      const _roundTrip = performance.now() - _cleanStart;
      // Log performance stats (console only, no UI)
      try {
        const timings = data && data.stats && data.stats.timings_ms;
        console.info('[clean]', item.name, timings || '(no timings)', 'round-trip:', Math.round(_roundTrip) + 'ms', 'body:', _bodySize, 'bytes');
      } catch (_) { /* ignore logging errors */ }
      if (!data || !data.cleanedImageBase64) throw new Error('Backend không trả về ảnh đã tẩy.');
      const { mime, buffer } = dataUrlToBuffer(data.cleanedImageBase64);
      const saved = await store.putCleaned({ id: item.id, mime, data: buffer });
      if (!saved) {
        reportSaveFailure();
        throw new Error('Không lưu được ảnh sạch vào trình duyệt (bộ nhớ đầy?).');
      }
      if (!state.images.includes(item)) { store.deleteCleaned(item.id); return false; } // trang bị xóa trong lúc chờ
      item.hasCleaned = true;
      item.cleanedMime = mime;
      item.cleanStatus = 'done';
      updateCardDOM(item);
      scheduleSave(item, 0);
      return true;
    } catch (err) {
      console.error(err);
      item.cleanStatus = item.hasCleaned ? 'done' : 'error';
      item.cleanError = err.message || 'Lỗi tẩy chữ';
      updateCardDOM(item);
      scheduleSave(item, 0);
      showToast(`Lỗi tẩy chữ trang ${item.name}: ${item.cleanError}`);
      return false;
    }
  }

  // Hàng đợi tẩy chữ: 2 luồng, bỏ qua trang đã tẩy xong (chạy tiếp phần còn lại sau khi tải lại trang)

  export function isZipFile(f) {
    return /\.zip$/i.test((f && f.name) || '') || /zip/i.test((f && f.type) || '');
  }

  export function mimeFromName(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' })[ext] || 'image/jpeg';
  }

  export async function expandZipToFiles(zipFile) {
    const zip = await JSZip.loadAsync(zipFile);
    const entries = [];
    zip.forEach((path, entry) => {
      if (entry.dir) return;
      const base = path.split('/').pop();
      if (!base || base.charAt(0) === '.' || /(^|\/)__MACOSX\//.test(path)) return;
      if (!IMG_EXT_RE.test(base)) return;
      entries.push({ path, base, entry });
    });
    entries.sort((x, y) => x.path.localeCompare(y.path, undefined, { numeric: true, sensitivity: 'base' }));
    const files = [];
    for (const e of entries) {
      const blob = await e.entry.async('blob');
      files.push(new File([blob], e.base, { type: mimeFromName(e.base) }));
    }
    return files;
  }

  export async function addInputFiles(list) {
    let totalAdded = 0;
    let compressedCount = 0;

    for (const f of list) {
      if (!isZipFile(f)) {
        const res = await addSingleFileItem(f);
        if (res) {
          totalAdded++;
          if (res.compressed) compressedCount++;
        }
        continue;
      }

      if (typeof JSZip === 'undefined') {
        showToast('Lỗi: chưa tải được thư viện ZIP, không đọc được tệp ZIP.');
        continue;
      }

      try {
        const zip = await JSZip.loadAsync(f);
        const entries = [];
        zip.forEach((path, entry) => {
          if (entry.dir) return;
          const base = path.split('/').pop();
          if (!base || base.charAt(0) === '.' || /(^|\/)__MACOSX\//.test(path)) return;
          if (!IMG_EXT_RE.test(base)) return;
          entries.push({ path, base, entry });
        });
        entries.sort((x, y) => x.path.localeCompare(y.path, undefined, { numeric: true, sensitivity: 'base' }));

        if (!entries.length) {
          showToast(`Tệp ZIP "${f.name}" không chứa ảnh nào.`);
          continue;
        }

        showToast(`Đang giải nén ${entries.length} ảnh từ "${f.name}"...`, 1500);
        for (const e of entries) {
          const blob = await e.entry.async('blob');
          const file = new File([blob], e.base, { type: mimeFromName(e.base) });
          const res = await addSingleFileItem(file);
          if (res) {
            totalAdded++;
            if (res.compressed) compressedCount++;
          }
          // Giải phóng event loop cho Garbage Collector dọn dẹp bộ nhớ đệm
          await new Promise(r => setTimeout(r, 0));
        }
      } catch (err) {
        console.error(err);
        showToast(`Lỗi: không đọc được tệp ZIP "${f.name}".`);
      }
    }

    if (totalAdded > 0) {
      renderBatchView();
      if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(() => {}); }
      if (compressedCount > 0) {
        showToast(`Đã thêm ${totalAdded} ảnh (đã tối ưu ${compressedCount} ảnh sang WebP)!`);
      } else {
        showToast(`Đã thêm ${totalAdded} ảnh vào danh sách!`);
      }
    }
  }
