/**
 * Manga Reader Preview Component
 * Webtoon continuous vertical scroll & Manga page-flip modes.
 * Displays approval status badges and opens Canvas Editor upon clicking any page.
 */

export class MangaReaderPreview {
  constructor(containerElement, options = {}) {
    this.container = containerElement;
    this.options = options;
    this.readingMode = "webtoon"; // 'webtoon' | 'manga'
    this.pages = [];
    this.activePageIndex = 0;

    this.onSelectPage = options.onSelectPage || (() => {});
    this.onStatusChanged = options.onStatusChanged || (() => {});
  }

  setPages(pages, activeIndex = 0) {
    this.pages = pages || [];
    this.activePageIndex = activeIndex;
    this.render();
  }

  setReadingMode(mode) {
    this.readingMode = mode; // 'webtoon' hoặc 'manga'
    this.render();
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = "";

    if (this.pages.length === 0) {
      this.container.innerHTML = `
        <div class="reader-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
          <h3>Chưa có trang nào trong Chapter</h3>
          <p>Hãy thêm ảnh hoặc nhập file .manga-proj từ cột bên trái để bắt đầu đọc và typeset.</p>
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
    listWrapper.className = "reader-webtoon-stream";

    this.pages.forEach((page, idx) => {
      const pageCard = document.createElement("div");
      pageCard.className = `reader-page-card ${idx === this.activePageIndex ? "active" : ""}`;

      // Status Badge
      const status = page.status || "pending";
      const statusText = status === "approved" ? "Đã duyệt" : status === "editing" ? "Đang sửa" : "Chưa xong";
      const statusClass = `badge-status-${status}`;

      pageCard.innerHTML = `
        <div class="reader-card-header">
          <span class="page-num-pill">Trang #${String(idx + 1).padStart(2, "0")} (${page.fileName || "Ảnh"})</span>
          <div class="badge-status ${statusClass}" title="Bấm để đổi trạng thái">
            <span class="status-dot"></span>
            <span class="status-label">${statusText}</span>
          </div>
          <button class="btn-open-canvas" title="Mở Canvas Typeset Studio">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
              <path d="M2 2l7.586 7.586"></path>
            </svg>
            <span>Sửa trên Canvas</span>
          </button>
        </div>
        <div class="reader-img-wrapper" title="Bấm vào trang để mở Canvas chỉnh sửa ngay">
          <img src="${page.cleanedImage || page.rawImage}" alt="Page ${idx + 1}" loading="lazy">
          <div class="reader-overlay-hint">
            <span>🎨 Bấm để mở Canvas Typeset</span>
          </div>
        </div>
      `;

      // Click vào badge để cycle trạng thái: pending -> editing -> approved -> pending
      const badgeEl = pageCard.querySelector(".badge-status");
      badgeEl.addEventListener("click", (e) => {
        e.stopPropagation();
        const nextStatus = status === "pending" ? "editing" : status === "editing" ? "approved" : "pending";
        this.onStatusChanged(page.id, nextStatus);
      });

      // Click vào card hoặc nút để mở Canvas
      const openCanvas = () => this.onSelectPage(idx, page);
      pageCard.querySelector(".btn-open-canvas").addEventListener("click", (e) => {
        e.stopPropagation();
        openCanvas();
      });
      pageCard.querySelector(".reader-img-wrapper").addEventListener("click", openCanvas);

      listWrapper.appendChild(pageCard);
    });

    this.container.appendChild(listWrapper);
  }

  renderMangaFlipMode() {
    const page = this.pages[this.activePageIndex] || this.pages[0];
    const idx = this.activePageIndex;

    const flipWrapper = document.createElement("div");
    flipWrapper.className = "reader-manga-flip";

    const status = page.status || "pending";
    const statusText = status === "approved" ? "Đã duyệt" : status === "editing" ? "Đang sửa" : "Chưa xong";
    const statusClass = `badge-status-${status}`;

    flipWrapper.innerHTML = `
      <div class="manga-nav-bar">
        <button class="btn-flip-prev" ${idx <= 0 ? "disabled" : ""} title="Trang trước (←)">
          ◀ Trang trước
        </button>
        <div class="manga-flip-info">
          <span>Trang ${idx + 1} / ${this.pages.length}</span>
          <div class="badge-status ${statusClass}" title="Bấm để đổi trạng thái">
            <span class="status-dot"></span>
            <span class="status-label">${statusText}</span>
          </div>
        </div>
        <button class="btn-flip-next" ${idx >= this.pages.length - 1 ? "disabled" : ""} title="Trang sau (→)">
          Trang sau ▶
        </button>
        <button class="btn-flip-edit" title="Mở trang này trên Canvas">
          🎨 Mở Canvas sửa
        </button>
      </div>
      <div class="manga-single-page" title="Bấm vào trang để mở Canvas chỉnh sửa">
        <img src="${page.cleanedImage || page.rawImage}" alt="Page ${idx + 1}">
        <div class="reader-overlay-hint">
          <span>🎨 Bấm để mở Canvas Typeset</span>
        </div>
      </div>
    `;

    flipWrapper.querySelector(".btn-flip-prev")?.addEventListener("click", () => {
      if (this.activePageIndex > 0) {
        this.activePageIndex--;
        this.renderMangaFlipMode();
      }
    });

    flipWrapper.querySelector(".btn-flip-next")?.addEventListener("click", () => {
      if (this.activePageIndex < this.pages.length - 1) {
        this.activePageIndex++;
        this.renderMangaFlipMode();
      }
    });

    const openCanvas = () => this.onSelectPage(this.activePageIndex, page);
    flipWrapper.querySelector(".btn-flip-edit").addEventListener("click", openCanvas);
    flipWrapper.querySelector(".manga-single-page").addEventListener("click", openCanvas);

    flipWrapper.querySelector(".badge-status").addEventListener("click", (e) => {
      e.stopPropagation();
      const nextStatus = status === "pending" ? "editing" : status === "editing" ? "approved" : "pending";
      this.onStatusChanged(page.id, nextStatus);
    });

    this.container.appendChild(flipWrapper);
  }
}
