import React, { useEffect, useState } from 'react';
import { BookOpen, RefreshCw, FolderOpen, Loader2, FileArchive } from 'lucide-react';
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

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-hidden select-none">
      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-[#313244] bg-[#181825]/80 backdrop-blur-md shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-[#cdd6f4] flex items-center gap-2">
            <BookOpen size={22} className="text-[#b4befe]" />
            <span>Kệ truyện cá nhân</span>
          </h1>
          <p className="text-xs text-[#a6adc8] mt-0.5">
            Đọc ngoại tuyến các tập truyện (CBZ/ZIP) đã tải về mà không cần giải nén
          </p>
        </div>

        <button
          onClick={fetchLibrary}
          disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#313244] text-[#cdd6f4] hover:bg-[#b4befe] hover:text-[#11111b] transition-all cursor-pointer active:scale-95 shrink-0"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Quét lại</span>
        </button>
      </div>

      {/* Book Grid */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-[#a6adc8]">
            <Loader2 size={36} className="animate-spin text-[#b4befe]" />
            <p className="text-xs">Đang quét thư mục truyện tải về...</p>
          </div>
        ) : books.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-[#6c7086] text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#313244]/40 flex items-center justify-center text-[#6c7086]">
              <FileArchive size={32} />
            </div>
            <p className="text-sm font-medium text-[#a6adc8]">Chưa có tập truyện nào được tải về</p>
            <p className="text-xs text-[#6c7086]">
              Các file tải về dạng CBZ hoặc ZIP sẽ tự động xuất hiện tại đây
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 max-w-7xl mx-auto">
            {books.map((book) => (
              <div
                key={book.id}
                onClick={() => onOpenBook(book)}
                className="group flex flex-col bg-[#181825] rounded-2xl overflow-hidden border border-[#313244]/60 hover:border-[#b4befe]/60 hover:shadow-xl transition-all cursor-pointer transform active:scale-95 sm:hover:-translate-y-1"
              >
                {/* Book Cover Container */}
                <div className="aspect-[3/4] relative overflow-hidden bg-gradient-to-br from-[#1e1e2e] to-[#11111b] flex items-center justify-center">
                  {book.cover_base64 ? (
                    <img
                      src={`data:image/webp;base64,${book.cover_base64}`}
                      alt={book.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 relative z-10"
                    />
                  ) : null}

                  {/* Fallback Graphic */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center z-0 opacity-40">
                    <BookOpen size={36} className="text-[#a6adc8] mb-1.5" />
                    <span className="text-[10px] font-medium text-[#bac2de] line-clamp-2">{book.title}</span>
                  </div>

                  {/* Format Badge */}
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[9px] font-bold bg-[#11111b]/80 backdrop-blur-sm text-[#cba6f7] z-20 border border-white/5 uppercase">
                    {book.file_format}
                  </div>
                </div>

                {/* Details */}
                <div className="p-2.5 sm:p-3 flex-1 flex flex-col justify-between">
                  <h3 className="font-semibold text-xs sm:text-sm text-[#cdd6f4] line-clamp-2 group-hover:text-[#b4befe] transition-colors leading-snug">
                    {book.title}
                  </h3>
                  <div className="flex items-center justify-between text-[10px] text-[#a6adc8] mt-2 font-mono">
                    <span>{book.total_pages} trang</span>
                    <span>{formatFileSize(book.file_size)}</span>
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
