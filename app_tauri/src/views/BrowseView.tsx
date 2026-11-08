import React, { useState } from 'react';
import { Search, Sparkles, BookOpen, Loader2 } from 'lucide-react';
import { MangaItem } from '../types';
import { invoke } from '@tauri-apps/api/core';

interface BrowseViewProps {
  onSelectManga: (manga: MangaItem) => void;
}

export const BrowseView: React.FC<BrowseViewProps> = ({ onSelectManga }) => {
  const [source, setSource] = useState('mangadex');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MangaItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sources = [
    { id: 'mangadex', name: 'MangaDex (API v5)' },
    { id: 'comick', name: 'Comick.dev (Fast CDN)' },
    { id: 'cuutruyen', name: 'Cứu Truyện (DRM Descramble)' },
    { id: 'hitomi', name: 'Hitomi.la (Nozomi)' },
    { id: 'asura', name: 'Asura Scans (Template)' },
    { id: 'manganato', name: 'MangaNato (Template)' },
  ];

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim() && source !== 'cuutruyen' && source !== 'hitomi') return;

    setLoading(true);
    setError(null);
    try {
      const data = await invoke<MangaItem[]>('search_manga', { source, query });
      setResults(data);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Lỗi khi tìm kiếm');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-hidden">
      {/* Top Search & Filter Bar */}
      <div className="p-5 border-b border-[#313244] bg-[#181825]/80 backdrop-blur-md">
        <form onSubmit={handleSearch} className="flex flex-wrap sm:flex-nowrap items-center gap-3 max-w-5xl">
          {/* Source Dropdown */}
          <div className="relative shrink-0 min-w-[220px]">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full h-11 px-4 bg-[#313244] text-[#cdd6f4] rounded-xl text-sm font-medium border border-[#45475a] focus:border-[#b4befe] focus:outline-none appearance-none cursor-pointer pr-10 shadow-inner"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <div className="absolute right-3.5 top-3.5 pointer-events-none text-[#a6adc8] text-xs">
              ▼
            </div>
          </div>

          {/* Search Box */}
          <div className="flex-1 min-w-[220px] relative">
            <Search className="absolute left-3.5 top-3 text-[#6c7086]" size={18} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nhập tên truyện, tác giả..."
              className="w-full h-11 pl-10 pr-4 bg-[#313244] text-[#cdd6f4] rounded-xl text-sm placeholder-[#6c7086] border border-[#45475a] focus:border-[#b4befe] focus:outline-none"
            />
          </div>

          {/* Search Button */}
          <button
            type="submit"
            disabled={loading}
            className="h-11 px-6 bg-[#b4befe] text-[#11111b] rounded-xl text-sm font-semibold hover:bg-[#cba6f7] transition-colors flex items-center gap-2 shadow-sm shrink-0 cursor-pointer"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            <span>Tìm kiếm</span>
          </button>
        </form>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="p-4 mb-6 rounded-xl bg-[#f38ba8]/10 border border-[#f38ba8]/30 text-[#f38ba8] text-sm">
            {error}
          </div>
        )}

        {loading && (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-[#a6adc8]">
            <Loader2 size={36} className="animate-spin text-[#b4befe]" />
            <p className="text-sm">Đang tìm kiếm trên {sources.find((s) => s.id === source)?.name}...</p>
          </div>
        )}

        {!loading && results.length === 0 && (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-[#6c7086]">
            <BookOpen size={48} className="opacity-40" />
            <p className="text-sm">Nhập từ khóa và bấm "Tìm kiếm" để bắt đầu duyệt truyện</p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
            {results.map((manga) => (
              <div
                key={manga.id}
                onClick={() => onSelectManga(manga)}
                className="group flex flex-col bg-[#181825] rounded-2xl overflow-hidden border border-[#313244]/60 hover:border-[#b4befe]/60 hover:shadow-xl transition-all cursor-pointer transform hover:-translate-y-1"
              >
                {/* Cover Image Container */}
                <div className="aspect-[3/4] relative overflow-hidden bg-gradient-to-br from-[#1e1e2e] to-[#11111b] flex items-center justify-center">
                  {manga.cover_url ? (
                    <img
                      src={manga.cover_url}
                      alt={manga.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 relative z-10"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : null}

                  {/* Sleek Fallback when no cover / loading */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center z-0 opacity-40">
                    <BookOpen size={36} className="text-[#a6adc8] mb-1" />
                    <span className="text-[11px] font-medium text-[#bac2de] line-clamp-2">{manga.title}</span>
                  </div>

                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#11111b]/80 backdrop-blur-sm text-[#b4befe] z-20">
                    {manga.source.toUpperCase()}
                  </div>
                </div>

                {/* Manga Details */}
                <div className="p-3 flex-1 flex flex-col justify-between">
                  <h3 className="font-semibold text-xs text-[#cdd6f4] line-clamp-2 group-hover:text-[#b4befe] transition-colors">
                    {manga.title}
                  </h3>
                  {manga.status && (
                    <p className="text-[10px] text-[#a6adc8] mt-1.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#a6e3a1]"></span>
                      {manga.status}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
