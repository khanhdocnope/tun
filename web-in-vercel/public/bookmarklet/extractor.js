/**
 * =========================================================================
 * UNIVERSAL MANGA EXTRACTOR PRO BOOKMARKLET
 * Inspired by comix-downloader: Canvas DRM & Lazy-load Multi-Engine Scraper
 * Zero-dependency, Shadow DOM VisionOS Glassmorphism HUD
 * =========================================================================
 */
(function () {
  // If already active on the page, toggle visibility or re-focus
  if (window.__mangaExtractorHost || window.__mangaExtractorActive) {
    if (typeof window.__mangaExtractorToggle === "function") {
      window.__mangaExtractorToggle();
    }
    return;
  }

  // =============================================================
  // AD-SHIELD STEEL DEFENSE MODULE (CHỐNG POPUNDER & CLICKJACKING)
  // =============================================================

  // 1. Lưu lại hàm window.open gốc an toàn & thiết lập cơ chế kiểm soát
  const originalWindowOpen = window.open;
  const safeWindowOpen = typeof window.open === "function" ? window.open.bind(window) : null;

  try {
    window.open = function (url, target, features) {
      const urlStr = String(url || "");
      // Chặn đứng popunder quảng cáo: CHỈ duy nhất cho phép đích đến là Manga Studio
      const isStudioTarget =
        (state && state.studioUrl && urlStr.startsWith(state.studioUrl)) ||
        urlStr.includes("/batch-studio") ||
        urlStr.includes("/typeset");

      if (isStudioTarget) {
        return safeWindowOpen ? safeWindowOpen(url, target, features) : originalWindowOpen.call(window, url, target, features);
      }
      console.warn("[Ad-Shield] Đã chặn popup / popunder quảng cáo trái phép:", urlStr);
      return null;
    };
  } catch (err) {
    console.warn("[Ad-Shield] Không thể bọc window.open:", err);
  }

  // 2. Chống chuyển hướng trang web mẹ & bẫy onbeforeunload gây phiền toái
  try {
    window.onbeforeunload = null;
  } catch (_) {}

  // Khai báo sớm biến host & shadow để module cách ly sự kiện tham chiếu
  let host = null;
  let shadow = null;

  // 3. Ad-Shield Boundary Quarantine: Cách ly click bên trong HUD không rò rỉ ra trang web mẹ
  const boundaryEvents = ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend"];

  function setupHostBoundaryQuarantine(hostEl) {
    if (!hostEl) return;
    boundaryEvents.forEach((evtType) => {
      hostEl.addEventListener(
        evtType,
        (e) => {
          // Chỉ chặn sự kiện ở pha Bubbling khi nó chuẩn bị thoát ra khỏi host sang trang web mẹ
          e.stopPropagation();
        },
        false // False = Bubbling phase: Cho phép các nút bấm bên trong Shadow DOM nhận và xử lý sự kiện bình thường!
      );
    });
  }

  function cleanupAdShield() {
    if (originalWindowOpen) {
      try { window.open = originalWindowOpen; } catch (_) {}
    }
  }

  // 4. Tiêu diệt lớp phủ tàng hình (Neutralize Invisible Click-Jacking Overlays)
  function neutralizeHostPageAdTraps() {
    try {
      const candidates = document.querySelectorAll("div, iframe, a, section, span, ins");
      const vw = window.innerWidth || document.documentElement.clientWidth || 1000;
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;

      let neutralizedCount = 0;
      candidates.forEach((el) => {
        // Tuyệt đối không can thiệp vào host của Bookmarklet
        if (host && (el === host || host.contains(el))) return;
        if (el.id === "manga-extractor-host") return;
        if (el === document.body || el === document.documentElement) return;

        const style = window.getComputedStyle(el);
        const pos = style.position;
        if (pos !== "fixed" && pos !== "absolute") return;

        const rect = el.getBoundingClientRect();
        // Kiểm tra kích thước bao phủ lớn (> 60% viewport)
        const isLargeCoverage = rect.width > vw * 0.6 && rect.height > vh * 0.6;

        // Bỏ qua nếu phần tử chứa các tranh manga thật (chiều rộng > 250px và chiều cao > 300px)
        const hasMangaImages = Array.from(el.querySelectorAll("img, canvas")).some((img) => {
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          return w > 250 && h > 300;
        });
        if (hasMangaImages) return;

        const opacity = parseFloat(style.opacity);
        const isTransparent = (opacity < 0.15 || style.visibility === "hidden" || style.backgroundColor === "transparent" || style.backgroundColor === "rgba(0, 0, 0, 0)");
        const idClassStr = `${el.id || ""} ${el.className || ""}`.toLowerCase();
        const hasAdKeywords = /ad|pop|overlay|click|banner|interstitial|under|sponsor|gate|fake|trap|float|hidden/i.test(idClassStr);
        const zIndex = parseInt(style.zIndex, 10) || 0;

        if ((isTransparent && isLargeCoverage) || (hasAdKeywords && (zIndex > 80 || isLargeCoverage))) {
          el.style.setProperty("pointer-events", "none", "important");
          el.style.setProperty("display", "none", "important");
          el.style.setProperty("visibility", "hidden", "important");
          neutralizedCount++;
        }
      });

      if (neutralizedCount > 0) {
        console.log(`[Ad-Shield] Đã vô hiệu hóa ${neutralizedCount} bẫy click / lớp phủ quảng cáo.`);
      }
    } catch (err) {
      console.warn("[Ad-Shield] Lỗi quét bẫy quảng cáo:", err);
    }
  }

  // Chạy diệt bẫy quảng cáo ngay lập tức
  neutralizeHostPageAdTraps();

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
    harvestRegistry: new Map(), // Kho lưu trữ bền vững chống Virtual Scroll unmount & recycling
    discoveryCounter: 0,
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

  // Chuẩn hóa URL ảnh để so sánh chống trùng (loại bỏ params rác, cache buster)
  function normalizeUrlKey(u) {
    if (!u || typeof u !== "string" || u.startsWith("data:")) return u || "";
    try {
      const parsed = new URL(u, window.location.href);
      return (parsed.origin + parsed.pathname).toLowerCase();
    } catch (_) {
      return u.split("?")[0].split("#")[0].toLowerCase();
    }
  }

  // Engine 1: Canvas DRM Scraper
  function scanCanvases() {
    const results = [];
    const canvases = Array.from(document.querySelectorAll("canvas"));

    for (let i = 0; i < canvases.length; i++) {
      const c = canvases[i];
      // Bỏ qua canvas trong Shadow DOM của chính HUD
      if (host && host.contains(c)) continue;

      const w = c.width || c.clientWidth || 0;
      const h = c.height || c.clientHeight || 0;

      // Filter out small canvases / icons / trackers
      if (w < 200 || h < 250) continue;

      // Bỏ qua canvas bị ẩn trong layout
      try {
        const style = window.getComputedStyle(c);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          continue;
        }
        if (c.offsetParent === null && style.position !== "fixed" && style.position !== "absolute") {
          continue;
        }
      } catch (_) {}

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
      // Bỏ qua ảnh thuộc về chính HUD
      if (host && host.contains(img)) continue;

      // Bỏ qua ảnh bị ẩn hoàn toàn trong CSS layout
      try {
        const style = window.getComputedStyle(img);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          continue;
        }
        if (img.offsetParent === null && style.position !== "fixed" && style.position !== "absolute") {
          continue;
        }
      } catch (_) {}

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

      // CHỐNG TRÙNG LẶP: So sánh theo URL gốc đã bóc tách tham số truy vấn
      const normKey = normalizeUrlKey(absoluteUrl);
      if (seenUrls.has(normKey)) continue;

      // Bộ lọc kích thước: Nếu ảnh đã nạp, kiểm tra natural dimensions
      const nw = img.naturalWidth || img.clientWidth || 0;
      const nh = img.naturalHeight || img.clientHeight || 0;

      // Loại bỏ ảnh quá nhỏ (icon, avatar, banner)
      if (img.complete && nw > 0 && nh > 0) {
        if (nw < 240 || nh < 240) continue;
      }

      seenUrls.add(normKey);
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

  // Chụp ảnh thẻ <img> sang dataUrl để lưu trữ vĩnh viễn trong RAM trước khi Virtual Scroller gỡ phần tử khỏi DOM
  function snapshotImgToDataUrl(img) {
    if (!img) return null;
    try {
      const nw = img.naturalWidth || img.width || 0;
      const nh = img.naturalHeight || img.height || 0;
      if (nw < 100 || nh < 100) return null;

      const offCanvas = document.createElement("canvas");
      offCanvas.width = nw;
      offCanvas.height = nh;
      const ctx = offCanvas.getContext("2d");
      ctx.drawImage(img, 0, 0, nw, nh);
      return offCanvas.toDataURL("image/jpeg", 0.95);
    } catch (_) {
      // Nếu bị chặn bởi tainted canvas CORS -> vẫn lưu lại src gốc để tải qua proxy hoặc direct fetch
      return null;
    }
  }

  // Thu thập và tích lũy các trang truyện đang xuất hiện trong DOM vào kho lưu trữ bền vững (Chống Virtual Scroller unmount & recycling)
  function harvestCurrentDom() {
    const canvases = scanCanvases();
    const images = scanImages();

    let newCount = 0;

    // 1. Thu thập Canvas DRM
    for (const c of canvases) {
      if (!c.dataUrl || c.dataUrl.length < 12000) continue;
      // Khóa vân tay độc nhất cho Canvas: kích thước + độ dài base64 + 60 ký tự mẫu
      const canvasKey = `canvas_${c.width}x${c.height}_${c.dataUrl.length}_${c.dataUrl.slice(35, 95)}`;
      if (!state.harvestRegistry.has(canvasKey)) {
        state.discoveryCounter++;
        state.harvestRegistry.set(canvasKey, {
          type: "canvas",
          dataUrl: c.dataUrl,
          src: c.dataUrl,
          width: c.width,
          height: c.height,
          pos: c.pos,
          order: c.pos.top,
          discoveryIdx: state.discoveryCounter,
          byteSize: c.byteSize,
        });
        newCount++;
      }
    }

    // 2. Thu thập thẻ <img>
    for (const img of images) {
      if (!img.src) continue;
      const urlKey = normalizeUrlKey(img.src);
      if (!urlKey) continue;

      if (!state.harvestRegistry.has(urlKey)) {
        state.discoveryCounter++;
        // Chụp ngay snapshot sang dataUrl nếu ảnh đã nạp xong (tránh mất khi bị unmount)
        let dataUrl = img.dataUrl;
        if (!dataUrl && img.domElement && img.domElement.complete && (img.domElement.naturalWidth || 0) > 100) {
          dataUrl = snapshotImgToDataUrl(img.domElement);
        }

        const harvestEntry = {
          type: "image",
          src: img.src,
          dataUrl: dataUrl || null,
          domElement: img.domElement,
          width: img.width,
          height: img.height,
          pos: img.pos,
          order: img.pos.top,
          discoveryIdx: state.discoveryCounter,
          byteSize: dataUrl ? Math.round((dataUrl.length * 3) / 4) : 0,
        };

        // Nếu ảnh chưa nạp xong, gắn bộ lắng nghe onload để snapshot ngay khoảnh khắc ảnh vừa load xong!
        if (!dataUrl && img.domElement && !img.domElement.complete) {
          const expectedSrc = img.src;
          const capturedElement = img.domElement;
          capturedElement.addEventListener("load", () => {
            const currentSrc = capturedElement.currentSrc || capturedElement.src;
            if (normalizeUrlKey(currentSrc) === normalizeUrlKey(expectedSrc)) {
              const freshData = snapshotImgToDataUrl(capturedElement);
              if (freshData && harvestEntry) {
                harvestEntry.dataUrl = freshData;
                harvestEntry.byteSize = Math.round((freshData.length * 3) / 4);
              }
            }
          }, { once: true });
        }

        state.harvestRegistry.set(urlKey, harvestEntry);
        newCount++;
      } else {
        // Nếu ảnh đã có trong registry nhưng chưa có dataUrl: cập nhật ngay khi ảnh hoàn tất
        const existing = state.harvestRegistry.get(urlKey);
        if (!existing.dataUrl && img.domElement && img.domElement.complete && (img.domElement.naturalWidth || 0) > 100) {
          const freshDataUrl = snapshotImgToDataUrl(img.domElement);
          if (freshDataUrl) {
            existing.dataUrl = freshDataUrl;
            existing.byteSize = Math.round((freshDataUrl.length * 3) / 4);
          }
        }
      }
    }

    // Đồng bộ sang state.pages và sắp xếp theo thứ tự đọc
    syncHarvestToPages();
    return newCount;
  }

  // Đồng bộ và sắp xếp toàn bộ danh sách trang thu thập được
  function syncHarvestToPages() {
    const list = Array.from(state.harvestRegistry.values());

    // Sắp xếp tự nhiên theo vị trí từ trên xuống dưới (đọc xuôi)
    list.sort((a, b) => a.order - b.order || a.discoveryIdx - b.discoveryIdx);

    // Lọc khử trùng tọa độ: nếu 1 canvas và 1 ảnh nằm cùng vị trí < 30px, giữ 1 bản
    const nonOverlapping = [];
    for (const item of list) {
      const isOverlap = nonOverlapping.some((prev) =>
        Math.abs(prev.pos.top - item.pos.top) < 30 &&
        Math.abs(prev.pos.left - item.pos.left) < 30
      );
      if (!isOverlap) {
        nonOverlapping.push(item);
      }
    }

    state.pages = nonOverlapping;

    // Tự động giữ nguyên các trang người dùng đã chọn, và mặc định chọn các trang mới
    const newSelected = new Set();
    state.pages.forEach((_, idx) => newSelected.add(idx));
    state.selectedIndices = newSelected;
  }

  // Quét nội dung hiện tại và tích lũy vào kho trang
  function scanAllPages() {
    state.isScanning = true;
    updateScanStatus("Đang thu thập trang...");
    harvestCurrentDom();
    state.isScanning = false;
    updateScanStatus("Sẵn sàng");
    renderHud();
  }

  // Live Harvester: Lắng nghe background DOM mutations và scroll để gom ảnh theo thời gian thực
  let liveObserver = null;
  let liveScrollHandler = null;
  let liveScrollTimeout = null;

  function initLiveHarvester() {
    if (typeof MutationObserver !== "undefined" && !liveObserver) {
      liveObserver = new MutationObserver((mutations) => {
        let hasImageMutation = false;
        for (const m of mutations) {
          if (m.addedNodes && m.addedNodes.length > 0) {
            hasImageMutation = true;
            break;
          }
        }
        if (hasImageMutation && !state.isScrolling) {
          const added = harvestCurrentDom();
          if (added > 0) {
            renderHud();
          }
        }
      });

      try {
        liveObserver.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
        });
      } catch (_) {}
    }

    if (!liveScrollHandler) {
      liveScrollHandler = () => {
        if (state.isScrolling) return;
        if (liveScrollTimeout) clearTimeout(liveScrollTimeout);
        liveScrollTimeout = setTimeout(() => {
          const added = harvestCurrentDom();
          if (added > 0) {
            renderHud();
          }
        }, 180);
      };
      window.addEventListener("scroll", liveScrollHandler, { passive: true });
    }
  }

  function destroyLiveHarvester() {
    if (liveObserver) {
      try { liveObserver.disconnect(); } catch (_) {}
      liveObserver = null;
    }
    if (liveScrollHandler) {
      window.removeEventListener("scroll", liveScrollHandler);
      liveScrollHandler = null;
    }
    if (liveScrollTimeout) {
      clearTimeout(liveScrollTimeout);
      liveScrollTimeout = null;
    }
  }

  // Auto-scroll kích hoạt và thu thập lũy tiến toàn bộ Virtual Scroll / Lazy Load
  async function triggerAutoScroll() {
    if (state.isScrolling) return;
    state.isScrolling = true;
    updateScanStatus("Bắt đầu cuộn thu thập Virtual Scroll...");
    showToast("Đang cuộn từng nấc và thu thập toàn bộ trang... Vui lòng không đóng tab!", 4000);

    const progressBar = shadow ? shadow.getElementById("hudProgressFill") : null;

    // 1. Quét nạp các trang ban đầu tại vị trí hiện tại
    harvestCurrentDom();
    renderHud();

    // 2. Cuộn nhẹ lên đầu để đảm bảo bắt trọn các trang 1-6 đầu tiên
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise((r) => setTimeout(r, 400));
    harvestCurrentDom();
    renderHud();

    // 3. Tiến trình cuộn từng nấc lướt qua toàn bộ tài liệu
    const viewportHeight = window.innerHeight || 800;
    const scrollStep = Math.round(viewportHeight * 0.65);
    let currentY = 0;
    let consecutiveNoNewPages = 0;
    let loopCount = 0;
    const maxLoops = 350; // Cho phép chapter dài đến hàng trăm trang

    while (loopCount < maxLoops) {
      loopCount++;
      const maxScrollY = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        window.innerHeight
      ) - viewportHeight;

      currentY += scrollStep;
      if (currentY > maxScrollY) {
        currentY = maxScrollY;
      }

      window.scrollTo({ top: currentY, behavior: "smooth" });

      // Đợi cho Virtual Scroller / IntersectionObserver của web truyện kích hoạt mount các ảnh mới
      await new Promise((r) => setTimeout(r, 320));

      const newFound = harvestCurrentDom();
      if (newFound > 0) {
        consecutiveNoNewPages = 0;
        renderHud();
      } else {
        consecutiveNoNewPages++;
      }

      const percent = maxScrollY > 0 ? Math.min(100, Math.round((currentY / maxScrollY) * 100)) : 100;
      if (progressBar) progressBar.style.width = `${percent}%`;
      updateScanStatus(`Đang cuộn: Đã bắt ${state.pages.length} trang (${percent}%)...`);

      // Nếu đã chạm đáy tài liệu và 3 nấc liên tiếp không có ảnh mới nào xuất hiện -> Hoàn tất!
      if (currentY >= maxScrollY && consecutiveNoNewPages >= 3) {
        break;
      }
    }

    if (progressBar) progressBar.style.width = "100%";
    setTimeout(() => { if (progressBar) progressBar.style.width = "0%"; }, 1200);

    state.isScrolling = false;
    neutralizeHostPageAdTraps();
    updateScanStatus("Sẵn sàng");
    renderHud();

    showToast(`Đã thu thập trọn vẹn ${state.pages.length} trang truyện (Đã đánh bại Virtual Scroll)!`, 5000);
  }

  // -------------------------------------------------------------
  // SHADOW DOM VISIONOS HUD (Cách ly hoàn toàn với CSS trang gốc)
  // -------------------------------------------------------------

  host = document.createElement("div");
  host.id = "manga-extractor-host";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.top = "0";
  host.style.left = "0";
  host.style.width = "100%";
  host.style.height = "100%";
  host.style.pointerEvents = "auto";
  document.documentElement.appendChild(host);
  setupHostBoundaryQuarantine(host);

  shadow = host.attachShadow({ mode: "open" });
  window.__mangaExtractorHost = host;
  window.__mangaExtractorActive = true;
  window.__mangaExtractorToggle = () => {
    state.hudVisible = !state.hudVisible;
    const modal = shadow.getElementById("hudContainer");
    if (modal) modal.style.display = state.hudVisible ? "flex" : "none";
    host.style.display = state.hudVisible ? "block" : "none";
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
    .hud-adshield-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      color: #34d399;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.35);
      border-radius: 9999px;
      padding: 3px 8px;
      box-shadow: 0 0 12px rgba(16, 185, 129, 0.25);
      flex-shrink: 0;
      user-select: none;
    }
    .hud-adshield-badge svg {
      color: #10b981;
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
          <div style="display:flex; justify-content:center; margin-bottom:8px;"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div>
          <div class="hud-empty-title">Chưa phát hiện ảnh hoặc canvas nào</div>
          <p style="font-size: 0.8rem; max-width: 380px;">Trang web có thể dùng lazy-load. Hãy bấm nút <b>"Cuộn quét trang"</b> để hệ thống tự động cuộn và nạp ảnh truyện.</p>
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

      card.addEventListener("click", () => {
        const willBeSelected = !state.selectedIndices.has(idx);
        if (willBeSelected) {
          state.selectedIndices.add(idx);
          card.classList.add("selected");
          card.classList.remove("deselected");
        } else {
          state.selectedIndices.delete(idx);
          card.classList.remove("selected");
          card.classList.add("deselected");
        }
        const chk = card.querySelector("input");
        if (chk) chk.checked = willBeSelected;
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
            <span class="hud-logo-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>Extractor Pro</span>
            <span class="hud-adshield-badge" title="Đã kích hoạt Lá chắn Ad-Shield: Chặn 100% Popunder & Click-jacking">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="m9 12 2 2 4-4"></path>
              </svg>
              <span>AD-SHIELD PROTECTED</span>
            </span>
            <span class="hud-title-text" id="hudTitleText" title="${state.title}">${state.title}</span>
          </div>
          <div class="hud-header-actions">
            <button class="btn-icon" id="btnRefreshScan" title="Quét lại"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg></button>
            <button class="btn-icon" id="btnCloseHud" title="Đóng"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="hud-toolbar">
          <div class="hud-stats">
            <span class="hud-stats-pill" id="hudStatsPill">0 trang</span>
            <span id="hudStatusText">Sẵn sàng</span>
          </div>
          <div class="hud-actions">
            <button class="btn-action btn-secondary" id="btnAutoScroll" title="Cuộn từng nấc thu thập toàn bộ trang Virtual Scroll">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><polyline points="7 13 12 18 17 13"></polyline><polyline points="7 6 12 11 17 6"></polyline></svg>Cuộn Thu Thập (Virtual Scroll)
            </button>
            <button class="btn-action btn-secondary" id="btnToggleSelectAll" title="Chọn / Bỏ chọn tất cả">
              Đảo chọn
            </button>
            <button class="btn-action btn-secondary" id="btnCopyUrls" title="Sao chép toàn bộ đường dẫn ảnh">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>Copy link
            </button>
            <button class="btn-action btn-secondary" id="btnDownloadZip" title="Tải về file nén .ZIP hoặc .CBZ">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>Tải ZIP / CBZ
            </button>
            <button class="btn-action btn-primary" id="btnSendToStudio" title="Mở Manga Studio và truyền trực tiếp ảnh sang">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin-right:4px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>Gửi sang Studio
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
    const closeHud = () => {
      destroyLiveHarvester();
      cleanupAdShield();
      host.remove();
      window.__mangaExtractorHost = null;
      window.__mangaExtractorActive = false;
    };

    shadow.getElementById("btnCloseHud").addEventListener("click", (e) => {
      e.preventDefault();
      closeHud();
    });

    hudWrapper.addEventListener("click", (e) => {
      if (e.target === hudWrapper) {
        closeHud();
      }
    });

    shadow.getElementById("btnRefreshScan").addEventListener("click", (e) => {
      e.preventDefault();
      neutralizeHostPageAdTraps();
      state.harvestRegistry.clear();
      state.discoveryCounter = 0;
      scanAllPages();
      showToast("Đã làm mới bộ nhớ và quét lại toàn bộ trang!");
    });

    shadow.getElementById("btnAutoScroll").addEventListener("click", (e) => {
      e.preventDefault();
      neutralizeHostPageAdTraps();
      triggerAutoScroll();
    });

    shadow.getElementById("btnToggleSelectAll").addEventListener("click", (e) => {
      e.preventDefault();
      if (state.selectedIndices.size === state.pages.length) {
        state.selectedIndices.clear();
      } else {
        state.selectedIndices = new Set(state.pages.map((_, i) => i));
      }
      renderHud();
    });

    shadow.getElementById("btnCopyUrls").addEventListener("click", (e) => {
      e.preventDefault();
      copyImageUrls();
    });

    shadow.getElementById("btnDownloadZip").addEventListener("click", (e) => {
      e.preventDefault();
      downloadZipArchive("zip");
    });

    shadow.getElementById("btnSendToStudio").addEventListener("click", (e) => {
      e.preventDefault();
      sendToMangaStudio();
    });
  }

  // -------------------------------------------------------------
  // BRIDGE PROTOCOL: GỬI SANG MANGA STUDIO
  // -------------------------------------------------------------
  async function sendToMangaStudio() {
    const btnSend = shadow ? shadow.getElementById("btnSendToStudio") : null;
    if (btnSend && btnSend.disabled) return;
    if (btnSend) {
      btnSend.disabled = true;
      btnSend.style.opacity = "0.6";
    }

    const unlockBtn = () => {
      if (btnSend) {
        btnSend.disabled = false;
        btnSend.style.opacity = "";
      }
    };

    const selected = Array.from(state.selectedIndices)
      .sort((a, b) => a - b)
      .map((idx) => state.pages[idx])
      .filter(Boolean);

    if (selected.length === 0) {
      showToast("Vui lòng chọn ít nhất 1 trang truyện để gửi!");
      unlockBtn();
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
        // Chống tái sử dụng DOM node (Recycled Element Trap): Chỉ vẽ nếu src hiện tại của thẻ vẫn khớp với URL trang
        const curDomSrc = p.domElement.currentSrc || p.domElement.src;
        const isMatchingDom = !p.src || !curDomSrc || normalizeUrlKey(curDomSrc) === normalizeUrlKey(p.src);
        if (isMatchingDom) {
          try {
            const offCanvas = document.createElement("canvas");
            offCanvas.width = p.domElement.naturalWidth || p.domElement.width;
            offCanvas.height = p.domElement.naturalHeight || p.domElement.height;
            const ctx = offCanvas.getContext("2d");
            ctx.drawImage(p.domElement, 0, 0);
            dataUrl = offCanvas.toDataURL("image/jpeg", 0.95);
          } catch (_) {}
        }
      }

      preparedImages.push({
        name: `${state.title}_${String(i + 1).padStart(3, "0")}.jpg`,
        dataUrl: dataUrl || null,
        src: p.src,
        referer: window.location.href,
      });
    }

    setTimeout(unlockBtn, 3000);

    if (progressBar) progressBar.style.width = "0%";

    const importId = "imp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const payload = {
      type: "MANGA_STUDIO_IMPORT",
      importId: importId,
      timestamp: Date.now(),
      title: state.title,
      sourceUrl: window.location.href,
      images: preparedImages,
    };

    // 1. Lưu dự phòng vào localStorage (nếu cùng domain)
    try {
      localStorage.setItem("manga_bookmarklet_import", JSON.stringify(payload));
    } catch (_) {}

    // 2. Mở tab Manga Studio Batch an toàn qua Ad-Shield
    const targetUrl = state.studioUrl;
    let studioWin = null;
    try {
      studioWin = safeWindowOpen ? safeWindowOpen(targetUrl, "_blank") : originalWindowOpen.call(window, targetUrl, "_blank");
    } catch (err) {
      console.error("[Ad-Shield] Lỗi mở Manga Studio:", err);
    }

    // 3. Khởi tạo BroadcastChannel (hỗ trợ cùng domain)
    let channel = null;
    try {
      channel = new BroadcastChannel("manga_studio_importer");
    } catch (_) {}

    let isAcknowledged = false;
    let pingTimer = null;

    function handleAck(e) {
      if (e.data && e.data.type === "MANGA_STUDIO_IMPORT_ACK") {
        if (!e.data.importId || e.data.importId === importId) {
          isAcknowledged = true;
          if (pingTimer) clearInterval(pingTimer);
          window.removeEventListener("message", handleAck);
          if (channel) {
            try { channel.close(); } catch (_) {}
          }
          showToast(`Manga Studio đã nhận thành công ${selected.length} trang!`);
        }
      }
    }

    // Lắng nghe tín hiệu ACK từ cả postMessage (xuyên domain) và BroadcastChannel
    window.addEventListener("message", handleAck);
    if (channel) channel.onmessage = handleAck;

    // 4. Gửi lần đầu ngay lập tức
    if (channel) {
      try { channel.postMessage(payload); } catch (_) {}
    }
    if (studioWin && !studioWin.closed) {
      try { studioWin.postMessage(payload, "*"); } catch (_) {}
    }

    // 5. Ping nhịp nhàng mỗi 700ms (tối đa 12 lần) để tab mới kịp nạp script, DỪNG NGAY khi nhận ACK
    let pings = 0;
    const maxPings = 12;
    pingTimer = setInterval(() => {
      if (isAcknowledged) {
        clearInterval(pingTimer);
        return;
      }
      pings++;
      if (studioWin && !studioWin.closed) {
        try { studioWin.postMessage(payload, "*"); } catch (_) {}
      }
      if (channel) {
        try { channel.postMessage(payload); } catch (_) {}
      }
      if (pings >= maxPings) {
        clearInterval(pingTimer);
      }
    }, 700);

    showToast(`Đang kết nối và truyền dữ liệu sang Manga Studio...`);
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

      showToast(`Đang tải & đóng gói ${selected.length} trang truyện...`);

      let addedFiles = 0;
      let completed = 0;

      // Hàm trích xuất / tải 1 ảnh với 3 lớp fallback an toàn
      async function fetchSingleImage(p, idx) {
        const filename = `${String(idx + 1).padStart(3, "0")}.jpg`;

        if (p.dataUrl) {
          try {
            const base64Data = p.dataUrl.split(",")[1];
            zip.file(filename, base64Data, { base64: true });
            addedFiles++;
            return;
          } catch (_) {}
        }

        let blob = null;

        // Lớp 1: Thử trích xuất từ DOM img canvas nếu không bị tainted VÀ chưa bị recycled
        if (p.domElement && p.domElement.complete) {
          const curDomSrc = p.domElement.currentSrc || p.domElement.src;
          const isMatchingDom = !p.src || !curDomSrc || normalizeUrlKey(curDomSrc) === normalizeUrlKey(p.src);
          if (isMatchingDom) {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = p.domElement.naturalWidth || p.domElement.width;
              canvas.height = p.domElement.naturalHeight || p.domElement.height;
              const ctx = canvas.getContext("2d");
              ctx.drawImage(p.domElement, 0, 0);
              blob = await new Promise((res, rej) => {
                canvas.toBlob((b) => (b ? res(b) : rej()), "image/jpeg", 0.95);
              });
            } catch (_) {}
          }
        }

        // Lớp 2: Thử fetch trực tiếp
        if (!blob) {
          try {
            const resp = await fetch(p.src);
            if (resp.ok) blob = await resp.blob();
          } catch (_) {}
        }

        // Lớp 3: Fallback qua API Proxy của Manga Studio (vượt rào CORS & Anti-hotlink của CDN)
        if (!blob && scriptOrigin) {
          try {
            const proxyUrl = `${scriptOrigin}/api/proxy-image?url=${encodeURIComponent(p.src)}&referer=${encodeURIComponent(window.location.href)}`;
            const resp = await fetch(proxyUrl);
            if (resp.ok) blob = await resp.blob();
          } catch (_) {}
        }

        if (blob) {
          zip.file(filename, blob);
          addedFiles++;
        }
      }

      // Tải song song với Concurrency = 6 để vừa nhanh vừa không nghẽn mạng
      const CONCURRENCY = 6;
      for (let i = 0; i < selected.length; i += CONCURRENCY) {
        const chunk = selected.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map((p, offset) => fetchSingleImage(p, i + offset)));
        completed += chunk.length;
        if (progressBar) {
          progressBar.style.width = `${Math.round((completed / selected.length) * 100)}%`;
        }
        updateScanStatus(`Đang tải ${completed}/${selected.length} trang (${Math.round((completed / selected.length) * 100)}%)...`);
      }

      if (addedFiles === 0) {
        if (progressBar) progressBar.style.width = "0%";
        updateScanStatus("Lỗi tải ảnh");
        showToast("Không thể tải được ảnh nào do CDN chặn và proxy không khả dụng!");
        return;
      }

      updateScanStatus("Đang nén file ZIP...");
      showToast(`Đang nén ${addedFiles} ảnh thành file .${format}...`);
      const blob = await zip.generateAsync({ type: "blob" });
      const ext = format === "cbz" ? "cbz" : "zip";
      const downloadName = `${state.title}.${ext}`;

      // =========================================================================
      // AIR-GAPPED ISOLATED IFRAME DOWNLOAD (CHỐNG BẮT SỰ KIỆN CLICK TOÀN PHẦN)
      // Cách ly tuyệt đối: event chỉ chạy trong iframe doc, web mẹ không bắt được
      // =========================================================================
      let downloadTriggered = false;
      const blobUrl = URL.createObjectURL(blob);

      try {
        const sandboxFrame = document.createElement("iframe");
        sandboxFrame.style.position = "fixed";
        sandboxFrame.style.width = "0";
        sandboxFrame.style.height = "0";
        sandboxFrame.style.border = "none";
        sandboxFrame.style.opacity = "0";
        sandboxFrame.style.pointerEvents = "none";
        document.documentElement.appendChild(sandboxFrame);

        const frameDoc = sandboxFrame.contentDocument || sandboxFrame.contentWindow?.document;
        if (frameDoc && frameDoc.body) {
          const safeLink = frameDoc.createElement("a");
          safeLink.href = blobUrl;
          safeLink.download = downloadName;
          frameDoc.body.appendChild(safeLink);
          safeLink.click();
          downloadTriggered = true;
        }

        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
          sandboxFrame.remove();
        }, 2000);
      } catch (frameErr) {
        console.warn("[Ad-Shield] Sandbox Iframe Download fallback:", frameErr);
      }

      if (!downloadTriggered) {
        // Fallback an toàn có chặn lan truyền
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = downloadName;
        link.style.display = "none";
        link.addEventListener("click", (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
        });
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
          link.remove();
        }, 5000);
      }

      if (progressBar) progressBar.style.width = "0%";
      updateScanStatus("Sẵn sàng");
      const mbSize = (blob.size / (1024 * 1024)).toFixed(1);
      showToast(`Đã tải về ${downloadName} (${mbSize} MB)!`, 4000);
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
      .then(() => showToast(`Đã chép ${selected.length} link ảnh vào clipboard!`))
      .catch(() => showToast("Không thể ghi vào bộ nhớ tạm."));
  }

  // -------------------------------------------------------------
  // BOOTSTRAP EXECUTION
  // -------------------------------------------------------------
  createHudDOM();
  initLiveHarvester();
  scanAllPages();
})();
