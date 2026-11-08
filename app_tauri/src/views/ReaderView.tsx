import React, { useEffect, useState, useRef } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Settings,
  Loader2,
  BookOpen,
  Layers,
  Sparkles,
} from 'lucide-react';
import { ChapterItem, LibraryBook, PageItem } from '../types';
import { invoke } from '@tauri-apps/api/core';

interface ReaderViewProps {
  onlineChapter?: ChapterItem;
  offlineBook?: LibraryBook;
  onClose: () => void;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  onlineChapter,
  offlineBook,
  onClose,
}) => {
  const [mode, setMode] = useState<'webtoon' | 'manga'>('webtoon');
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Online pages
  const [pages, setPages] = useState<PageItem[]>([]);
  // Offline pages
  const [offlinePageData, setOfflinePageData] = useState<string | null>(null);
  const totalPages = offlineBook ? offlineBook.total_pages : pages.length;

  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (onlineChapter) {
      loadOnlinePages();
    } else if (offlineBook) {
      loadOfflinePage(0);
    }
  }, [onlineChapter, offlineBook]);

  // Auto-hide controls after 4 seconds of inactivity
  useEffect(() => {
    if (showControls) {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => {
        setShowControls(false);
      }, 4000);
    }
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [showControls]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        handleNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        handlePrevPage();
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        setMode((prev) => (prev === 'webtoon' ? 'manga' : 'webtoon'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPage, totalPages, isFullscreen, mode]);

  const loadOnlinePages = async () => {
    if (!onlineChapter) return;
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<PageItem[]>('get_chapter_pages', {
        source: onlineChapter.source,
        chapterId: onlineChapter.id,
      });
      setPages(data);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Lỗi khi tải trang truyện');
    } finally {
      setLoading(false);
    }
  };

  const loadOfflinePage = async (pageIndex: number) => {
    if (!offlineBook) return;
    setLoading(true);
    try {
      const b64 = await invoke<string>('get_page_image_base64', {
        archivePath: offlineBook.file_path,
        pageIndex,
      });
      setOfflinePageData(b64);
      setCurrentPage(pageIndex);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Lỗi khi đọc trang sách');
    } finally {
      setLoading(false);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages - 1) {
      if (offlineBook) {
        loadOfflinePage(currentPage + 1);
      } else {
        setCurrentPage((prev) => prev + 1);
      }
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 0) {
      if (offlineBook) {
        loadOfflinePage(currentPage - 1);
      } else {
        setCurrentPage((prev) => prev - 1);
      }
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleCenterClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;

    if (mode === 'manga') {
      if (x < width * 0.25) {
        handlePrevPage();
      } else if (x > width * 0.75) {
        handleNextPage();
      } else {
        setShowControls((prev) => !prev);
      }
    } else {
      setShowControls((prev) => !prev);
    }
  };

  const title = onlineChapter
    ? onlineChapter.title
    : offlineBook
    ? `${offlineBook.manga_title} - ${offlineBook.chapter_title}`
    : 'Đang đọc';

  return (
    <div className="fixed inset-0 z-50 bg-[#000000] flex flex-col overflow-hidden select-none">
      {/* Top Floating Glassmorphic App Bar */}
      <div
        className={`absolute top-0 left-0 right-0 z-40 bg-[#0a0b12]/90 backdrop-blur-2xl border-b border-white/[0.08] p-3 sm:p-4 flex items-center justify-between transition-transform duration-300 ${
          showControls ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <button
            onClick={onClose}
            className="p-2.5 rounded-2xl bg-white/[0.06] text-white hover:bg-white/[0.12] transition-all cursor-pointer active:scale-95 shrink-0 border border-white/[0.08]"
            title="Đóng trình đọc (Esc)"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="overflow-hidden">
            <h2 className="text-xs sm:text-sm font-bold text-white truncate">{title}</h2>
            <p className="text-[11px] text-slate-400">
              {mode === 'webtoon' ? 'Cuộn dọc Webtoon' : 'Lật trang Manga'} • {totalPages} trang
            </p>
          </div>
        </div>

        {/* View Mode & Fullscreen Controls */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex bg-white/[0.05] p-1 rounded-2xl border border-white/[0.08] text-xs font-semibold">
            <button
              onClick={() => setMode('webtoon')}
              className={`px-3 py-1 rounded-xl transition-all cursor-pointer ${
                mode === 'webtoon'
                  ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white font-bold shadow-md shadow-violet-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Webtoon
            </button>
            <button
              onClick={() => setMode('manga')}
              className={`px-3 py-1 rounded-xl transition-all cursor-pointer ${
                mode === 'manga'
                  ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white font-bold shadow-md shadow-violet-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Manga
            </button>
          </div>

          <button
            onClick={toggleFullscreen}
            className="p-2.5 rounded-2xl bg-white/[0.06] text-slate-300 hover:text-white transition-all cursor-pointer hidden sm:flex border border-white/[0.08]"
            title="Toàn màn hình (F)"
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>

      {/* Main Reader Viewport */}
      <div
        onClick={handleCenterClick}
        className="flex-1 w-full h-full overflow-y-auto flex items-center justify-center relative cursor-default"
      >
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 z-20 text-slate-400">
            <Loader2 size={40} className="animate-spin text-violet-500" />
            <p className="text-xs font-medium">Đang nạp ảnh sắc nét...</p>
          </div>
        )}

        {error && (
          <div className="p-8 text-center text-rose-400 text-sm max-w-md z-30">
            <p className="mb-4">{error}</p>
            <button
              onClick={onlineChapter ? loadOnlinePages : () => loadOfflinePage(currentPage)}
              className="px-5 py-2.5 bg-violet-600 text-white rounded-2xl text-xs font-bold cursor-pointer hover:bg-violet-500 transition-colors shadow-lg shadow-violet-600/30"
            >
              Thử tải lại
            </button>
          </div>
        )}

        {/* WEBTOON MODE (Continuous Vertical Scroll) */}
        {!loading && !error && mode === 'webtoon' && (
          <div className="w-full h-full overflow-y-auto flex flex-col items-center py-16 px-0 sm:px-4">
            {onlineChapter &&
              pages.map((p, idx) => (
                <div key={idx} className="w-full max-w-3xl my-0 relative">
                  <img
                    src={p.url}
                    alt={`Trang ${idx + 1}`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-auto block select-none pointer-events-none"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
              ))}

            {offlineBook && offlinePageData && (
              <div className="w-full max-w-3xl my-0">
                <img
                  src={`data:image/webp;base64,${offlinePageData}`}
                  alt={`Trang ${currentPage + 1}`}
                  className="w-full h-auto block select-none pointer-events-none"
                />
              </div>
            )}
          </div>
        )}

        {/* MANGA MODE (Single Page Flip) */}
        {!loading && !error && mode === 'manga' && (
          <div className="relative w-full h-full flex items-center justify-center p-2 sm:p-6">
            {/* Visual Tap Zone Indicators */}
            <div className="absolute left-0 top-0 bottom-0 w-1/4 z-10 cursor-w-resize" title="Chạm để lùi trang" />
            <div className="absolute right-0 top-0 bottom-0 w-1/4 z-10 cursor-e-resize" title="Chạm để sang trang" />

            {onlineChapter && pages[currentPage] && (
              <img
                src={pages[currentPage].url}
                alt={`Trang ${currentPage + 1}`}
                referrerPolicy="no-referrer"
                className="max-h-full max-w-full object-contain select-none pointer-events-none shadow-2xl rounded-lg"
              />
            )}

            {offlineBook && offlinePageData && (
              <img
                src={`data:image/webp;base64,${offlinePageData}`}
                alt={`Trang ${currentPage + 1}`}
                className="max-h-full max-w-full object-contain select-none pointer-events-none shadow-2xl rounded-lg"
              />
            )}
          </div>
        )}
      </div>

      {/* Bottom Floating Scrubber */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-40 bg-[#0a0b12]/90 backdrop-blur-2xl border-t border-white/[0.08] p-3 sm:p-4 flex items-center justify-between gap-4 transition-transform duration-300 ${
          showControls ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <button
          onClick={handlePrevPage}
          disabled={currentPage === 0}
          className="p-2.5 rounded-2xl bg-white/[0.05] text-white hover:bg-violet-600 transition-all disabled:opacity-20 cursor-pointer active:scale-95 border border-white/[0.08]"
          title="Trang trước"
        >
          <ChevronLeft size={20} />
        </button>

        {/* Scrubber slider & Page Counter */}
        <div className="flex-1 max-w-lg flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={totalPages > 0 ? totalPages - 1 : 0}
            value={currentPage}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (offlineBook) {
                loadOfflinePage(val);
              } else {
                setCurrentPage(val);
              }
            }}
            className="w-full accent-violet-500 cursor-pointer h-1.5 bg-white/10 rounded-lg"
          />
          <span className="text-xs font-mono font-bold text-violet-400 shrink-0 min-w-[70px] text-center">
            {totalPages > 0 ? `${currentPage + 1} / ${totalPages}` : '0 / 0'}
          </span>
        </div>

        <button
          onClick={handleNextPage}
          disabled={currentPage >= totalPages - 1}
          className="p-2.5 rounded-2xl bg-white/[0.05] text-white hover:bg-violet-600 transition-all disabled:opacity-20 cursor-pointer active:scale-95 border border-white/[0.08]"
          title="Trang tiếp theo"
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
};
