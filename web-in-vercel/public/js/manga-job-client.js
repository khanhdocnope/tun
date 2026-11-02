/**
 * manga-job-client.js - Client điều phối Async Batch Jobs & Realtime SSE Stream.
 * Giúp người dùng xử lý cả chapter 30-100 trang mà không bao giờ bị nghẽn hay timeout.
 */

export class MangaJobClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || "";
    this.backendUrl = options.backendUrl || "";
    this.activeEventSource = null;
    this.activePollTimer = null;
  }

  /**
   * Tạo một Batch Job mới trên Backend
   * @param {Array<Object>} pages - Danh sách [{ page_id, imageBase64, imageUrl, options }]
   * @param {Object} [defaultOptions] - Tuỳ chọn mặc định cho toàn bộ trang
   * @returns {Promise<Object>} Job summary { job_id, status, total_pages, ... }
   */
  async createJob(pages, defaultOptions = {}) {
    if (!Array.isArray(pages) || pages.length === 0) {
      throw new Error("Danh sách trang không được rỗng.");
    }

    const headers = { "Content-Type": "application/json" };
    if (this.backendUrl) {
      headers["x-backend-url"] = this.backendUrl;
    }

    const resp = await fetch(`${this.baseUrl}/api/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        pages,
        defaultOptions,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Lỗi tạo Job (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    return data.job;
  }

  /**
   * Lấy snapshot trạng thái hiện tại của Job
   * @param {string} jobId
   * @returns {Promise<Object>}
   */
  async getJobStatus(jobId) {
    const headers = {};
    if (this.backendUrl) headers["x-backend-url"] = this.backendUrl;

    const resp = await fetch(`${this.baseUrl}/api/jobs?id=${encodeURIComponent(jobId)}`, { headers });
    if (!resp.ok) {
      throw new Error(`Lỗi kiểm tra tiến độ Job (${resp.status})`);
    }
    const data = await resp.json();
    return data.job;
  }

  /**
   * Hủy bỏ tác vụ đang xử lý
   * @param {string} jobId
   */
  async cancelJob(jobId) {
    this.stopListening();
    const headers = {};
    if (this.backendUrl) headers["x-backend-url"] = this.backendUrl;

    await fetch(`${this.baseUrl}/api/jobs?id=${encodeURIComponent(jobId)}&action=cancel`, {
      method: "POST",
      headers,
    });
  }

  /**
   * Kết nối luồng Server-Sent Events (SSE) theo thời gian thực
   * Tự động fallback sang polling nếu trình duyệt bị ngắt kết nối.
   */
  listenJob(jobId, callbacks = {}) {
    this.stopListening();

    const {
      onInit = () => {},
      onPageProcessing = () => {},
      onPageDone = () => {},
      onPageError = () => {},
      onCompleted = () => {},
      onError = () => {},
    } = callbacks;

    const streamUrl = `${this.baseUrl}/api/jobs?id=${encodeURIComponent(jobId)}&stream=true`;
    let isFinished = false;

    try {
      const es = new EventSource(streamUrl);
      this.activeEventSource = es;

      es.addEventListener("init", (e) => {
        try {
          const data = JSON.parse(e.data);
          onInit(data);
        } catch (_) {}
      });

      es.addEventListener("page_processing", (e) => {
        try {
          const data = JSON.parse(e.data);
          onPageProcessing(data);
        } catch (_) {}
      });

      es.addEventListener("page_done", (e) => {
        try {
          const data = JSON.parse(e.data);
          onPageDone(data);
        } catch (_) {}
      });

      es.addEventListener("page_error", (e) => {
        try {
          const data = JSON.parse(e.data);
          onPageError(data);
        } catch (_) {}
      });

      es.addEventListener("job_completed", (e) => {
        try {
          const data = JSON.parse(e.data);
          isFinished = true;
          this.stopListening();
          onCompleted(data);
        } catch (_) {}
      });

      es.addEventListener("job_cancelled", () => {
        isFinished = true;
        this.stopListening();
      });

      es.onerror = () => {
        if (isFinished) return;
        es.close();
        this.activeEventSource = null;

        // Fallback sang Polling định kỳ mỗi 2 giây nếu SSE đứt kết nối
        console.warn("[MangaJobClient] SSE bị ngắt, chuyển sang Polling fallback...");
        this._startPollingFallback(jobId, callbacks);
      };
    } catch (err) {
      console.warn("[MangaJobClient] Không thể mở EventSource, dùng Polling fallback:", err);
      this._startPollingFallback(jobId, callbacks);
    }
  }

  _startPollingFallback(jobId, callbacks) {
    if (this.activePollTimer) clearInterval(this.activePollTimer);

    this.activePollTimer = setInterval(async () => {
      try {
        const job = await this.getJobStatus(jobId);
        if (!job) return;

        if (callbacks.onProgress) callbacks.onProgress(job);

        if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
          clearInterval(this.activePollTimer);
          this.activePollTimer = null;
          if (callbacks.onCompleted) callbacks.onCompleted(job);
        }
      } catch (e) {
        if (callbacks.onError) callbacks.onError(e);
      }
    }, 2000);
  }

  stopListening() {
    if (this.activeEventSource) {
      this.activeEventSource.close();
      this.activeEventSource = null;
    }
    if (this.activePollTimer) {
      clearInterval(this.activePollTimer);
      this.activePollTimer = null;
    }
  }
}
