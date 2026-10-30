/**
 * Manga Reader Preview Component
 * Webtoon continuous vertical scroll (liền mạch, chuẩn Webtoon) & Manga page-flip modes.
 * Clean, seamless image flow without clumsy gaps or unstyled headers.
 */

export class MangaReaderPreview {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.options = options;
    this.readingMode = "webtoon"; // 'webtoon' | 'manga'
    this.widthMode = "standard"; // 'compact' | 'standard' | 'wide' | 'full'
    this.pages = [];
    this.activePageIndex = 0;

    this.onSelectPage = options.onSelectPage || (() => {});
    this.onStatusChanged = options.onStatusChanged || (() => {});

    this._bindKeyboardEvents();
  }

  setPages(pages, activeIndex = 0) {
    this.pages = pages || [];
    this.activePageIndex = Math.max(0, Math.min(activeIndex, (this.pages.length || 1) - 1));
    this.render();
  }

  setReadingMode(mode) {
    this.readingMode = mode; // 'webtoon' | 'manga'
    this.render();
  }

  setWidthMode(width) {
    this.widthMode = width;
    const stream = this.container?.querySelector(".reader-webtoon-stream");
    if (stream) {
      stream.className = `reader-webtoon-stream width-${width}`;
    }
  }

  _bindKeyboardEvents() {
    window.addEventListener("keydown", (e) => {
      // Chỉ kích hoạt khi đang ở tab reader
      const readerWrapper = document.getElementById("typesetReaderWrapper");
      if (!readerWrapper || readerWrapper.style.display === "none") return;
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

      if (this.readingMode === "manga") {
        if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
          this.prevPage();
        } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
          this.nextPage();
        }
      }
    });
  }

  prevPage() {
    if (this.activePageIndex > 0) {
      this.activePageIndex--;
      this.renderMangaFlipMode();
    }
  }

  nextPage() {
    if (this.activePageIndex < this.pages.length - 1) {
      this.activePageIndex++;
      this.renderMangaFlipMode();
    }
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = "";

    if (this.pages.length === 0) {
      this.container.innerHTML = `
        <div class="reader-empty-state" style="text-align: center; padding: 60px 20px; color: #94a3b8;">
          <i class="fa-solid fa-book-open text-4xl text-indigo-400" style="margin-bottom: 12px; display: inline-block;"></i>
          <h3 style="color: #ffffff; font-size: 1.1rem; margin-bottom: 8px;">Chưa có trang nào trong Chapter</h3>
          <p style="font-size: 0.85rem;">Hãy thêm ảnh hoặc nhập file .manga-proj từ chế độ Biên tập để xem trước tại đây.</p>
        </div>
      `;
      return;
    }

    if (this.readingMode === "webtoon") {
      this.renderWebtoonMode();
    } else {
      this.renderMangaFlipMode();
    }
  }

  renderWebtoonMode() {
    const listWrapper = document.createElement("div");
    listWrapper.className = `reader-webtoon-stream width-${this.widthMode}`;

    this.pages.forEach((page, idx) => {
      const pageCard = document.createElement("div");
      pageCard.className = `reader-page-card ${idx === this.activePageIndex ? "active" : ""}`;
      pageCard.dataset.index = idx;

      const imgSrc = page.renderedPreview || page.cleanedImage || page.rawImage;
      const status = page.status || "pending";
      const statusDotColor = status === "approved" ? "#10b981" : status === "editing" ? "#f59e0b" : "#94a3b8";

      pageCard.innerHTML = `
        <div class="reader-img-container" title="Bấm vào trang để mở Canvas Biên tập">
          <img src="${imgSrc}" alt="Trang ${idx + 1}" loading="lazy">
          
          <!-- Floating Pill trên từng trang (Không làm đứt đoạn tranh) -->
          <div class="reader-page-floating-pill">
            <span class="status-dot-mini" style="background: ${statusDotColor}; width: 7px; height: 7px; border-radius: 50%; display: inline-block;" title="Trạng thái: ${status}"></span>
            <span class="pill-page-number">#${String(idx + 1).padStart(2, "0")}</span>
            <span class="pill-page-file">${page.fileName || `Trang ${idx + 1}`}</span>
            <button type="button" class="btn-pill-edit" title="Mở trang này trên Canvas Typeset">
              <i class="fa-solid fa-pen-nib"></i> Sửa trang
            </button>
          </div>

          <!-- Hover Overlay -->
          <div class="reader-hover-overlay">
            <button type="button" class="btn-reader-quick-edit">
              <i class="fa-solid fa-pen-to-square"></i> Mở Canvas Biên Tập
            </button>
          </div>
        </div>
      `;

      // Click vào card để mở Canvas
      const openCanvas = () => this.onSelectPage(idx, page);
      pageCard.querySelector(".btn-pill-edit")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openCanvas();
      });
      pageCard.querySelector(".reader-img-container").addEventListener("click", openCanvas);

      listWrapper.appendChild(pageCard);
    });

    this.container.appendChild(listWrapper);
  }

  renderMangaFlipMode() {
    const page = this.pages[this.activePageIndex] || this.pages[0];
    const idx = this.activePageIndex;
    const imgSrc = page.renderedPreview || page.cleanedImage || page.rawImage;

    const flipWrapper = document.createElement("div");
    flipWrapper.className = "reader-manga-flip-wrap";

    flipWrapper.innerHTML = `
      <div class="manga-flip-viewport">
        <button type="button" class="btn-flip-arrow prev" ${idx <= 0 ? "disabled" : ""} title="Trang trước (Phím ← hoặc A)">
          <i class="fa-solid fa-chevron-left"></i>
        </button>

        <div class="manga-flip-image-box" title="Bấm để mở Canvas biên tập trang này">
          <img src="${imgSrc}" alt="Trang ${idx + 1}">
          
          <div class="manga-flip-badge">
            <span style="color: #818cf8; font-weight: 800;">Trang ${idx + 1} / ${this.pages.length}</span>
            <span style="color: rgba(255,255,255,0.3);">|</span>
            <span class="manga-filename">${page.fileName || ""}</span>
            <span style="color: rgba(255,255,255,0.3);">|</span>
            <span style="color: #cbd5e1; cursor: pointer; text-decoration: underline;" class="btn-flip-edit-text">✏️ Sửa</span>
          </div>
        </div>

        <button type="button" class="btn-flip-arrow next" ${idx >= this.pages.length - 1 ? "disabled" : ""} title="Trang sau (Phím → hoặc D)">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
    `;

    flipWrapper.querySelector(".btn-flip-arrow.prev")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.prevPage();
    });

    flipWrapper.querySelector(".btn-flip-arrow.next")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.nextPage();
    });

    const openCanvas = () => this.onSelectPage(this.activePageIndex, page);
    flipWrapper.querySelector(".manga-flip-image-box")?.addEventListener("click", openCanvas);
    flipWrapper.querySelector(".btn-flip-edit-text")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openCanvas();
    });

    this.container.appendChild(flipWrapper);
  }
}
