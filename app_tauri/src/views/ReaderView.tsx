import React, { useEffect, useState, useRef } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize, Minimize, Settings, Loader2, BookOpen, Layers } from 'lucide-react';
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

  useEffect(() => {
    if (onlineChapter) {
      loadOnlinePages();
    } else if (offlineBook) {
      loadOfflinePage(0);
    }
  }, [onlineChapter, offlineBook]);

  // Keyboard navigation
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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPage, totalPages, isFullscreen]);

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

  // Center tap zone toggle
  const handleScreenClick = (e: React.MouseEvent<HTMLDivElement>) => {
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
      // In webtoon mode, tap toggles controls
      setShowControls((prev) => !prev);
    }
  };

  const title = onlineChapter ? onlineChapter.title : offlineBook ? offlineBook.title : 'Đang đọc';

  return (
    <div className="fixed inset-0 z-50 bg-[#11111b] flex flex-col overflow-hidden select-none">
      {/* Top Floating App Bar */}
      <div
        className={`absolute top-0 left-0 right-0 z-40 bg-[#181825]/95 backdrop-blur-md border-b border-[#313244] p-3 sm:p-4 flex items-center justify-between transition-transform duration-300 ${
          showControls ? 'translate-y-0' : '-translate-y-full'
        }`}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-[#313244] text-[#cdd6f4] hover:bg-[#b4befe] hover:text-[#11111b] transition-all cursor-pointer active:scale-95 shrink-0"
            title="Đóng trình đọc (Esc)"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="overflow-hidden">
            <h2 className="text-sm sm:text-base font-bold text-[#cdd6f4] truncate">{title}</h2>
            <p className="text-[11px] text-[#a6adc8]">
              {mode === 'webtoon' ? 'Cuộn dọc Webtoon' : 'Lật trang Manga'} • {totalPages} trang
            </p>
          </div>
        </div>

        {/* View Mode & Fullscreen Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex bg-[#313244] p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setMode('webtoon')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                mode === 'webtoon' ? 'bg-[#b4befe] text-[#11111b] font-bold shadow-sm' : 'text-[#a6adc8] hover:text-[#cdd6f4]'
              }`}
            >
              Webtoon
            </button>
            <button
              onClick={() => setMode('manga')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                mode === 'manga' ? 'bg-[#b4befe] text-[#11111b] font-bold shadow-sm' : 'text-[#a6adc8] hover:text-[#cdd6f4]'
              }`}
            >
              Manga
            </button>
          </div>

          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl bg-[#313244] text-[#a6adc8] hover:text-[#cdd6f4] transition-all cursor-pointer hidden sm:flex"
            title="Toàn màn hình (F)"
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>

      {/* Reader Display Area */}
      <div
        onClick={handleScreenClick}
        className="flex-1 w-full h-full overflow-y-auto flex items-center justify-center relative"
      >
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#11111b]/80 z-20 text-[#a6adc8]">
            <Loader2 size={36} className="animate-spin text-[#b4befe]" />
            <p className="text-xs">Đang nạp ảnh...</p>
          </div>
        )}

        {error && (
          <div className="p-6 text-center text-[#f38ba8] text-sm max-w-md">
            <p>{error}</p>
            <button
              onClick={onlineChapter ? loadOnlinePages : () => loadOfflinePage(currentPage)}
              className="mt-4 px-4 py-2 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs font-semibold cursor-pointer"
            >
              Thử lại
            </button>
          </div>
        )}

        {/* WEBTOON MODE (Vertical Continuous Scroll) */}
        {!loading && !error && mode === 'webtoon' && (
          <div className="w-full h-full overflow-y-auto flex flex-col items-center py-16 px-1 sm:px-4">
            {onlineChapter &&
              pages.map((p, idx) => (
                <div key={idx} className="w-full max-w-3xl my-0.5 relative">
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
              <div className="w-full max-w-3xl my-0.5">
                <img
                  src={`data:image/webp;base64,${offlinePageData}`}
                  alt={`Trang ${currentPage + 1}`}
                  className="w-full h-auto block select-none pointer-events-none"
                />
              </div>
            )}
          </div>
        )}

        {/* MANGA MODE (Single / Flip Page) */}
        {!loading && !error && mode === 'manga' && (
          <div className="relative w-full h-full flex items-center justify-center p-2 sm:p-6">
            {/* Visual Tap Zone Indicators (subtle) */}
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

      {/* Bottom Floating Scrubber & Page Indicator */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-40 bg-[#181825]/95 backdrop-blur-md border-t border-[#313244] p-3 sm:p-4 flex items-center justify-between gap-4 transition-transform duration-300 ${
          showControls ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <button
          onClick={handlePrevPage}
          disabled={currentPage === 0}
          className="p-2 rounded-xl bg-[#313244] text-[#cdd6f4] hover:bg-[#b4befe] hover:text-[#11111b] transition-all disabled:opacity-30 cursor-pointer active:scale-95"
          title="Trang trước"
        >
          <ChevronLeft size={20} />
        </button>

        {/* Slider & Page Indicator */}
        <div className="flex-1 max-w-md flex items-center gap-3">
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
            className="w-full accent-[#b4befe] cursor-pointer h-1.5 bg-[#313244] rounded-lg"
          />
          <span className="text-xs font-mono font-bold text-[#b4befe] shrink-0 min-w-[60px] text-center">
            {totalPages > 0 ? `${currentPage + 1} / ${totalPages}` : '0 / 0'}
          </span>
        </div>

        <button
          onClick={handleNextPage}
          disabled={currentPage >= totalPages - 1}
          className="p-2 rounded-xl bg-[#313244] text-[#cdd6f4] hover:bg-[#b4befe] hover:text-[#11111b] transition-all disabled:opacity-30 cursor-pointer active:scale-95"
          title="Trang tiếp theo"
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
};
