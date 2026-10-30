/**
 * Master Controller for Manga Translation & Typesetting Studio (Tab 1)
 */
import {
  getAllPages,
  savePage,
  deletePage,
  clearAllPages,
  getSetting,
  setSetting,
  getGlossary,
  saveGlossaryItem,
  deleteGlossaryItem,
} from "./storage.js";
import { initFonts, populateFontSelect, loadUserFontFile, BUILTIN_FONTS, getAvailableFonts } from "./font-manager.js";
import { TypesetCanvasEditor } from "./canvas-editor.js";
import { SmartMaskTool } from "./smart-mask.js";
import { MangaReaderPreview } from "./reader-preview.js";
import { translateText, runOcrOnRegion, GENRE_PRESETS } from "./translator.js";
import { exportProjectJSON, importProjectJSON, exportChapterZip } from "./export-project.js";
import { WebLamaEngine } from "./web-lama.js";

export async function optimizeImageBase64(dataUrlOrFile, maxDim = 2048, quality = 0.92) {
  return new Promise((resolve, reject) => {
    function processSrc(dataUrl) {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        const maxCurrent = Math.max(w, h);

        if (maxCurrent <= maxDim && dataUrl.length < 2 * 1024 * 1024 && !dataUrl.startsWith("data:image/png")) {
          return resolve(dataUrl);
        }

        if (maxCurrent > maxDim) {
          const ratio = maxDim / maxCurrent;
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const optimized = canvas.toDataURL("image/jpeg", quality);
        resolve(optimized);
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    }

    if (typeof dataUrlOrFile === "string") {
      processSrc(dataUrlOrFile);
    } else if (dataUrlOrFile instanceof Blob || dataUrlOrFile instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => processSrc(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(dataUrlOrFile);
    } else {
      resolve(dataUrlOrFile);
    }
  });
}

export class TypesetStudioApp {
  constructor() {
    this.pages = [];
    this.currentPageIndex = 0;
    this.viewMode = "editor"; // 'editor' | 'reader'
    this.editor = null;
    this.smartMask = new SmartMaskTool();
    this.reader = null;

    this.currentMaskRegion = null;
    this.currentMaskData = null;

    this.webLama = new WebLamaEngine({
      onStatusChange: (status) => this.handleWebLamaStatus(status),
    });

    this.init();
  }

  async init() {
    // 1. Khởi tạo fonts
    const fontSelect = document.getElementById("typesetFontFamily");
    await initFonts(fontSelect);
    this.availableFonts = await getAvailableFonts();

    // 2. Khởi tạo WebLama Engine trong Web Worker ngầm (không chặn giao diện)
    this.webLama.init().catch((err) => console.warn("Lỗi khởi tạo WebLama:", err));

    // 2. Khởi tạo Canvas Editor
    this.editor = new TypesetCanvasEditor("typesetCanvas", {
      onSelectionChanged: (boxData) => this.handleBoxSelected(boxData),
      onBoxModified: (boxData) => this.handleBoxModified(boxData),
      onBoxesListChanged: (boxes) => {
        this.renderParallelDialogs(boxes);
        this.saveCurrentPageState();
      },
      onRegionSelected: (rect, evt) => this.handleRegionSelected(rect, evt),
      onZoomChanged: (zoom) => {
        const zoomEl = document.getElementById("typesetZoomLevel");
        if (zoomEl) zoomEl.textContent = `${zoom}%`;
      },
      onToolChanged: (tool) => this.handleToolChanged(tool),
    });

    // 3. Khởi tạo Reader Preview
    const readerContainer = document.getElementById("typesetReaderContainer");
    this.reader = new MangaReaderPreview(readerContainer, {
      onSelectPage: (index) => {
        this.switchViewMode("editor");
        this.selectPage(index);
      },
      onStatusChanged: async (pageId, nextStatus) => {
        const page = this.pages.find((p) => p.id === pageId);
        if (page) {
          page.status = nextStatus;
          await savePage(page);
          this.renderPagesList();
          this.reader.setPages(this.pages, this.currentPageIndex);
        }
      },
    });

    // 4. Load dữ liệu từ IndexedDB
    await this.loadPagesFromDB();

    // 5. Gắn sự kiện giao diện
    this.bindUIEvents();
    this.bindFloatingMaskEvents();
    this.bindFontPanelEvents();
    this.bindRightPanelTabs();
    this.bindSettingsEvents();
  }

  async loadPagesFromDB() {
    this.pages = await getAllPages();
    if (this.pages.length === 0) {
      // Hiển thị trạng thái trống
      this.updateEmptyState(true);
    } else {
      this.updateEmptyState(false);
      this.renderPagesList();
      this.selectPage(0);
    }
    this.reader.setPages(this.pages, this.currentPageIndex);
  }

  updateEmptyState(isEmpty) {
    const emptyEl = document.getElementById("typesetEmptyDropzone");
    const workspaceEl = document.getElementById("typesetWorkspaceContent");
    if (emptyEl && workspaceEl) {
      emptyEl.style.display = isEmpty ? "flex" : "none";
      workspaceEl.style.display = isEmpty ? "none" : "flex";
    }
  }

  // ---------------- Page Management ----------------
  renderPagesList() {
    const listEl = document.getElementById("typesetPagesList");
    if (!listEl) return;
    listEl.innerHTML = "";

    const countBadge = document.getElementById("typesetPageCountBadge");
    if (countBadge) countBadge.textContent = `${this.pages.length} trang`;

    this.pages.forEach((page, idx) => {
      const card = document.createElement("div");
      card.className = `page-thumb-card ${idx === this.currentPageIndex ? "active" : ""}`;

      const status = page.status || "pending";
      const statusText = status === "approved" ? "Đã duyệt" : status === "editing" ? "Đang sửa" : "Chưa xong";
      const statusClass = `badge-status-${status}`;

      card.innerHTML = `
        <div class="thumb-header">
          <span class="thumb-index">#${String(idx + 1).padStart(2, "0")}</span>
          <span class="badge-status-mini ${statusClass}" title="${statusText}"></span>
          <button class="btn-thumb-del" title="Xóa trang này">&times;</button>
        </div>
        <div class="thumb-img-wrap">
          <img src="${page.cleanedImage || page.rawImage}" alt="Page ${idx + 1}" loading="lazy">
        </div>
        <div class="thumb-footer">
          <span class="thumb-filename" title="${page.fileName}">${page.fileName || `Trang ${idx + 1}`}</span>
          <span class="thumb-box-count">${page.boxes ? page.boxes.length : 0} bóng</span>
        </div>
      `;

      card.addEventListener("click", () => this.selectPage(idx));
      card.querySelector(".btn-thumb-del").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (confirm(`Bạn có chắc chắn muốn xóa trang #${idx + 1} (${page.fileName}) không?`)) {
          await this.deletePageAtIndex(idx);
        }
      });

      listEl.appendChild(card);
    });
  }

  async selectPage(index) {
    if (index < 0 || index >= this.pages.length) return;

    // Lưu lại trạng thái trang cũ trước khi chuyển
    await this.saveCurrentPageState();

    this.currentPageIndex = index;
    const page = this.pages[index];

    // Cập nhật class active trong danh sách
    const cards = document.querySelectorAll(".page-thumb-card");
    cards.forEach((c, i) => c.classList.toggle("active", i === index));

    // Cập nhật tiêu đề trang hiện tại
    const titleEl = document.getElementById("typesetCurrentPageTitle");
    if (titleEl) titleEl.textContent = `Trang #${index + 1}: ${page.fileName || "Ảnh"}`;

    // Load lên Fabric Canvas
    await this.editor.loadPage(page);

    // Cập nhật Bảng kịch bản bên phải
    this.renderParallelDialogs(page.boxes || []);

    // Ẩn floating mask nếu đang mở
    this.hideFloatingMask();
  }

  async saveCurrentPageState() {
    if (this.pages.length === 0 || this.currentPageIndex < 0 || this.currentPageIndex >= this.pages.length) return;
    const page = this.pages[this.currentPageIndex];
    if (!page) return;

    // Lấy danh sách boxes hiện tại từ Fabric Canvas
    page.boxes = this.editor.getAllBoxesData();
    page.updatedAt = Date.now();
    await savePage(page);
  }

  async deletePageAtIndex(index) {
    const page = this.pages[index];
    if (page) {
      await deletePage(page.id);
      this.pages.splice(index, 1);
      if (this.pages.length === 0) {
        this.updateEmptyState(true);
      } else {
        const nextIdx = Math.max(0, Math.min(this.currentPageIndex, this.pages.length - 1));
        this.renderPagesList();
        this.selectPage(nextIdx);
      }
      this.reader.setPages(this.pages, this.currentPageIndex);
    }
  }

  handleToolChanged(tool) {
    const toolToBtn = {
      select: "btnToolSelect",
      pan: "btnToolHand",
      region: "btnToolRegion",
      brush: "btnToolBrush",
      eraser: "btnToolEraser",
      text: "btnToolText",
    };
    const targetBtnId = toolToBtn[tool];
    if (targetBtnId) {
      Object.values(toolToBtn).forEach((btnId) => {
        document.getElementById(btnId)?.classList.remove("active");
      });
      document.getElementById(targetBtnId)?.classList.add("active");
    }
  }

  async handleAddImages(files) {
    if (!files || files.length === 0) return;

    // Sắp xếp tự nhiên tên file
    const fileList = Array.from(files).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );

    const prevCount = this.pages.length;
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file.type.startsWith("image/")) continue;

      const dataUrl = await optimizeImageBase64(file, 2048, 0.92);

      const newPage = {
        id: `page_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        chapterId: "default",
        index: this.pages.length,
        fileName: file.name,
        status: "pending",
        rawImage: dataUrl,
        cleanedImage: dataUrl,
        boxes: [],
      };

      await savePage(newPage);
      this.pages.push(newPage);
    }

    const addedCount = this.pages.length - prevCount;
    if (addedCount > 0) {
      this.updateEmptyState(false);
      this.renderPagesList();
      this.reader.setPages(this.pages, this.currentPageIndex);
      const targetIdx = prevCount === 0 ? 0 : prevCount;
      this.selectPage(targetIdx);
      this.showToast(`Đã nạp ${addedCount} trang vào Manga Studio!`, "success");
    }
  }

  // ---------------- Smart Region & Floating Mask Toolbar ----------------
  handleRegionSelected(rect, mouseEvent) {
    if (!this.editor.backgroundImage || !this.editor.backgroundImage._element) return;

    this.currentMaskRegion = rect;
    const imgEl = this.editor.backgroundImage._element;

    // 1. Tạo Auto-snap mask bằng thuật toán Otsu + Dilation
    const snapResult = this.smartMask.createSnapMask(imgEl, rect, 3);
    this.currentMaskData = snapResult;

    // 2. Định vị Floating Toolbar ngay trên/dưới vùng chọn trên màn hình
    this.showFloatingMask(rect);
  }

  showFloatingMask(rect) {
    const toolbar = document.getElementById("floatingMaskToolbar");
    const canvasWrap = document.getElementById("typesetCanvasContainer");
    if (!toolbar || !canvasWrap) return;

    const vpt = this.editor.fabricCanvas.viewportTransform;
    const zoom = this.editor.fabricCanvas.getZoom();

    toolbar.style.display = "flex";
    const tbWidth = toolbar.offsetWidth || 440;
    const tbHeight = toolbar.offsetHeight || 44;

    const boxLeft = vpt[4] + rect.x * zoom;
    const boxTop = vpt[5] + rect.y * zoom;
    const boxWidth = rect.width * zoom;

    // Căn giữa toolbar theo chiều ngang của vùng chọn
    let targetX = boxLeft + (boxWidth - tbWidth) / 2;
    const maxX = Math.max(16, canvasWrap.clientWidth - tbWidth - 16);
    targetX = Math.max(16, Math.min(maxX, targetX));

    // Đặt toolbar nổi phía trên vùng chọn, nếu chạm mép trên thì đưa xuống dưới
    let targetY = boxTop - tbHeight - 12;
    if (targetY < 12) {
      targetY = boxTop + (rect.height * zoom) + 12;
    }
    const maxY = Math.max(12, canvasWrap.clientHeight - tbHeight - 16);
    targetY = Math.max(12, Math.min(maxY, targetY));

    toolbar.style.left = `${Math.round(targetX)}px`;
    toolbar.style.top = `${Math.round(targetY)}px`;

    // Hiển thị canvas mask overlay lên vị trí vùng chọn
    this.renderMaskOverlayOnCanvas();
  }

  hideFloatingMask() {
    const toolbar = document.getElementById("floatingMaskToolbar");
    if (toolbar) toolbar.style.display = "none";
    this.removeMaskOverlay();
    this.currentMaskRegion = null;
    this.currentMaskData = null;
  }

  renderMaskOverlayOnCanvas() {
    this.removeMaskOverlay();
    if (!this.currentMaskRegion || !this.smartMask.maskCanvas) return;

    const maskImg = new fabric.Image(this.smartMask.maskCanvas, {
      left: this.currentMaskRegion.x,
      top: this.currentMaskRegion.y,
      width: this.currentMaskRegion.width,
      height: this.currentMaskRegion.height,
      selectable: false,
      evented: false,
      opacity: 0.85,
    });
    maskImg.isMaskOverlay = true;
    this.editor.fabricCanvas.add(maskImg);
    this.editor.fabricCanvas.renderAll();
  }

  removeMaskOverlay() {
    const overlay = this.editor.fabricCanvas.getObjects().find((o) => o.isMaskOverlay);
    if (overlay) {
      this.editor.fabricCanvas.remove(overlay);
      this.editor.fabricCanvas.renderAll();
    }
  }

  bindFloatingMaskEvents() {
    const toolbar = document.getElementById("floatingMaskToolbar");
    if (!toolbar) return;

    // Brush Tool (B)
    document.getElementById("btnMaskBrush")?.addEventListener("click", () => {
      this.editor.setTool("brush");
      this.highlightMaskToolBtn("btnMaskBrush");
    });

    // Eraser Tool (E)
    document.getElementById("btnMaskEraser")?.addEventListener("click", () => {
      this.editor.setTool("eraser");
      this.highlightMaskToolBtn("btnMaskEraser");
    });

    // Dilation Slider
    const dilationRange = document.getElementById("maskDilationRange");
    const dilationVal = document.getElementById("maskDilationVal");
    dilationRange?.addEventListener("input", () => {
      const val = Number(dilationRange.value);
      if (dilationVal) dilationVal.textContent = `+${val}px`;
      this.smartMask.applyDilation(val);
      this.renderMaskOverlayOnCanvas();
    });

    // Nút "Xóa chữ (Inpaint)" -> Gửi mask sang backend AOT
    document.getElementById("btnMaskInpaint")?.addEventListener("click", async () => {
      await this.runRegionInpaint();
    });

    // Nút "Tự OCR" -> Bóc text tiếng Nhật
    document.getElementById("btnMaskOcr")?.addEventListener("click", async () => {
      await this.runRegionOcrAndTranslate(false);
    });

    // Nút "Chèn Box Typeset" -> OCR + Dịch + Tạo Textbox ngay lập tức
    document.getElementById("btnMaskInsertBox")?.addEventListener("click", async () => {
      await this.runRegionOcrAndTranslate(true);
    });

    // Nút đóng Floating toolbar
    document.getElementById("btnCloseMaskToolbar")?.addEventListener("click", () => {
      this.hideFloatingMask();
      this.editor.setTool("select");
    });
  }

  highlightMaskToolBtn(id) {
    ["btnMaskBrush", "btnMaskEraser"].forEach((btnId) => {
      const b = document.getElementById(btnId);
      if (b) b.classList.toggle("active", btnId === id);
    });
  }

  async runRegionInpaint() {
    if (!this.currentMaskRegion) return;
    const btn = document.getElementById("btnMaskInpaint");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner-mini"></span> Đang xóa...`;
    }

    try {
      const page = this.pages[this.currentPageIndex];
      const preferWebLama = await getSetting("prefer_web_lama", true);

      // 1. Thử chạy trực tiếp trên trình duyệt bằng Web Manga LaMa (WebGPU / WASM)
      if (preferWebLama && this.webLama && this.webLama.isReady && this.editor.backgroundImage?._element) {
        try {
          const imgEl = this.editor.backgroundImage._element;
          const maskCanvas = this.smartMask.exportFullPageMaskCanvas(this.editor.pageWidth, this.editor.pageHeight);

          const result = await this.webLama.inpaintCrop(imgEl, maskCanvas, this.currentMaskRegion);
          if (result && result.cleanedDataUrl) {
            page.cleanedImage = result.cleanedDataUrl;
            await savePage(page);
            await this.editor.setBackground(page.cleanedImage);
            this.renderPagesList();
            this.hideFloatingMask();
            this.showToast(`⚡ Đã xóa chữ bằng Web LaMa (${result.device.toUpperCase()}) trong ${result.durationMs}ms!`, "success");
            return;
          }
        } catch (webErr) {
          console.warn("Web LaMa inpaint lỗi, tự động chuyển sang Cloud Backend:", webErr);
          this.showToast(`WebGPU gặp lỗi (${webErr.message}), chuyển sang Cloud...`, "info");
        }
      }

      // 2. Fallback sang Cloud Backend hoặc Local Backend
      const fullMaskB64 = this.smartMask.exportFullPageMaskB64(this.editor.pageWidth, this.editor.pageHeight);
      const backendUrl = await getSetting("backend_url", "https://dobietdc-manga-text-cleaner.hf.space");
      const inpaintModel = "aot";

      const resp = await fetch("/api/clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: page.cleanedImage || page.rawImage,
          maskBase64: fullMaskB64,
          inpainter: inpaintModel,
          detector: "default",
          backendUrl: backendUrl,
        }),
      });

      if (!resp.ok) {
        let errText = "";
        try {
          const errObj = await resp.json();
          errText = errObj.error || errObj.detail || JSON.stringify(errObj);
        } catch (_) {
          errText = await resp.text();
        }
        throw new Error(errText);
      }

      const resJson = await resp.json();
      if (resJson.cleanedImageBase64) {
        page.cleanedImage = resJson.cleanedImageBase64;
        await savePage(page);
        await this.editor.setBackground(page.cleanedImage);
        this.renderPagesList();
        this.hideFloatingMask();
        this.showToast("☁️ Đã tẩy chữ qua Cloud Backend thành công!", "success");
      }
    } catch (e) {
      console.error("Region inpaint error:", e);
      this.showToast(`Lỗi tẩy chữ: ${e.message}`, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles text-xs"></i> <span>Xóa chữ (LaMa)</span>`;
      }
    }
  }

  async runRegionOcrAndTranslate(insertTextbox = true) {
    if (!this.currentMaskRegion) return;
    const btn = insertTextbox ? document.getElementById("btnMaskInsertBox") : document.getElementById("btnMaskOcr");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner-mini"></span> Đang xử lý...`;
    }

    try {
      const imgEl = this.editor.backgroundImage._element;
      const cropB64 = this.smartMask.cropRegionB64(imgEl, this.currentMaskRegion);

      // 1. OCR tiếng Nhật
      const textJa = await runOcrOnRegion(cropB64);

      // 2. Dịch sang tiếng Việt
      let textVi = "";
      if (textJa) {
        textVi = await translateText(textJa);
      } else {
        textVi = "Lời thoại mới";
      }

      if (insertTextbox) {
        const rect = this.currentMaskRegion;
        const box = this.editor.createNewTextBox(rect.x, rect.y, textVi);
        box.textJa = textJa;
        box.set({
          width: Math.max(60, rect.width),
        });
        // Tự động co chữ vừa khít chiều cao vùng chọn
        this.editor.autoFitFontSize(box, rect.height);
        this.editor.autoInvertColors(box);

        this.hideFloatingMask();
        this.editor.setTool("select");
        this.renderParallelDialogs(this.editor.getAllBoxesData());
        this.saveCurrentPageState();
        this.showToast("Đã chèn Box Typeset thành công!", "success");
      } else {
        this.showToast(`OCR được: ${textJa || "(Trống)"}`, "info");
      }
    } catch (e) {
      console.error("Region OCR/Translate error:", e);
      this.showToast(`Lỗi OCR/Dịch: ${e.message}`, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = insertTextbox ? `📝 Chèn Box Typeset` : `🔍 Tự OCR`;
      }
    }
  }

  // ---------------- Side-by-side Dialog Panel ----------------
  renderParallelDialogs(boxes) {
    const listEl = document.getElementById("paneParallelDialogs") || document.getElementById("parallelDialogList");
    const countBadge = document.getElementById("rightDialogsCountBadge");
    if (countBadge) countBadge.textContent = boxes ? boxes.length : 0;
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!boxes || boxes.length === 0) {
      listEl.innerHTML = `
        <div class="dialogs-empty-state">
          <div class="empty-icon-wrap">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
          </div>
          <h4>Chưa có lời thoại nào</h4>
          <p>Dùng chuột khoanh vùng bóng thoại trên tranh để bóc chữ và dịch, hoặc bấm nút dưới để AI tự động làm tất cả.</p>
          <button type="button" class="btn-empty-auto" id="btnEmptyAutoPipeline">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
            <span>⚡ Tự động quét cả trang</span>
          </button>
          <div class="empty-hotkey-guide">
            <div class="hotkey-item"><kbd>V</kbd> <span>Chọn & Di chuyển bóng thoại</span></div>
            <div class="hotkey-item"><kbd>B</kbd> <span>Cọ vẽ bù mask nét chữ</span></div>
            <div class="hotkey-item"><kbd>E</kbd> <span>Tẩy bớt phần mask lem</span></div>
            <div class="hotkey-item"><kbd>T</kbd> <span>Thêm hộp thoại mới</span></div>
            <div class="hotkey-item"><kbd>Space</kbd> <span>Nhấn giữ xem tranh gốc</span></div>
          </div>
        </div>
      `;
      document.getElementById("btnEmptyAutoPipeline")?.addEventListener("click", () => {
        this.runAutoPipelineCurrentPage();
      });
      return;
    }

    const builtinList = this.availableFonts?.builtin || BUILTIN_FONTS;
    const customList = this.availableFonts?.custom || [];

    boxes.forEach((box) => {
      const item = document.createElement("div");
      item.className = "dialog-row-card";
      item.dataset.boxId = box.id;

      const curFont = box.style?.fontFamily || "Yuki Burobu";
      const curSize = box.style?.fontSize || 20;
      const curAlign = box.style?.align || "center";
      const isBold = Boolean(box.style?.bold);
      const isItalic = Boolean(box.style?.italic);

      // Render danh sách font
      let fontOptionsHtml = "";
      builtinList.forEach((f) => {
        const isSel = f.name === curFont ? "selected" : "";
        fontOptionsHtml += `<option value="${f.name}" ${isSel} style="font-family: '${f.name}', ${f.fallback}">${f.label}</option>`;
      });
      if (customList.length > 0) {
        fontOptionsHtml += `<optgroup label="Font của bạn">`;
        customList.forEach((cf) => {
          const isSel = cf.name === curFont ? "selected" : "";
          fontOptionsHtml += `<option value="${cf.name}" ${isSel}>${cf.name}</option>`;
        });
        fontOptionsHtml += `</optgroup>`;
      }

      item.innerHTML = `
        <div class="dialog-row-header">
          <span class="dialog-order-badge">#${box.order}</span>
          <div class="dialog-row-actions">
            <button class="btn-mini-action btn-fit" title="Tự động co chữ vừa khung">↔ Auto Fit</button>
            <button class="btn-mini-action btn-invert" title="Đảo màu theo nền (Trắng/Đen)">🌓 Đảo màu</button>
            <button class="btn-mini-action btn-del" title="Xóa bóng thoại này">&times;</button>
          </div>
        </div>
        <div class="dialog-input-group">
          <div class="input-subgroup">
            <div class="input-label-row">
              <span class="input-label">JP (Gốc):</span>
              <button type="button" class="btn-retrans" title="Dịch lại câu này">🔄 Dịch lại</button>
            </div>
            <input type="text" class="input-jp" value="${box.textJa || ""}" placeholder="Chưa có text tiếng Nhật...">
          </div>
          <div class="input-subgroup">
            <div class="input-label-row">
              <span class="input-label" style="color: #38bdf8;">VI (Bản dịch):</span>
            </div>
            <textarea class="textarea-vi" rows="2" placeholder="Nhập bản dịch tiếng Việt...">${box.textVi || ""}</textarea>
          </div>
        </div>

        <!-- Smart Inspector: Quick Typography Bar trực tiếp trên thẻ thoại -->
        <div class="dialog-quick-toolbar">
          <select class="quick-font-select" title="Đổi Font chữ cho câu này">
            ${fontOptionsHtml}
          </select>

          <div class="quick-size-stepper" title="Tăng giảm cỡ chữ">
            <button type="button" class="btn-step-size btn-dec-size" title="Giảm 1px">-</button>
            <span class="badge-size-val">${curSize}px</span>
            <button type="button" class="btn-step-size btn-inc-size" title="Tăng 1px">+</button>
          </div>

          <div class="quick-align-group">
            <button type="button" class="btn-step-align ${curAlign === "left" ? "active" : ""}" data-align="left" title="Căn trái">
              <i class="fa-solid fa-align-left"></i>
            </button>
            <button type="button" class="btn-step-align ${curAlign === "center" ? "active" : ""}" data-align="center" title="Căn giữa">
              <i class="fa-solid fa-align-center"></i>
            </button>
            <button type="button" class="btn-step-align ${curAlign === "right" ? "active" : ""}" data-align="right" title="Căn phải">
              <i class="fa-solid fa-align-right"></i>
            </button>
          </div>

          <button type="button" class="btn-quick-btn btn-bold ${isBold ? "active" : ""}" title="In đậm">
            <i class="fa-solid fa-bold"></i>
          </button>
          <button type="button" class="btn-quick-btn btn-italic ${isItalic ? "active" : ""}" title="In nghiêng">
            <i class="fa-solid fa-italic"></i>
          </button>
        </div>
      `;

      // Click vào card để focus vào Textbox trên Canvas
      item.addEventListener("click", () => {
        this.editor.selectBoxById(box.id);
      });

      // Thay đổi text tiếng Việt cập nhật Canvas ngay lập tức
      const textareaVi = item.querySelector(".textarea-vi");
      textareaVi.addEventListener("input", (e) => {
        e.stopPropagation();
        this.editor.updateBoxText(box.id, e.target.value);
      });

      // Thay đổi text tiếng Nhật
      const inputJp = item.querySelector(".input-jp");
      inputJp.addEventListener("change", (e) => {
        e.stopPropagation();
        box.textJa = e.target.value;
      });

      // Nút Dịch lại câu này
      item.querySelector(".btn-retrans").addEventListener("click", async (e) => {
        e.stopPropagation();
        const textJpVal = inputJp.value.trim();
        if (!textJpVal) return;
        const newVi = await translateText(textJpVal);
        textareaVi.value = newVi;
        this.editor.updateBoxText(box.id, newVi);
      });

      // Smart Inspector: Đổi font
      const quickFontSel = item.querySelector(".quick-font-select");
      quickFontSel.addEventListener("change", (e) => {
        e.stopPropagation();
        this.editor.updateBoxStyle(box.id, { fontFamily: e.target.value });
      });

      // Smart Inspector: Tăng/giảm cỡ chữ
      const sizeValBadge = item.querySelector(".badge-size-val");
      item.querySelector(".btn-dec-size").addEventListener("click", (e) => {
        e.stopPropagation();
        const tb = this.editor.fabricCanvas.getObjects().find((o) => o.id === box.id);
        const cur = tb ? tb.fontSize : curSize;
        const next = Math.max(8, cur - 1);
        sizeValBadge.textContent = `${next}px`;
        this.editor.updateBoxStyle(box.id, { fontSize: next });
      });

      item.querySelector(".btn-inc-size").addEventListener("click", (e) => {
        e.stopPropagation();
        const tb = this.editor.fabricCanvas.getObjects().find((o) => o.id === box.id);
        const cur = tb ? tb.fontSize : curSize;
        const next = Math.min(140, cur + 1);
        sizeValBadge.textContent = `${next}px`;
        this.editor.updateBoxStyle(box.id, { fontSize: next });
      });

      // Smart Inspector: Căn lề
      item.querySelectorAll(".btn-step-align").forEach((alignBtn) => {
        alignBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const alignVal = alignBtn.dataset.align;
          item.querySelectorAll(".btn-step-align").forEach((b) => b.classList.toggle("active", b === alignBtn));
          this.editor.updateBoxStyle(box.id, { textAlign: alignVal });
        });
      });

      // Smart Inspector: Bold & Italic
      const boldBtn = item.querySelector(".btn-bold");
      boldBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tb = this.editor.fabricCanvas.getObjects().find((o) => o.id === box.id);
        const isCurrentlyBold = tb ? tb.fontWeight === "bold" : isBold;
        const nextBold = !isCurrentlyBold;
        boldBtn.classList.toggle("active", nextBold);
        this.editor.updateBoxStyle(box.id, { fontWeight: nextBold ? "bold" : "normal" });
      });

      const italicBtn = item.querySelector(".btn-italic");
      italicBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tb = this.editor.fabricCanvas.getObjects().find((o) => o.id === box.id);
        const isCurrentlyItalic = tb ? tb.fontStyle === "italic" : isItalic;
        const nextItalic = !isCurrentlyItalic;
        italicBtn.classList.toggle("active", nextItalic);
        this.editor.updateBoxStyle(box.id, { fontStyle: nextItalic ? "italic" : "normal" });
      });

      // Nút Auto Fit cỡ chữ
      item.querySelector(".btn-fit").addEventListener("click", (e) => {
        e.stopPropagation();
        const tb = this.editor.fabricCanvas.getObjects().find((o) => o.id === box.id);
        if (tb) {
          this.editor.autoFitFontSize(tb);
          sizeValBadge.textContent = `${tb.fontSize}px`;
        }
      });

      // Nút Đảo màu
      item.querySelector(".btn-invert").addEventListener("click", (e) => {
        e.stopPropagation();
        const tb = this.editor.fabricCanvas.getObjects().find((o) => o.id === box.id);
        if (tb) this.editor.autoInvertColors(tb);
      });

      // Nút Xóa box
      item.querySelector(".btn-del").addEventListener("click", (e) => {
        e.stopPropagation();
        this.editor.selectBoxById(box.id);
        this.editor.deleteSelectedBox();
      });

      listEl.appendChild(item);
    });
  }

  handleBoxSelected(boxData) {
    // 1. Highlight dòng tương ứng trong bảng thoại
    const cards = document.querySelectorAll(".dialog-row-card");
    cards.forEach((c) => {
      c.classList.toggle("selected", boxData && c.dataset.boxId === boxData.id);
      if (boxData && c.dataset.boxId === boxData.id) {
        c.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });

    // 2. Cập nhật Panel công cụ Font / Kiểu chữ bên phải
    this.updateFontPanelFromBox(boxData);
  }

  handleBoxModified(boxData) {
    if (!boxData) return;
    const card = document.querySelector(`.dialog-row-card[data-box-id="${boxData.id}"]`);
    if (card) {
      const ta = card.querySelector(".textarea-vi");
      if (ta && ta.value !== boxData.textVi) {
        ta.value = boxData.textVi;
      }
      const sizeBadge = card.querySelector(".badge-size-val");
      if (sizeBadge && boxData.style?.fontSize) {
        sizeBadge.textContent = `${boxData.style.fontSize}px`;
      }
      const fontSel = card.querySelector(".quick-font-select");
      if (fontSel && boxData.style?.fontFamily && fontSel.value !== boxData.style.fontFamily) {
        fontSel.value = boxData.style.fontFamily;
      }
    }
  }

  // ---------------- Font / Typeset Panel ----------------
  updateFontPanelFromBox(boxData) {
    const panel = document.getElementById("paneFontTools") || document.getElementById("typesetFontPanel");
    if (!panel) return;

    if (!boxData) {
      // Giữ panel có thể chỉnh sửa font mặc định cho box mới
      return;
    }

    const style = boxData.style || {};
    const fontSel = document.getElementById("typesetFontFamily");
    if (fontSel) fontSel.value = style.fontFamily || "Yuki Burobu";

    const sizeInput = document.getElementById("typesetFontSize");
    if (sizeInput) sizeInput.value = style.fontSize || 20;

    const sizeVal = document.getElementById("typesetFontSizeVal");
    if (sizeVal) sizeVal.textContent = `${style.fontSize || 20}px`;

    const fillInput = document.getElementById("typesetFillColor");
    if (fillInput) fillInput.value = style.fill || "#000000";

    const fillCode = document.getElementById("typesetFillColorCode");
    if (fillCode) fillCode.textContent = (style.fill || "#000000").toUpperCase();

    const strokeInput = document.getElementById("typesetStrokeColor");
    if (strokeInput) strokeInput.value = style.stroke || "#ffffff";

    const strokeCode = document.getElementById("typesetStrokeColorCode");
    if (strokeCode) strokeCode.textContent = (style.stroke || "#ffffff").toUpperCase();

    const strokeWidthInput = document.getElementById("typesetStrokeWidth");
    if (strokeWidthInput) strokeWidthInput.value = style.strokeWidth !== undefined ? style.strokeWidth : 3;

    const strokeWidthVal = document.getElementById("typesetStrokeWidthVal");
    if (strokeWidthVal) strokeWidthVal.textContent = `${style.strokeWidth || 3}px`;

    document.querySelectorAll(".btn-align-group button").forEach((b) => {
      b.classList.toggle("active", b.dataset.align === (style.align || "center"));
    });
  }

  bindFontPanelEvents() {
    // Font Family
    document.getElementById("typesetFontFamily")?.addEventListener("change", (e) => {
      const active = this.editor.fabricCanvas.getActiveObject();
      if (active) this.editor.updateBoxStyle(active.id, { fontFamily: e.target.value });
    });

    // Font Size
    const fontSizeSlider = document.getElementById("typesetFontSize");
    fontSizeSlider?.addEventListener("input", (e) => {
      const val = Number(e.target.value);
      const valEl = document.getElementById("typesetFontSizeVal");
      if (valEl) valEl.textContent = `${val}px`;
      const active = this.editor.fabricCanvas.getActiveObject();
      if (active) this.editor.updateBoxStyle(active.id, { fontSize: val });
    });

    // Fill Color
    document.getElementById("typesetFillColor")?.addEventListener("input", (e) => {
      const codeEl = document.getElementById("typesetFillColorCode");
      if (codeEl) codeEl.textContent = e.target.value.toUpperCase();
      const active = this.editor.fabricCanvas.getActiveObject();
      if (active) this.editor.updateBoxStyle(active.id, { fill: e.target.value });
    });

    // Stroke Color
    document.getElementById("typesetStrokeColor")?.addEventListener("input", (e) => {
      const codeEl = document.getElementById("typesetStrokeColorCode");
      if (codeEl) codeEl.textContent = e.target.value.toUpperCase();
      const active = this.editor.fabricCanvas.getActiveObject();
      if (active) this.editor.updateBoxStyle(active.id, { stroke: e.target.value });
    });

    // Stroke Width
    const strokeWidthSlider = document.getElementById("typesetStrokeWidth");
    strokeWidthSlider?.addEventListener("input", (e) => {
      const val = Number(e.target.value);
      const valEl = document.getElementById("typesetStrokeWidthVal");
      if (valEl) valEl.textContent = `${val}px`;
      const active = this.editor.fabricCanvas.getActiveObject();
      if (active) this.editor.updateBoxStyle(active.id, { strokeWidth: val });
    });

    // Text Align
    document.querySelectorAll(".btn-align-group button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".btn-align-group button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const active = this.editor.fabricCanvas.getActiveObject();
        if (active) this.editor.updateBoxStyle(active.id, { textAlign: btn.dataset.align });
      });
    });

    // Preset Chips
    const applyColorPreset = (fill, stroke, strokeWidth, presetId) => {
      document.querySelectorAll(".preset-chip").forEach((c) => c.classList.remove("active"));
      document.getElementById(presetId)?.classList.add("active");

      const fillInput = document.getElementById("typesetFillColor");
      const strokeInput = document.getElementById("typesetStrokeColor");
      const strokeWidthInput = document.getElementById("typesetStrokeWidth");

      if (fillInput) fillInput.value = fill;
      if (strokeInput) strokeInput.value = stroke;
      if (strokeWidthInput) {
        strokeWidthInput.value = strokeWidth;
        const valEl = document.getElementById("typesetStrokeWidthVal");
        if (valEl) valEl.textContent = `${strokeWidth}px`;
      }
      const fillCode = document.getElementById("typesetFillColorCode");
      const strokeCode = document.getElementById("typesetStrokeColorCode");
      if (fillCode) fillCode.textContent = fill.toUpperCase();
      if (strokeCode) strokeCode.textContent = stroke.toUpperCase();

      const active = this.editor.fabricCanvas.getActiveObject();
      if (active) {
        this.editor.updateBoxStyle(active.id, { fill, stroke, strokeWidth });
      }
    };

    document.getElementById("presetWhiteBubble")?.addEventListener("click", () => {
      applyColorPreset("#000000", "#ffffff", 3, "presetWhiteBubble");
    });
    document.getElementById("presetBlackBubble")?.addEventListener("click", () => {
      applyColorPreset("#ffffff", "#000000", 3, "presetBlackBubble");
    });
    document.getElementById("presetSfxRed")?.addEventListener("click", () => {
      applyColorPreset("#ef4444", "#ffffff", 4, "presetSfxRed");
    });

    // Upload custom font
    const fontInput = document.getElementById("typesetUploadFontInput");
    fontInput?.addEventListener("change", async () => {
      if (fontInput.files.length > 0) {
        try {
          const fontName = await loadUserFontFile(fontInput.files[0]);
          await populateFontSelect(document.getElementById("typesetFontFamily"));
          document.getElementById("typesetFontFamily").value = fontName;
          this.availableFonts = await getAvailableFonts();
          this.renderParallelDialogs();
          const active = this.editor.fabricCanvas.getActiveObject();
          if (active) this.editor.updateBoxStyle(active.id, { fontFamily: fontName });
          this.showToast(`Đã nạp font thành công: ${fontInput.files[0].name}`, "success");
        } catch (e) {
          this.showToast(`Lỗi nạp font: ${e.message}`, "error");
        }
      }
    });

    // Auto-fit button
    document.getElementById("btnAutoFitCurrent")?.addEventListener("click", () => {
      const active = this.editor.fabricCanvas.getActiveObject();
      if (active) {
        this.editor.autoFitFontSize(active);
        this.showToast("Đã tự động co chữ vừa khung", "success");
      } else {
        this.showToast("Vui lòng chọn một bóng thoại trên Canvas", "info");
      }
    });

    // Auto Invert color button
    document.getElementById("btnAutoInvertCurrent")?.addEventListener("click", () => {
      const active = this.editor.fabricCanvas.getActiveObject();
      if (active) {
        this.editor.autoInvertColors(active);
        this.showToast("Đã đảo màu chữ theo nền bóng thoại", "success");
      } else {
        this.showToast("Vui lòng chọn một bóng thoại trên Canvas", "info");
      }
    });
  }

  // ---------------- Tab Switching in Right Panel ----------------
  bindRightPanelTabs() {
    const btnDialogs = document.getElementById("btnTabDialogs");
    const btnFont = document.getElementById("btnTabFont");
    const paneDialogs = document.getElementById("paneParallelDialogs");
    const paneFont = document.getElementById("paneFontTools");

    const switchTab = (tab) => {
      if (tab === "dialogs") {
        btnDialogs?.classList.add("active");
        btnFont?.classList.remove("active");
        if (paneDialogs) paneDialogs.style.display = "flex";
        if (paneFont) paneFont.style.display = "none";
      } else {
        btnFont?.classList.add("active");
        btnDialogs?.classList.remove("active");
        if (paneFont) paneFont.style.display = "flex";
        if (paneDialogs) paneDialogs.style.display = "none";
      }
    };

    btnDialogs?.addEventListener("click", () => switchTab("dialogs"));
    btnFont?.addEventListener("click", () => switchTab("font"));
    window.switchRightTab = switchTab;
  }

  // ---------------- UI & Navigation ----------------
  bindUIEvents() {
    // Mode Switcher: Reader vs Editor
    document.getElementById("btnViewModeEditor")?.addEventListener("click", () => this.switchViewMode("editor"));
    document.getElementById("btnViewModeReader")?.addEventListener("click", () => this.switchViewMode("reader"));

    // Reader Mode Switcher: Webtoon vs Manga flip
    document.getElementById("btnReaderModeWebtoon")?.addEventListener("click", () => {
      document.getElementById("btnReaderModeWebtoon")?.classList.add("active");
      document.getElementById("btnReaderModeManga")?.classList.remove("active");
      this.reader.setReadingMode("webtoon");
    });
    document.getElementById("btnReaderModeManga")?.addEventListener("click", () => {
      document.getElementById("btnReaderModeManga")?.classList.add("active");
      document.getElementById("btnReaderModeWebtoon")?.classList.remove("active");
      this.reader.setReadingMode("manga");
    });

    // Tool Buttons trên top canvas bar
    const toolBtns = {
      btnToolSelect: "select",
      btnToolHand: "pan",
      btnToolRegion: "region",
      btnToolBrush: "brush",
      btnToolEraser: "eraser",
      btnToolText: "text",
    };
    Object.entries(toolBtns).forEach(([btnId, tool]) => {
      document.getElementById(btnId)?.addEventListener("click", () => {
        Object.keys(toolBtns).forEach((id) => document.getElementById(id)?.classList.remove("active"));
        document.getElementById(btnId)?.classList.add("active");
        this.editor.setTool(tool);
      });
    });

    // Zoom Controls
    document.getElementById("btnTypesetZoomIn")?.addEventListener("click", () => {
      const cur = this.editor.fabricCanvas.getZoom();
      this.editor.setZoomLevel(Math.round(cur * 120));
    });
    document.getElementById("btnTypesetZoomOut")?.addEventListener("click", () => {
      const cur = this.editor.fabricCanvas.getZoom();
      this.editor.setZoomLevel(Math.round(cur * 80));
    });
    document.getElementById("btnTypesetZoomFit")?.addEventListener("click", () => {
      this.editor.fitToScreen();
    });
    document.getElementById("btnTypesetZoom100")?.addEventListener("click", () => {
      this.editor.setZoomLevel(100);
    });
    document.getElementById("btnTogglePreviewOriginal")?.addEventListener("click", () => {
      this.editor.togglePreviewOriginal(!this.editor.isShowingOriginal);
      document.getElementById("btnTogglePreviewOriginal")?.classList.toggle("active", this.editor.isShowingOriginal);
    });

    // Sidebar Island Collapse Toggles (Lynx style)
    const leftSidebar = document.getElementById("typesetSidebarLeft");
    const btnToggleLeft = document.getElementById("btnToggleLeftSidebar");
    const iconToggleLeft = document.getElementById("iconToggleLeftSidebar");
    btnToggleLeft?.addEventListener("click", () => {
      if (!leftSidebar) return;
      leftSidebar.classList.toggle("collapsed");
      const isCollapsed = leftSidebar.classList.contains("collapsed");
      if (iconToggleLeft) {
        iconToggleLeft.className = isCollapsed ? "fa-solid fa-chevron-right" : "fa-solid fa-chevron-left";
      }
    });

    const rightSidebar = document.getElementById("typesetSidebarRight");
    const btnToggleRight = document.getElementById("btnToggleRightSidebar");
    const iconToggleRight = document.getElementById("iconToggleRightSidebar");
    btnToggleRight?.addEventListener("click", () => {
      if (!rightSidebar) return;
      rightSidebar.classList.toggle("collapsed");
      const isCollapsed = rightSidebar.classList.contains("collapsed");
      if (iconToggleRight) {
        iconToggleRight.className = isCollapsed ? "fa-solid fa-chevron-left" : "fa-solid fa-chevron-right";
      }
    });

    // Undo / Redo
    document.getElementById("btnTypesetUndo")?.addEventListener("click", () => this.editor.undo());
    document.getElementById("btnTypesetRedo")?.addEventListener("click", () => this.editor.redo());

    // Thêm ảnh từ máy tính
    const fileInput = document.getElementById("typesetFileInput");
    fileInput?.addEventListener("change", (e) => this.handleAddImages(e.target.files));

    // Thêm ảnh từ Drag & Drop toàn diện
    const emptyDropzone = document.getElementById("typesetEmptyDropzone");
    const canvasContainer = document.getElementById("typesetCanvasContainer");
    const pagesList = document.getElementById("typesetPagesList");
    const dragOverlay = document.getElementById("typesetDragOverlay");

    // Click vào vùng dropzone trống để chọn ảnh
    emptyDropzone?.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      document.getElementById("typesetFileInput")?.click();
    });

    // Ngăn chặn trình duyệt mở ảnh đè lên trang web khi kéo file vào window
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => e.preventDefault());

    // Hiển thị Overlay khi kéo file ảnh từ Desktop/Explorer vào Studio
    let dragCounter = 0;
    window.addEventListener("dragenter", (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
        dragCounter++;
        if (dragOverlay) dragOverlay.style.display = "flex";
      }
    });

    window.addEventListener("dragleave", (e) => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        if (dragOverlay) dragOverlay.style.display = "none";
      }
    });

    window.addEventListener("drop", (e) => {
      e.preventDefault();
      dragCounter = 0;
      if (dragOverlay) dragOverlay.style.display = "none";
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.handleAddImages(e.dataTransfer.files);
      }
    });

    // Kéo thả trực tiếp lên Empty Dropzone
    if (emptyDropzone) {
      emptyDropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        emptyDropzone.classList.add("dragover");
      });
      emptyDropzone.addEventListener("dragleave", () => emptyDropzone.classList.remove("dragover"));
      emptyDropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        emptyDropzone.classList.remove("dragover");
        if (e.dataTransfer && e.dataTransfer.files) this.handleAddImages(e.dataTransfer.files);
      });
    }

    // Kéo thả lên sidebar danh sách trang
    if (pagesList) {
      pagesList.addEventListener("dragover", (e) => e.preventDefault());
      pagesList.addEventListener("drop", (e) => {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files) this.handleAddImages(e.dataTransfer.files);
      });
    }

    // Export Project (.manga-proj)
    document.getElementById("btnExportMangaProj")?.addEventListener("click", async () => {
      await this.saveCurrentPageState();
      await exportProjectJSON("Manga_Chapter_01");
    });

    // Import Project
    const importProjInput = document.getElementById("typesetImportProjInput");
    importProjInput?.addEventListener("change", async () => {
      if (importProjInput.files.length > 0) {
        try {
          await importProjectJSON(importProjInput.files[0]);
          await this.loadPagesFromDB();
          this.showToast("Nhập dự án .manga-proj thành công!", "success");
        } catch (e) {
          this.showToast(`Lỗi nhập dự án: ${e.message}`, "error");
        }
      }
    });

    // Export Chapter ZIP
    document.getElementById("btnExportChapterZip")?.addEventListener("click", async () => {
      await this.saveCurrentPageState();
      if (this.pages.length === 0) {
        this.showToast("Chưa có trang nào để xuất ZIP!", "warning");
        return;
      }
      this.showExportZipModal();
    });

    // 1-Click Pipeline Tự động cả trang: Detect DBNet -> Dịch -> Tẩy AOT -> Typeset
    document.getElementById("btnAutoPipelinePage")?.addEventListener("click", async () => {
      await this.runAutoPipelineCurrentPage();
    });
  }

  switchViewMode(mode) {
    this.viewMode = mode;
    const editorWrapper = document.getElementById("typesetEditorWrapper");
    const readerWrapper = document.getElementById("typesetReaderWrapper");
    const btnEditor = document.getElementById("btnViewModeEditor");
    const btnReader = document.getElementById("btnViewModeReader");

    if (mode === "editor") {
      if (editorWrapper) editorWrapper.style.display = "flex";
      if (readerWrapper) readerWrapper.style.display = "none";
      btnEditor?.classList.add("active");
      btnReader?.classList.remove("active");
      this.editor.fabricCanvas.calcOffset();
      this.editor.fitToScreen();
    } else {
      if (editorWrapper) editorWrapper.style.display = "none";
      if (readerWrapper) readerWrapper.style.display = "block";
      btnEditor?.classList.remove("active");
      btnReader?.classList.add("active");
      this.reader.setPages(this.pages, this.currentPageIndex);
    }
  }

  // ---------------- 1-Click Auto Pipeline ----------------
  async runAutoPipelineCurrentPage() {
    if (this.pages.length === 0) return;
    const page = this.pages[this.currentPageIndex];
    const btn = document.getElementById("btnAutoPipelinePage");

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner-mini"></span> Đang chạy AI tự động...`;
    }

    try {
      this.showToast("Đang phát hiện bóng thoại và tẩy chữ bằng AI...", "info");
      const backendUrl = await getSetting("backend_url", "https://dobietdc-manga-text-cleaner.hf.space");

      // 1. Gọi backend nhận diện khung chữ DBNet
      const detectResp = await fetch("/api/detect-boxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: page.rawImage,
          readingOrder: "manga",
          detector: "default",
          backendUrl: backendUrl,
        }),
      });

      if (!detectResp.ok) throw new Error("Lỗi phát hiện khung chữ.");
      const detectData = await detectResp.json();
      const rawBoxes = detectData.boxes || [];

      // 2. Tẩy chữ nền AOT
      const cleanResp = await fetch("/api/clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: page.rawImage,
          detector: "default",
          inpainter: "aot",
          dilation_offset: 2,
          backendUrl: backendUrl,
        }),
      });

      if (cleanResp.ok) {
        const cleanData = await cleanResp.json();
        if (cleanData.cleanedImageBase64) {
          page.cleanedImage = cleanData.cleanedImageBase64;
          await this.editor.setBackground(page.cleanedImage);
        }
      }

      // 3. OCR & Dịch từng box rồi chèn Textbox lên Canvas
      const newBoxes = [];
      for (let i = 0; i < rawBoxes.length; i++) {
        const rb = rawBoxes[i];
        const boxCoord = rb.box || [rb.x, rb.y, rb.w, rb.h];
        const rect = {
          x: boxCoord[0],
          y: boxCoord[1],
          width: boxCoord[2],
          height: boxCoord[3],
        };

        // Crop ảnh bóng thoại từ ảnh gốc để OCR
        const cropB64 = this.smartMask.cropRegionB64(this.editor.backgroundImage._element, rect);
        const textJa = await runOcrOnRegion(cropB64);
        let textVi = "";
        if (textJa) {
          textVi = await translateText(textJa);
        } else {
          textVi = "Lời thoại";
        }

        const tb = this.editor.createNewTextBox(rect.x, rect.y, textVi);
        tb.textJa = textJa;
        tb.set({ width: Math.max(60, rect.width) });
        this.editor.autoFitFontSize(tb, rect.height);
        this.editor.autoInvertColors(tb);

        newBoxes.push(this.editor.getBoxData(tb));
      }

      page.boxes = newBoxes;
      page.status = "editing";
      await savePage(page);
      this.renderPagesList();
      this.renderParallelDialogs(newBoxes);
      this.showToast(`Hoàn tất AI Pipeline! Đã tạo ${newBoxes.length} bóng thoại.`, "success");
    } catch (e) {
      console.error("Auto pipeline error:", e);
      this.showToast(`Lỗi pipeline: ${e.message}`, "error");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `⚡ Tự động cả trang`;
      }
    }
  }

  // ---------------- Settings & Glossary ----------------
  async refreshWebLamaStorageStatus() {
    if (!this.webLama) return;
    const storage = await this.webLama.getStorageInfo();
    this.handleWebLamaStatus({
      state: this.webLama.isReady ? "ready" : "idle",
      device: this.webLama.deviceMode,
      isReady: this.webLama.isReady,
      isCached: storage.isCached,
      cachedSize: storage.cachedSize,
    });
  }

  handleWebLamaStatus(status) {
    const badge = document.getElementById("webLamaStatusBadge");
    const indicator = document.getElementById("maskEngineIndicator");
    const clearBtn = document.getElementById("btnClearWebLamaCache");
    const quickDeleteBtn = document.getElementById("btnQuickDeleteModel");
    const dlBtnText = document.getElementById("btnDownloadWebLamaText");
    const storageText = document.getElementById("webLamaStorageText");

    const hasStoredModel = Boolean(status.isCached || status.isReady);

    if (badge) {
      badge.className = "badge-status-pill";
      if (status.state === "ready") {
        badge.textContent = `⚡ Sẵn sàng (${status.device.toUpperCase()})`;
        badge.classList.add(status.device === "webgpu" ? "ready-webgpu" : "ready-wasm");
      } else if (status.state === "loading") {
        badge.textContent = `Đang nạp (${status.percent}%)`;
        badge.classList.add("loading");
      } else if (hasStoredModel) {
        badge.textContent = `Đã lưu (~198MB)`;
        badge.classList.add("ready-wasm");
      } else {
        badge.textContent = "Chưa tải model";
      }
    }

    if (storageText) {
      if (hasStoredModel) {
        const mb = status.cachedSize ? Math.round(status.cachedSize / 1024 / 1024) : 198;
        storageText.innerHTML = `Đã lưu model trong trình duyệt: <strong style="color: #818cf8;">~${mb} MB</strong>`;
      } else {
        storageText.textContent = "Chưa lưu model trong trình duyệt (0 MB)";
      }
    }

    if (indicator) {
      indicator.className = "mask-engine-indicator";
      if (status.isReady) {
        indicator.textContent = status.device === "webgpu" ? "⚡ WebGPU" : "⚙️ WASM";
        indicator.classList.add(status.device === "webgpu" ? "webgpu" : "wasm");
        indicator.title = `Xóa chữ trực tiếp trên trình duyệt bằng ${status.device.toUpperCase()} (100% Offline, siêu tốc)`;
      } else if (hasStoredModel) {
        indicator.textContent = "⚡ Web LaMa";
        indicator.classList.add("wasm");
        indicator.title = "Đã lưu model trong máy (tự động kích hoạt khi xóa chữ)";
      } else {
        indicator.textContent = "☁️ Cloud";
        indicator.classList.add("cloud");
        indicator.title = "Xóa chữ qua Backend Cloud / Local Server";
      }
    }

    // Luôn hiển thị nút Xóa Model khi máy đã có model (kể cả khi chưa nạp vào RAM)
    if (clearBtn) {
      clearBtn.style.display = hasStoredModel ? "inline-flex" : "none";
    }
    if (quickDeleteBtn) {
      quickDeleteBtn.style.display = hasStoredModel ? "inline-flex" : "none";
    }

    if (dlBtnText) {
      dlBtnText.textContent = hasStoredModel ? "Tải lại Model Manga LaMa" : "Tải Model Manga LaMa (~198MB)";
    }
  }

  bindSettingsEvents() {
    // WebLama Inpainting Event Listeners
    const btnDownloadWebLama = document.getElementById("btnDownloadWebLama");
    const btnClearCache = document.getElementById("btnClearWebLamaCache");
    const btnQuickDelete = document.getElementById("btnQuickDeleteModel");
    const fileInputCustom = document.getElementById("inputWebLamaCustomFile");
    const progressWrap = document.getElementById("webLamaDownloadProgressWrap");
    const progressBar = document.getElementById("webLamaProgressBar");
    const progressPercent = document.getElementById("webLamaProgressPercent");
    const progressLabel = document.getElementById("webLamaProgressLabel");

    btnDownloadWebLama?.addEventListener("click", async () => {
      if (btnDownloadWebLama) btnDownloadWebLama.disabled = true;
      if (progressWrap) progressWrap.style.display = "block";

      try {
        await this.webLama.downloadModel((percent, loaded, total) => {
          if (progressBar) progressBar.style.width = `${percent}%`;
          if (progressPercent) progressPercent.textContent = `${percent}%`;
          if (progressLabel) progressLabel.textContent = `Đang tải: ${Math.round(loaded / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB`;
        });
        await this.refreshWebLamaStorageStatus();
        this.showToast("⚡ Đã tải thành công model Manga LaMa! Chạy ngầm bằng Web Worker không bao giờ lag giao diện.", "success");
      } catch (err) {
        this.showToast(`Lỗi tải model: ${err.message}`, "error");
      } finally {
        if (btnDownloadWebLama) btnDownloadWebLama.disabled = false;
        if (progressWrap) progressWrap.style.display = "none";
      }
    });

    const doDeleteModel = async () => {
      if (!confirm("Bạn có chắc chắn muốn xóa model Manga LaMa (~198MB) khỏi bộ nhớ máy tính không?")) {
        return;
      }
      try {
        await this.webLama.clearCache();
        await this.refreshWebLamaStorageStatus();
        this.showToast("Đã xóa hoàn toàn model Manga LaMa khỏi bộ nhớ trình duyệt!", "info");
      } catch (err) {
        this.showToast(`Lỗi xóa model: ${err.message}`, "error");
      }
    };

    btnClearCache?.addEventListener("click", doDeleteModel);
    btnQuickDelete?.addEventListener("click", doDeleteModel);

    fileInputCustom?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        try {
          this.showToast("Đang nạp file .onnx từ máy tính vào Web Worker...", "info");
          await this.webLama.loadFromFile(file);
          await this.refreshWebLamaStorageStatus();
          this.showToast(`⚡ Đã nạp thành công model ${file.name}!`, "success");
        } catch (err) {
          this.showToast(`Lỗi nạp model: ${err.message}`, "error");
        }
      }
    });
    });

    // Engine selector trong thanh công cụ
    const topEngineSelect = document.getElementById("typesetEngineSelect");
    topEngineSelect?.addEventListener("change", async (e) => {
      await setSetting("translation_engine", e.target.value);
      this.showToast(`Đã chuyển Engine dịch: ${e.target.options[e.target.selectedIndex].text}`, "info");
    });
    getSetting("translation_engine", "google").then((eng) => {
      if (topEngineSelect) topEngineSelect.value = eng;
    });

    // Mở modal Glossary
    document.getElementById("btnOpenGlossaryModal")?.addEventListener("click", () => {
      this.openGlossaryModal();
    });
  }

  async openGlossaryModal() {
    const modal = document.getElementById("glossaryModal");
    if (!modal) return;
    modal.style.display = "flex";
    await this.renderGlossaryTable();
  }

  async renderGlossaryTable() {
    const listEl = document.getElementById("glossaryTableBody");
    if (!listEl) return;
    listEl.innerHTML = "";

    const glossary = await getGlossary();
    if (glossary.length === 0) {
      listEl.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94a3b8; padding:12px;">Chưa có từ điển thuật ngữ. Hãy thêm nhân vật đầu tiên!</td></tr>`;
      return;
    }

    glossary.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><b>${item.original}</b></td>
        <td><span style="color:#38bdf8;">${item.translated}</span></td>
        <td style="color:#cbd5e1; font-size:0.8rem;">${item.notes || "-"}</td>
        <td style="text-align:right;">
          <button class="btn-del-term" style="background:none; border:none; color:#f43f5e; cursor:pointer;" title="Xóa">&times;</button>
        </td>
      `;
      tr.querySelector(".btn-del-term").addEventListener("click", async () => {
        await deleteGlossaryItem(item.id);
        await this.renderGlossaryTable();
      });
      listEl.appendChild(tr);
    });
  }

  showExportZipModal() {
    const modal = document.getElementById("exportZipModal");
    if (!modal) return;
    modal.style.display = "flex";

    const btnStart = document.getElementById("btnStartExportZip");
    btnStart.onclick = async () => {
      const format = document.querySelector('input[name="zipFormat"]:checked')?.value || "jpeg";
      const progressWrap = document.getElementById("zipExportProgressWrap");
      const progressFill = document.getElementById("zipExportProgressFill");
      const progressText = document.getElementById("zipExportProgressText");

      progressWrap.style.display = "block";
      btnStart.disabled = true;

      try {
        await exportChapterZip(this.pages, {
          format: format,
          quality: 0.95,
          onProgress: (cur, total, name) => {
            const pct = Math.round((cur / total) * 100);
            progressFill.style.width = `${pct}%`;
            progressText.textContent = `Đang render: ${cur}/${total} trang (${name})...`;
          },
        });
        this.showToast("Đã tải xuống Chapter ZIP hoàn tất!", "success");
        modal.style.display = "none";
      } catch (e) {
        this.showToast(`Lỗi xuất ZIP: ${e.message}`, "error");
      } finally {
        btnStart.disabled = false;
        progressWrap.style.display = "none";
      }
    };
  }

  showToast(message, type = "info") {
    let toast = document.getElementById("typesetToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "typesetToast";
      toast.className = "typeset-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `typeset-toast show toast-${type}`;
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove("show");
    }, 3200);
  }
}
