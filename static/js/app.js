/**
 * Intern-AI Studio - Minimalist & Beautiful Chat Application
 * Quản lý model_list.txt và kết nối 2 giao thức (OpenAI & Native)
 */

document.addEventListener("DOMContentLoaded", () => {
    // ==========================================
    // STATE
    // ==========================================
    const state = {
        models: [],
        currentModelId: "deepseek-v4-flash-0731",
        protocol: "openai", // 'openai' hoặc 'native'
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: "",
        attachedImageBase64: null,
        isStreaming: false,
        abortController: null,
        sessions: [],
        currentSessionId: null,
    };

    // ==========================================
    // DOM ELEMENTS
    // ==========================================
    const el = {
        sidebar: document.getElementById("sidebar"),
        btnToggleSidebar: document.getElementById("btn-toggle-sidebar"),
        connectionStatusText: document.getElementById("connection-status-text"),
        btnNewChat: document.getElementById("btn-new-chat"),
        
        // Active model display
        activeModelCard: document.getElementById("active-model-card"),
        currentModelName: document.getElementById("current-model-name"),
        currentModelId: document.getElementById("current-model-id"),
        currentModelTags: document.getElementById("current-model-tags"),
        topbarModelDisplay: document.getElementById("topbar-model-display"),
        topbarProtocolBadge: document.getElementById("topbar-protocol-badge"),
        topbarCtxBadge: document.getElementById("topbar-ctx-badge"),
        footerModelLabel: document.getElementById("footer-model-label"),
        footerProtocolLabel: document.getElementById("footer-protocol-label"),
        
        // Protocols
        tabOpenai: document.getElementById("tab-openai"),
        tabNative: document.getElementById("tab-native"),
        
        // Parameters
        paramTemp: document.getElementById("param-temp"),
        valTemp: document.getElementById("val-temp"),
        paramTokens: document.getElementById("param-tokens"),
        valTokens: document.getElementById("val-tokens"),
        paramSystem: document.getElementById("param-system"),
        
        // History
        historyList: document.getElementById("history-list"),
        btnClearHistory: document.getElementById("btn-clear-history"),
        
        // Chat Area
        messagesContainer: document.getElementById("messages-container"),
        welcomeScreen: document.getElementById("welcome-screen"),
        chatThread: document.getElementById("chat-thread"),
        btnClearChat: document.getElementById("btn-clear-chat"),
        btnExportChat: document.getElementById("btn-export-chat"),
        
        // Input
        chatTextarea: document.getElementById("chat-textarea"),
        btnSend: document.getElementById("btn-send"),
        btnStop: document.getElementById("btn-stop"),
        btnAttachImage: document.getElementById("btn-attach-image"),
        fileInputImage: document.getElementById("file-input-image"),
        imagePreviewBar: document.getElementById("image-preview-bar"),
        previewImg: document.getElementById("preview-img"),
        btnRemoveImage: document.getElementById("btn-remove-image"),
        
        // Modal
        modalManage: document.getElementById("modal-manage"),
        btnCloseModal: document.getElementById("btn-close-modal"),
        btnOpenModelModal: document.getElementById("btn-open-model-modal"),
        btnOpenManageModal: document.getElementById("btn-open-manage-modal"),
        tabModalCards: document.getElementById("tab-modal-cards"),
        tabModalRaw: document.getElementById("tab-modal-raw"),
        contentModalCards: document.getElementById("content-modal-cards"),
        contentModalRaw: document.getElementById("content-modal-raw"),
        modalModelCount: document.getElementById("modal-model-count"),
        modelsGrid: document.getElementById("models-grid"),
        modelSearchInput: document.getElementById("model-search-input"),
        rawModelTextarea: document.getElementById("raw-model-textarea"),
        btnSaveRaw: document.getElementById("btn-save-raw"),
        rawSaveMsg: document.getElementById("raw-save-msg"),
    };

    // ==========================================
    // MARKED & HIGHLIGHT SETUP
    // ==========================================
    if (window.marked) {
        const renderer = new marked.Renderer();
        renderer.code = function (tokenOrCode, infoString) {
            let code = "";
            let language = "plaintext";

            if (typeof tokenOrCode === "object" && tokenOrCode !== null) {
                code = tokenOrCode.text || tokenOrCode.raw || "";
                language = tokenOrCode.lang || infoString || "plaintext";
            } else {
                code = tokenOrCode || "";
                language = infoString || "plaintext";
            }

            language = (language || "plaintext").trim().split(/\s+/)[0];

            let highlighted = "";
            if (window.hljs && hljs.getLanguage(language)) {
                try {
                    highlighted = hljs.highlight(code, { language }).value;
                } catch (_) {
                    highlighted = escapeHtml(code);
                }
            } else if (window.hljs) {
                try {
                    highlighted = hljs.highlightAuto(code).value;
                } catch (_) {
                    highlighted = escapeHtml(code);
                }
            } else {
                highlighted = escapeHtml(code);
            }

            return `
                <div class="code-block-wrapper">
                    <div class="code-header">
                        <span>${escapeHtml(language)}</span>
                        <button class="btn-copy-code" onclick="copyCodeBlock(this)">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            <span>Sao chép</span>
                        </button>
                    </div>
                    <pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>
                </div>
            `;
        };
        marked.setOptions({
            renderer: renderer,
            gfm: true,
            breaks: true,
        });
    }

    // Helper: Escape HTML
    function escapeHtml(str) {
        return (str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Helper: Copy code block
    window.copyCodeBlock = function (btn) {
        const pre = btn.closest(".code-block-wrapper").querySelector("pre code");
        if (pre) {
            navigator.clipboard.writeText(pre.innerText).then(() => {
                const span = btn.querySelector("span");
                const oldText = span.innerText;
                span.innerText = "Đã chép ✓";
                setTimeout(() => { span.innerText = oldText; }, 1800);
            });
        }
    };

    // Helper: Copy message
    window.copyMessageText = function (btn) {
        const bubble = btn.closest(".message-content-wrapper").querySelector(".bubble-ai");
        if (bubble) {
            // Lấy text ngoại trừ reasoning
            const clone = bubble.cloneNode(true);
            const reasoning = clone.querySelector(".reasoning-box");
            if (reasoning) reasoning.remove();
            navigator.clipboard.writeText(clone.innerText.trim()).then(() => {
                const old = btn.innerText;
                btn.innerText = "Đã sao chép ✓";
                setTimeout(() => { btn.innerText = old; }, 1800);
            });
        }
    };

    // Helper: Toggle reasoning accordion
    window.toggleReasoning = function (header) {
        const box = header.closest(".reasoning-box");
        if (box) {
            box.classList.toggle("collapsed");
        }
    };

    // ==========================================
    // INITIALIZATION & DATA FETCHING
    // ==========================================
    async function init() {
        loadHistoryFromStorage();
        setupEventListeners();
        await fetchConfigAndModels();
        renderHistoryList();
    }

    async function fetchConfigAndModels() {
        try {
            el.connectionStatusText.innerText = "Đang kiểm tra...";
            const res = await fetch("/api/models");
            const data = await res.json();
            state.models = data.models || [];
            
            if (data.current_model) {
                state.currentModelId = data.current_model;
            }

            el.connectionStatusText.innerText = `API Sẵn sàng (${state.models.length} mô hình)`;
            el.modalModelCount.innerText = state.models.length;
            updateActiveModelUI();
            renderModelsGrid();
        } catch (err) {
            el.connectionStatusText.innerText = "Lỗi kết nối API";
            console.error("Lỗi khi tải danh sách mô hình:", err);
        }
    }

    function getActiveModel() {
        return state.models.find(m => m.id === state.currentModelId) || {
            id: state.currentModelId,
            name: state.currentModelId,
            type: "LLM",
            context: "1M",
            is_vision: false,
            has_deep_think: true,
            features: "Suy luận sâu",
        };
    }

    function updateActiveModelUI() {
        const m = getActiveModel();
        el.currentModelName.innerText = m.name;
        el.currentModelId.innerText = m.id;
        el.topbarModelDisplay.innerText = m.name;
        el.footerModelLabel.innerText = m.id;
        el.topbarCtxBadge.innerText = `${m.context || "1M"} Context`;

        // Render tags
        let tagsHtml = `<span class="badge badge-ctx">⚡ ${m.context || "1M"}</span>`;
        if (m.is_vision) {
            tagsHtml += `<span class="badge badge-vision">🖼️ Vision</span>`;
        }
        if (m.has_deep_think) {
            tagsHtml += `<span class="badge badge-think">🧠 Deep Think</span>`;
        }
        el.currentModelTags.innerHTML = tagsHtml;

        // Cập nhật giao thức hiển thị
        if (state.protocol === "openai") {
            el.topbarProtocolBadge.innerText = "OpenAI Protocol";
            el.footerProtocolLabel.innerText = "OpenAI Protocol (/v1)";
            el.tabOpenai.classList.add("active");
            el.tabNative.classList.remove("active");
        } else {
            el.topbarProtocolBadge.innerText = "Giao thức Nhân sinh";
            el.footerProtocolLabel.innerText = "Native Protocol";
            el.tabNative.classList.add("active");
            el.tabOpenai.classList.remove("active");
        }

        // Đổi trạng thái selected trong grid
        document.querySelectorAll(".model-card-item").forEach(card => {
            if (card.dataset.id === m.id) {
                card.classList.add("selected");
                card.querySelector(".btn-activate-model").innerText = "Đang kích hoạt ✓";
            } else {
                card.classList.remove("selected");
                card.querySelector(".btn-activate-model").innerText = "Kích hoạt";
            }
        });
    }

    // ==========================================
    // RENDER MODELS GRID IN MODAL
    // ==========================================
    function renderModelsGrid(filter = "all", searchQuery = "") {
        el.modelsGrid.innerHTML = "";
        const query = searchQuery.toLowerCase().trim();

        const filtered = state.models.filter(m => {
            const matchesQuery = !query || 
                m.name.toLowerCase().includes(query) || 
                m.id.toLowerCase().includes(query) || 
                m.features.toLowerCase().includes(query);

            if (!matchesQuery) return false;

            if (filter === "vision") return m.is_vision;
            if (filter === "deepseek") return m.has_deep_think;
            if (filter === "1m") return (m.context || "").includes("1M");
            return true;
        });

        if (filtered.length === 0) {
            el.modelsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px 0;">Không tìm thấy mô hình phù hợp</div>`;
            return;
        }

        filtered.forEach(m => {
            const isSelected = m.id === state.currentModelId;
            const card = document.createElement("div");
            card.className = `model-card-item ${isSelected ? "selected" : ""}`;
            card.dataset.id = m.id;

            card.innerHTML = `
                <div class="card-item-title">${escapeHtml(m.name)}</div>
                <div class="card-item-id">${escapeHtml(m.id)}</div>
                <div class="card-item-tags">
                    <span class="badge badge-ctx">⚡ ${escapeHtml(m.context || "1M")}</span>
                    ${m.is_vision ? '<span class="badge badge-vision">🖼️ Vision</span>' : ''}
                    ${m.has_deep_think ? '<span class="badge badge-think">🧠 Deep Think</span>' : ''}
                </div>
                <div class="card-item-features">${escapeHtml(m.features || "Hỗ trợ chat & lập trình")}</div>
                <button class="btn-activate-model">${isSelected ? "Đang kích hoạt ✓" : "Kích hoạt"}</button>
            `;

            card.addEventListener("click", () => {
                selectModel(m.id);
            });

            el.modelsGrid.appendChild(card);
        });
    }

    async function selectModel(modelId) {
        state.currentModelId = modelId;
        updateActiveModelUI();
        try {
            await fetch("/api/models/select", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model_id: modelId })
            });
        } catch (e) {
            console.error("Lỗi khi lưu model mặc định:", e);
        }
        // Đóng modal sau khi chọn
        el.modalManage.classList.remove("open");
    }

    // ==========================================
    // CHAT MANAGEMENT & SESSIONS
    // ==========================================
    function createNewSession() {
        const session = {
            id: "chat_" + Date.now(),
            title: "Đoạn chat mới",
            timestamp: Date.now(),
            messages: []
        };
        state.sessions.unshift(session);
        state.currentSessionId = session.id;
        saveHistoryToStorage();
        renderHistoryList();
        renderCurrentChat();
    }

    function getCurrentSession() {
        if (!state.currentSessionId && state.sessions.length > 0) {
            state.currentSessionId = state.sessions[0].id;
        }
        return state.sessions.find(s => s.id === state.currentSessionId);
    }

    function renderCurrentChat() {
        const session = getCurrentSession();
        el.chatThread.innerHTML = "";
        
        if (!session || session.messages.length === 0) {
            el.welcomeScreen.style.display = "flex";
            return;
        }

        el.welcomeScreen.style.display = "none";
        session.messages.forEach(msg => {
            appendMessageToUI(msg);
        });
        scrollToBottom();
    }

    function appendMessageToUI(msg) {
        const isUser = msg.role === "user";
        const row = document.createElement("div");
        row.className = `message-row ${isUser ? "user" : "ai"}`;

        if (!isUser) {
            // Avatar AI
            row.innerHTML = `<div class="message-avatar avatar-ai">AI</div>`;
        }

        const contentWrapper = document.createElement("div");
        contentWrapper.className = "message-content-wrapper";

        if (isUser) {
            let imgHtml = "";
            if (msg.image) {
                imgHtml = `<img src="${msg.image}" class="user-attached-img" alt="Ảnh tải lên">`;
            }
            contentWrapper.innerHTML = `
                ${imgHtml}
                <div class="bubble-user">${escapeHtml(msg.content)}</div>
            `;
        } else {
            let reasoningHtml = "";
            if (msg.reasoning) {
                reasoningHtml = `
                    <div class="reasoning-box collapsed">
                        <div class="reasoning-header" onclick="toggleReasoning(this)">
                            <div class="reasoning-title">
                                <span>💭 Quá trình suy luận (Reasoning)</span>
                            </div>
                            <span class="reasoning-arrow">▼</span>
                        </div>
                        <div class="reasoning-body">${escapeHtml(msg.reasoning)}</div>
                    </div>
                `;
            }

            const markdownHtml = window.marked ? marked.parse(msg.content || "") : escapeHtml(msg.content);
            contentWrapper.innerHTML = `
                <div class="bubble-ai">
                    ${reasoningHtml}
                    <div class="ai-body-content">${markdownHtml}</div>
                </div>
                <div class="message-footer">
                    <span>${msg.model || state.currentModelId}</span> • 
                    <button class="btn-copy-msg" onclick="copyMessageText(this)">Sao chép</button>
                </div>
            `;
        }

        row.appendChild(contentWrapper);

        if (isUser) {
            // Avatar User
            const userAvatar = document.createElement("div");
            userAvatar.className = "message-avatar avatar-user";
            userAvatar.innerText = "Tôi";
            row.appendChild(userAvatar);
        }

        el.chatThread.appendChild(row);
    }

    function scrollToBottom() {
        el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
    }

    // ==========================================
    // SEND MESSAGE WITH SSE STREAMING
    // ==========================================
    async function sendMessage() {
        const text = el.chatTextarea.value.trim();
        const image = state.attachedImageBase64;
        
        if ((!text && !image) || state.isStreaming) return;

        let session = getCurrentSession();
        if (!session) {
            createNewSession();
            session = getCurrentSession();
        }

        // Ẩn welcome screen
        el.welcomeScreen.style.display = "none";

        // Thêm tin nhắn của User
        const userMsg = {
            role: "user",
            content: text,
            image: image,
        };
        session.messages.push(userMsg);
        appendMessageToUI(userMsg);

        // Đặt tiêu đề session nếu là tin nhắn đầu tiên
        if (session.messages.length === 1) {
            session.title = text ? (text.length > 28 ? text.slice(0, 28) + "..." : text) : "Hình ảnh đính kèm";
            renderHistoryList();
        }

        // Reset input
        el.chatTextarea.value = "";
        el.chatTextarea.style.height = "auto";
        removeAttachedImage();
        scrollToBottom();

        // Tạo khung tin nhắn AI dạng streaming
        const aiMsg = {
            role: "assistant",
            content: "",
            reasoning: "",
            model: state.currentModelId,
        };
        session.messages.push(aiMsg);

        // Render AI Message Skeleton
        const row = document.createElement("div");
        row.className = "message-row ai";
        row.innerHTML = `<div class="message-avatar avatar-ai">AI</div>`;

        const contentWrapper = document.createElement("div");
        contentWrapper.className = "message-content-wrapper";
        
        const bubbleAi = document.createElement("div");
        bubbleAi.className = "bubble-ai";

        // Khung reasoning nếu model suy luận
        const reasoningBox = document.createElement("div");
        reasoningBox.className = "reasoning-box";
        reasoningBox.style.display = "none";
        reasoningBox.innerHTML = `
            <div class="reasoning-header" onclick="toggleReasoning(this)">
                <div class="reasoning-title">
                    <span class="reasoning-spinner"></span>
                    <span>Đang suy luận (Thinking)...</span>
                </div>
                <span class="reasoning-arrow">▼</span>
            </div>
            <div class="reasoning-body"></div>
        `;

        const bodyContent = document.createElement("div");
        bodyContent.className = "ai-body-content";
        bodyContent.innerHTML = `<span style="color: var(--text-muted);">Đang chờ phản hồi từ mô hình...</span>`;

        bubbleAi.appendChild(reasoningBox);
        bubbleAi.appendChild(bodyContent);

        const footer = document.createElement("div");
        footer.className = "message-footer";
        footer.innerHTML = `
            <span>${state.currentModelId}</span> • 
            <button class="btn-copy-msg" onclick="copyMessageText(this)">Sao chép</button>
        `;

        contentWrapper.appendChild(bubbleAi);
        contentWrapper.appendChild(footer);
        row.appendChild(contentWrapper);
        el.chatThread.appendChild(row);
        scrollToBottom();

        // Chuẩn bị payload tin nhắn gửi lên API
        const apiMessages = [];
        if (state.systemPrompt.trim()) {
            apiMessages.push({ role: "system", content: state.systemPrompt.trim() });
        }

        session.messages.slice(0, -1).forEach(m => {
            if (m.role === "user") {
                if (m.image) {
                    apiMessages.push({
                        role: "user",
                        content: [
                            { type: "text", text: m.content || "Hãy phân tích hình ảnh này." },
                            { type: "image_url", image_url: { url: m.image } }
                        ]
                    });
                } else {
                    apiMessages.push({ role: "user", content: m.content });
                }
            } else if (m.role === "assistant") {
                apiMessages.push({ role: "assistant", content: m.content });
            }
        });

        // Bắt đầu streaming
        state.isStreaming = true;
        el.btnSend.style.display = "none";
        el.btnStop.style.display = "flex";
        state.abortController = new AbortController();

        let accumulatedReasoning = "";
        let accumulatedContent = "";
        let hasStartedContent = false;

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: apiMessages,
                    model: state.currentModelId,
                    protocol: state.protocol,
                    temperature: state.temperature,
                    max_tokens: state.maxTokens,
                }),
                signal: state.abortController.signal
            });

            if (!response.ok) {
                const errJson = await response.json();
                throw new Error(errJson.error || `HTTP ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n\n");
                buffer = lines.pop(); // giữ lại phần chưa đủ 2 dấu newline

                for (const block of lines) {
                    if (!block.trim()) continue;
                    const line = block.trim();
                    if (line.startsWith("data: ")) {
                        const jsonStr = line.slice(6).trim();
                        if (jsonStr === "[DONE]") break;
                        try {
                            const data = JSON.parse(jsonStr);
                            if (data.error) {
                                throw new Error(data.error);
                            }
                            if (data.reasoning) {
                                accumulatedReasoning += data.reasoning;
                                reasoningBox.style.display = "block";
                                reasoningBox.querySelector(".reasoning-body").innerText = accumulatedReasoning;
                                scrollToBottom();
                            }
                            if (data.content) {
                                if (!hasStartedContent) {
                                    hasStartedContent = true;
                                    bodyContent.innerHTML = "";
                                    // Thu gọn reasoning khi bắt đầu có content chính
                                    reasoningBox.classList.add("collapsed");
                                    reasoningBox.querySelector(".reasoning-title span:last-child").innerText = "Quá trình suy luận (Reasoning)";
                                    const spinner = reasoningBox.querySelector(".reasoning-spinner");
                                    if (spinner) spinner.style.display = "none";
                                }
                                accumulatedContent += data.content;
                                bodyContent.innerHTML = window.marked ? marked.parse(accumulatedContent) : escapeHtml(accumulatedContent);
                                scrollToBottom();
                            }
                        } catch (parseErr) {
                            console.warn("Parse stream chunk error:", parseErr);
                        }
                    }
                }
            }

            // Kết thúc thành công
            aiMsg.content = accumulatedContent;
            aiMsg.reasoning = accumulatedReasoning;
            saveHistoryToStorage();

        } catch (err) {
            if (err.name === "AbortError") {
                bodyContent.innerHTML += `<div style="color: var(--accent-amber); font-size: 12px; margin-top: 8px;">[Đã dừng tạo phản hồi]</div>`;
            } else {
                bodyContent.innerHTML = `<div style="color: #ef4444; font-size: 13px; font-weight: 600;">⚠️ Lỗi: ${escapeHtml(err.message)}</div>`;
            }
            aiMsg.content = accumulatedContent || "[Không có phản hồi]";
            saveHistoryToStorage();
        } finally {
            state.isStreaming = false;
            state.abortController = null;
            el.btnSend.style.display = "flex";
            el.btnStop.style.display = "none";
        }
    }

    function stopStreaming() {
        if (state.abortController) {
            state.abortController.abort();
        }
    }

    // ==========================================
    // IMAGE ATTACHMENT
    // ==========================================
    function handleImageSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            alert("Vui lòng chọn file hình ảnh hợp lệ (PNG, JPEG, WebP)!");
            return;
        }

        const reader = new FileReader();
        reader.onload = function (event) {
            state.attachedImageBase64 = event.target.result;
            el.previewImg.src = state.attachedImageBase64;
            el.imagePreviewBar.style.display = "flex";
        };
        reader.readAsDataURL(file);
    }

    function removeAttachedImage() {
        state.attachedImageBase64 = null;
        el.fileInputImage.value = "";
        el.imagePreviewBar.style.display = "none";
        el.previewImg.src = "";
    }

    // ==========================================
    // HISTORY LOCALSTORAGE
    // ==========================================
    function loadHistoryFromStorage() {
        try {
            const saved = localStorage.getItem("intern_ai_sessions");
            if (saved) {
                state.sessions = JSON.parse(saved);
            }
        } catch (_) {
            state.sessions = [];
        }

        if (state.sessions.length === 0) {
            createNewSession();
        } else {
            state.currentSessionId = state.sessions[0].id;
            renderCurrentChat();
        }
    }

    function saveHistoryToStorage() {
        try {
            localStorage.setItem("intern_ai_sessions", JSON.stringify(state.sessions));
        } catch (_) {}
    }

    function renderHistoryList() {
        el.historyList.innerHTML = "";
        state.sessions.forEach(s => {
            const item = document.createElement("div");
            item.className = `history-item ${s.id === state.currentSessionId ? "active" : ""}`;
            item.innerHTML = `
                <span class="history-text" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</span>
                <button class="btn-del-history" title="Xóa đoạn chat">&times;</button>
            `;

            item.querySelector(".history-text").addEventListener("click", () => {
                state.currentSessionId = s.id;
                renderHistoryList();
                renderCurrentChat();
            });

            item.querySelector(".btn-del-history").addEventListener("click", (e) => {
                e.stopPropagation();
                deleteSession(s.id);
            });

            el.historyList.appendChild(item);
        });
    }

    function deleteSession(sessionId) {
        state.sessions = state.sessions.filter(s => s.id !== sessionId);
        if (state.sessions.length === 0) {
            createNewSession();
        } else if (state.currentSessionId === sessionId) {
            state.currentSessionId = state.sessions[0].id;
        }
        saveHistoryToStorage();
        renderHistoryList();
        renderCurrentChat();
    }

    // ==========================================
    // EXPORT TO MARKDOWN
    // ==========================================
    function exportChatMarkdown() {
        const session = getCurrentSession();
        if (!session || session.messages.length === 0) {
            alert("Đoạn chat chưa có nội dung để xuất!");
            return;
        }

        let md = `# ${session.title}\n`;
        md += `*Thời gian: ${new Date(session.timestamp).toLocaleString("vi-VN")}*\n\n---\n\n`;

        session.messages.forEach(msg => {
            if (msg.role === "user") {
                md += `### 👤 Người dùng:\n${msg.content}\n\n`;
            } else {
                if (msg.reasoning) {
                    md += `> **Suy luận (${msg.model || ""}):**\n> ${msg.reasoning.replace(/\n/g, "\n> ")}\n\n`;
                }
                md += `### 🤖 Trợ lý AI (${msg.model || ""}):\n${msg.content}\n\n`;
            }
            md += `---\n\n`;
        });

        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${session.title.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, "_")}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ==========================================
    // EVENT LISTENERS
    // ==========================================
    function setupEventListeners() {
        // Toggle Sidebar
        el.btnToggleSidebar.addEventListener("click", () => {
            el.sidebar.classList.toggle("open");
        });

        // New Chat
        el.btnNewChat.addEventListener("click", () => {
            createNewSession();
        });

        // Clear Current Chat
        el.btnClearChat.addEventListener("click", () => {
            if (confirm("Bạn có chắc chắn muốn xóa nội dung đoạn chat hiện tại không?")) {
                const s = getCurrentSession();
                if (s) {
                    s.messages = [];
                    saveHistoryToStorage();
                    renderCurrentChat();
                }
            }
        });

        // Clear All History
        el.btnClearHistory.addEventListener("click", () => {
            if (confirm("Bạn có chắc chắn muốn xóa toàn bộ lịch sử trò chuyện không?")) {
                state.sessions = [];
                createNewSession();
            }
        });

        // Export Chat
        el.btnExportChat.addEventListener("click", exportChatMarkdown);

        // Protocol Tabs
        el.tabOpenai.addEventListener("click", () => {
            state.protocol = "openai";
            updateActiveModelUI();
        });

        el.tabNative.addEventListener("click", () => {
            state.protocol = "native";
            updateActiveModelUI();
        });

        // Parameters Sliders
        el.paramTemp.addEventListener("input", (e) => {
            state.temperature = parseFloat(e.target.value);
            el.valTemp.innerText = state.temperature;
        });

        el.paramTokens.addEventListener("input", (e) => {
            state.maxTokens = parseInt(e.target.value);
            el.valTokens.innerText = state.maxTokens;
        });

        el.paramSystem.addEventListener("input", (e) => {
            state.systemPrompt = e.target.value;
        });

        // Textarea Auto-expand & Keybinds
        el.chatTextarea.addEventListener("input", () => {
            el.chatTextarea.style.height = "auto";
            el.chatTextarea.style.height = Math.min(el.chatTextarea.scrollHeight, 180) + "px";
        });

        el.chatTextarea.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Send & Stop Buttons
        el.btnSend.addEventListener("click", sendMessage);
        el.btnStop.addEventListener("click", stopStreaming);

        // Attach Image
        el.btnAttachImage.addEventListener("click", () => {
            el.fileInputImage.click();
        });
        el.fileInputImage.addEventListener("change", handleImageSelect);
        el.btnRemoveImage.addEventListener("click", removeAttachedImage);

        // Quick Prompts
        document.querySelectorAll(".quick-prompt-card").forEach(card => {
            card.addEventListener("click", () => {
                const p = card.dataset.prompt;
                if (p) {
                    el.chatTextarea.value = p;
                    sendMessage();
                }
            });
        });

        // Open Modal
        const openModal = () => {
            el.modalManage.classList.add("open");
            loadRawModelList();
        };

        el.activeModelCard.addEventListener("click", openModal);
        el.btnOpenModelModal.addEventListener("click", (e) => {
            e.stopPropagation();
            openModal();
        });
        el.btnOpenManageModal.addEventListener("click", openModal);

        // Close Modal
        el.btnCloseModal.addEventListener("click", () => {
            el.modalManage.classList.remove("open");
        });
        el.modalManage.addEventListener("click", (e) => {
            if (e.target === el.modalManage) {
                el.modalManage.classList.remove("open");
            }
        });

        // Modal Tabs
        el.tabModalCards.addEventListener("click", () => {
            el.tabModalCards.classList.add("active");
            el.tabModalRaw.classList.remove("active");
            el.contentModalCards.classList.add("active");
            el.contentModalRaw.classList.remove("active");
        });

        el.tabModalRaw.addEventListener("click", () => {
            el.tabModalRaw.classList.add("active");
            el.tabModalCards.classList.remove("active");
            el.contentModalRaw.classList.add("active");
            el.contentModalCards.classList.remove("active");
            loadRawModelList();
        });

        // Modal Search & Filter Chips
        el.modelSearchInput.addEventListener("input", (e) => {
            const activeFilter = document.querySelector(".chip.active")?.dataset.filter || "all";
            renderModelsGrid(activeFilter, e.target.value);
        });

        document.querySelectorAll(".chip").forEach(chip => {
            chip.addEventListener("click", () => {
                document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
                chip.classList.add("active");
                renderModelsGrid(chip.dataset.filter, el.modelSearchInput.value);
            });
        });

        // Raw Editor Save
        el.btnSaveRaw.addEventListener("click", saveRawModelList);
    }

    // ==========================================
    // RAW MODEL LIST EDITING
    // ==========================================
    async function loadRawModelList() {
        try {
            const res = await fetch("/api/models/raw");
            const data = await res.json();
            el.rawModelTextarea.value = data.content || "";
        } catch (e) {
            console.error("Lỗi khi tải file model_list.txt thô:", e);
        }
    }

    async function saveRawModelList() {
        const content = el.rawModelTextarea.value;
        el.btnSaveRaw.disabled = true;
        el.rawSaveMsg.className = "save-status-msg";
        el.rawSaveMsg.innerText = "Đang lưu...";

        try {
            const res = await fetch("/api/models/raw", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content })
            });
            const data = await res.json();
            if (data.success) {
                el.rawSaveMsg.className = "save-status-msg success";
                el.rawSaveMsg.innerText = data.message;
                state.models = data.models || [];
                el.modalModelCount.innerText = state.models.length;
                updateActiveModelUI();
                renderModelsGrid();
            } else {
                el.rawSaveMsg.className = "save-status-msg error";
                el.rawSaveMsg.innerText = "Lỗi: " + (data.error || "Không thể lưu");
            }
        } catch (e) {
            el.rawSaveMsg.className = "save-status-msg error";
            el.rawSaveMsg.innerText = "Lỗi kết nối: " + e.message;
        } finally {
            el.btnSaveRaw.disabled = false;
            setTimeout(() => { el.rawSaveMsg.innerText = ""; }, 4000);
        }
    }

    // Khởi chạy
    init();
});
