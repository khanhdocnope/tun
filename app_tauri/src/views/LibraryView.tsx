import React, { useEffect, useState } from 'react';
import { BookOpen, RefreshCw, FolderOpen, Loader2 } from 'lucide-react';
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
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-[#313244] bg-[#181825]/60 backdrop-blur-md flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[#cdd6f4] flex items-center gap-2">
            <BookOpen size={20} className="text-[#b4befe]" />
            <span>Kệ truyện cá nhân</span>
          </h1>
          <p className="text-xs text-[#a6adc8]">
            Quản lý và đọc ngoại tuyến các tập truyện (CBZ/ZIP) đã tải về máy
          </p>
        </div>

        <button
          onClick={fetchLibrary}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#313244] text-[#cdd6f4] hover:bg-[#b4befe] hover:text-[#11111b] transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Quét lại thư viện</span>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-[#a6adc8]">
            <Loader2 size={36} className="animate-spin text-[#b4befe]" />
            <p className="text-xs">Đang quét các file CBZ và ZIP trong thư mục lưu trữ...</p>
          </div>
        )}

        {!loading && books.length === 0 && (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-[#6c7086]">
            <BookOpen size={48} className="opacity-40" />
            <p className="text-sm font-semibold text-[#cdd6f4]">Thư viện của bạn đang trống</p>
            <p className="text-xs text-[#a6adc8]">
              Hãy chuyển sang tab "Khám phá" để tìm và tải những tập truyện đầu tiên!
            </p>
          </div>
        )}

        {!loading && books.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
            {books.map((book, idx) => (
              <div
                key={idx}
                onClick={() => onOpenBook(book)}
                className="group flex flex-col bg-[#181825] rounded-2xl overflow-hidden border border-[#313244]/60 hover:border-[#b4befe]/60 hover:shadow-xl transition-all cursor-pointer transform hover:-translate-y-1"
              >
                {/* Cover Thumbnail */}
                <div className="aspect-[3/4] relative overflow-hidden bg-[#11111b]">
                  {book.cover_base64 ? (
                    <img
                      src={`data:image/webp;base64,${book.cover_base64}`}
                      alt={book.chapter_title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-[#6c7086] gap-2 p-2 text-center">
                      <BookOpen size={32} />
                      <span className="text-[10px]">{book.file_name}</span>
                    </div>
                  )}

                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#11111b]/80 backdrop-blur-sm text-[#b4befe]">
                    {book.file_format.toUpperCase()}
                  </div>

                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#11111b]/80 backdrop-blur-sm text-[#a6adc8]">
                    {book.total_pages} trang
                  </div>
                </div>

                {/* Info */}
                <div className="p-3 flex-1 flex flex-col justify-between">
                  <h3 className="font-bold text-xs text-[#cdd6f4] line-clamp-1 group-hover:text-[#b4befe] transition-colors">
                    {book.manga_title}
                  </h3>
                  <p className="text-[11px] text-[#a6adc8] mt-1 line-clamp-1">
                    {book.chapter_title}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
