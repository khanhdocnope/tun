/**
 * Manga Studio Batch - Export Tools (ZIP Clean, ZIP Bundle, TXT/DOC Export & Clipboard)
 */

import { state, el, showToast, copyToClipboard } from './state.js';
import { store } from './storage.js';

  export function mimeToExt(mime) {
    if (/png/i.test(mime)) return 'png';
    if (/webp/i.test(mime)) return 'webp';
    if (/jpe?g/i.test(mime)) return 'jpg';
    return 'png';
  }

  // Giữ tên gốc của trang; chỉ đổi đuôi nếu định dạng ảnh sạch khác (backend trả PNG)
  export function cleanedFileName(item, used) {
    const stem = (item.name || 'page').replace(/\.[^./\\]+$/, '') || 'page';
    const ext = mimeToExt(item.cleanedMime);
    let name = `${stem}.${ext}`;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${stem}_${n++}.${ext}`;
    used.add(name.toLowerCase());
    return name;
  }

  export function saveBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 4000);
  }

  let zipExporting = false;

  export async function exportCleanZip(withScript) {
    if (zipExporting) return;
    if (typeof JSZip === 'undefined') { showToast('Lỗi: chưa tải được thư viện nén ZIP. Kiểm tra mạng rồi thử lại.'); return; }
    const cleaned = state.images.filter((i) => i.hasCleaned);
    if (!cleaned.length) { showToast('Chưa có trang nào được tẩy chữ. Hãy bấm "Tẩy chữ tất cả" trước.'); return; }
    if (withScript && !state.images.some((i) => (i.ocrText && i.ocrText.trim()) || (i.viText && i.viText.trim()))) {
      showToast('Chưa có kịch bản! Hãy chạy "OCR + Dịch" trước, hoặc chọn "Tải ZIP ảnh đã tẩy".');
      return;
    }

    zipExporting = true;
    try {
      showToast(`Đang nén ${cleaned.length} ảnh sạch...`);
      const zip = new JSZip();
      const used = new Set();
      let missing = 0;
      for (const item of cleaned) {
        const rec = await store.getCleaned(item.id);
        if (!rec || !rec.data) { missing++; continue; }
        zip.file(cleanedFileName(item, used), rec.data, { binary: true });
      }
      if (withScript) zip.file('script.txt', '\uFEFF' + generateChapterContent());

      // Ảnh đã nén sẵn nên dùng STORE (nhanh, đỡ tốn RAM trên điện thoại)
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
      saveBlob(`Manga_Chapter_${withScript ? 'Clean_Script' : 'Clean'}_${Date.now()}.zip`, blob);

      const notCleaned = state.images.length - cleaned.length;
      const notes = [];
      if (notCleaned) notes.push(`${notCleaned} trang chưa tẩy nên không có trong ZIP`);
      if (missing) notes.push(`${missing} ảnh sạch không đọc được`);
      showToast(`Đã tạo ZIP (${cleaned.length - missing} ảnh${withScript ? ' + script.txt' : ''}).` + (notes.length ? ' Lưu ý: ' + notes.join('; ') + '.' : ''));
    } catch (err) {
      console.error(err);
      showToast('Lỗi: không tạo được tệp ZIP (' + (err.message || 'không rõ nguyên nhân') + '). Thử xuất ít trang hơn.');
    } finally {
      zipExporting = false;
    }
  }

  export function openExportModal(text) {
    if (!el.exportModal) return;
    if (el.exportPreviewTextarea) el.exportPreviewTextarea.value = text;
    if (el.exportTextLengthBadge) el.exportTextLengthBadge.textContent = text.length.toLocaleString('vi-VN') + ' ký tự';
    el.exportModal.style.display = 'flex';
  }

  export function closeExportModal() {
    if (el.exportModal) el.exportModal.style.display = 'none';
  }

  // Thực hiện tải file với đa cơ chế (Blob link không target blank, Fallback Form POST/GET, Data URL)
  export function executeFileDownload(filename, text, format = 'txt') {
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

  export function downloadTextFile(filename, text, format = 'txt') {
    // Luôn mở Export Modal để người dùng có giao diện xem trước & nút bấm trực tiếp (đặc biệt hữu ích trên điện thoại / iframe)
    openExportModal(text);
    // Đồng thời kích hoạt tải file ngay lập tức
    executeFileDownload(filename, text, format);
  }

  export function generateChapterContent() {
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

  export function exportFullChapter(format = 'txt') {
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
  export function copyChapterToClipboard() {
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
