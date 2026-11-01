/**
 * =========================================================================
 * UNIVERSAL MANGA EXTRACTOR PRO BOOKMARKLET
 * Inspired by comix-downloader: Canvas DRM & Lazy-load Multi-Engine Scraper
 * Zero-dependency, Shadow DOM VisionOS Glassmorphism HUD
 * =========================================================================
 */
(function () {
  // If already active on the page, toggle visibility or re-focus
  if (window.__mangaExtractorHost) {
    if (typeof window.__mangaExtractorToggle === "function") {
      window.__mangaExtractorToggle();
    }
    return;
  }

  // 1. Determine script origin (for connecting back to Manga Studio)
  let scriptOrigin = "http://localhost:3000";
  try {
    const scripts = document.querySelectorAll("script[src*='extractor.js']");
    if (scripts.length > 0) {
      const src = scripts[scripts.length - 1].src;
      scriptOrigin = new URL(src).origin;
    } else if (window.location.origin && window.location.origin !== "null") {
      scriptOrigin = window.location.origin;
    }
  } catch (_) {}

  // 2. State & Storage
  const state = {
    pages: [],
    selectedIndices: new Set(),
    isScanning: false,
    isScrolling: false,
    studioUrl: scriptOrigin + "/batch-studio",
    title: (document.title || "Manga_Chapter").replace(/[\\\/:\*\?"<>\|]/g, "_").trim(),
    hudVisible: true,
  };

  // Try to detect cleaner chapter title from H1 or meta tags
  try {
    const h1 = document.querySelector("h1, .chapter-title, .reader-title, .title");
    if (h1 && h1.textContent.trim()) {
      state.title = h1.textContent.replace(/[\\\/:\*\?"<>\|]/g, "_").trim().slice(0, 80);
    }
  } catch (_) {}

  // -------------------------------------------------------------
  // MULTI-ENGINE SCANNER (Canvas DRM + Lazy-load Images)
  // -------------------------------------------------------------

  function getElementPosition(el) {
    try {
      const rect = el.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft || 0;
      return {
        top: Math.round(rect.top + scrollTop),
        left: Math.round(rect.left + scrollLeft),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    } catch (_) {
      return { top: 0, left: 0, width: 0, height: 0 };
    }
  }

  // Engine 1: Canvas DRM Scraper
  function scanCanvases() {
    const results = [];
    const canvases = Array.from(document.querySelectorAll("canvas"));

    for (let i = 0; i < canvases.length; i++) {
      const c = canvases[i];
      const w = c.width || c.clientWidth || 0;
      const h = c.height || c.clientHeight || 0;

      // Filter out small canvases / icons / trackers
      if (w < 200 || h < 250) continue;

      try {
        let dataUrl = "";
        try {
          dataUrl = c.toDataURL("image/webp", 0.95);
        } catch (_) {
          dataUrl = c.toDataURL("image/jpeg", 0.95);
        }

        // Bỏ qua canvas rỗng / trong suốt (base64 ngắn < 12.000 ký tự)
        if (!dataUrl || dataUrl.length < 12000) continue;

        const pos = getElementPosition(c);
        results.push({
          type: "canvas",
          dataUrl: dataUrl,
          src: dataUrl,
          domElement: c,
          width: w,
          height: h,
          pos: pos,
          byteSize: Math.round((dataUrl.length * 3) / 4),
        });
      } catch (err) {
        console.warn("[MangaExtractor] Không thể trích xuất canvas (CORS/Tainted):", err);
      }
    }
    return results;
  }

  // Engine 2: Lazy-Load & Standard Image Scraper
  function scanImages() {
    const results = [];
    const images = Array.from(document.querySelectorAll("img"));
    const seenUrls = new Set();

    const isGarbageUrl = (url) => {
      if (!url) return true;
      if (url.startsWith("data:image/svg") || url.startsWith("data:image/gif")) return true;
      return /\b(avatar|icon|logo|banner|badge|button|tracker|ad_|advertisement|comment|emoji)\b/i.test(url);
    };

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      let candidateUrl = "";

      // Tìm URL thật qua các thuộc tính lazy-load phổ biến
      const attrs = [
        img.dataset?.src,
        img.dataset?.original,
        img.dataset?.lazySrc,
        img.dataset?.lazy,
        img.dataset?.url,
        img.getAttribute("data-src"),
        img.getAttribute("data-original"),
        img.getAttribute("data-lazy-src"),
        img.currentSrc,
        img.src,
      ];

      for (const attr of attrs) {
        if (attr && typeof attr === "string" && attr.trim()) {
          const trimmed = attr.trim();
          if (!isGarbageUrl(trimmed)) {
            candidateUrl = trimmed;
            break;
          }
        }
      }

      // Kiểm tra srcset nếu có
      if (!candidateUrl && img.srcset) {
        const parts = img.srcset.split(",");
        if (parts.length > 0) {
          const last = parts[parts.length - 1].trim().split(" ")[0];
          if (!isGarbageUrl(last)) candidateUrl = last;
        }
      }

      if (!candidateUrl) continue;

      // Chuẩn hóa thành URL tuyệt đối
      let absoluteUrl = candidateUrl;
      try {
        if (!candidateUrl.startsWith("data:")) {
          absoluteUrl = new URL(candidateUrl, window.location.href).href;
        }
      } catch (_) {}

      if (seenUrls.has(absoluteUrl)) continue;

      // Bộ lọc kích thước: Nếu ảnh đã nạp, kiểm tra natural dimensions
      const nw = img.naturalWidth || img.clientWidth || 0;
      const nh = img.naturalHeight || img.clientHeight || 0;

      // Loại bỏ ảnh quá nhỏ (icon, avatar, banner)
      if (img.complete && nw > 0 && nh > 0) {
        if (nw < 280 && nh < 280) continue;
      }

      seenUrls.add(absoluteUrl);
      const pos = getElementPosition(img);

      results.push({
        type: "image",
        src: absoluteUrl,
        dataUrl: absoluteUrl.startsWith("data:") ? absoluteUrl : null,
        domElement: img,
        width: nw || 800,
        height: nh || 1200,
        pos: pos,
        byteSize: 0,
      });
    }

    return results;
  }

  // Quét toàn diện kết hợp cả Canvas & Images và sắp xếp theo vị trí trang
  function scanAllPages() {
    state.isScanning = true;
    updateScanStatus("Đang quét nội dung...");

    const canvases = scanCanvases();
    const images = scanImages();

    // Hợp nhất và lọc trùng
    let merged = [];
    if (canvases.length > 0 && images.length === 0) {
      merged = canvases;
    } else if (images.length > 0 && canvases.length === 0) {
      merged = images;
    } else {
      // Nếu có cả 2: Ưu tiên canvas nếu canvas chiếm trọn viewer DRM
      merged = [...canvases, ...images];
    }

    // Sắp xếp tự nhiên theo vị trí từ trên xuống dưới (đọc xuôi)
    merged.sort((a, b) => a.pos.top - b.pos.top || a.pos.left - b.pos.left);

    state.pages = merged;
    state.selectedIndices = new Set(merged.map((_, idx) => idx));
    state.isScanning = false;

    renderHud();
  }

  // Auto-scroll kích hoạt toàn bộ Lazy Load / Canvas rendering
  async function triggerAutoScroll() {
    if (state.isScrolling) return;
    state.isScrolling = true;
    updateScanStatus("Đang cuộn kích hoạt ảnh...");

    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      window.innerHeight * 5
    );
    const step = window.innerHeight * 0.8;
    const numSteps = Math.ceil(totalHeight / step);

    for (let i = 0; i <= numSteps; i++) {
      window.scrollTo({ top: i * step, behavior: "smooth" });
      updateScanStatus(`Cuộn trang ${Math.round((i / numSteps) * 100)}%...`);
      await new Promise((r) => setTimeout(r, 160));
    }

    // Cuộn nhẹ ngược lên đầu
    window.scrollTo({ top: 0, behavior: "smooth" });
    await new Promise((r) => setTimeout(r, 300));

    state.isScrolling = false;
    scanAllPages();
  }

  // -------------------------------------------------------------
  // SHADOW DOM VISIONOS HUD (Cách ly hoàn toàn với CSS trang gốc)
  // -------------------------------------------------------------

  const host = document.createElement("div");
  host.id = "manga-extractor-host";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.top = "0";
  host.style.left = "0";
  host.style.width = "100%";
  host.style.height = "100%";
  host.style.pointerEvents = "none";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  window.__mangaExtractorHost = host;
  window.__mangaExtractorToggle = () => {
    state.hudVisible = !state.hudVisible;
    const modal = shadow.getElementById("hudContainer");
    if (modal) modal.style.display = state.hudVisible ? "flex" : "none";
  };

  const hudStyles = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .hud-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      animation: fadeIn 0.25s ease-out;
    }
    .hud-card {
      width: 92%;
      max-width: 860px;
      height: 86vh;
      max-height: 820px;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(24px) saturate(190%);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 20px;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 50px rgba(99, 102, 241, 0.25);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #f8fafc;
      animation: popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes popIn {
      from { opacity: 0; transform: scale(0.94) translateY(12px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    /* Header */
    .hud-header {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(30, 41, 59, 0.5);
    }
    .hud-header-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .hud-logo-badge {
      background: linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899);
      color: #fff;
      font-size: 0.72rem;
      font-weight: 800;
      padding: 4px 8px;
      border-radius: 8px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      box-shadow: 0 2px 10px rgba(99, 102, 241, 0.4);
    }
    .hud-title-text {
      font-size: 1rem;
      font-weight: 700;
      color: #f1f5f9;
      max-width: 440px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hud-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-icon {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #cbd5e1;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.15s;
    }
    .btn-icon:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      transform: scale(1.05);
    }
    /* Toolbar */
    .hud-toolbar {
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(15, 23, 42, 0.4);
      flex-wrap: wrap;
      gap: 10px;
    }
    .hud-stats {
      font-size: 0.8rem;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .hud-stats-pill {
      background: rgba(99, 102, 241, 0.15);
      color: #a5b4fc;
      border: 1px solid rgba(99, 102, 241, 0.3);
      padding: 3px 8px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 0.74rem;
    }
    .hud-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 10px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: all 0.18s ease;
    }
    .btn-primary {
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
    }
    .btn-primary:hover {
      filter: brightness(1.12);
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #e2e8f0;
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    /* Grid Body */
    .hud-body {
      flex: 1;
      padding: 18px 20px;
      overflow-y: auto;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 14px;
      align-content: start;
    }
    .hud-body::-webkit-scrollbar {
      width: 6px;
    }
    .hud-body::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 3px;
    }
    /* Thumbnail Card */
    .thumb-card {
      position: relative;
      background: rgba(30, 41, 59, 0.6);
      border: 2px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      overflow: hidden;
      aspect-ratio: 2 / 3;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
    }
    .thumb-card:hover {
      transform: translateY(-3px);
      border-color: rgba(99, 102, 241, 0.6);
      box-shadow: 0 10px 20px -5px rgba(0, 0, 0, 0.5);
    }
    .thumb-card.selected {
      border-color: #6366f1;
      box-shadow: 0 0 15px rgba(99, 102, 241, 0.4);
    }
    .thumb-card.deselected {
      opacity: 0.35;
      filter: grayscale(0.8);
    }
    .thumb-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #090d16;
    }
    .thumb-badge-index {
      position: absolute;
      top: 6px;
      left: 6px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(4px);
      color: #f1f5f9;
      font-size: 0.68rem;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }
    .thumb-badge-type {
      position: absolute;
      bottom: 6px;
      left: 6px;
      background: rgba(15, 23, 42, 0.85);
      color: #94a3b8;
      font-size: 0.62rem;
      font-weight: 700;
      padding: 2px 5px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .thumb-checkbox {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 18px;
      height: 18px;
      accent-color: #6366f1;
      cursor: pointer;
    }
    /* Empty State */
    .hud-empty {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      color: #94a3b8;
      text-align: center;
      gap: 12px;
    }
    .hud-empty-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: #cbd5e1;
    }
    /* Footer & Progress */
    .hud-footer {
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(15, 23, 42, 0.6);
      font-size: 0.75rem;
      color: #94a3b8;
    }
    .hud-progress-bar {
      height: 3px;
      width: 100%;
      background: rgba(255, 255, 255, 0.08);
      position: relative;
      overflow: hidden;
    }
    .hud-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #6366f1, #ec4899);
      width: 0%;
      transition: width 0.2s ease;
    }
    /* Toast */
    .hud-toast {
      position: absolute;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(30px);
      background: rgba(30, 41, 59, 0.95);
      border: 1px solid rgba(99, 102, 241, 0.5);
      color: #fff;
      padding: 8px 18px;
      border-radius: 30px;
      font-size: 0.8rem;
      font-weight: 600;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      opacity: 0;
      transition: all 0.25s ease;
      pointer-events: none;
      z-index: 10;
    }
    .hud-toast.visible {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
  `;

  function showToast(msg) {
    const toast = shadow.getElementById("hudToast");
    if (toast) {
      toast.textContent = msg;
      toast.classList.add("visible");
      setTimeout(() => toast.classList.remove("visible"), 2800);
    }
  }

  function updateScanStatus(text) {
    const el = shadow.getElementById("hudStatusText");
    if (el) el.textContent = text;
  }

  function renderHud() {
    const container = shadow.getElementById("hudBody");
    const statsPill = shadow.getElementById("hudStatsPill");
    if (!container) return;

    if (statsPill) {
      statsPill.textContent = `${state.selectedIndices.size} / ${state.pages.length} trang`;
    }

    if (state.pages.length === 0) {
      container.innerHTML = `
        <div class="hud-empty">
          <div style="font-size: 2.2rem;">🔍</div>
          <div class="hud-empty-title">Chưa phát hiện ảnh hoặc canvas nào</div>
          <p style="font-size: 0.8rem; max-width: 380px;">Trang web có thể dùng lazy-load. Hãy bấm nút <b>"📜 Cuộn quét trang"</b> để hệ thống tự động cuộn và nạp ảnh truyện.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = "";
    state.pages.forEach((page, idx) => {
      const isSelected = state.selectedIndices.has(idx);
      const card = document.createElement("div");
      card.className = `thumb-card ${isSelected ? "selected" : "deselected"}`;
      card.dataset.index = idx;

      card.innerHTML = `
        <img class="thumb-img" src="${page.dataUrl || page.src}" loading="lazy" />
        <span class="thumb-badge-index">#${String(idx + 1).padStart(2, "0")}</span>
        <span class="thumb-badge-type">${page.type}</span>
        <input type="checkbox" class="thumb-checkbox" ${isSelected ? "checked" : ""} />
      `;

      card.addEventListener("click", (e) => {
        if (e.target.tagName !== "INPUT") {
          const chk = card.querySelector("input");
          chk.checked = !chk.checked;
        }
        if (state.selectedIndices.has(idx)) {
          state.selectedIndices.delete(idx);
          card.classList.remove("selected");
          card.classList.add("deselected");
        } else {
          state.selectedIndices.add(idx);
          card.classList.add("selected");
          card.classList.remove("deselected");
        }
        if (statsPill) {
          statsPill.textContent = `${state.selectedIndices.size} / ${state.pages.length} trang`;
        }
      });

      container.appendChild(card);
    });
  }

  function createHudDOM() {
    const styleEl = document.createElement("style");
    styleEl.textContent = hudStyles;
    shadow.appendChild(styleEl);

    const hudWrapper = document.createElement("div");
    hudWrapper.id = "hudContainer";
    hudWrapper.className = "hud-backdrop";

    hudWrapper.innerHTML = `
      <div class="hud-card">
        <!-- Progress Top -->
        <div class="hud-progress-bar"><div class="hud-progress-fill" id="hudProgressFill"></div></div>

        <!-- Header -->
        <div class="hud-header">
          <div class="hud-header-title">
            <span class="hud-logo-badge">⚡ Extractor Pro</span>
            <span class="hud-title-text" id="hudTitleText" title="${state.title}">${state.title}</span>
          </div>
          <div class="hud-header-actions">
            <button class="btn-icon" id="btnRefreshScan" title="Quét lại">🔄</button>
            <button class="btn-icon" id="btnCloseHud" title="Đóng">✕</button>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="hud-toolbar">
          <div class="hud-stats">
            <span class="hud-stats-pill" id="hudStatsPill">0 trang</span>
            <span id="hudStatusText">Sẵn sàng</span>
          </div>
          <div class="hud-actions">
            <button class="btn-action btn-secondary" id="btnAutoScroll" title="Tự động cuộn êm để kích hoạt toàn bộ lazy-load">
              📜 Cuộn quét trang
            </button>
            <button class="btn-action btn-secondary" id="btnToggleSelectAll" title="Chọn / Bỏ chọn tất cả">
              Đảo chọn
            </button>
            <button class="btn-action btn-secondary" id="btnCopyUrls" title="Sao chép toàn bộ đường dẫn ảnh">
              📋 Copy link
            </button>
            <button class="btn-action btn-secondary" id="btnDownloadZip" title="Tải về file nén .ZIP hoặc .CBZ">
              📦 Tải ZIP / CBZ
            </button>
            <button class="btn-action btn-primary" id="btnSendToStudio" title="Mở Manga Studio và truyền trực tiếp ảnh sang">
              ⚡ Gửi sang Studio
            </button>
          </div>
        </div>

        <!-- Thumbnail Grid Body -->
        <div class="hud-body" id="hudBody"></div>

        <!-- Footer -->
        <div class="hud-footer">
          <span>Target: <span style="color: #cbd5e1; font-family: monospace;">${state.studioUrl}</span></span>
          <span>Manga Studio Universal Bookmarklet v2.0</span>
        </div>

        <!-- Floating Toast -->
        <div class="hud-toast" id="hudToast"></div>
      </div>
    `;

    shadow.appendChild(hudWrapper);

    // Bind HUD events
    shadow.getElementById("btnCloseHud").addEventListener("click", () => {
      host.remove();
      window.__mangaExtractorHost = null;
    });

    hudWrapper.addEventListener("click", (e) => {
      if (e.target === hudWrapper) {
        host.remove();
        window.__mangaExtractorHost = null;
      }
    });

    shadow.getElementById("btnRefreshScan").addEventListener("click", () => {
      scanAllPages();
      showToast("Đã quét lại toàn bộ trang!");
    });

    shadow.getElementById("btnAutoScroll").addEventListener("click", () => {
      triggerAutoScroll();
    });

    shadow.getElementById("btnToggleSelectAll").addEventListener("click", () => {
      if (state.selectedIndices.size === state.pages.length) {
        state.selectedIndices.clear();
      } else {
        state.selectedIndices = new Set(state.pages.map((_, i) => i));
      }
      renderHud();
    });

    shadow.getElementById("btnCopyUrls").addEventListener("click", () => {
      copyImageUrls();
    });

    shadow.getElementById("btnDownloadZip").addEventListener("click", () => {
      downloadZipArchive("zip");
    });

    shadow.getElementById("btnSendToStudio").addEventListener("click", () => {
      sendToMangaStudio();
    });
  }

  // -------------------------------------------------------------
  // BRIDGE PROTOCOL: GỬI SANG MANGA STUDIO
  // -------------------------------------------------------------
  async function sendToMangaStudio() {
    const selected = Array.from(state.selectedIndices)
      .sort((a, b) => a - b)
      .map((idx) => state.pages[idx])
      .filter(Boolean);

    if (selected.length === 0) {
      showToast("Vui lòng chọn ít nhất 1 trang truyện để gửi!");
      return;
    }

    showToast(`Đang chuẩn bị ${selected.length} trang truyện...`);

    // Chuyển đổi các trang thành payload truyền dữ liệu
    const preparedImages = [];
    const progressBar = shadow.getElementById("hudProgressFill");

    for (let i = 0; i < selected.length; i++) {
      const p = selected[i];
      if (progressBar) progressBar.style.width = `${Math.round(((i + 1) / selected.length) * 100)}%`;

      let dataUrl = p.dataUrl;
      if (!dataUrl && p.domElement && p.domElement.complete) {
        try {
          // Trích xuất trực tiếp từ thẻ img đã render trên trang (vượt rào CORS)
          const offCanvas = document.createElement("canvas");
          offCanvas.width = p.domElement.naturalWidth || p.domElement.width;
          offCanvas.height = p.domElement.naturalHeight || p.domElement.height;
          const ctx = offCanvas.getContext("2d");
          ctx.drawImage(p.domElement, 0, 0);
          dataUrl = offCanvas.toDataURL("image/jpeg", 0.95);
        } catch (_) {}
      }

      preparedImages.push({
        name: `${state.title}_${String(i + 1).padStart(3, "0")}.jpg`,
        dataUrl: dataUrl || null,
        src: p.src,
      });
    }

    if (progressBar) progressBar.style.width = "0%";

    const payload = {
      type: "MANGA_STUDIO_IMPORT",
      timestamp: Date.now(),
      title: state.title,
      sourceUrl: window.location.href,
      images: preparedImages,
    };

    // 1. Lưu dự phòng vào localStorage (nếu cùng domain)
    try {
      localStorage.setItem("manga_bookmarklet_import", JSON.stringify(payload));
    } catch (_) {}

    // 2. Mở tab Manga Studio Batch
    const targetUrl = state.studioUrl;
    const studioWin = window.open(targetUrl, "_blank");

    // 3. Truyền qua BroadcastChannel
    const channel = new BroadcastChannel("manga_studio_importer");
    channel.postMessage(payload);

    // 4. Ping liên tục qua postMessage trong 12 giây để bắt nhịp khi tab mới nạp xong
    let pings = 0;
    const maxPings = 24;
    const pingTimer = setInterval(() => {
      pings++;
      channel.postMessage(payload);
      if (studioWin && !studioWin.closed) {
        try {
          studioWin.postMessage(payload, "*");
        } catch (_) {}
      }
      if (pings >= maxPings) {
        clearInterval(pingTimer);
      }
    }, 500);

    // Lắng nghe tín hiệu ACK phản hồi từ Studio
    channel.onmessage = (e) => {
      if (e.data && e.data.type === "MANGA_STUDIO_IMPORT_ACK") {
        clearInterval(pingTimer);
        showToast(`🎉 Manga Studio đã nhận thành công ${selected.length} trang!`);
      }
    };

    showToast(`⚡ Đang kết nối và truyền dữ liệu sang Manga Studio...`);
  }

  // -------------------------------------------------------------
  // DYNAMIC JSZIP & CBZ / ZIP EXPORTER
  // -------------------------------------------------------------
  async function loadJSZipLibrary() {
    if (window.JSZip) return window.JSZip;

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      script.crossOrigin = "anonymous";
      script.onload = () => resolve(window.JSZip);
      script.onerror = () => reject(new Error("Không thể tải thư viện JSZip từ CDN."));
      document.head.appendChild(script);
    });
  }

  async function downloadZipArchive(format = "zip") {
    const selected = Array.from(state.selectedIndices)
      .sort((a, b) => a - b)
      .map((idx) => state.pages[idx])
      .filter(Boolean);

    if (selected.length === 0) {
      showToast("Vui lòng chọn ít nhất 1 trang truyện để tải!");
      return;
    }

    try {
      showToast("Đang nạp bộ nén JSZip...");
      const JSZip = await loadJSZipLibrary();
      const zip = new JSZip();
      const progressBar = shadow.getElementById("hudProgressFill");

      showToast(`Đang đóng gói ${selected.length} trang...`);

      for (let i = 0; i < selected.length; i++) {
        const p = selected[i];
        if (progressBar) progressBar.style.width = `${Math.round(((i + 1) / selected.length) * 100)}%`;

        const filename = `${String(i + 1).padStart(3, "0")}.jpg`;

        if (p.dataUrl) {
          const base64Data = p.dataUrl.split(",")[1];
          zip.file(filename, base64Data, { base64: true });
        } else {
          // Thử trích xuất từ DOM img canvas trước để vượt CORS
          let blob = null;
          if (p.domElement && p.domElement.complete) {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = p.domElement.naturalWidth || p.domElement.width;
              canvas.height = p.domElement.naturalHeight || p.domElement.height;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(p.domElement, 0, 0);
              blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.95));
            } catch (_) {}
          }

          // Fallback fetch nếu không capture được canvas
          if (!blob) {
            try {
              const resp = await fetch(p.src);
              blob = await resp.blob();
            } catch (_) {}
          }

          if (blob) {
            zip.file(filename, blob);
          }
        }
      }

      showToast("Đang tạo tệp nén...");
      const blob = await zip.generateAsync({ type: "blob" });
      const ext = format === "cbz" ? "cbz" : "zip";
      const downloadName = `${state.title}.${ext}`;

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = downloadName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);

      if (progressBar) progressBar.style.width = "0%";
      showToast(`✅ Đã tải về ${downloadName}!`);
    } catch (err) {
      console.error(err);
      showToast(`Lỗi tạo ZIP: ${err.message}`);
    }
  }

  function copyImageUrls() {
    const selected = Array.from(state.selectedIndices)
      .sort((a, b) => a - b)
      .map((idx) => state.pages[idx]?.src)
      .filter(Boolean);

    if (selected.length === 0) {
      showToast("Không có link ảnh nào để sao chép!");
      return;
    }

    const text = selected.join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(`📋 Đã chép ${selected.length} link ảnh vào clipboard!`))
      .catch(() => showToast("Không thể ghi vào bộ nhớ tạm."));
  }

  // -------------------------------------------------------------
  // BOOTSTRAP EXECUTION
  // -------------------------------------------------------------
  createHudDOM();
  scanAllPages();
})();
