/**
 * Manga Studio Batch - IndexedDB Storage & State Persistence
 */

import { state, el, showToast, bufferToDataUrl } from './state.js';

  export const store = (function () {
    const DB_NAME = 'manga_studio_batch';
    const DB_VERSION = 3; // v3: thêm kho "typeset" cho Giai đoạn 4 (Chèn chữ)
    const PAGES = 'pages';
    const STATE = 'state';
    const CLEANED = 'cleaned';
    const ORIGINALS = 'originals';
    const TYPESET = 'typeset';
    const ALL = [PAGES, STATE, CLEANED, ORIGINALS, TYPESET];
    let dbPromise = null;
    let dbHandle = null;

    function open() {
      if (dbHandle) return Promise.resolve(dbHandle);
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve) => {
        if (!('indexedDB' in window) || !window.indexedDB) {
          dbPromise = null;
          return resolve(null);
        }
        let req;
        try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) {
          dbPromise = null;
          return resolve(null);
        }
        // Migrate v1 -> v2: chỉ TẠO kho mới, không đụng tới dữ liệu cũ (pages, state giữ nguyên)
        req.onupgradeneeded = () => {
          const db = req.result;
          ALL.forEach((name) => {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
          });
        };
        req.onsuccess = () => {
          dbHandle = req.result;
          // Nếu tab khác nâng cấp DB sau này, đóng kết nối để không chặn họ
          dbHandle.onversionchange = () => {
            try { dbHandle.close(); } catch (e) { /* bỏ qua */ }
            dbHandle = null;
            dbPromise = null;
          };
          resolve(dbHandle);
        };
        req.onerror = () => {
          dbPromise = null;
          resolve(null);
        };
        req.onblocked = () => {
          // Một tab Batch Studio bản cũ đang mở giữ DB v1 -> không nâng cấp được
          dbPromise = null;
          try { showToast('Lỗi: hãy đóng các tab Batch Studio khác rồi tải lại trang để nâng cấp bộ nhớ.'); } catch (e) { /* bỏ qua */ }
          resolve(null);
        };
      });
      return dbPromise;
    }

    // Chạy 1 giao dịch trên các kho đã chọn; fn nhận tx và trả về request cần đọc kết quả
    async function run(mode, names, fn) {
      const db = await open();
      if (!db) return { ok: false, result: null };
      const validNames = names.filter((n) => db.objectStoreNames.contains(n));
      if (!validNames.length) return { ok: false, result: null };
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(validNames, mode);
          const out = fn(tx, validNames);
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
        const r = await run('readonly', [PAGES, STATE], (tx) => ({
          pages: tx.objectStore(PAGES).getAll(),
          states: tx.objectStore(STATE).getAll()
        }));
        if (!r.ok) return [];
        const pages = r.result.pages.result || [];
        const byId = new Map((r.result.states.result || []).map((x) => [x.id, x]));
        return pages
          .sort((x, y) => (x.seq || 0) - (y.seq || 0))
          .map((pg) => Object.assign({}, pg, byId.get(pg.id) || {}));
      },
      async putPage(rec) { return (await run('readwrite', [PAGES], (tx) => { tx.objectStore(PAGES).put(rec); })).ok; },
      async putState(rec) { return (await run('readwrite', [STATE], (tx) => { tx.objectStore(STATE).put(rec); })).ok; },
      async putCleaned(rec) { return (await run('readwrite', [CLEANED], (tx) => { tx.objectStore(CLEANED).put(rec); })).ok; },
      async putOriginal(rec) { return (await run('readwrite', [ORIGINALS], (tx) => { tx.objectStore(ORIGINALS).put(rec); })).ok; },
      async putTypeset(rec) { return (await run('readwrite', [TYPESET], (tx) => { tx.objectStore(TYPESET).put(rec); })).ok; },
      async getTypeset(id) {
        const r = await run('readonly', [TYPESET], (tx) => tx.objectStore(TYPESET).get(id));
        return r.ok ? (r.result.result || null) : null;
      },
      async getAllTypeset() {
        const r = await run('readonly', [TYPESET], (tx) => tx.objectStore(TYPESET).getAll());
        return r.ok ? (r.result.result || []) : [];
      },
      async getCleaned(id) {
        const r = await run('readonly', [CLEANED], (tx) => tx.objectStore(CLEANED).get(id));
        return r.ok ? (r.result.result || null) : null;
      },
      async getOriginal(id) {
        const r = await run('readonly', [ORIGINALS], (tx) => tx.objectStore(ORIGINALS).get(id));
        return r.ok ? (r.result.result || null) : null;
      },
      async deleteCleaned(id) { return (await run('readwrite', [CLEANED], (tx, validNames) => { validNames.forEach((n) => tx.objectStore(n).delete(id)); })).ok; },
      // Dùng khi tab sắp đóng: không có await nào giữa chừng nên giao dịch được tạo ngay trong sự kiện
      putStateSync(rec) {
        if (!dbHandle) return;
        try {
          if (dbHandle.objectStoreNames.contains(STATE)) {
            dbHandle.transaction([STATE], 'readwrite').objectStore(STATE).put(rec);
          }
        } catch (e) { /* bỏ qua */ }
      },
      async remove(id) {
        return (await run('readwrite', ALL, (tx, validNames) => {
          validNames.forEach((name) => tx.objectStore(name).delete(id));
        })).ok;
      },
      async clear() {
        return (await run('readwrite', ALL, (tx, validNames) => {
          validNames.forEach((name) => tx.objectStore(name).clear());
        })).ok;
      },
      open
    };
  })();

  let seqCounter = 0;
  let saveFailureShown = false;
  export const pendingSaves = new Map(); // id -> { timer, item }

  export function nextSeq() {
    seqCounter = (seqCounter + 1) % 1000;
    return Date.now() * 1000 + seqCounter; // tăng dần -> giữ đúng thứ tự trang khi khôi phục
  }

  export function serializePage(item) {
    return { id: item.id, seq: item.seq, name: item.name, sizeStr: item.sizeStr, base64: item.base64, hasOriginal: !!item.hasOriginal };
  }

  export function serializeState(item) {
    return {
      id: item.id,
      // 'processing' không phải trạng thái bền vững: nếu bị ngắt giữa chừng thì quay về 'idle'
      status: item.status === 'processing' ? 'idle' : item.status,
      stage: item.stage || 0, // 0: chưa làm gì | 1: đã OCR | 2: đã dịch
      ocrText: item.ocrText || '',
      viText: item.viText || '',
      bubbles: Array.isArray(item.bubbles) ? item.bubbles : [],
      typesetStatus: item.typesetStatus || 'idle',
      // Bước tẩy chữ có trạng thái riêng (độc lập với stage OCR/dịch)
      cleanStatus: item.cleanStatus === 'processing' ? (item.hasCleaned ? 'done' : 'idle') : (item.cleanStatus || 'idle'),
      hasCleaned: !!item.hasCleaned,
      cleanedMime: item.cleanedMime || '',
      updatedAt: Date.now()
    };
  }

  export function reportSaveFailure() {
    if (saveFailureShown) return;
    saveFailureShown = true;
    showToast('Lỗi: không lưu được tiến trình vào trình duyệt (bộ nhớ đầy hoặc đang ở chế độ ẩn danh). Hãy xuất .txt thường xuyên.');
  }

  // Thêm trang mới: ghi ảnh (1 lần) + trạng thái
  export async function persistNewPage(item) {
    if (!state.images.some(x => x.id === item.id)) return;
    const okPage = await store.putPage(serializePage(item));
    if (!state.images.some(x => x.id === item.id)) {
      await store.remove(item.id);
      return;
    }
    const okState = await store.putState(serializeState(item));
    if (!state.images.some(x => x.id === item.id)) {
      await store.remove(item.id);
      return;
    }
    if (!okPage || !okState) reportSaveFailure();
  }

  export async function persistNow(item) {
    if (!state.images.some(x => x.id === item.id)) return; // trang đã bị xóa
    const ok = await store.putState(serializeState(item));
    if (!state.images.some(x => x.id === item.id)) {
      await store.remove(item.id);
      return;
    }
    if (!ok) reportSaveFailure();
  }

  export function scheduleSave(item, delay = 300) {
    const prev = pendingSaves.get(item.id);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
      pendingSaves.delete(item.id);
      persistNow(item);
    }, delay);
    pendingSaves.set(item.id, { timer, item });
  }

  // Ghi ngay mọi thay đổi đang chờ (gọi khi ẩn tab / đóng trang)
  export function flushPendingSaves() {
    for (const { timer, item } of pendingSaves.values()) {
      clearTimeout(timer);
      if (state.images.includes(item)) store.putStateSync(serializeState(item));
    }
    pendingSaves.clear();
  }

  export function dropPendingSave(id) {
    const prev = pendingSaves.get(id);
    if (prev) clearTimeout(prev.timer);
    pendingSaves.delete(id);
  }

  window.addEventListener('pagehide', flushPendingSaves);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSaves();
  });

  export async function restoreSession() {
    await store.open();
    const rows = await store.loadAll();
    if (!rows.length) return;

    state.images = rows.map((r) => {
      const status = r.status === 'done' ? 'done' : (r.status === 'error' ? 'error' : 'idle');
      return {
        id: r.id,
        seq: r.seq || nextSeq(),
        name: r.name,
        sizeStr: r.sizeStr || '',
        base64: r.base64,
        status,
        stage: typeof r.stage === 'number' ? r.stage : (status === 'done' ? 2 : 0),
        dialogues: [],
        ocrText: r.ocrText || '',
        viText: r.viText || '',
        tokens: 0,
        hasOriginal: !!r.hasOriginal,
        hasCleaned: !!r.hasCleaned,
        cleanedMime: r.cleanedMime || '',
        cleanStatus: r.hasCleaned ? 'done' : (r.cleanStatus === 'error' ? 'error' : 'idle')
      };
    });

    const finished = state.images.filter((i) => i.stage >= 2).length;
    const remaining = state.images.length - finished;
    showToast(
      remaining > 0
        ? `Đã khôi phục ${state.images.length} trang (${finished} đã xong, ${remaining} còn lại). Bấm "OCR + Dịch" để làm tiếp phần còn lại.`
        : `Đã khôi phục ${state.images.length} trang, tất cả đã xong. Bạn có thể xuất .txt.`
    );
  }

  // Ngữ cảnh truyện: vài dòng dịch cuối của trang gần nhất đã có bản dịch (lùi tối đa 3 trang,
  // vì khi chạy 2 luồng song song thì trang ngay trước có thể chưa xong)
