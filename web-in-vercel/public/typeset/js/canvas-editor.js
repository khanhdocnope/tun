/**
 * Fabric.js Canvas Editor for Manga Typesetting Studio
 * Handles zoom, pan, textbox lifecycle, auto-fit font size, auto color inversion,
 * hotkeys (B, E, V, T, Space, Tab, Ctrl+Z, Ctrl+Y), and smart region selection.
 */

export class TypesetCanvasEditor {
  constructor(canvasElementId, options = {}) {
    this.canvasId = canvasElementId;
    this.options = options;
    this.fabricCanvas = null;
    this.backgroundImage = null;
    this.rawImageUrl = null;
    this.cleanedImageUrl = null;
    this.isShowingOriginal = false;

    this.activeTool = "select"; // 'select' | 'region' | 'brush' | 'eraser'
    this.isDrawingRegion = false;
    this.regionStart = { x: 0, y: 0 };
    this.selectionRectObj = null;

    this.maskCanvasOverlay = null;
    this.maskCanvasCtx = null;
    this.isMaskPainting = false;

    // History for Undo/Redo
    this.history = [];
    this.historyIndex = -1;
    this.isHistoryLocked = false;

    // Listeners callbacks
    this.onSelectionChanged = options.onSelectionChanged || (() => {});
    this.onBoxModified = options.onBoxModified || (() => {});
    this.onBoxesListChanged = options.onBoxesListChanged || (() => {});
    this.onRegionSelected = options.onRegionSelected || (() => {});
    this.onZoomChanged = options.onZoomChanged || (() => {});

    this.initCanvas();
    this.bindEvents();
    this.bindHotkeys();
  }

  initCanvas() {
    this.fabricCanvas = new fabric.Canvas(this.canvasId, {
      selection: true,
      preserveObjectStacking: true,
      fireRightClick: true,
      stopContextMenu: true,
    });

    // Custom properties to serialize
    fabric.Textbox.prototype.toObject = (function (toObject) {
      return function (propertiesToInclude) {
        return toObject.call(
          this,
          ["id", "order", "textJa", "textVi", "isLocked", "originalStyle"].concat(propertiesToInclude || [])
        );
      };
    })(fabric.Textbox.prototype.toObject);
  }

  /**
   * Load một trang lên Canvas (ảnh gốc hoặc ảnh đã xóa chữ)
   */
  async loadPage(pageData) {
    if (!pageData) return;
    this.rawImageUrl = pageData.rawImage || null;
    this.cleanedImageUrl = pageData.cleanedImage || pageData.rawImage || null;
    this.currentPageId = pageData.id;

    // Xóa toàn bộ canvas và lịch sử cũ
    this.fabricCanvas.clear();
    this.history = [];
    this.historyIndex = -1;

    // Load background image
    const bgUrl = this.cleanedImageUrl || this.rawImageUrl;
    if (bgUrl) {
      await this.setBackground(bgUrl);
    }

    // Load các box thoại nếu có
    if (Array.isArray(pageData.boxes)) {
      this.isHistoryLocked = true;
      pageData.boxes.forEach((b) => this.addTextBoxFromData(b));
      this.isHistoryLocked = false;
    }

    this.fitToScreen();
    this.pushHistoryState();
  }

  async setBackground(imageUrl) {
    return new Promise((resolve) => {
      fabric.Image.fromURL(
        imageUrl,
        (img) => {
          this.backgroundImage = img;
          this.pageWidth = img.width;
          this.pageHeight = img.height;

          // Giữ canvas vừa vặn với kích thước viewport container
          this.resizeCanvasToContainer();

          img.set({
            left: 0,
            top: 0,
            originX: "left",
            originY: "top",
            selectable: false,
            evented: false,
          });

          this.fabricCanvas.setBackgroundImage(img, this.fabricCanvas.renderAll.bind(this.fabricCanvas));
          resolve(img);
        },
        { crossOrigin: "anonymous" }
      );
    });
  }

  resizeCanvasToContainer() {
    const container = document.getElementById("typesetCanvasContainer");
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
      this.fabricCanvas.setWidth(w);
      this.fabricCanvas.setHeight(h);
      this.fabricCanvas.renderAll();
    }
  }

  /**
   * Tạm ẩn/hiện chữ để xem lại tranh gốc (Hold Space to Preview Original)
   */
  togglePreviewOriginal(showOriginal) {
    if (this.isShowingOriginal === showOriginal) return;
    this.isShowingOriginal = showOriginal;

    const objects = this.fabricCanvas.getObjects();
    objects.forEach((obj) => {
      if (obj instanceof fabric.Textbox) {
        obj.visible = !showOriginal;
      }
    });

    // Đổi background sang raw image nếu có
    const targetUrl = showOriginal && this.rawImageUrl ? this.rawImageUrl : this.cleanedImageUrl || this.rawImageUrl;
    if (this.backgroundImage && targetUrl) {
      this.backgroundImage.setSrc(targetUrl, () => {
        this.fabricCanvas.renderAll();
      });
    } else {
      this.fabricCanvas.renderAll();
    }
  }

  // ---------------- Tool Switcher ----------------
  setTool(tool) {
    this.activeTool = tool;
    this.fabricCanvas.isDrawingMode = false;

    if (tool === "select") {
      this.fabricCanvas.selection = true;
      this.fabricCanvas.defaultCursor = "default";
      this.fabricCanvas.forEachObject((obj) => {
        if (obj instanceof fabric.Textbox) obj.selectable = true;
      });
    } else if (tool === "region") {
      this.fabricCanvas.selection = false;
      this.fabricCanvas.defaultCursor = "crosshair";
      this.fabricCanvas.forEachObject((obj) => {
        if (obj instanceof fabric.Textbox) obj.selectable = false;
      });
    } else if (tool === "brush") {
      this.fabricCanvas.selection = false;
      this.fabricCanvas.defaultCursor = "crosshair";
    } else if (tool === "eraser") {
      this.fabricCanvas.selection = false;
      this.fabricCanvas.defaultCursor = "cell";
    } else if (tool === "text") {
      this.fabricCanvas.selection = false;
      this.fabricCanvas.defaultCursor = "text";
    } else if (tool === "pan") {
      this.fabricCanvas.selection = false;
      this.fabricCanvas.defaultCursor = "grab";
      this.fabricCanvas.forEachObject((obj) => {
        if (obj instanceof fabric.Textbox) obj.selectable = false;
      });
    }
  }

  // ---------------- Canvas Events & Mouse Interactions ----------------
  bindEvents() {
    let isPanning = false;
    let lastPosX = 0;
    let lastPosY = 0;

    // Zoom & Pan qua lăn chuột (Mouse Wheel)
    this.fabricCanvas.on("mouse:wheel", (opt) => {
      const evt = opt.e;
      evt.preventDefault();
      evt.stopPropagation();

      const canvasEl = this.fabricCanvas.upperCanvasEl;
      const rect = canvasEl.getBoundingClientRect();
      const mouseX = evt.clientX - rect.left;
      const mouseY = evt.clientY - rect.top;

      // Giữ Ctrl / Meta: Phóng to / Thu nhỏ mượt mà neo chuẩn tại vị trí con trỏ chuột
      if (evt.ctrlKey || evt.metaKey) {
        let zoom = this.fabricCanvas.getZoom();
        const factor = evt.deltaY < 0 ? 1.12 : 0.89;
        zoom = Math.min(Math.max(0.08, zoom * factor), 10.0);

        this.fabricCanvas.zoomToPoint(new fabric.Point(mouseX, mouseY), zoom);
        this.onZoomChanged(Math.round(zoom * 100));
        return;
      }

      // Lăn chuột bình thường: Cuộn di chuyển (Pan) trang truyện mượt mà
      const vpt = this.fabricCanvas.viewportTransform;
      vpt[4] -= evt.deltaX;
      vpt[5] -= evt.deltaY;
      this.fabricCanvas.requestRenderAll();
    });

    // Kéo pan canvas khi nhấn chuột
    this.fabricCanvas.on("mouse:down", (opt) => {
      const evt = opt.e;
      
      // Bắt đầu pan nếu:
      // 1. Nhấn nút giữa chuột (button === 1)
      // 2. Nhấn nút chuột phải (button === 2)
      // 3. Đang giữ phím Space
      // 4. Đang bật công cụ Pan (activeTool === "pan")
      // 5. Công cụ Select và click vào nền trống (không click trúng textbox)
      const isRightClick = evt.button === 2;
      const isMiddleClick = evt.button === 1;
      const isSpaceOrPan = this.isSpacePressed || this.activeTool === "pan";
      const isSelectEmpty = this.activeTool === "select" && !opt.target && evt.button === 0;

      if (isRightClick || isMiddleClick || isSpaceOrPan || isSelectEmpty) {
        isPanning = true;
        this.fabricCanvas.selection = false;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        this.fabricCanvas.defaultCursor = "grabbing";
        this.fabricCanvas.setCursor("grabbing");
        return;
      }

      // Công cụ kéo khoanh vùng Smart Region
      if (this.activeTool === "region" && !this.isDrawingRegion && evt.button === 0) {
        const pointer = this.fabricCanvas.getPointer(opt.e);
        this.isDrawingRegion = true;
        this.regionStart = { x: pointer.x, y: pointer.y };

        this.selectionRectObj = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: "rgba(244, 63, 94, 0.2)",
          stroke: "#f43f5e",
          strokeWidth: 2,
          strokeDashArray: [4, 4],
          selectable: false,
          evented: false,
        });
        this.fabricCanvas.add(this.selectionRectObj);
      } else if (this.activeTool === "text" && evt.button === 0) {
        const pointer = this.fabricCanvas.getPointer(opt.e);
        this.createNewTextBox(pointer.x, pointer.y);
        this.setTool("select");
      }
    });

    this.fabricCanvas.on("mouse:move", (opt) => {
      const evt = opt.e;
      if (isPanning) {
        const vpt = this.fabricCanvas.viewportTransform;
        vpt[4] += evt.clientX - lastPosX;
        vpt[5] += evt.clientY - lastPosY;
        this.fabricCanvas.requestRenderAll();
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        return;
      }

      if (this.isDrawingRegion && this.selectionRectObj) {
        const pointer = this.fabricCanvas.getPointer(opt.e);
        const left = Math.min(this.regionStart.x, pointer.x);
        const top = Math.min(this.regionStart.y, pointer.y);
        const width = Math.abs(pointer.x - this.regionStart.x);
        const height = Math.abs(pointer.y - this.regionStart.y);

        this.selectionRectObj.set({ left, top, width, height });
        this.fabricCanvas.renderAll();
      }
    });

    const stopPanning = () => {
      if (isPanning) {
        isPanning = false;
        this.fabricCanvas.defaultCursor = this.isSpacePressed || this.activeTool === "pan" ? "grab" : "default";
        this.fabricCanvas.setCursor(this.fabricCanvas.defaultCursor);
        this.fabricCanvas.selection = this.activeTool === "select";
      }
    };

    this.fabricCanvas.on("mouse:up", (opt) => {
      stopPanning();

      if (this.isDrawingRegion && this.selectionRectObj) {
        this.isDrawingRegion = false;
        const rect = {
          x: Math.round(this.selectionRectObj.left),
          y: Math.round(this.selectionRectObj.top),
          width: Math.round(this.selectionRectObj.width),
          height: Math.round(this.selectionRectObj.height),
        };

        // Bỏ khung vẽ tạm
        this.fabricCanvas.remove(this.selectionRectObj);
        this.selectionRectObj = null;

        // Nếu vùng quét đủ lớn (> 20px) thì kích hoạt Smart Region
        if (rect.width > 20 && rect.height > 20) {
          this.onRegionSelected(rect, opt.e);
        }
      }
    });

    // Ngăn menu chuột phải trên canvas để dùng chuột phải kéo di chuyển canvas
    this.fabricCanvas.upperCanvasEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    // Dừng pan nếu thả chuột ngoài window
    window.addEventListener("mouseup", stopPanning);
    window.addEventListener("resize", () => {
      this.resizeCanvasToContainer();
    });

    // Lắng nghe chọn Textbox
    this.fabricCanvas.on("selection:created", (e) => this.handleSelectionEvent(e));
    this.fabricCanvas.on("selection:updated", (e) => this.handleSelectionEvent(e));
    this.fabricCanvas.on("selection:cleared", () => {
      this.onSelectionChanged(null);
    });

    // Lắng nghe thay đổi vị trí / kích thước / nội dung Textbox
    this.fabricCanvas.on("object:modified", (e) => {
      if (e.target instanceof fabric.Textbox) {
        this.onBoxModified(this.getBoxData(e.target));
        this.pushHistoryState();
      }
    });

    this.fabricCanvas.on("text:changed", (e) => {
      if (e.target instanceof fabric.Textbox) {
        e.target.textVi = e.target.text;
        this.onBoxModified(this.getBoxData(e.target));
      }
    });
  }

  handleSelectionEvent(e) {
    const selected = e.selected?.[0] || e.target;
    if (selected instanceof fabric.Textbox) {
      this.onSelectionChanged(this.getBoxData(selected));
    }
  }

  // ---------------- Textbox Creation & Typesetting ----------------
  addTextBoxFromData(data) {
    const defaultFamily = "Yuki Burobu";
    const box = new fabric.Textbox(data.textVi || data.text || "Văn bản thoại", {
      id: data.id || `box_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      order: data.order || this.getNextOrder(),
      textJa: data.textJa || "",
      textVi: data.textVi || data.text || "",
      left: data.x || 100,
      top: data.y || 100,
      width: Math.max(60, data.width || 180),
      fontSize: data.style?.fontSize || 20,
      fontFamily: data.style?.fontFamily || defaultFamily,
      fill: data.style?.fill || "#000000",
      stroke: data.style?.stroke || "#ffffff",
      strokeWidth: data.style?.strokeWidth !== undefined ? data.style?.strokeWidth : 3,
      textAlign: data.style?.align || "center",
      lineHeight: data.style?.lineHeight || 1.15,
      fontWeight: data.style?.bold ? "bold" : "normal",
      fontStyle: data.style?.italic ? "italic" : "normal",
      paintFirst: "stroke", // Vẽ viền trước, chữ đè lên trên để viền không ăn lẹm vào lòng chữ
      originX: "left",
      originY: "top",
      cornerColor: "#6366f1",
      cornerStrokeColor: "#ffffff",
      cornerSize: 8,
      transparentCorners: false,
    });

    this.fabricCanvas.add(box);
    return box;
  }

  createNewTextBox(x, y, text = "Lời thoại mới") {
    const nextOrder = this.getNextOrder();
    const isLight = this.detectBackgroundLuminance(x, y, 160, 80);

    const box = this.addTextBoxFromData({
      x: x || 100,
      y: y || 100,
      width: 160,
      order: nextOrder,
      textVi: text,
      textJa: "",
      style: {
        fontSize: 20,
        fontFamily: "Yuki Burobu",
        fill: isLight ? "#000000" : "#ffffff",
        stroke: isLight ? "#ffffff" : "#000000",
        strokeWidth: 3,
        align: "center",
      },
    });

    this.fabricCanvas.setActiveObject(box);
    this.fabricCanvas.renderAll();
    this.pushHistoryState();
    this.onBoxesListChanged(this.getAllBoxesData());
    this.onSelectionChanged(this.getBoxData(box));
    return box;
  }

  /**
   * Tự động co cỡ chữ (Auto-fit font size) để vừa khít khung bóng thoại
   */
  autoFitFontSize(textbox, targetHeight) {
    if (!textbox) return;
    const maxHeight = targetHeight || textbox.height || 100;
    const targetWidth = textbox.width;

    let min = 10;
    let max = 64;
    let best = textbox.fontSize || 20;

    // Binary search cỡ chữ tối ưu
    for (let i = 0; i < 6; i++) {
      const mid = Math.round((min + max) / 2);
      textbox.set("fontSize", mid);
      textbox.initDimensions();

      if (textbox.calcTextHeight() <= maxHeight) {
        best = mid;
        min = mid + 1; // Thử tăng lên để to hơn
      } else {
        max = mid - 1; // Bị tràn chiều cao, phải giảm bớt
      }
    }

    textbox.set("fontSize", best);
    textbox.initDimensions();
    this.fabricCanvas.renderAll();
    this.onBoxModified(this.getBoxData(textbox));
    this.pushHistoryState();
  }

  /**
   * Tự động nhận diện màu nền bóng thoại (Luminance check) và đảo màu chữ
   */
  detectBackgroundLuminance(x, y, w, h) {
    if (!this.backgroundImage || !this.backgroundImage._element) return true;
    try {
      const img = this.backgroundImage._element;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      ctx.drawImage(img, Math.max(0, x), Math.max(0, y), w, h, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      let lumSum = 0;
      const count = w * h;
      for (let i = 0; i < count; i++) {
        lumSum += 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      }
      const avgLum = lumSum / count;
      return avgLum > 128; // true = nền sáng/trắng
    } catch (e) {
      return true;
    }
  }

  autoInvertColors(textbox) {
    if (!textbox) return;
    const isLight = this.detectBackgroundLuminance(textbox.left, textbox.top, textbox.width, textbox.height);
    textbox.set({
      fill: isLight ? "#000000" : "#ffffff",
      stroke: isLight ? "#ffffff" : "#000000",
      strokeWidth: 3,
    });
    this.fabricCanvas.renderAll();
    this.onBoxModified(this.getBoxData(textbox));
    this.pushHistoryState();
  }

  // ---------------- Textbox Selection & Manipulation ----------------
  selectBoxById(id) {
    const box = this.fabricCanvas.getObjects().find((o) => o instanceof fabric.Textbox && o.id === id);
    if (box) {
      this.fabricCanvas.setActiveObject(box);
      this.fabricCanvas.renderAll();
      this.onSelectionChanged(this.getBoxData(box));
    }
  }

  updateBoxText(id, newTextVi) {
    const box = this.fabricCanvas.getObjects().find((o) => o instanceof fabric.Textbox && o.id === id);
    if (box) {
      box.set("text", newTextVi);
      box.textVi = newTextVi;
      box.initDimensions();
      this.fabricCanvas.renderAll();
      this.pushHistoryState();
    }
  }

  updateBoxStyle(id, styleUpdates) {
    const box = this.fabricCanvas.getObjects().find((o) => o instanceof fabric.Textbox && o.id === id);
    if (box) {
      box.set(styleUpdates);
      box.initDimensions();
      this.fabricCanvas.renderAll();
      this.onBoxModified(this.getBoxData(box));
      this.pushHistoryState();
    }
  }

  deleteSelectedBox() {
    const active = this.fabricCanvas.getActiveObject();
    if (active && active instanceof fabric.Textbox) {
      this.fabricCanvas.remove(active);
      this.fabricCanvas.discardActiveObject();
      this.fabricCanvas.renderAll();
      this.pushHistoryState();
      this.onBoxesListChanged(this.getAllBoxesData());
      this.onSelectionChanged(null);
    }
  }

  cycleNextBox(reverse = false) {
    const boxes = this.fabricCanvas
      .getObjects()
      .filter((o) => o instanceof fabric.Textbox)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    if (boxes.length === 0) return;

    const current = this.fabricCanvas.getActiveObject();
    let idx = boxes.indexOf(current);

    if (idx === -1) {
      idx = reverse ? boxes.length - 1 : 0;
    } else {
      idx = reverse ? (idx - 1 + boxes.length) % boxes.length : (idx + 1) % boxes.length;
    }

    const nextBox = boxes[idx];
    this.fabricCanvas.setActiveObject(nextBox);
    this.fabricCanvas.renderAll();
    this.onSelectionChanged(this.getBoxData(nextBox));
  }

  getNextOrder() {
    const boxes = this.fabricCanvas.getObjects().filter((o) => o instanceof fabric.Textbox);
    if (boxes.length === 0) return 1;
    return Math.max(...boxes.map((b) => b.order || 0)) + 1;
  }

  getBoxData(textbox) {
    return {
      id: textbox.id,
      order: textbox.order,
      x: Math.round(textbox.left),
      y: Math.round(textbox.top),
      width: Math.round(textbox.width),
      height: Math.round(textbox.height),
      textJa: textbox.textJa || "",
      textVi: textbox.text || "",
      style: {
        fontFamily: textbox.fontFamily,
        fontSize: textbox.fontSize,
        fill: textbox.fill,
        stroke: textbox.stroke,
        strokeWidth: textbox.strokeWidth,
        align: textbox.textAlign,
        lineHeight: textbox.lineHeight,
        bold: textbox.fontWeight === "bold",
        italic: textbox.fontStyle === "italic",
      },
    };
  }

  getAllBoxesData() {
    return this.fabricCanvas
      .getObjects()
      .filter((o) => o instanceof fabric.Textbox)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((b) => this.getBoxData(b));
  }

  // ---------------- Zoom & Fit Controls ----------------
  fitToScreen() {
    if (!this.pageWidth || !this.pageHeight) return;
    const container = document.getElementById("typesetCanvasContainer");
    if (!container) return;

    const contW = container.clientWidth;
    const contH = container.clientHeight;
    if (contW <= 0 || contH <= 0) return;

    this.fabricCanvas.setWidth(contW);
    this.fabricCanvas.setHeight(contH);

    // Padding để trang truyện hiển thị vừa vặn và thẩm mỹ
    const padX = 40;
    const padY = 40;
    const availW = Math.max(80, contW - padX);
    const availH = Math.max(80, contH - padY);

    const scale = Math.min(availW / this.pageWidth, availH / this.pageHeight, 1.0);

    const vpt = this.fabricCanvas.viewportTransform;
    vpt[0] = scale;
    vpt[3] = scale;
    vpt[4] = Math.round((contW - this.pageWidth * scale) / 2);
    vpt[5] = Math.round((contH - this.pageHeight * scale) / 2);

    this.fabricCanvas.setViewportTransform(vpt);
    this.fabricCanvas.requestRenderAll();
    this.onZoomChanged(Math.round(scale * 100));
  }

  setZoomLevel(percent) {
    const zoom = Math.max(10, Math.min(800, percent)) / 100;
    const center = {
      x: this.fabricCanvas.getWidth() / 2,
      y: this.fabricCanvas.getHeight() / 2,
    };
    this.fabricCanvas.zoomToPoint(new fabric.Point(center.x, center.y), zoom);
    this.onZoomChanged(Math.round(zoom * 100));
  }

  // ---------------- Undo / Redo ----------------
  pushHistoryState() {
    if (this.isHistoryLocked) return;
    const state = JSON.stringify(this.getAllBoxesData());
    if (this.historyIndex >= 0 && this.history[this.historyIndex] === state) return;

    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(state);
    this.historyIndex++;
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.restoreHistoryState(this.history[this.historyIndex]);
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.restoreHistoryState(this.history[this.historyIndex]);
    }
  }

  restoreHistoryState(stateStr) {
    if (!stateStr) return;
    this.isHistoryLocked = true;
    try {
      const boxesData = JSON.parse(stateStr);
      // Remove current textboxes
      const current = this.fabricCanvas.getObjects().filter((o) => o instanceof fabric.Textbox);
      current.forEach((c) => this.fabricCanvas.remove(c));

      boxesData.forEach((b) => this.addTextBoxFromData(b));
      this.fabricCanvas.renderAll();
      this.onBoxesListChanged(this.getAllBoxesData());
      this.onSelectionChanged(null);
    } catch (e) {
      console.warn("Restore history error:", e);
    } finally {
      this.isHistoryLocked = false;
    }
  }

  // ---------------- Hotkeys ----------------
  bindHotkeys() {
    this.isSpacePressed = false;

    window.addEventListener("keydown", (e) => {
      // Bỏ qua khi đang gõ phím trong ô input/textarea
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
      const isInput = tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable;
      if (isInput) return;

      // Phím tắt Scanlation
      if (e.code === "Space" && !this.isSpacePressed) {
        e.preventDefault();
        this.isSpacePressed = true;
        this.fabricCanvas.defaultCursor = "grab";
        this.fabricCanvas.setCursor("grab");
      } else if (e.key === "h" || e.key === "H") {
        this.setTool("pan");
      } else if (e.key === "\\" || e.key === "p" || e.key === "P") {
        this.togglePreviewOriginal(!this.isShowingOriginal);
      } else if (e.key === "b" || e.key === "B") {
        this.setTool("brush");
      } else if (e.key === "e" || e.key === "E") {
        this.setTool("eraser");
      } else if (e.key === "v" || e.key === "V") {
        this.setTool("select");
      } else if (e.key === "t" || e.key === "T") {
        this.setTool("text");
      } else if (e.key === "Tab") {
        e.preventDefault();
        this.cycleNextBox(e.shiftKey);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        this.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        // Chỉ xóa box nếu đang select
        if (this.fabricCanvas.getActiveObject() instanceof fabric.Textbox) {
          this.deleteSelectedBox();
        }
      }
    });

    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.isSpacePressed = false;
        this.fabricCanvas.defaultCursor = this.activeTool === "pan" ? "grab" : (this.activeTool === "select" ? "default" : "crosshair");
        this.fabricCanvas.setCursor(this.fabricCanvas.defaultCursor);
      }
    });
  }

  /**
   * Render trang hoàn chỉnh (bao gồm ảnh nền + chữ typeset) ra Blob để xuất bản
   */
  async exportMergedPageBlob(format = "image/jpeg", quality = 0.95) {
    const currentVpt = [...this.fabricCanvas.viewportTransform];
    const currentW = this.fabricCanvas.getWidth();
    const currentH = this.fabricCanvas.getHeight();

    // Tạm thời đặt canvas về kích thước thực của trang truyện để xuất ảnh chuẩn nét 100%
    this.fabricCanvas.setWidth(this.pageWidth);
    this.fabricCanvas.setHeight(this.pageHeight);
    this.fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    this.fabricCanvas.renderAll();

    const dataUrl = this.fabricCanvas.toDataURL({
      format: format === "image/png" ? "png" : "jpeg",
      quality: quality,
      multiplier: 1,
    });

    // Khôi phục lại kích thước viewport và zoom
    this.fabricCanvas.setWidth(currentW);
    this.fabricCanvas.setHeight(currentH);
    this.fabricCanvas.setViewportTransform(currentVpt);
    this.fabricCanvas.renderAll();

    // Convert dataUrl sang Blob
    const resp = await fetch(dataUrl);
    return await resp.blob();
  }
}
