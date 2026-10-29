/**
 * Project Import/Export & Chapter ZIP Exporter
 * Supports .manga-proj JSON files and Chapter ZIP with merged typeset images (JPG 95% / PNG Lossless).
 */
import { getAllPages, savePage, clearAllPages, getGlossary, saveGlossaryItem } from "./storage.js";

/**
 * Xuất toàn bộ tiến độ Chapter thành file .manga-proj (JSON)
 */
export async function exportProjectJSON(chapterName = "Chapter_01") {
  const pages = await getAllPages();
  const glossary = await getGlossary();

  const projectData = {
    app: "Manga Translation & Typesetting Studio Pro",
    version: "2.0",
    exportedAt: new Date().toISOString(),
    chapterName: chapterName,
    glossary: glossary,
    pages: pages,
  };

  const jsonStr = JSON.stringify(projectData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${chapterName.replace(/[^a-zA-Z0-9_-]/g, "_")}.manga-proj`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Nhập file .manga-proj (JSON)
 */
export async function importProjectJSON(file) {
  if (!file) return null;
  const text = await file.text();
  const data = JSON.parse(text);

  if (!data.pages || !Array.isArray(data.pages)) {
    throw new Error("File .manga-proj không hợp lệ hoặc thiếu dữ liệu trang.");
  }

  // Xóa pages cũ và lưu pages mới
  await clearAllPages();
  for (const page of data.pages) {
    await savePage(page);
  }

  // Lưu glossary nếu có
  if (Array.isArray(data.glossary)) {
    for (const item of data.glossary) {
      await saveGlossaryItem(item);
    }
  }

  return data;
}

/**
 * Xuất toàn bộ Chapter thành file .ZIP chứa các trang ảnh hoàn chỉnh đã typeset
 * @param {Array} pages
 * @param {Object} options - { format: 'jpeg'|'png', quality: 0.95, filename: 'Chapter_01_Typeset.zip', onProgress: (cur, total) => {} }
 */
export async function exportChapterZip(pages, options = {}) {
  if (!window.JSZip) {
    throw new Error("Thư viện JSZip chưa được nạp.");
  }

  const zip = new window.JSZip();
  const format = options.format === "png" ? "png" : "jpeg";
  const quality = options.quality !== undefined ? options.quality : 0.95;
  const ext = format === "png" ? "png" : "jpg";
  const onProgress = options.onProgress || (() => {});

  let scriptTxt = `=================================================\nKỊCH BẢN DỊCH VÀ TYPESET CHAPTER\nXuất bản lúc: ${new Date().toLocaleString("vi-VN")}\nTổng số trang: ${pages.length}\n=================================================\n\n`;

  // Render từng trang bằng canvas offscreen
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    onProgress(i + 1, pages.length, page.fileName || `Trang ${i + 1}`);

    const fileName = `${String(i + 1).padStart(3, "0")}.${ext}`;

    // Tạo Canvas offscreen để gộp ảnh nền + chữ typeset
    const blob = await renderPageToBlob(page, format, quality);
    zip.file(fileName, blob);

    // Bổ sung vào script.txt
    scriptTxt += `=== TRANG ${String(i + 1).padStart(2, "0")} (${page.fileName || fileName}) ===\n`;
    if (page.boxes && page.boxes.length > 0) {
      page.boxes.forEach((b) => {
        scriptTxt += `[#${b.order}] ${b.textJa ? `[JP: ${b.textJa}] ` : ""}${b.textVi || b.text || ""}\n`;
      });
    } else {
      scriptTxt += `(Không có câu thoại)\n`;
    }
    scriptTxt += `\n`;
  }

  // Thêm file kịch bản text vào ZIP
  zip.file("script_translation.txt", scriptTxt);

  // Tạo file ZIP
  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const downloadName = options.filename || `Chapter_Typeset_${Date.now()}.zip`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(zipBlob);
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Render trang đơn lẻ thành Blob bằng canvas native để đảm bảo độ phân giải gốc
 */
async function renderPageToBlob(page, format = "jpeg", quality = 0.95) {
  const bgSrc = page.cleanedImage || page.rawImage;
  if (!bgSrc) {
    throw new Error(`Trang ${page.fileName || page.id} thiếu dữ liệu ảnh.`);
  }

  const img = new Image();
  img.crossOrigin = "anonymous";

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = bgSrc;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");

  // Vẽ ảnh nền
  ctx.drawImage(img, 0, 0);

  // Vẽ các Textbox
  if (Array.isArray(page.boxes)) {
    page.boxes.forEach((box) => {
      const text = box.textVi || box.text || "";
      if (!text) return;

      const style = box.style || {};
      const fontFamily = style.fontFamily || "Yuki Burobu";
      const fontSize = style.fontSize || 20;
      const fill = style.fill || "#000000";
      const stroke = style.stroke || "#ffffff";
      const strokeWidth = style.strokeWidth !== undefined ? style.strokeWidth : 3;
      const align = style.align || "center";
      const lineHeight = style.lineHeight || 1.15;
      const isBold = style.bold ? "bold " : "";
      const isItalic = style.italic ? "italic " : "";

      ctx.save();
      ctx.font = `${isItalic}${isBold}${fontSize}px "${fontFamily}", sans-serif`;
      ctx.textAlign = align;
      ctx.textBaseline = "top";

      // Wrap text
      const maxWidth = Math.max(40, box.width || 160);
      const lines = wrapTextLines(ctx, text, maxWidth);
      const lineSpacing = fontSize * lineHeight;

      const x = box.x || 0;
      const y = box.y || 0;

      lines.forEach((line, lineIdx) => {
        let drawX = x;
        if (align === "center") {
          drawX = x + maxWidth / 2;
        } else if (align === "right") {
          drawX = x + maxWidth;
        }
        const drawY = y + lineIdx * lineSpacing;

        // Vẽ stroke viền trước
        if (strokeWidth > 0 && stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = strokeWidth * 2;
          ctx.lineJoin = "round";
          ctx.miterLimit = 2;
          ctx.strokeText(line, drawX, drawY);
        }

        // Vẽ ruột chữ đè lên trên
        ctx.fillStyle = fill;
        ctx.fillText(line, drawX, drawY);
      });

      ctx.restore();
    });
  }

  const mime = format === "png" ? "image/png" : "image/jpeg";
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

function wrapTextLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let currentLine = "";

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [text];
}
