/**
 * Fabric.js Canvas Editor for Manga Typesetting Studio
 * Re-architected with Elliptical Diamond Wrap, Floating Contextual Micro-Toolbar,
 * Interactive Split-Curtain Diff, Memory Lifecycle Cleanup, and Pro-Typesetter Hotkeys.
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

    // Memory & Blob Management
    this._activeObjectUrls = [];
    this.rawImageElement = null;

    // Interactive Split-Curtain Diff Mode (Rèm kéo so sánh Trước / Sau)
    this.isSplitCurtainActive = false;
    this.splitCurtainRatio = 0.5; // 0.0 to 1.0 (mặc định ở giữa 50%)
    this.isDraggingSplitCurtain = false;

    this.activeTool = "select"; // 'select' | 'region' | 'brush' | 'eraser' | 'pan' | 'text'
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
    this.onToolChanged = options.onToolChanged || (() => {});

    this.initCanvas();
    this.bindEvents();
    this.bindHotkeys();
    this.initMicroToolbar();
  }

  initCanvas() {
    this.fabricCanvas = new fabric.Canvas(this.canvasId, {
      selection: false,
      defaultCursor: "grab",
      hoverCursor: "move",
      preserveObjectStacking: true,
      fireRightClick: true,
      stopContextMenu: true,
      targetFindTolerance: 6, // Vùng đệm 6px giúp click trúng đối tượng cực nhạy
      perPixelTargetFind: false, // Dùng bounding box để bắt trúng toàn bộ vùng chữ
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
   * Chuyển Base64 chuỗi dài sang Blob URL để tiết kiệm RAM & tránh nghẽn Event Loop
   */
  _toBlobUrl(src) {
    if (!src) return null;
    if (src.startsWith("blob:") || src.startsWith("http")) return src;
    try {
      const parts = src.split(",");
      const byteString = atob(parts[1] || parts[0]);
      const mime = parts[0]?.match(/:(.*?);/)?.[1] || "image/png";
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      this._activeObjectUrls.push(blobUrl);
      return blobUrl;
    } catch (e) {
      console.warn("Chuyển blob URL thất bại, giữ URL gốc:", e);
      return src;
    }
  }

  /**
   * Giải phóng bộ nhớ khi đổi trang trong Chapter
   */
  _cleanupPageMemory() {
    if (Array.isArray(this._activeObjectUrls)) {
      this._activeObjectUrls.forEach((url) => {
        try {
          if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
        } catch (_) {}
      });
    }
    this._activeObjectUrls = [];

    if (this.fabricCanvas) {
      this.fabricCanvas.forEachObject((obj) => {
        if (obj._cacheCanvas) {
          obj._cacheCanvas.width = 0;
          obj._cacheCanvas.height = 0;
          obj._cacheCanvas = null;
          obj._cacheContext = null;
        }
      });
      try {
        this.fabricCanvas.clearContext(this.fabricCanvas.contextTop);
      } catch (_) {}
    }

    this.rawImageElement = null;
    this.hideMicroToolbar();
  }

  /**
   * Load một trang lên Canvas (ảnh gốc hoặc ảnh đã xóa chữ)
   * Tối ưu hiệu năng: Tắt renderOnAddRemove khi nạp hàng loạt box
   */
  async loadPage(pageData) {
    if (!pageData) return;
    this._cleanupPageMemory();

    // Chuyển ảnh sang Blob URL để giải phóng RAM V8 heap
    this.rawImageUrl = this._toBlobUrl(pageData.rawImage || null);
    this.cleanedImageUrl = this._toBlobUrl(pageData.cleanedImage || pageData.rawImage || null);
    this.currentPageId = pageData.id;

    // Preload ảnh gốc cho chế độ Split-Curtain Diff
    if (this.rawImageUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.rawImageElement = img;
      };
      img.src = this.rawImageUrl;
    }

    // Xóa toàn bộ canvas và lịch sử cũ
    this.fabricCanvas.clear();
    this.history = [];
    this.historyIndex = -1;

    // Load background image
    const bgUrl = this.cleanedImageUrl || this.rawImageUrl;
    if (bgUrl) {
      await this.setBackground(bgUrl);
    }

    // Nạp các box thoại hàng loạt (renderOnAddRemove = false)
    if (Array.isArray(pageData.boxes)) {
      this.isHistoryLocked = true;
      this.fabricCanvas.renderOnAddRemove = false;
      pageData.boxes.forEach((b) => this.addTextBoxFromData(b));
      this.fabricCanvas.renderOnAddRemove = true;
      this.isHistoryLocked = false;
    }

    this.fitToScreen();
    this.updateObjectsCoords();
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

          this.fabricCanvas.setBackgroundImage(img, () => {
            this.fabricCanvas.renderAll();
            resolve(img);
          });
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
      this.updateObjectsCoords();
      this.fabricCanvas.renderAll();
    }
  }

  /**
   * Cập nhật đồng bộ tọa độ hit-test (oCoords) cho toàn bộ Textbox sau khi Pan, Zoom hoặc Resize.
   * Ngăn chặn triệt để lỗi click trúng bóng thoại nhưng không nhận diện được (phải click lệch ra ngoài).
   */
  updateObjectsCoords() {
    if (!this.fabricCanvas) return;
    this.fabricCanvas.calcOffset();
    this.fabricCanvas.forEachObject((obj) => {
      if (typeof obj.setCoords === "function") {
        obj.setCoords();
      }
    });
  }

  /**
   * Tạm ẩn/hiện chữ để xem lại tranh gốc (Hold Space hoặc phím P)
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

    const targetUrl = showOriginal && this.rawImageUrl ? this.rawImageUrl : this.cleanedImageUrl || this.rawImageUrl;
    if (this.backgroundImage && targetUrl) {
      this.backgroundImage.setSrc(targetUrl, () => {
        this.fabricCanvas.renderAll();
      });
    } else {
      this.fabricCanvas.renderAll();
    }
  }

  /**
   * Bật / Tắt chế độ rèm kéo so sánh Trước/Sau (Interactive Split-Curtain Diff)
   */
  toggleSplitCurtain(enable) {
    const targetState = enable !== undefined ? Boolean(enable) : !this.isSplitCurtainActive;
    this.isSplitCurtainActive = targetState;

    if (this.isSplitCurtainActive && !this.rawImageElement && this.rawImageUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.rawImageElement = img;
        this.fabricCanvas.requestRenderAll();
      };
      img.src = this.rawImageUrl;
    }

    const btn = document.getElementById("btnToggleSplitCurtain");
    if (btn) btn.classList.toggle("active", this.isSplitCurtainActive);

    this.fabricCanvas.requestRenderAll();
    return this.isSplitCurtainActive;
  }

  // ---------------- Tool Switcher ----------------
  setTool(tool) {
    this.activeTool = tool;
    this.fabricCanvas.isDrawingMode = false;

    if (tool === "select") {
      this.fabricCanvas.selection = false;
      this.fabricCanvas.defaultCursor = "grab";
      this.fabricCanvas.hoverCursor = "move";
      this.fabricCanvas.forEachObject((obj) => {
        if (obj instanceof fabric.Textbox) obj.selectable = true;
      });
    } else if (tool === "pan") {
      this.fabricCanvas.selection = false;
      this.fabricCanvas.defaultCursor = "grab";
      this.fabricCanvas.hoverCursor = "grab";
      this.fabricCanvas.forEachObject((obj) => {
        if (obj instanceof fabric.Textbox) obj.selectable = false;
      });
    } else if (tool === "region") {
      this.fabricCanvas.selection = false;
      this.fabricCanvas.defaultCursor = "crosshair";
      this.fabricCanvas.hoverCursor = "crosshair";
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
    }

    this.onToolChanged(tool);
  }

  // ---------------- Canvas Events & Mouse Interactions ----------------
  bindEvents() {
    let isPanning = false;
    let lastPosX = 0;
    let lastPosY = 0;
    const canvasContainer = document.getElementById("typesetCanvasContainer");

    // Hook render: Vẽ rèm so sánh Trước/Sau (Split-Curtain)
    this.fabricCanvas.on("after:render", (opt) => {
      this._renderSplitCurtainOverlay(opt.ctx);
    });

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
        this.updateObjectsCoords();
        this.positionMicroToolbar();
        this.onZoomChanged(Math.round(zoom * 100));
        return;
      }

      // Lăn chuột bình thường: Cuộn di chuyển (Pan) trang truyện mượt mà
      const vpt = this.fabricCanvas.viewportTransform;
      vpt[4] -= evt.deltaX;
      vpt[5] -= evt.deltaY;
      this.fabricCanvas.requestRenderAll();
      this.updateObjectsCoords();
      this.positionMicroToolbar();
    });

    // Kéo pan canvas hoặc kéo vạch rèm Split-Curtain
    this.fabricCanvas.on("mouse:down", (opt) => {
      const evt = opt.e;
      const clientX = evt.clientX ?? (evt.touches && evt.touches[0]?.clientX);
      const clientY = evt.clientY ?? (evt.touches && evt.touches[0]?.clientY);

      // 1. Kiểm tra kéo vạch chia Split-Curtain
      if (this.isSplitCurtainActive) {
        const canvasEl = this.fabricCanvas.upperCanvasEl;
        const rect = canvasEl.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const canvasW = this.fabricCanvas.getWidth();
        const splitX = canvasW * this.splitCurtainRatio;

        if (Math.abs(mouseX - splitX) <= 14) {
          this.isDraggingSplitCurtain = true;
          this.fabricCanvas.setCursor("ew-resize");
          return;
        }
      }

      let target = opt.target;

      // Fallback hit-test chuẩn xác: Nếu Fabric chưa nhận target (do vừa pan/zoom),
      // dùng canvas pointer để kiểm tra chính xác vùng bounding box của các textbox
      if (!target && (this.activeTool === "select" || !this.activeTool) && evt.button === 0) {
        const pointer = this.fabricCanvas.getPointer(evt);
        const textboxes = this.fabricCanvas.getObjects().filter((o) => o instanceof fabric.Textbox && o.visible && o.selectable);
        for (let i = textboxes.length - 1; i >= 0; i--) {
          const tb = textboxes[i];
          tb.setCoords();
          if (tb.containsPoint(pointer)) {
            target = tb;
            this.fabricCanvas.setActiveObject(tb);
            this.fabricCanvas.requestRenderAll();
            break;
          }
        }
      }

      // Bắt đầu pan nếu:
      // 1. Nhấn nút giữa chuột (button === 1)
      // 2. Nhấn nút chuột phải (button === 2)
      // 3. Đang giữ phím Space
      // 4. Đang bật công cụ Pan (activeTool === "pan")
      // 5. Công cụ Select và click vào nền trống / trang ảnh (không click trúng textbox)
      const isRightClick = evt.button === 2;
      const isMiddleClick = evt.button === 1;
      const isSpaceOrPan = this.isSpacePressed || this.activeTool === "pan";
      const isSelectEmpty = (this.activeTool === "select" || !this.activeTool) && !target && evt.button === 0;

      if (isRightClick || isMiddleClick || isSpaceOrPan || isSelectEmpty) {
        isPanning = true;
        this.fabricCanvas.selection = false;
        lastPosX = clientX;
        lastPosY = clientY;
        this.fabricCanvas.defaultCursor = "grabbing";
        this.fabricCanvas.setCursor("grabbing");
        canvasContainer?.classList.add("panning");

        if (isSelectEmpty && this.fabricCanvas.getActiveObject()) {
          this.fabricCanvas.discardActiveObject();
          this.fabricCanvas.requestRenderAll();
          this.hideMicroToolbar();
        }
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
      const clientX = evt.clientX ?? (evt.touches && evt.touches[0]?.clientX);
      const clientY = evt.clientY ?? (evt.touches && evt.touches[0]?.clientY);

      // Kéo rèm Split-Curtain
      if (this.isDraggingSplitCurtain) {
        const canvasEl = this.fabricCanvas.upperCanvasEl;
        const rect = canvasEl.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const canvasW = this.fabricCanvas.getWidth();
        this.splitCurtainRatio = Math.max(0.02, Math.min(0.98, mouseX / canvasW));
        this.fabricCanvas.setCursor("ew-resize");
        this.fabricCanvas.requestRenderAll();
        return;
      }

      // Hover gần vạch chia Split-Curtain
      if (this.isSplitCurtainActive && !isPanning && !this.isDrawingRegion) {
        const canvasEl = this.fabricCanvas.upperCanvasEl;
        const rect = canvasEl.getBoundingClientRect();
        const mouseX = clientX - rect.left;
        const canvasW = this.fabricCanvas.getWidth();
        const splitX = canvasW * this.splitCurtainRatio;
        if (Math.abs(mouseX - splitX) <= 12) {
          this.fabricCanvas.setCursor("ew-resize");
        }
      }

      if (isPanning) {
        const deltaX = clientX - lastPosX;
        const deltaY = clientY - lastPosY;
        if (deltaX !== 0 || deltaY !== 0) {
          const vpt = this.fabricCanvas.viewportTransform;
          vpt[4] += deltaX;
          vpt[5] += deltaY;
          this.fabricCanvas.requestRenderAll();
          lastPosX = clientX;
          lastPosY = clientY;
          this.positionMicroToolbar();
        }
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
      if (this.isDraggingSplitCurtain) {
        this.isDraggingSplitCurtain = false;
      }
      if (isPanning) {
        isPanning = false;
        canvasContainer?.classList.remove("panning");
        const cur = (this.isSpacePressed || this.activeTool === "pan" || this.activeTool === "select" || !this.activeTool) ? "grab" : "default";
        this.fabricCanvas.defaultCursor = cur;
        this.fabricCanvas.setCursor(cur);
        this.fabricCanvas.selection = false;
        this.updateObjectsCoords();
        this.positionMicroToolbar();
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

    window.addEventListener("mouseup", stopPanning);
    window.addEventListener("resize", () => {
      this.resizeCanvasToContainer();
      this.positionMicroToolbar();
    });

    // Lắng nghe chọn Textbox
    this.fabricCanvas.on("selection:created", (e) => this.handleSelectionEvent(e));
    this.fabricCanvas.on("selection:updated", (e) => this.handleSelectionEvent(e));
    this.fabricCanvas.on("selection:cleared", () => {
      this.hideMicroToolbar();
      this.onSelectionChanged(null);
    });

    // Nhấp đúp để mở chế độ gõ chữ mượt mà ngay trên Canvas
    this.fabricCanvas.on("mouse:dblclick", (opt) => {
      if (opt.target instanceof fabric.Textbox) {
        opt.target.enterEditing();
        opt.target.selectAll();
        this.fabricCanvas.renderAll();
      }
    });

    // Lắng nghe thay đổi vị trí / kích thước / nội dung Textbox
    this.fabricCanvas.on("object:moving", () => this.positionMicroToolbar());
    this.fabricCanvas.on("object:scaling", () => this.positionMicroToolbar());

    this.fabricCanvas.on("object:modified", (e) => {
      if (e.target instanceof fabric.Textbox) {
        this.onBoxModified(this.getBoxData(e.target));
        this.positionMicroToolbar();
        this.pushHistoryState();
      }
    });

    this.fabricCanvas.on("text:changed", (e) => {
      if (e.target instanceof fabric.Textbox) {
        e.target.textVi = e.target.text;
        this.onBoxModified(this.getBoxData(e.target));
        this.positionMicroToolbar();
      }
    });
  }

  handleSelectionEvent(e) {
    const selected = e.selected?.[0] || e.target;
    if (selected instanceof fabric.Textbox) {
      this.positionMicroToolbar(selected);
      this.onSelectionChanged(this.getBoxData(selected));
    }
  }

  // ---------------- Interactive Split-Curtain Rendering ----------------
  _renderSplitCurtainOverlay(ctx) {
    if (!this.isSplitCurtainActive || !this.rawImageElement) return;

    const canvasW = this.fabricCanvas.getWidth();
    const canvasH = this.fabricCanvas.getHeight();
    const splitX = Math.round(canvasW * this.splitCurtainRatio);

    // 1. Vẽ nửa trái là tranh gốc (rawImageElement) theo đúng viewport zoom/pan
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Về không gian màn hình để cắt hình chữ nhật rèm
    ctx.beginPath();
    ctx.rect(0, 0, splitX, canvasH);
    ctx.clip();

    // Dùng viewportTransform của Fabric để vẽ tranh gốc khớp tuyệt đối từng pixel
    const vpt = this.fabricCanvas.viewportTransform;
    ctx.setTransform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
    ctx.drawImage(this.rawImageElement, 0, 0, this.pageWidth, this.pageHeight);
    ctx.restore();

    // 2. Vẽ đường rèm neon chia đôi & con trỏ kéo
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Vạch sáng thẳng đứng
    ctx.beginPath();
    ctx.moveTo(splitX, 0);
    ctx.lineTo(splitX, canvasH);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#818cf8";
    ctx.shadowColor = "rgba(99, 102, 241, 0.75)";
    ctx.shadowBlur = 10;
    ctx.stroke();

    // Nút kéo tròn ở chính giữa
    const handleY = canvasH / 2;
    ctx.beginPath();
    ctx.arc(splitX, handleY, 15, 0, Math.PI * 2);
    ctx.fillStyle = "#6366f1";
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    // Mũi tên 2 chiều
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 0;
    ctx.fillText("⇄", splitX, handleY);

    // Badge nhãn Bên Trái (GỐC) & Bên Phải (TYPESET)
    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.beginPath();
    ctx.roundRect(splitX - 68, 14, 56, 22, 6);
    ctx.roundRect(splitX + 12, 14, 76, 22, 6);
    ctx.fill();

    ctx.font = "bold 10px sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("GỐC", splitX - 40, 25);
    ctx.fillStyle = "#818cf8";
    ctx.fillText("TYPESET", splitX + 50, 25);

    ctx.restore();
  }

  // ---------------- Floating Contextual Micro-Toolbar ----------------
  refreshMicroToolbarFonts(availableFonts) {
    if (availableFonts) {
      this.options.availableFonts = availableFonts;
    }
    const fontSelect = document.getElementById("microFontSelect");
    if (!fontSelect) return;
    fontSelect.innerHTML = "";

    const builtin = this.options.availableFonts?.builtin || [
      { name: "Yuki Burobu", label: "Yuki Burobu (Manga chuẩn)" },
      { name: "CC Wild Words", label: "CC Wild Words (Hành động)" },
      { name: "Anime Ace", label: "Anime Ace (Hài hước)" },
    ];
    builtin.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.name;
      opt.textContent = f.label;
      fontSelect.appendChild(opt);
    });

    const custom = this.options.availableFonts?.custom || [];
    if (Array.isArray(custom) && custom.length > 0) {
      const grp = document.createElement("optgroup");
      grp.label = "Font tự nạp";
      custom.forEach((cf) => {
        const opt = document.createElement("option");
        opt.value = cf.name;
        opt.textContent = cf.name;
        grp.appendChild(opt);
      });
      fontSelect.appendChild(grp);
    }
  }

  initMicroToolbar() {
    const toolbar = document.getElementById("typesetMicroToolbar");
    if (!toolbar) return;

    // 1. Populate danh sách Font chữ
    const fontSelect = document.getElementById("microFontSelect");
    if (fontSelect) {
      this.refreshMicroToolbarFonts();

      fontSelect.addEventListener("change", (e) => {
        const active = this.fabricCanvas.getActiveObject();
        if (active instanceof fabric.Textbox) {
          this.updateBoxStyle(active.id, { fontFamily: e.target.value });
        }
      });
    }

    // 2. Stepper cỡ chữ (+/-)
    document.getElementById("btnMicroSizeDec")?.addEventListener("click", () => {
      const active = this.fabricCanvas.getActiveObject();
      if (active instanceof fabric.Textbox) {
        const cur = active.fontSize || 20;
        this.updateBoxStyle(active.id, { fontSize: Math.max(8, cur - 1) });
        this.positionMicroToolbar(active);
      }
    });

    document.getElementById("btnMicroSizeInc")?.addEventListener("click", () => {
      const active = this.fabricCanvas.getActiveObject();
      if (active instanceof fabric.Textbox) {
        const cur = active.fontSize || 20;
        this.updateBoxStyle(active.id, { fontSize: Math.min(140, cur + 1) });
        this.positionMicroToolbar(active);
      }
    });

    // 3. ⚡ Nút Auto-Fit Elip Diamond Wrap
    document.getElementById("btnMicroAutoFit")?.addEventListener("click", () => {
      const active = this.fabricCanvas.getActiveObject();
      if (active instanceof fabric.Textbox) {
        this.autoFitFontSize(active);
      }
    });

    // 4. In đậm (Bold)
    document.getElementById("btnMicroBold")?.addEventListener("click", () => {
      const active = this.fabricCanvas.getActiveObject();
      if (active instanceof fabric.Textbox) {
        const next = active.fontWeight === "bold" ? "normal" : "bold";
        this.updateBoxStyle(active.id, { fontWeight: next });
        this.positionMicroToolbar(active);
      }
    });

    // 5. In nghiêng (Italic)
    document.getElementById("btnMicroItalic")?.addEventListener("click", () => {
      const active = this.fabricCanvas.getActiveObject();
      if (active instanceof fabric.Textbox) {
        const next = active.fontStyle === "italic" ? "normal" : "italic";
        this.updateBoxStyle(active.id, { fontStyle: next });
        this.positionMicroToolbar(active);
      }
    });

    // 6. Chuyển đổi Viết HOA Toàn Bộ (All-Caps)
    document.getElementById("btnMicroCaps")?.addEventListener("click", () => {
      const active = this.fabricCanvas.getActiveObject();
      if (active instanceof fabric.Textbox) {
        this.toggleCapsAll(active);
      }
    });

    // 7. Đảo màu chữ / viền tương phản (Trắng/Đen)
    document.getElementById("btnMicroInvert")?.addEventListener("click", () => {
      const active = this.fabricCanvas.getActiveObject();
      if (active instanceof fabric.Textbox) {
        this.autoInvertColors(active);
        this.positionMicroToolbar(active);
      }
    });

    // 8. Nhân bản box (Duplicate)
    document.getElementById("btnMicroDuplicate")?.addEventListener("click", () => {
      this.duplicateSelectedBox();
    });

    // 9. Khóa / Mở khóa box (Lock)
    document.getElementById("btnMicroLock")?.addEventListener("click", () => {
      const active = this.fabricCanvas.getActiveObject();
      if (active instanceof fabric.Textbox) {
        this.toggleLockBox(active.id);
      }
    });

    // 10. Xóa box (Delete)
    document.getElementById("btnMicroDelete")?.addEventListener("click", () => {
      this.deleteSelectedBox();
    });
  }

  /**
   * Định vị thanh công cụ ngữ cảnh nổi neo ngay trên đầu Textbox đang chọn
   */
  positionMicroToolbar(box) {
    const active = box || this.fabricCanvas?.getActiveObject();
    const toolbar = document.getElementById("typesetMicroToolbar");
    if (!toolbar) return;

    if (!active || !(active instanceof fabric.Textbox)) {
      this.hideMicroToolbar();
      return;
    }

    // 1. Tính toán tọa độ màn hình từ không gian world coordinates
    const vpt = this.fabricCanvas.viewportTransform;
    const rect = active.getBoundingRect(true, true);

    const screenLeft = rect.left * vpt[0] + vpt[4];
    const screenTop = rect.top * vpt[3] + vpt[5];
    const screenWidth = rect.width * vpt[0];
    const screenHeight = rect.height * vpt[3];

    const tbW = toolbar.offsetWidth || 340;
    const tbH = toolbar.offsetHeight || 38;
    const centerX = screenLeft + screenWidth / 2;

    let posX = centerX - tbW / 2;
    const containerW = this.fabricCanvas.getWidth();
    posX = Math.max(12, Math.min(containerW - tbW - 12, posX));

    // Ưu tiên hiển thị phía trên Textbox 10px, nếu sát mép trên thì lật xuống dưới
    let posY = screenTop - tbH - 12;
    if (posY < 12) {
      posY = screenTop + screenHeight + 12;
    }

    toolbar.style.left = `${Math.round(posX)}px`;
    toolbar.style.top = `${Math.round(posY)}px`;
    toolbar.style.display = "flex";
    toolbar.classList.add("visible");

    // 2. Đồng bộ trạng thái vào UI toolbar
    const fontSel = document.getElementById("microFontSelect");
    if (fontSel && active.fontFamily) fontSel.value = active.fontFamily;

    const sizeBadge = document.getElementById("microSizeBadge");
    if (sizeBadge) sizeBadge.textContent = `${active.fontSize || 20}px`;

    const btnBold = document.getElementById("btnMicroBold");
    if (btnBold) btnBold.classList.toggle("active", active.fontWeight === "bold");

    const btnItalic = document.getElementById("btnMicroItalic");
    if (btnItalic) btnItalic.classList.toggle("active", active.fontStyle === "italic");

    const iconLock = document.getElementById("iconMicroLock");
    if (iconLock) {
      iconLock.className = active.isLocked ? "fa-solid fa-lock text-amber-400" : "fa-solid fa-lock";
    }
  }

  hideMicroToolbar() {
    const toolbar = document.getElementById("typesetMicroToolbar");
    if (toolbar) {
      toolbar.classList.remove("visible");
      toolbar.style.display = "none";
    }
  }

  /**
   * Chuyển đổi Viết hoa toàn bộ (All-Caps) hoặc viết thường
   */
  toggleCapsAll(textbox) {
    if (!textbox) return;
    const cur = textbox.text || "";
    const isAllUpper = cur.length > 0 && cur === cur.toUpperCase();
    const next = isAllUpper ? cur.toLowerCase() : cur.toUpperCase();
    this.updateBoxText(textbox.id, next);
  }

  /**
   * Khóa / Mở khóa di chuyển và chỉnh sửa box
   */
  toggleLockBox(id) {
    const box = this.fabricCanvas.getObjects().find((o) => o instanceof fabric.Textbox && o.id === id);
    if (!box) return;
    box.isLocked = !box.isLocked;
    box.lockMovementX = box.isLocked;
    box.lockMovementY = box.isLocked;
    box.lockScalingX = box.isLocked;
    box.lockScalingY = box.isLocked;
    box.lockRotation = box.isLocked;
    box.borderColor = box.isLocked ? "#f59e0b" : "#6366f1";
    this.fabricCanvas.renderAll();
    this.positionMicroToolbar(box);
    this.onBoxModified(this.getBoxData(box));
  }

  /**
   * Nhân bản Textbox hiện tại với offset nhẹ (+20px, +20px)
   */
  duplicateSelectedBox() {
    const active = this.fabricCanvas.getActiveObject();
    if (!(active instanceof fabric.Textbox)) return;

    const boxData = this.getBoxData(active);
    const newBox = this.addTextBoxFromData({
      ...boxData,
      id: `box_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      order: this.getNextOrder(),
      x: boxData.x + 20,
      y: boxData.y + 20,
    });

    this.fabricCanvas.setActiveObject(newBox);
    this.fabricCanvas.renderAll();
    this.pushHistoryState();
    this.onBoxesListChanged(this.getAllBoxesData());
    this.positionMicroToolbar(newBox);
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
      strokeLineJoin: "round", // Làm mượt viền stroke, không bị gai nhọn đâm lẹm dấu tiếng Việt
      strokeLineCap: "round",
      textAlign: data.style?.align || "center",
      lineHeight: data.style?.lineHeight || 1.15,
      fontWeight: data.style?.bold ? "bold" : "normal",
      fontStyle: data.style?.italic ? "italic" : "normal",
      paintFirst: "stroke", // Vẽ viền trước, chữ đè lên trên để viền không ăn lẹm vào lòng chữ
      originX: "left",
      originY: "top",
      padding: 10, // Vùng đệm 10px giúp click trúng đối tượng cực nhạy
      borderColor: "#6366f1",
      cornerColor: "#ffffff",
      cornerStrokeColor: "#6366f1",
      cornerSize: 11, // Nút handle tròn 11px phong cách Figma/Canva
      cornerStyle: "circle",
      transparentCorners: false,
      touchCornerSize: 28,
      selectable: true,
      evented: true,
    });

    // Ẩn 2 handle giữa trên/dưới để tránh người dùng kéo méo bẹp chữ theo trục dọc
    box.setControlsVisibility({
      mt: false,
      mb: false,
    });

    // Co giãn tự do 4 góc: Cỡ chữ và kích thước khung tự động phóng to/thu nhỏ mượt mà
    box.on("scaling", () => {
      const scale = Math.max(box.scaleX || 1, box.scaleY || 1);
      if (scale && scale !== 1) {
        const curFont = box.fontSize || 20;
        const newFontSize = Math.max(8, Math.min(140, Math.round(curFont * scale)));
        const newWidth = Math.max(40, Math.round(box.width * scale));

        box.set({
          fontSize: newFontSize,
          width: newWidth,
          scaleX: 1,
          scaleY: 1,
        });
        box.setCoords();
        this.positionMicroToolbar(box);
        this.onBoxModified(this.getBoxData(box));
      }
    });

    this.fabricCanvas.add(box);
    box.setCoords();
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
    this.positionMicroToolbar(box);
    return box;
  }

  getNextOrder() {
    const boxes = this.fabricCanvas.getObjects().filter((o) => o instanceof fabric.Textbox);
    if (boxes.length === 0) return 1;
    const maxOrder = Math.max(...boxes.map((b) => b.order || 0));
    return maxOrder + 1;
  }

  getBoxData(textbox) {
    if (!textbox) return null;
    return {
      id: textbox.id,
      order: textbox.order,
      textJa: textbox.textJa || "",
      textVi: textbox.textVi || textbox.text || "",
      text: textbox.text || "",
      x: Math.round(textbox.left),
      y: Math.round(textbox.top),
      width: Math.round(textbox.width * (textbox.scaleX || 1)),
      height: Math.round(textbox.height * (textbox.scaleY || 1)),
      style: {
        fontSize: Math.round((textbox.fontSize || 20) * (textbox.scaleX || 1)),
        fontFamily: textbox.fontFamily || "Yuki Burobu",
        fill: textbox.fill || "#000000",
        stroke: textbox.stroke || "#ffffff",
        strokeWidth: textbox.strokeWidth !== undefined ? textbox.strokeWidth : 3,
        align: textbox.textAlign || "center",
        bold: textbox.fontWeight === "bold",
        italic: textbox.fontStyle === "italic",
        lineHeight: textbox.lineHeight || 1.15,
      },
      isLocked: Boolean(textbox.isLocked),
    };
  }

  // ---------------- THUẬT TOÁN ĐỘT PHÁ: ELLIPTICAL DIAMOND WRAP ----------------
  /**
   * Thuật toán "Elliptical Diamond Wrap" dành riêng cho Manga Typesetting.
   * Uốn dòng chữ và căn chỉnh cỡ font sao cho chữ khít đều vào dáng elip của bóng thoại,
   * dòng ở giữa dài nhất, các dòng trên/dưới thu hẹp dần theo tỷ lệ hình học:
   * (x / a)^2 + (y / b)^2 <= 1.
   * Kèm khoảng đệm an toàn tối thiểu 12% và chống rớt chữ côi cút (orphan words).
   *
   * @param {string} text - Nội dung câu thoại
   * @param {number} boxWidth - Chiều rộng khung bóng thoại
   * @param {number} boxHeight - Chiều cao khung bóng thoại
   * @param {string} fontFamily - Tên font chữ
   * @param {number} [initialFontSize=22] - Cỡ chữ gợi ý ban đầu
   * @returns {{ lines: string[], text: string, fontSize: number }}
   */
  ellipticalDiamondWrap(text, boxWidth, boxHeight, fontFamily = "Yuki Burobu", initialFontSize = 22) {
    const cleanText = (text || "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
    if (!cleanText) return { lines: [""], text: "", fontSize: initialFontSize };

    const words = cleanText.split(" ");
    if (words.length <= 1) {
      return { lines: [cleanText], text: cleanText, fontSize: initialFontSize };
    }

    // Safety margin 14% (chống chạm nét viền vẽ bóng thoại của tác giả)
    const aEff = (boxWidth / 2) * 0.86;
    const bEff = (boxHeight / 2) * 0.86;

    // Đo đạc text chính xác qua Canvas context ẩn
    const measureCanvas = document.createElement("canvas");
    const mctx = measureCanvas.getContext("2d");

    const measureWord = (str, sz) => {
      mctx.font = `${sz}px '${fontFamily}', sans-serif`;
      return mctx.measureText(str).width;
    };

    let bestConfig = null;

    // Quét tìm cỡ chữ từ lớn xuống nhỏ để chữ dễ đọc nhất
    const startSize = Math.max(14, Math.min(60, Math.round(boxHeight * 0.38)));
    const minSize = 10;

    for (let sz = startSize; sz >= minSize; sz -= 2) {
      const lineHeight = sz * 1.18;
      const maxLines = Math.max(1, Math.min(8, Math.floor((bEff * 2) / lineHeight)));

      // Thử số lượng dòng từ 2 đến maxLines
      for (let N = 2; N <= maxLines; N++) {
        // Tính độ rộng khả dụng cho từng dòng i theo phương trình Elip: (y/b)^2 + (w/2a)^2 = 1
        const allowedWidths = [];
        let isFeasible = true;

        for (let i = 0; i < N; i++) {
          const y = (i - (N - 1) / 2) * lineHeight;
          const normY = Math.abs(y) / bEff;
          if (normY >= 0.96) {
            isFeasible = false;
            break;
          }
          const w = 2 * aEff * Math.sqrt(Math.max(0.08, 1 - normY * normY));
          allowedWidths.push(w);
        }

        if (!isFeasible) continue;

        // Phân phối từ vào N dòng tôn trọng hình dạng kim cương / elip
        const candidateLines = this._distributeWordsIntoEllipticalLines(words, allowedWidths, sz, measureWord);
        if (candidateLines) {
          bestConfig = { lines: candidateLines, fontSize: sz };
          break;
        }
      }

      if (bestConfig) break;
    }

    if (!bestConfig) {
      return { lines: [cleanText], text: cleanText, fontSize: Math.max(12, Math.round(initialFontSize * 0.8)) };
    }

    return {
      lines: bestConfig.lines,
      text: bestConfig.lines.join("\n"),
      fontSize: bestConfig.fontSize,
    };
  }

  _distributeWordsIntoEllipticalLines(words, allowedWidths, sz, measureWord) {
    const N = allowedWidths.length;
    const lines = [];
    let wordIdx = 0;

    for (let i = 0; i < N; i++) {
      let curLine = "";
      while (wordIdx < words.length) {
        const testLine = curLine ? `${curLine} ${words[wordIdx]}` : words[wordIdx];
        const w = measureWord(testLine, sz);
        if (w <= allowedWidths[i] || !curLine) {
          curLine = testLine;
          wordIdx++;
        } else {
          break;
        }
      }
      if (!curLine) return null;
      lines.push(curLine);
    }

    if (wordIdx < words.length) return null;

    // Chống từ côi cút (Orphan word): Nếu dòng cuối chỉ có đúng 1 từ ngắn (< 6 ký tự)
    if (lines.length > 1) {
      const lastLineWords = lines[lines.length - 1].split(" ");
      if (lastLineWords.length === 1 && lastLineWords[0].length < 6) {
        const prevLineWords = lines[lines.length - 2].split(" ");
        if (prevLineWords.length > 2) {
          const stolenWord = prevLineWords.pop();
          const newPrev = prevLineWords.join(" ");
          const newLast = `${stolenWord} ${lastLineWords[0]}`;
          if (measureWord(newLast, sz) <= allowedWidths[N - 1]) {
            lines[lines.length - 2] = newPrev;
            lines[lines.length - 1] = newLast;
          }
        }
      }
    }

    return lines;
  }

  /**
   * Tự động uốn chữ & co cỡ font theo dáng elip bóng thoại Manga
   */
  autoFitFontSize(textbox, targetHeight) {
    if (!textbox) return;

    const rawContent = textbox.textVi || textbox.text || "";
    const boxW = Math.max(60, textbox.width * (textbox.scaleX || 1));
    const boxH = Math.max(40, targetHeight || textbox.height * (textbox.scaleY || 1));
    const font = textbox.fontFamily || "Yuki Burobu";

    const wrapResult = this.ellipticalDiamondWrap(rawContent, boxW, boxH, font, textbox.fontSize || 20);

    textbox.set({
      text: wrapResult.text,
      fontSize: wrapResult.fontSize,
      textAlign: "center",
      scaleX: 1,
      scaleY: 1,
    });
    textbox.textVi = wrapResult.text;
    textbox.initDimensions();
    textbox.setCoords();

    this.fabricCanvas.renderAll();
    this.positionMicroToolbar(textbox);
    this.onBoxModified(this.getBoxData(textbox));
    this.pushHistoryState();
  }

  /**
   * Chạy Auto-Fit Elip cho toàn bộ các bóng thoại trong trang hiện tại (Ctrl + Shift + F)
   */
  autoFitAllBoxes() {
    const textboxes = this.fabricCanvas.getObjects().filter((o) => o instanceof fabric.Textbox);
    if (textboxes.length === 0) return;

    this.fabricCanvas.renderOnAddRemove = false;
    textboxes.forEach((tb) => {
      const rawContent = tb.textVi || tb.text || "";
      const boxW = Math.max(60, tb.width * (tb.scaleX || 1));
      const boxH = Math.max(40, tb.height * (tb.scaleY || 1));
      const font = tb.fontFamily || "Yuki Burobu";

      const wrapResult = this.ellipticalDiamondWrap(rawContent, boxW, boxH, font, tb.fontSize || 20);
      tb.set({
        text: wrapResult.text,
        fontSize: wrapResult.fontSize,
        textAlign: "center",
        scaleX: 1,
        scaleY: 1,
      });
      tb.textVi = wrapResult.text;
      tb.initDimensions();
      tb.setCoords();
    });
    this.fabricCanvas.renderOnAddRemove = true;

    this.updateObjectsCoords();
    this.fabricCanvas.requestRenderAll();
    this.positionMicroToolbar();
    this.pushHistoryState();
    this.onBoxesListChanged(this.getAllBoxesData());
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
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;

      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let count = 0;

      for (let i = 0; i < data.length; i += 16) {
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        count++;
      }

      const luma = (0.299 * rSum + 0.587 * gSum + 0.114 * bSum) / count;
      return luma > 128;
    } catch (_) {
      return true;
    }
  }

  autoInvertColors(textbox) {
    if (!textbox) return;
    const isCurBlack = textbox.fill === "#000000" || textbox.fill === "black";
    textbox.set({
      fill: isCurBlack ? "#ffffff" : "#000000",
      stroke: isCurBlack ? "#000000" : "#ffffff",
      strokeWidth: 3,
    });
    this.fabricCanvas.renderAll();
    this.positionMicroToolbar(textbox);
    this.onBoxModified(this.getBoxData(textbox));
    this.pushHistoryState();
  }

  // ---------------- Textbox Management ----------------
  selectBoxById(id) {
    const box = this.fabricCanvas.getObjects().find((o) => o instanceof fabric.Textbox && o.id === id);
    if (box) {
      box.setCoords();
      this.fabricCanvas.setActiveObject(box);
      this.fabricCanvas.renderAll();
      this.positionMicroToolbar(box);
      this.onSelectionChanged(this.getBoxData(box));
    }
  }

  updateBoxText(id, newTextVi) {
    const box = this.fabricCanvas.getObjects().find((o) => o instanceof fabric.Textbox && o.id === id);
    if (box) {
      box.set("text", newTextVi);
      box.textVi = newTextVi;
      box.initDimensions();
      box.setCoords();
      this.fabricCanvas.renderAll();
      this.positionMicroToolbar(box);
      this.pushHistoryState();
    }
  }

  updateBoxStyle(id, styleUpdates) {
    const box = this.fabricCanvas.getObjects().find((o) => o instanceof fabric.Textbox && o.id === id);
    if (box) {
      box.set(styleUpdates);
      box.initDimensions();
      box.setCoords();
      this.fabricCanvas.renderAll();
      this.positionMicroToolbar(box);
      this.pushHistoryState();
      this.onBoxModified(this.getBoxData(box));
    }
  }

  deleteBoxById(id) {
    const box = this.fabricCanvas.getObjects().find((o) => o instanceof fabric.Textbox && o.id === id);
    if (box) {
      this.fabricCanvas.remove(box);
      this.fabricCanvas.discardActiveObject();
      this.hideMicroToolbar();
      this.fabricCanvas.renderAll();
      this.pushHistoryState();
      this.onBoxesListChanged(this.getAllBoxesData());
    }
  }

  deleteSelectedBox() {
    const active = this.fabricCanvas.getActiveObject();
    if (active && active instanceof fabric.Textbox) {
      this.fabricCanvas.remove(active);
      this.fabricCanvas.discardActiveObject();
      this.hideMicroToolbar();
      this.fabricCanvas.renderAll();
      this.pushHistoryState();
      this.onBoxesListChanged(this.getAllBoxesData());
    }
  }

  cycleNextBox(reverse = false) {
    const boxes = this.fabricCanvas
      .getObjects()
      .filter((o) => o instanceof fabric.Textbox)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    if (boxes.length === 0) return;

    const current = this.fabricCanvas.getActiveObject();
    let nextIndex = 0;

    if (current) {
      const curIndex = boxes.indexOf(current);
      if (reverse) {
        nextIndex = curIndex > 0 ? curIndex - 1 : boxes.length - 1;
      } else {
        nextIndex = curIndex < boxes.length - 1 ? curIndex + 1 : 0;
      }
    }

    const nextBox = boxes[nextIndex];
    nextBox.setCoords();
    this.fabricCanvas.setActiveObject(nextBox);
    this.fabricCanvas.renderAll();
    this.positionMicroToolbar(nextBox);
  }

  reorderBoxes() {
    const boxes = this.fabricCanvas.getObjects().filter((o) => o instanceof fabric.Textbox);
    boxes.sort((a, b) => {
      const topDiff = a.top - b.top;
      if (Math.abs(topDiff) > 80) return topDiff;
      return b.left - a.left; // Manga đọc từ Phải sang Trái (RTL)
    });

    boxes.forEach((box, index) => {
      box.order = index + 1;
    });

    this.fabricCanvas.renderAll();
    this.pushHistoryState();
    this.onBoxesListChanged(this.getAllBoxesData());
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
    this.updateObjectsCoords();
    this.positionMicroToolbar();
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
    this.updateObjectsCoords();
    this.positionMicroToolbar();
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
    try {
      const boxesData = JSON.parse(stateStr);
      this.isHistoryLocked = true;

      const current = this.fabricCanvas.getObjects().filter((o) => o instanceof fabric.Textbox);
      current.forEach((c) => this.fabricCanvas.remove(c));

      boxesData.forEach((d) => this.addTextBoxFromData(d));

      this.updateObjectsCoords();
      this.fabricCanvas.renderAll();
      this.positionMicroToolbar();
      this.onBoxesListChanged(this.getAllBoxesData());
    } finally {
      this.isHistoryLocked = false;
    }
  }

  // ---------------- Hotkeys Scanlation Chuyên Nghiệp ----------------
  bindHotkeys() {
    this.isSpacePressed = false;

    window.addEventListener("keydown", (e) => {
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
      const isInput = tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable;
      if (isInput) return;

      // 1. Phím tắt Space (Pan canvas mượt mà)
      if (e.code === "Space" && !this.isSpacePressed) {
        e.preventDefault();
        this.isSpacePressed = true;
        this.fabricCanvas.defaultCursor = "grab";
        this.fabricCanvas.setCursor("grab");
      }
      // 2. Phím F: Fit to Screen
      else if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        this.fitToScreen();
      }
      // 3. Phím \ : Bật/Tắt rèm kéo so sánh Trước/Sau (Split-Curtain Diff)
      else if (e.key === "\\") {
        e.preventDefault();
        this.toggleSplitCurtain();
      }
      // 4. Ctrl + Shift + F: Auto-Fit Elip toàn bộ box trên trang
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "F" || e.key === "f")) {
        e.preventDefault();
        this.autoFitAllBoxes();
      }
      // 5. Ctrl + D: Nhân bản box
      else if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        this.duplicateSelectedBox();
      }
      // 6. Tab / Shift+Tab: Nhảy giữa các box theo thứ tự đọc
      else if (e.key === "Tab") {
        e.preventDefault();
        this.cycleNextBox(e.shiftKey);
      }
      // 7. Hoàn tác / Làm lại (Ctrl+Z / Ctrl+Y)
      else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        this.redo();
      }
      // 8. Delete / Backspace: Xóa box
      else if (e.key === "Delete" || e.key === "Backspace") {
        if (this.fabricCanvas.getActiveObject() instanceof fabric.Textbox) {
          this.deleteSelectedBox();
        }
      }
      // 9. Escape: Bỏ chọn box
      else if (e.key === "Escape") {
        this.fabricCanvas.discardActiveObject();
        this.fabricCanvas.renderAll();
        this.hideMicroToolbar();
      }
      // 10. Chuyển đổi Tool nhanh
      else if (e.key === "h" || e.key === "H") {
        this.setTool("pan");
      } else if (e.key === "b" || e.key === "B") {
        this.setTool("brush");
      } else if (e.key === "e" || e.key === "E") {
        this.setTool("eraser");
      } else if (e.key === "v" || e.key === "V") {
        this.setTool("select");
      } else if (e.key === "t" || e.key === "T") {
        this.setTool("text");
      } else if (e.key === "p" || e.key === "P") {
        this.togglePreviewOriginal(!this.isShowingOriginal);
      }
    });

    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.isSpacePressed = false;
        const cur = (this.activeTool === "pan" || this.activeTool === "select") ? "grab" : "crosshair";
        this.fabricCanvas.defaultCursor = cur;
        this.fabricCanvas.setCursor(cur);
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

    this.fabricCanvas.setWidth(this.pageWidth);
    this.fabricCanvas.setHeight(this.pageHeight);
    this.fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    this.fabricCanvas.renderAll();

    const dataUrl = this.fabricCanvas.toDataURL({
      format: format === "image/png" ? "png" : "jpeg",
      quality: quality,
      multiplier: 1,
    });

    this.fabricCanvas.setWidth(currentW);
    this.fabricCanvas.setHeight(currentH);
    this.fabricCanvas.setViewportTransform(currentVpt);
    this.fabricCanvas.renderAll();

    const resp = await fetch(dataUrl);
    return await resp.blob();
  }
}
