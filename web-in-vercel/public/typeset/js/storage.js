/**
 * IndexedDB Storage for Manga Translation & Typesetting Studio V2
 * Stores chapters, pages, dialog boxes, glossary, custom fonts, and settings.
 */

const DB_NAME = "manga_typeset_studio_v2";
const DB_VERSION = 1;

let dbPromise = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("chapters")) {
          db.createObjectStore("chapters", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("pages")) {
          const pageStore = db.createObjectStore("pages", { keyPath: "id" });
          pageStore.createIndex("chapterId", "chapterId", { unique: false });
          pageStore.createIndex("index", "index", { unique: false });
        }
        if (!db.objectStoreNames.contains("glossary")) {
          db.createObjectStore("glossary", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("custom_fonts")) {
          db.createObjectStore("custom_fonts", { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

// ---------------- Settings ----------------
export async function getSetting(key, defaultValue = null) {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction("settings", "readonly");
      const store = tx.objectStore("settings");
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : defaultValue);
      req.onerror = () => resolve(defaultValue);
    });
  } catch (e) {
    console.warn("Storage getSetting error:", e);
    return defaultValue;
  }
}

export async function setSetting(key, value) {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      const store = tx.objectStore("settings");
      const req = store.put({ key, value, updatedAt: Date.now() });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error("Storage setSetting error:", e);
  }
}

// ---------------- Pages ----------------
export async function savePage(page) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pages", "readwrite");
    const store = tx.objectStore("pages");
    const req = store.put({
      ...page,
      updatedAt: Date.now(),
    });
    req.onsuccess = () => resolve(page.id);
    req.onerror = () => reject(req.error);
  });
}

export async function getPage(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pages", "readonly");
    const store = tx.objectStore("pages");
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllPages(chapterId = "default") {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pages", "readonly");
    const store = tx.objectStore("pages");
    const req = store.getAll();
    req.onsuccess = () => {
      let list = req.result || [];
      if (chapterId) {
        list = list.filter((p) => !p.chapterId || p.chapterId === chapterId);
      }
      list.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deletePage(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pages", "readwrite");
    const store = tx.objectStore("pages");
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllPages(chapterId = "default") {
  const pages = await getAllPages(chapterId);
  const db = await getDB();
  const tx = db.transaction("pages", "readwrite");
  const store = tx.objectStore("pages");
  for (const p of pages) {
    store.delete(p.id);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------- Glossary ----------------
export async function getGlossary() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("glossary", "readonly");
    const store = tx.objectStore("glossary");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function saveGlossaryItem(item) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("glossary", "readwrite");
    const store = tx.objectStore("glossary");
    const id = item.id || `term_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const req = store.put({ ...item, id });
    req.onsuccess = () => resolve(id);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteGlossaryItem(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("glossary", "readwrite");
    const store = tx.objectStore("glossary");
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// ---------------- Custom Fonts ----------------
export async function getCustomFonts() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("custom_fonts", "readonly");
    const store = tx.objectStore("custom_fonts");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCustomFont(fontData) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("custom_fonts", "readwrite");
    const store = tx.objectStore("custom_fonts");
    const req = store.put(fontData);
    req.onsuccess = () => resolve(fontData.id);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteCustomFont(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("custom_fonts", "readwrite");
    const store = tx.objectStore("custom_fonts");
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
