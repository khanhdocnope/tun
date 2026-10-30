/**
 * Font Manager: Built-in manga fonts & dynamic custom font loading via FontFace API
 */
import { getCustomFonts, saveCustomFont, deleteCustomFont } from "./storage.js";

export const BUILTIN_FONTS = [
  { name: "Yuki Burobu", label: "Yuki Burobu (Manga chuẩn)", fallback: "sans-serif" },
  { name: "Anime Ace", label: "Anime Ace (Kinh điển)", fallback: "sans-serif" },
  { name: "Comic Neue", label: "Comic Neue (Hiện đại)", fallback: "cursive" },
  { name: "Yuki Arenzi", label: "Yuki Arenzi (Thoại gọn)", fallback: "sans-serif" },
  { name: "Yuki Marian", label: "Yuki Marian (Viết tay / Suy nghĩ)", fallback: "cursive" },
  { name: "Yuki CrashLanding", label: "Yuki CrashLanding (Hét / SFX)", fallback: "impact" },
  { name: "Yuki Chicken Pie", label: "Yuki Chicken Pie (Dễ thương / Chibi)", fallback: "comic sans ms" },
  { name: "Yuki Downhill", label: "Yuki Downhill (Kịch tính)", fallback: "sans-serif" },
  { name: "Yuki Gorrilaz", label: "Yuki Gorrilaz (Độc lạ / SFX)", fallback: "sans-serif" },
  { name: "Yuki Only Angel", label: "Yuki Only Angel (Lãng mạn)", fallback: "serif" },
  { name: "Yuki Tea And Oranges", label: "Yuki Tea And Oranges (Nhẹ nhàng)", fallback: "sans-serif" },
  { name: "Arial", label: "Arial (Hệ thống)", fallback: "sans-serif" },
  { name: "Times New Roman", label: "Times New Roman", fallback: "serif" },
];

export async function initFonts(selectElement) {
  // Load custom fonts from IndexedDB
  const customFonts = await getCustomFonts();
  for (const fontItem of customFonts) {
    try {
      const fontFace = new FontFace(fontItem.name, fontItem.buffer);
      await fontFace.load();
      document.fonts.add(fontFace);
    } catch (e) {
      console.warn(`Không thể nạp font tùy chỉnh ${fontItem.name}:`, e);
    }
  }

  if (selectElement) {
    populateFontSelect(selectElement);
  }
}

export async function populateFontSelect(selectElement) {
  if (!selectElement) return;
  const currentVal = selectElement.value;
  selectElement.innerHTML = "";

  const customFonts = await getCustomFonts();

  const optGroupBuiltin = document.createElement("optgroup");
  optGroupBuiltin.label = "Font Manga Việt hóa";
  BUILTIN_FONTS.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.name;
    opt.textContent = f.label;
    opt.style.fontFamily = `"${f.name}", ${f.fallback}`;
    optGroupBuiltin.appendChild(opt);
  });
  selectElement.appendChild(optGroupBuiltin);

  if (customFonts.length > 0) {
    const optGroupCustom = document.createElement("optgroup");
    optGroupCustom.label = "Font người dùng tải lên";
    customFonts.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.name;
      opt.textContent = `${f.name} (Tùy chỉnh)`;
      opt.style.fontFamily = `"${f.name}", sans-serif`;
      optGroupCustom.appendChild(opt);
    });
    selectElement.appendChild(optGroupCustom);
  }

  if (currentVal) {
    selectElement.value = currentVal;
  }
}

export async function loadUserFontFile(file) {
  if (!file) return null;
  const rawName = file.name.replace(/\.[^/.]+$/, "");
  const fontName = `UserFont_${rawName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  const arrayBuffer = await file.arrayBuffer();

  // Create FontFace
  const fontFace = new FontFace(fontName, arrayBuffer);
  await fontFace.load();
  document.fonts.add(fontFace);

  // Save to IndexedDB
  await saveCustomFont({
    id: fontName,
    name: fontName,
    displayName: rawName,
    buffer: arrayBuffer,
    format: file.name.endsWith(".woff2")
      ? "woff2"
      : file.name.endsWith(".woff")
      ? "woff"
      : file.name.endsWith(".otf")
      ? "opentype"
      : "truetype",
    uploadedAt: Date.now(),
  });

  return fontName;
}

export async function getAvailableFonts() {
  const customFonts = await getCustomFonts();
  return {
    builtin: BUILTIN_FONTS,
    custom: customFonts,
  };
}
