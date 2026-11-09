import React, { useEffect, useState } from 'react';
import { BookOpen, RefreshCw, FolderOpen, Loader2, FileArchive, Library, Sparkles } from 'lucide-react';
import { LibraryBook } from '../types';
import { invoke } from '@tauri-apps/api/core';

interface LibraryViewProps {
  onOpenBook: (book: LibraryBook) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({ onOpenBook }) => {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLibrary = async () => {
    setLoading(true);
    try {
      const data = await invoke<LibraryBook[]>('get_library_books', { downloadDir: null });
      setBooks(data);
    } catch (err) {
      console.error('Failed to scan library:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLibrary();
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0f1524] overflow-hidden select-none relative">
      {/* Background ambient glow */}

      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-white/[0.08] bg-[#131a2c]/85 backdrop-blur-2xl shrink-0 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-cyan-500 flex items-center justify-center shadow-lg text-white">
            <Library size={20} />
          </div>
          <div>
            <h1 className="text-base sm:text-xl font-bold text-white tracking-wide">
              Kệ truyện
            </h1>
            <p className="text-xs text-slate-400">
              Đọc trực tiếp các tệp CBZ và ZIP đã tải, không cần giải nén
            </p>
          </div>
        </div>

        <button
          onClick={fetchLibrary}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-bold bg-white/[0.05] text-slate-300 hover:text-white hover:bg-white/[0.1] border border-white/[0.08] transition-all cursor-pointer active:scale-95 shrink-0"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin text-cyan-400' : ''} />
          <span className="hidden sm:inline">Quét lại</span>
        </button>
      </div>

      {/* Main Grid */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 z-10">
        {loading ? (
          <div className="h-80 flex flex-col items-center justify-center gap-3.5 text-slate-400">
            <Loader2 size={40} className="animate-spin text-cyan-400" />
            <p className="text-xs font-medium">Đang quét nhanh kho lưu trữ CBZ/ZIP...</p>
          </div>
        ) : books.length === 0 ? (
          <div className="h-80 flex flex-col items-center justify-center gap-3.5 text-slate-500 text-center">
            <div className="w-20 h-20 rounded-3xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-slate-400 shadow-inner">
              <FileArchive size={36} className="text-slate-400 opacity-60" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-300">Chưa có tập truyện nào được tải về</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                Tải các chương từ tab Khám phá, các file CBZ sẽ tự động được lập chỉ mục tại đây
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-5 max-w-7xl mx-auto">
            {books.map((book) => (
              <div
                key={book.file_path}
                onClick={() => onOpenBook(book)}
                className="group flex flex-col bg-[#182036] rounded-2xl sm:rounded-3xl overflow-hidden border border-white/[0.07] hover:border-cyan-500/50 hover:shadow-[0_12px_35px_rgba(56,189,248,0.25)] transition-all duration-300 cursor-pointer transform active:scale-95 sm:hover:-translate-y-1.5 relative"
              >
                {/* Book Cover Container */}
                <div className="cover aspect-[3/4] overflow-hidden bg-[#182036] flex items-center justify-center">
                  {book.cover_base64 ? (
                    <img
                      src={`data:image/webp;base64,${book.cover_base64}`}
                      alt={book.manga_title}
                      className="w-full h-full object-cover group-hover:scale-108 transition-transform duration-500 relative z-10"
                    />
                  ) : null}

                  {/* Fallback Graphic */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center z-0 opacity-40">
                    <BookOpen size={36} className="text-slate-400 mb-1" />
                    <span className="text-[10px] font-medium text-slate-300 line-clamp-2">
                      {book.manga_title}
                    </span>
                  </div>

                  {/* Format Badge */}
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[9px] font-black bg-black/60 backdrop-blur-md text-cyan-300 border border-white/10 z-20 uppercase tracking-wider">
                    {book.file_format}
                  </div>

                  <div className="absolute inset-0 bg-gradient-to-t from-[#182036] via-transparent to-transparent opacity-80 z-10" />
                </div>

                {/* Details */}
                <div className="p-3 sm:p-3.5 flex-1 flex flex-col justify-between bg-[#182036] relative z-20">
                  <div>
                    <h3 className="font-bold text-xs sm:text-sm text-white line-clamp-1 group-hover:text-cyan-300 transition-colors">
                      {book.manga_title}
                    </h3>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {book.chapter_title}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 font-mono">
                    <span className="font-semibold text-slate-300">{book.total_pages} trang</span>
                    <span className="text-cyan-400 text-[10px] font-bold">Mở đọc →</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
