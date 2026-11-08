import React, { useEffect, useState, useRef } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize, Minimize, Settings, Loader2 } from 'lucide-react';
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
  const [isFullscreen, setIsFullscreen] = useState(false);

  // For online
  const [pages, setPages] = useState<PageItem[]>([]);
  // For offline
  const [offlinePageData, setOfflinePageData] = useState<string | null>(null);
  const totalPages = offlineBook ? offlineBook.total_pages : pages.length;

  useEffect(() => {
    if (onlineChapter) {
      loadOnlinePages();
    } else if (offlineBook) {
      loadOfflinePage(0);
    }
  }, [onlineChapter, offlineBook]);

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
      setError(typeof err === 'string' ? err : err.message || 'Lỗi khi đọc trang');
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

  const title = onlineChapter ? onlineChapter.title : offlineBook?.chapter_title || 'Đọc truyện';

  return (
    <div className="fixed inset-0 z-50 bg-[#11111b] flex flex-col select-none">
      {/* Top Floating Control Bar */}
      <div className="h-14 px-6 bg-[#181825]/90 backdrop-blur-md border-b border-[#313244] flex items-center justify-between text-[#cdd6f4] z-20">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-[#313244] text-[#a6adc8] hover:text-[#cdd6f4] transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-sm font-bold truncate max-w-md">{title}</h2>
            <p className="text-[11px] text-[#a6adc8]">
              {totalPages > 0 ? `Trang ${currentPage + 1} / ${totalPages}` : 'Đang tải...'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Reader Mode Toggle */}
          <div className="flex bg-[#313244] p-0.5 rounded-lg text-xs">
            <button
              onClick={() => setMode('webtoon')}
              className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                mode === 'webtoon' ? 'bg-[#b4befe] text-[#11111b]' : 'text-[#a6adc8] hover:text-[#cdd6f4]'
              }`}
            >
              Cuộn dọc
            </button>
            <button
              onClick={() => setMode('manga')}
              className={`px-3 py-1 rounded-md font-semibold transition-colors ${
                mode === 'manga' ? 'bg-[#b4befe] text-[#11111b]' : 'text-[#a6adc8] hover:text-[#cdd6f4]'
              }`}
            >
              Lật trang
            </button>
          </div>
        </div>
      </div>

      {/* Main Reader Content */}
      <div className="flex-1 overflow-auto flex justify-center bg-[#11111b]">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 text-[#a6adc8]">
            <Loader2 size={36} className="animate-spin text-[#b4befe]" />
            <p className="text-xs">Đang nạp ảnh truyện...</p>
          </div>
        )}

        {error && (
          <div className="m-auto p-4 rounded-xl bg-[#f38ba8]/10 border border-[#f38ba8]/30 text-[#f38ba8] text-xs max-w-md text-center">
            {error}
          </div>
        )}

        {/* WEBTOON MODE (Vertical Continuous Scroll) */}
        {!loading && mode === 'webtoon' && (
          <div className="w-full max-w-3xl flex flex-col items-center py-4">
            {onlineChapter ? (
              pages.map((p) => (
                <img
                  key={p.page_number}
                  src={p.url}
                  alt={`Page ${p.page_number}`}
                  loading="lazy"
                  className="w-full h-auto block select-none"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://placehold.co/600x900?text=Error+Loading+Image';
                  }}
                />
              ))
            ) : (
              // For offline book in webtoon mode, display current page
              offlinePageData && (
                <img
                  src={`data:image/webp;base64,${offlinePageData}`}
                  alt="Page"
                  className="w-full h-auto block select-none"
                />
              )
            )}
          </div>
        )}

        {/* MANGA MODE (Paginated Horizontal View) */}
        {!loading && mode === 'manga' && (
          <div className="relative w-full h-full flex items-center justify-center p-4">
            {onlineChapter && pages[currentPage] && (
              <img
                src={pages[currentPage].url}
                alt={`Page ${currentPage + 1}`}
                className="max-h-full max-w-full object-contain select-none shadow-2xl"
              />
            )}

            {offlineBook && offlinePageData && (
              <img
                src={`data:image/webp;base64,${offlinePageData}`}
                alt="Page"
                className="max-h-full max-w-full object-contain select-none shadow-2xl"
              />
            )}

            {/* Click Navigation Areas */}
            <div
              onClick={handlePrevPage}
              className="absolute left-0 top-0 bottom-0 w-1/3 flex items-center justify-start p-4 cursor-pointer hover:bg-white/5 opacity-0 hover:opacity-100 transition-opacity"
            >
              <div className="p-3 rounded-full bg-[#181825]/80 text-[#cdd6f4]">
                <ChevronLeft size={28} />
              </div>
            </div>

            <div
              onClick={handleNextPage}
              className="absolute right-0 top-0 bottom-0 w-1/3 flex items-center justify-end p-4 cursor-pointer hover:bg-white/5 opacity-0 hover:opacity-100 transition-opacity"
            >
              <div className="p-3 rounded-full bg-[#181825]/80 text-[#cdd6f4]">
                <ChevronRight size={28} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
