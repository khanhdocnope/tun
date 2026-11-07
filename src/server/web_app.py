"""
Giao diện Web App tương tác trực tiếp của MoeJect phục vụ nghiệm thu tức thì.
Ứng dụng bảng màu Catppuccin Mocha (#1E1E2E) và cấu trúc điều hướng tối giản Mihon/Tachiyomi.
"""

WEB_APP_HTML = """<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MoeJect - Manga Ecosystem</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --base: #1E1E2E;
            --mantle: #181825;
            --crust: #11111B;
            --surface0: #313244;
            --surface1: #45475A;
            --surface2: #585B70;
            --subtext0: #A6ADC8;
            --subtext1: #BAC2DE;
            --text: #CDD6F4;
            --lavender: #B4BEFE;
            --teal: #94E2D5;
            --pink: #F5C2E7;
            --mauve: #CBA6F7;
            --peach: #FAB387;
            --red: #F38BA8;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Plus Jakarta Sans', sans-serif;
            -webkit-font-smoothing: antialiased;
        }

        body {
            background-color: var(--base);
            color: var(--text);
            display: flex;
            height: 100vh;
            overflow: hidden;
        }

        /* SIDEBAR NAVIGATION RAIL */
        aside.nav-rail {
            width: 80px;
            background-color: var(--mantle);
            border-right: 1px solid var(--surface1);
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 24px 0;
            gap: 20px;
            z-index: 10;
        }

        .logo-box {
            width: 44px;
            height: 44px;
            background: rgba(180, 190, 254, 0.15);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--lavender);
            font-size: 22px;
            margin-bottom: 12px;
        }

        .nav-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            width: 64px;
            height: 56px;
            border-radius: 12px;
            color: var(--subtext0);
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
        }

        .nav-item:hover {
            color: var(--text);
            background: rgba(255, 255, 255, 0.05);
        }

        .nav-item.active {
            color: var(--lavender);
            background: var(--surface0);
        }

        .nav-item svg {
            width: 22px;
            height: 22px;
        }

        .nav-item span {
            font-size: 10px;
            font-weight: 600;
        }

        .badge-count {
            position: absolute;
            top: 4px;
            right: 10px;
            background: var(--lavender);
            color: var(--crust);
            font-size: 9px;
            font-weight: 800;
            padding: 1px 5px;
            border-radius: 10px;
            display: none;
        }

        /* MAIN CONTENT AREA */
        main.main-viewport {
            flex: 1;
            height: 100vh;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            position: relative;
        }

        header.top-bar {
            padding: 16px 24px;
            display: flex;
            align-items: center;
            gap: 16px;
            background: var(--base);
            border-bottom: 1px solid var(--surface1);
            position: sticky;
            top: 0;
            z-index: 5;
        }

        .search-box {
            flex: 1;
            display: flex;
            align-items: center;
            background: var(--surface0);
            border: 1px solid var(--surface1);
            border-radius: 12px;
            padding: 8px 16px;
            gap: 12px;
        }

        .search-box input {
            background: transparent;
            border: none;
            outline: none;
            color: var(--text);
            font-size: 14px;
            width: 100%;
        }

        .search-box input::placeholder {
            color: var(--subtext0);
        }

        .search-clear-btn {
            background: transparent;
            border: none;
            color: var(--subtext0);
            cursor: pointer;
            font-size: 14px;
            display: none;
            align-items: center;
            justify-content: center;
        }

        .search-clear-btn:hover {
            color: var(--text);
        }

        .feed-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 24px 0 24px;
            font-size: 13px;
            font-weight: 700;
            color: var(--lavender);
        }

        .source-chips {
            display: flex;
            gap: 8px;
            padding: 12px 24px;
            overflow-x: auto;
            border-bottom: 1px solid rgba(69, 71, 90, 0.4);
        }

        .chip {
            padding: 6px 14px;
            background: var(--surface0);
            border: 1px solid var(--surface1);
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
        }

        .chip.active {
            background: var(--lavender);
            color: var(--crust);
            border-color: var(--lavender);
        }

        /* MANGA GRID */
        .manga-grid {
            padding: 24px;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 20px;
        }

        .manga-card {
            background: var(--surface0);
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid var(--surface1);
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            display: flex;
            flex-direction: column;
        }

        .manga-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.3);
            border-color: var(--lavender);
        }

        .card-cover {
            width: 100%;
            aspect-ratio: 3 / 4.3;
            background: var(--surface1);
            object-fit: cover;
        }

        .card-info {
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            flex: 1;
        }

        .card-title {
            font-size: 13px;
            font-weight: 700;
            line-height: 1.3;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .card-latest {
            font-size: 11px;
            color: var(--lavender);
            font-weight: 600;
        }

        /* DETAIL MODAL */
        .modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(17, 17, 27, 0.85);
            backdrop-filter: blur(8px);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 100;
            padding: 20px;
        }

        .modal-card {
            background: var(--base);
            border: 1px solid var(--surface1);
            border-radius: 16px;
            width: 100%;
            max-width: 760px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
        }

        .modal-header {
            padding: 20px;
            display: flex;
            gap: 20px;
            background: var(--mantle);
            border-bottom: 1px solid var(--surface1);
            position: relative;
        }

        .modal-cover {
            width: 110px;
            height: 160px;
            object-fit: cover;
            border-radius: 8px;
            background: var(--surface0);
            flex-shrink: 0;
        }

        .modal-meta {
            display: flex;
            flex-direction: column;
            gap: 8px;
            flex: 1;
        }

        .modal-meta h2 {
            font-size: 18px;
            font-weight: 700;
        }

        .modal-meta .author {
            color: var(--lavender);
            font-size: 13px;
            font-weight: 600;
        }

        .modal-meta .genres {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .genre-tag {
            background: var(--surface0);
            color: var(--mauve);
            font-size: 10px;
            padding: 2px 8px;
            border-radius: 4px;
        }

        .modal-close {
            position: absolute;
            top: 16px;
            right: 16px;
            background: transparent;
            border: none;
            color: var(--subtext0);
            font-size: 20px;
            cursor: pointer;
        }

        .modal-body {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .download-action-bar {
            background: var(--surface0);
            padding: 14px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
        }

        select, input.range-input {
            background: var(--mantle);
            border: 1px solid var(--surface1);
            color: var(--text);
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 13px;
            outline: none;
        }

        button.btn-primary {
            background: var(--lavender);
            color: var(--crust);
            border: none;
            padding: 8px 18px;
            border-radius: 8px;
            font-weight: 700;
            font-size: 13px;
            cursor: pointer;
            transition: opacity 0.2s;
        }

        button.btn-primary:hover {
            opacity: 0.9;
        }

        /* CHAPTER LIST */
        .chapter-list {
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .chapter-item {
            background: var(--mantle);
            padding: 10px 14px;
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 13px;
        }

        /* DOWNLOADS VIEW & AI VIEW */
        .page-view {
            display: none;
            padding: 24px;
            flex-direction: column;
            gap: 16px;
        }

        .page-view.active {
            display: flex;
        }

        .task-card {
            background: var(--surface0);
            border: 1px solid var(--surface1);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .progress-bar {
            height: 6px;
            background: var(--mantle);
            border-radius: 3px;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            background: var(--lavender);
            width: 0%;
            transition: width 0.3s;
        }
        .source-card {
            background: var(--mantle);
            border: 1px solid var(--surface1);
            border-radius: 10px;
            padding: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }

        .source-card:hover {
            border-color: var(--lavender);
            background: var(--surface0);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }

        .source-card.active {
            border-color: var(--teal);
            background: rgba(148, 226, 213, 0.08);
        }
    </style>
</head>
<body>
    <!-- SIDEBAR NAVIGATION -->
    <aside class="nav-rail">
        <div class="logo-box">📖</div>
        
        <div class="nav-item" onclick="switchTab('library')">
            <svg fill="currentColor" viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>
            <span>Thư viện</span>
        </div>

        <div class="nav-item active" onclick="switchTab('browse')">
            <svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
            <span>Khám phá</span>
        </div>

        <div class="nav-item" onclick="switchTab('cleaner')">
            <svg fill="currentColor" viewBox="0 0 24 24"><path d="M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29c-.39-.39-1.02-.39-1.41 0L1.29 18.96c-.39.39-.39 1.02 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.05c.39-.39.39-1.02 0-1.41l-2.33-2.35zm-1.06 3.41l-1.41-1.41 1.06-1.06 1.41 1.41-1.06 1.06z"/></svg>
            <span>AI Studio</span>
        </div>

        <div class="nav-item" onclick="switchTab('downloads')">
            <svg fill="currentColor" viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
            <span>Tiến trình</span>
            <div id="dl-badge" class="badge-count">0</div>
        </div>
    </aside>

    <!-- MAIN VIEWPORT -->
    <main class="main-viewport">
        <!-- BROWSE TAB -->
        <div id="tab-browse" class="page-view active">
            <header class="top-bar">
                <div class="search-box">
                    <svg width="18" height="18" fill="var(--lavender)" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                    <input type="text" id="search-input" placeholder="Tìm kiếm truyện tranh... (Để trống xem truyện mới cập nhật)" value="" oninput="handleSearchInput()" onkeydown="if(event.key==='Enter') executeSearch()">
                    <button id="search-clear" class="search-clear-btn" onclick="clearSearch()" title="Xóa tìm kiếm">✕</button>
                </div>
                <button class="btn-primary" onclick="executeSearch()">Tìm kiếm</button>
            </header>

            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
                <div class="source-chips" id="quick-source-chips" style="margin-bottom:0;">
                    <div class="chip active" data-src="mangadex" onclick="setSource('mangadex', this)">MangaDex (API v5)</div>
                    <div class="chip" data-src="cuutruyen" onclick="setSource('cuutruyen', this)">Cứu Truyện (Auto DRM)</div>
                    <div class="chip" data-src="blogtruyen" onclick="setSource('blogtruyen', this)">BlogTruyen</div>
                    <div class="chip" data-src="mangatoon-vi" onclick="setSource('mangatoon-vi', this)">MangaToon (VI)</div>
                    <div class="chip" data-src="asurascans" onclick="setSource('asurascans', this)">Asura Scans</div>
                    <div class="chip" data-src="hitomi" onclick="setSource('hitomi', this)">Hitomi.la (Doujin/Manga)</div>
                    <div class="chip" data-src="comix" onclick="setSource('comix', this)">Comix.to (Turnstile)</div>
                </div>
                <button class="btn-primary" style="background:var(--surface1); color:var(--text); border:1px solid var(--surface2); padding:6px 14px; font-size:12px; display:inline-flex; align-items:center; gap:6px; cursor:pointer;" onclick="openSourceModal()">
                    <span>🌐 Tất cả 1,313+ Nguồn</span>
                    <span style="background:var(--lavender); color:var(--crust); font-size:10px; font-weight:700; padding:1px 6px; border-radius:10px;">1,313</span>
                </button>
            </div>

            <div id="feed-status" class="feed-header">
                <span id="feed-title">🔥 Truyện mới cập nhật gần đây (Mới nhất)</span>
                <span id="feed-count" style="color:var(--subtext0); font-weight:500; font-size:11px;"></span>
            </div>

            <div id="manga-grid" class="manga-grid">
                <!-- Manga cards loaded dynamically -->
            </div>
        </div>

        <!-- DOWNLOADS TAB -->
        <div id="tab-downloads" class="page-view">
            <h2>Tiến trình Tải truyện (Real-Time Background Tasks)</h2>
            <div id="tasks-container" style="display:flex; flex-direction:column; gap:12px;">
                <p style="color:var(--subtext0);">Chưa có tác vụ tải nào đang chạy.</p>
            </div>
        </div>

        <!-- AI CLEANER TAB -->
        <div id="tab-cleaner" class="page-view">
            <h2>AI Cleaner Studio (Xóa chữ & Khôi phục nền tranh)</h2>
            <div style="background:var(--surface0); border:2px dashed var(--lavender); border-radius:16px; padding:40px; text-align:center;">
                <p style="font-size:16px; font-weight:700;">Kéo thả file .ZIP hoặc thư mục ảnh truyện vào đây</p>
                <p style="color:var(--subtext0); font-size:12px; margin-top:6px;">Tự động nạp vào bộ nhận diện ComicTextDetector (CTD) và Inpainting LaMa Large</p>
            </div>
        </div>

        <!-- LIBRARY TAB -->
        <div id="tab-library" class="page-view">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <div>
                    <h2>Kệ truyện của bạn (Thư viện file đã tải)</h2>
                    <p style="color:var(--subtext0); font-size:13px; margin-top:4px;">Quản lý và tải trực tiếp các file .ZIP và .CBZ đã hoàn tất trên máy chủ về thiết bị.</p>
                </div>
                <button class="btn-primary" style="background:var(--surface1); color:var(--text); border:1px solid var(--surface2); padding:6px 14px; font-size:12px; cursor:pointer;" onclick="loadLibrary()">🔄 Làm mới</button>
            </div>
            <div id="library-container" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:14px;">
                <div style="color:var(--subtext0); grid-column:1/-1;">Đang tải thư viện file...</div>
            </div>
        </div>
    </main>

    <!-- MANGA DETAIL MODAL -->
    <div id="manga-modal" class="modal-overlay" onclick="closeModal(event)">
        <div class="modal-card" onclick="event.stopPropagation()">
            <div class="modal-header">
                <img id="modal-cover" class="modal-cover" src="" alt="Cover">
                <div class="modal-meta">
                    <h2 id="modal-title">Tiêu đề truyện</h2>
                    <div id="modal-author" class="author">Tác giả</div>
                    <div id="modal-genres" class="genres"></div>
                </div>
                <button class="modal-close" onclick="closeModal()">✕</button>
            </div>
            <div class="modal-body">
                <div class="download-action-bar" style="flex-wrap:wrap; gap:10px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-weight:700; font-size:13px; color:var(--lavender);">Định dạng:</span>
                        <select id="dl-format">
                            <option value="zip" selected>ZIP (Ảnh thô cho AI Cleaner / Lưu trữ)</option>
                            <option value="cbz">CBZ (ComicInfo.xml cho Manga Reader)</option>
                            <option value="images">Thư mục ảnh rời</option>
                            <option value="pdf">Tài liệu PDF</option>
                        </select>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <input type="text" id="dl-range" class="range-input" placeholder="Dải chương: 1-3, all" value="1-2" style="width:130px;">
                        <button class="btn-primary" style="background:var(--teal); color:var(--crust); font-weight:700;" onclick="submitDownload('zip')">📦 Tải file ZIP</button>
                        <button class="btn-primary" style="background:var(--lavender); color:var(--crust); font-weight:700;" onclick="submitDownload('cbz')">⚡ Tải CBZ</button>
                    </div>
                </div>
                <h3>Danh sách chương (Chọn tải trực tiếp ZIP hoặc CBZ)</h3>
                <ul id="modal-chapters" class="chapter-list"></ul>
            </div>
        </div>
    </div>

    <!-- SOURCE CATALOG MODAL (1,313 CONNECTORS) -->
    <div id="source-modal" class="modal-overlay" onclick="closeSourceModal(event)">
        <div class="modal-card" style="max-width:860px; height:80vh; display:flex; flex-direction:column; padding:0; overflow:hidden;" onclick="event.stopPropagation()">
            <div style="padding:18px 24px; background:var(--mantle); border-bottom:1px solid var(--surface1); display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h2 style="font-size:18px; margin:0; display:flex; align-items:center; gap:8px;">
                        <span>📚 Kho 1,313+ Nguồn Truyện</span>
                        <span id="catalog-count-badge" style="background:var(--lavender); color:var(--crust); font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px;">Đang nạp...</span>
                    </h2>
                    <p style="font-size:12px; color:var(--subtext0); margin:4px 0 0 0;">
                        Chọn bất kỳ nguồn nào để duyệt truyện hoặc tải về không giới hạn.
                    </p>
                </div>
                <button class="modal-close" style="position:static;" onclick="closeSourceModal()">✕</button>
            </div>

            <div style="padding:14px 24px; border-bottom:1px solid var(--surface1); display:flex; flex-direction:column; gap:10px; background:var(--crust);">
                <div class="search-box" style="max-width:100%;">
                    <svg width="16" height="16" fill="var(--lavender)" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                    <input type="text" id="source-filter-input" placeholder="Gõ tên nguồn, domain hoặc template (vd: asura, truyen, flame, reaper, madara)..." oninput="filterSourcesCatalog()">
                </div>
                <div class="source-chips" id="source-lang-tabs" style="margin-bottom:0; flex-wrap:wrap;">
                    <div class="chip active" onclick="setCatalogLangFilter('all', this)">Tất cả (1,313)</div>
                    <div class="chip" onclick="setCatalogLangFilter('vi', this)">🇻🇳 Tiếng Việt (17)</div>
                    <div class="chip" onclick="setCatalogLangFilter('en', this)">🇬🇧 English (453)</div>
                    <div class="chip" onclick="setCatalogLangFilter('raw', this)">🇯🇵 Raw / Đa ngữ</div>
                </div>
            </div>

            <div id="source-catalog-grid" style="flex:1; overflow-y:auto; padding:20px 24px; display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px; align-content:start;">
                <!-- Rendered dynamically -->
            </div>
        </div>
    </div>

    <script>
        let currentSource = 'mangadex';
        let currentMangaId = '';
        let currentMangaTitle = '';
        let currentTasks = {};
        let searchDebounceTimer = null;
        let allSources = [];
        let currentCatalogLang = 'all';

        async function loadAllSourcesCatalog() {
            try {
                const res = await fetch('/api/sources');
                const data = await res.json();
                allSources = data.sources || [];
                const badge = document.getElementById('catalog-count-badge');
                if (badge) badge.innerText = allSources.length + ' nguồn';
            } catch (e) {
                console.error('Lỗi tải danh mục nguồn:', e);
            }
        }

        function openSourceModal() {
            const modal = document.getElementById('source-modal');
            modal.style.display = 'flex';
            filterSourcesCatalog();
            setTimeout(() => {
                const inp = document.getElementById('source-filter-input');
                if (inp) inp.focus();
            }, 100);
        }

        function closeSourceModal(e) {
            document.getElementById('source-modal').style.display = 'none';
        }

        function setCatalogLangFilter(lang, el) {
            currentCatalogLang = lang;
            document.querySelectorAll('#source-lang-tabs .chip').forEach(c => c.classList.remove('active'));
            if (el) el.classList.add('active');
            filterSourcesCatalog();
        }

        function filterSourcesCatalog() {
            const grid = document.getElementById('source-catalog-grid');
            if (!grid) return;
            const query = (document.getElementById('source-filter-input')?.value || '').trim().toLowerCase();
            
            let filtered = allSources;
            if (currentCatalogLang === 'vi') {
                filtered = filtered.filter(s => (s.languages || []).includes('vi'));
            } else if (currentCatalogLang === 'en') {
                filtered = filtered.filter(s => (s.languages || []).includes('en'));
            } else if (currentCatalogLang === 'raw') {
                filtered = filtered.filter(s => {
                    const l = s.languages || [];
                    return l.includes('ja') || l.includes('ko') || l.includes('zh') || l.includes('raw') || l.includes('multi');
                });
            }

            if (query) {
                filtered = filtered.filter(s => 
                    (s.name && s.name.toLowerCase().includes(query)) ||
                    (s.id && s.id.toLowerCase().includes(query)) ||
                    (s.url && s.url.toLowerCase().includes(query)) ||
                    (s.description && s.description.toLowerCase().includes(query))
                );
            }

            if (filtered.length === 0) {
                grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--subtext0);">Không tìm thấy nguồn truyện nào khớp với bộ lọc.</div>';
                return;
            }

            grid.innerHTML = filtered.slice(0, 120).map(s => {
                const isActive = s.id === currentSource;
                const langs = (s.languages || []).join(', ').toUpperCase();
                return `
                <div class="source-card ${isActive ? 'active' : ''}" onclick="selectSourceFromCatalog('${s.id}', '${encodeURIComponent(s.name)}')">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                        <span style="font-weight:700; font-size:13px; color:${isActive ? 'var(--lavender)' : 'var(--text)'};">${s.name}</span>
                        ${isActive ? '<span style="font-size:10px; background:var(--teal); color:var(--crust); font-weight:700; padding:1px 6px; border-radius:4px;">ĐANG CHỌN</span>' : ''}
                    </div>
                    <div style="font-size:11px; color:var(--subtext0); margin:4px 0 8px 0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${s.url}">${s.url}</div>
                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px;">
                        <span style="background:var(--surface0); color:var(--lavender); padding:2px 6px; border-radius:4px; font-weight:600;">${langs || 'MULTI'}</span>
                        <span style="color:var(--subtext1); font-size:10px;">${s.needs_browser_bypass ? '🛡️ Cloudflare' : '⚡ Tốc độ cao'}</span>
                    </div>
                </div>
                `;
            }).join('');
        }

        function selectSourceFromCatalog(sourceId, encodedName) {
            const name = decodeURIComponent(encodedName);
            closeSourceModal();

            let chip = document.querySelector(`.source-chips .chip[data-src="${sourceId}"]`);
            if (!chip) {
                const quickChips = document.getElementById('quick-source-chips');
                chip = document.createElement('div');
                chip.className = 'chip';
                chip.setAttribute('data-src', sourceId);
                chip.innerText = name;
                chip.onclick = function() { setSource(sourceId, chip); };
                quickChips.insertBefore(chip, quickChips.firstChild);
            }

            setSource(sourceId, chip);
        }

        function handleSearchInput() {
            const input = document.getElementById('search-input');
            const clearBtn = document.getElementById('search-clear');
            if (input.value.trim().length > 0) {
                clearBtn.style.display = 'flex';
            } else {
                clearBtn.style.display = 'none';
                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(executeSearch, 250);
            }
        }

        function clearSearch() {
            const input = document.getElementById('search-input');
            input.value = '';
            document.getElementById('search-clear').style.display = 'none';
            executeSearch();
        }

        function switchTab(tabId) {
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.page-view').forEach(el => el.classList.remove('active'));
            
            event.currentTarget.classList.add('active');
            document.getElementById('tab-' + tabId).classList.add('active');
            if (tabId === 'library') {
                loadLibrary();
            }
        }

        function setSource(src, el) {
            currentSource = src;
            document.querySelectorAll('.source-chips .chip').forEach(c => c.classList.remove('active'));
            el.classList.add('active');
            executeSearch();
        }

        async function executeSearch() {
            const query = document.getElementById('search-input').value.trim();
            const grid = document.getElementById('manga-grid');
            const feedTitle = document.getElementById('feed-title');
            const feedCount = document.getElementById('feed-count');

            if (query) {
                feedTitle.innerText = `🔍 Kết quả tìm kiếm cho: "${query}"`;
            } else {
                feedTitle.innerText = `🔥 Truyện mới cập nhật gần đây (Mới nhất)`;
            }
            feedCount.innerText = '';
            
            const loadingText = currentSource === 'comix' 
                ? 'Đang kết nối tới Comix.to (Đang vượt bảo vệ Cloudflare Turnstile, vui lòng đợi vài giây)...'
                : 'Đang nạp dữ liệu từ ' + currentSource + '...';
            grid.innerHTML = '<p style="color:var(--lavender); display:flex; align-items:center; gap:8px;">⏳ ' + loadingText + '</p>';

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            try {
                const searchParam = query ? `&q=${encodeURIComponent(query)}` : '';
                const res = await fetch(`/api/search?source=${currentSource}${searchParam}`, {
                    signal: controller.signal
                });
                clearTimeout(timeoutId);
                const data = await res.json();
                const items = Array.isArray(data) ? data : (data.results || []);
                
                if (!items || items.length === 0) {
                    grid.innerHTML = '<p style="color:var(--subtext0);">' + (query ? 'Không tìm thấy kết quả nào cho "' + query + '".' : 'Hiện chưa có truyện mới cập nhật.') + '</p>';
                    feedCount.innerText = '0 bộ truyện';
                    return;
                }

                feedCount.innerText = `${items.length} bộ truyện`;
                grid.innerHTML = items.map(it => {
                    const proxyCover = it.cover_url ? ('/api/proxy/image?url=' + encodeURIComponent(it.cover_url)) : '/api/proxy/image?url=';
                    return `
                    <div class="manga-card" onclick="openMangaDetail('${currentSource}', '${it.id}', '${encodeURIComponent(it.title)}')">
                        <img class="card-cover" src="${proxyCover}" alt="${it.title}" loading="lazy" onerror="this.src='/api/proxy/image?url='">
                        <div class="card-info">
                            <div class="card-title">${it.title}</div>
                            <div class="card-latest">${it.latest_chapter ? 'Ch. ' + it.latest_chapter : 'Chi tiết'}</div>
                        </div>
                    </div>
                `}).join('');
            } catch (err) {
                clearTimeout(timeoutId);
                if (err.name === 'AbortError') {
                    grid.innerHTML = `
                        <div style="background:var(--surface0); border:1px solid var(--peach); padding:20px; border-radius:12px; margin-top:12px; grid-column:1/-1;">
                            <h4 style="color:var(--peach); margin:0 0 8px 0; font-size:15px; display:flex; align-items:center; gap:8px;">
                                ⚠️ Kết nối tới ${currentSource.toUpperCase()} quá thời gian chờ (Timeout)
                            </h4>
                            <p style="font-size:13px; color:var(--subtext1); margin:0 0 14px 0; line-height:1.5;">
                                ${currentSource === 'comix' 
                                    ? 'Comix.to đang kích hoạt bảo vệ Cloudflare Turnstile nghiêm ngặt. Bạn có thể thử tìm kiếm lại hoặc bấm chuyển nhanh sang nguồn MangaDex hoặc Cứu Truyện để đọc ngay tức thì.'
                                    : 'Máy chủ phản hồi chậm hoặc bị quá tải mạng. Vui lòng thử lại sau.'}
                            </p>
                            <div style="display:flex; gap:10px;">
                                <button class="btn-primary" style="padding:6px 14px; font-size:12px;" onclick="setSource('mangadex', document.querySelector('.chip[data-src=\\'mangadex\\']'))">
                                    Chuyển sang MangaDex
                                </button>
                                <button class="btn-primary" style="padding:6px 14px; font-size:12px; background:var(--surface1); border:1px solid var(--surface2); color:var(--text);" onclick="setSource('cuutruyen', document.querySelector('.chip[data-src=\\'cuutruyen\\']'))">
                                    Chuyển sang Cứu Truyện
                                </button>
                            </div>
                        </div>
                    `;
                } else {
                    grid.innerHTML = '<p style="color:var(--red); grid-column:1/-1;">⚠️ Lỗi kết nối máy chủ: ' + (err.message || err) + '</p>';
                }
            }
        }

        async function openMangaDetail(source, mangaId, title) {
            currentMangaId = mangaId;
            currentMangaTitle = decodeURIComponent(title);
            const modal = document.getElementById('manga-modal');
            modal.style.display = 'flex';
            document.getElementById('modal-title').innerText = currentMangaTitle;
            document.getElementById('modal-chapters').innerHTML = '<li>Đang nạp danh sách chương...</li>';
            document.getElementById('modal-cover').src = '/api/proxy/image?url=';

            try {
                const res = await fetch(`/api/manga/${source}/${encodeURIComponent(mangaId)}`);
                const info = await res.json();
                
                if (info.title) currentMangaTitle = info.title;
                document.getElementById('modal-title').innerText = currentMangaTitle;
                document.getElementById('modal-author').innerText = info.authors ? info.authors.join(', ') : 'Chưa rõ';
                if (info.cover_url) {
                    document.getElementById('modal-cover').src = '/api/proxy/image?url=' + encodeURIComponent(info.cover_url);
                } else {
                    document.getElementById('modal-cover').src = '/api/proxy/image?url=';
                }
                
                document.getElementById('modal-genres').innerHTML = (info.genres || []).map(g => `<span class="genre-tag">${g}</span>`).join('');
                
                document.getElementById('modal-chapters').innerHTML = (info.chapters || []).map(ch => `
                    <li class="chapter-item" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid var(--surface0);">
                        <span style="font-size:13px; font-weight:500;">Chương ${ch.chapter_number} ${ch.title ? ' - ' + ch.title : ''}</span>
                        <div style="display:flex; gap:6px;">
                            <button class="btn-primary" style="background:var(--teal); color:var(--crust); padding:4px 10px; font-size:11px; font-weight:700; border-radius:4px;" onclick="downloadSingleChapter('${ch.id}', 'zip')" title="Tải file ZIP ảnh thô (phù hợp cho AI Cleaner / Lưu trữ)">📦 ZIP</button>
                            <button class="btn-primary" style="background:var(--lavender); color:var(--crust); padding:4px 10px; font-size:11px; font-weight:700; border-radius:4px;" onclick="downloadSingleChapter('${ch.id}', 'cbz')" title="Tải file CBZ chuẩn truyện tranh ComicInfo.xml">🟣 CBZ</button>
                        </div>
                    </li>
                `).join('');
            } catch (err) {
                document.getElementById('modal-chapters').innerHTML = '<li style="color:var(--red);">Lỗi: ' + err + '</li>';
            }
        }

        function closeModal(e) {
            document.getElementById('manga-modal').style.display = 'none';
        }

        async function submitDownload(overrideFormat) {
            const format = overrideFormat || document.getElementById('dl-format').value;
            const range = document.getElementById('dl-range').value;
            await triggerDownload({
                source: currentSource,
                manga_id: currentMangaId,
                manga_title: currentMangaTitle,
                chapters: range,
                format: format
            });
        }

        async function downloadSingleChapter(chapterId, overrideFormat) {
            const format = overrideFormat || document.getElementById('dl-format').value;
            await triggerDownload({
                source: currentSource,
                manga_id: currentMangaId,
                manga_title: currentMangaTitle,
                chapter_ids: [chapterId],
                format: format
            });
        }

        async function triggerDownload(payload) {
            try {
                const res = await fetch('/api/download', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                alert('Đã kích hoạt tải tác vụ ID: ' + data.task_id);
                closeModal();
                trackTask(data.task_id, payload.manga_title);
            } catch (err) {
                alert('Lỗi khởi tạo tải: ' + err);
            }
        }

        function trackTask(taskId, mangaTitle) {
            currentTasks[taskId] = {
                task_id: taskId,
                source: currentSource,
                manga_id: currentMangaId,
                manga_title: mangaTitle || currentMangaTitle,
                status: 'running',
                progress: { percent: 0 }
            };
            updateTasksUI();
            
            const timer = setInterval(async () => {
                try {
                    const res = await fetch('/api/download/' + taskId);
                    const task = await res.json();
                    currentTasks[taskId] = task;
                    updateTasksUI();
                    
                    if (task.status === 'completed' || task.status === 'failed') {
                        clearInterval(timer);
                    }
                } catch (_) {}
            }, 1000);
        }

        function updateTasksUI() {
            const container = document.getElementById('tasks-container');
            const tasks = Object.values(currentTasks);
            const running = tasks.filter(t => t.status === 'running' || t.status === 'pending').length;
            
            const badge = document.getElementById('dl-badge');
            if (running > 0) {
                badge.style.display = 'block';
                badge.innerText = running;
            } else {
                badge.style.display = 'none';
            }

            if (tasks.length === 0) return;
            
            container.innerHTML = tasks.reverse().map(t => {
                const isFailed = t.status === 'failed';
                const isCompleted = t.status === 'completed';
                const fillColor = isCompleted ? 'var(--teal)' : (isFailed ? 'var(--red)' : 'var(--lavender)');
                const errMsg = (t.errors && t.errors[0]) || (t.results && t.results[0] && t.results[0].error) || '';
                
                return `
                <div class="task-card">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong>${t.source?.toUpperCase() || ''} • ${t.manga_title || t.manga_id} (${t.format?.toUpperCase() || ''})</strong>
                        <span style="font-size:12px; color:${fillColor}; font-weight:700;">
                            ${t.status.toUpperCase()}
                        </span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width:${t.progress?.percent || 0}%; background:${fillColor};"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--subtext0);">
                        <span>Chương: ${t.progress?.completed_chapters || 0}/${t.progress?.total_chapters || 0}</span>
                        <span>Trang: ${t.progress?.completed_pages || 0}/${t.progress?.total_pages || 0}</span>
                        <span>${(t.progress?.percent || 0).toFixed(1)}%</span>
                    </div>
                    ${isFailed ? `<div style="font-size:11px; color:var(--red); margin-top:4px;">⚠️ ${errMsg || 'Tải thất bại hoặc bị gián đoạn máy chủ'}</div>` : ''}
                    ${isCompleted ? `
                    <div style="margin-top:10px; display:flex; justify-content:flex-end; gap:8px;">
                        <a href="/api/download/${t.task_id}/file" download class="btn-primary" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px; padding:6px 14px; font-size:12px; background:var(--teal); color:var(--crust); font-weight:700; border-radius:6px;">
                            <span>📥 Lưu file ${t.format?.toUpperCase() || 'ZIP'} về máy</span>
                        </a>
                    </div>
                    ` : ''}
                </div>
            `}).join('');
        }

        async function loadLibrary() {
            const container = document.getElementById('library-container');
            if (!container) return;
            try {
                const res = await fetch('/api/files/library');
                const data = await res.json();
                const files = data.files || [];
                if (files.length === 0) {
                    container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px; color:var(--subtext0);">Chưa có file .ZIP hoặc .CBZ nào trong thư viện tải về. Hãy chọn truyện và tải về định dạng ZIP hoặc CBZ!</div>';
                    return;
                }
                container.innerHTML = files.map(f => {
                    const isZip = f.format === 'zip';
                    const badgeColor = isZip ? 'var(--teal)' : 'var(--lavender)';
                    const badgeText = isZip ? '📦 ZIP (Ảnh thô)' : '🟣 CBZ (ComicInfo)';
                    return `
                    <div class="task-card" style="margin-bottom:0; display:flex; flex-direction:column; justify-content:space-between; gap:10px;">
                        <div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                <span style="font-size:10px; font-weight:700; background:${badgeColor}; color:var(--crust); padding:2px 8px; border-radius:10px;">${badgeText}</span>
                                <span style="font-size:11px; color:var(--subtext0); font-weight:600;">${f.size_mb} MB</span>
                            </div>
                            <strong style="font-size:13px; color:var(--text); display:block; margin-bottom:4px; word-break:break-word;">${f.name}</strong>
                            <div style="font-size:11px; color:var(--subtext0);">Bộ: ${f.manga}</div>
                        </div>
                        <div style="display:flex; justify-content:flex-end;">
                            <a href="/api/files/download?path=${encodeURIComponent(f.path)}" download class="btn-primary" style="text-decoration:none; display:inline-flex; align-items:center; gap:6px; padding:6px 12px; font-size:11px; background:${badgeColor}; color:var(--crust); font-weight:700; border-radius:6px;">
                                <span>📥 Lưu về máy</span>
                            </a>
                        </div>
                    </div>
                    `;
                }).join('');
            } catch (err) {
                container.innerHTML = '<div style="color:var(--red);">Lỗi nạp thư viện: ' + err + '</div>';
            }
        }

        // Tự động nạp danh mục nguồn và tìm kiếm mẫu khi mở trang
        window.onload = () => {
            loadAllSourcesCatalog();
            executeSearch();
        };
    </script>
</body>
</html>
"""
