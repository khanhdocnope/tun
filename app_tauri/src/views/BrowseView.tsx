import React, { useState } from 'react';
import { Search, Sparkles, BookOpen, Loader2, X, Globe } from 'lucide-react';
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
    { id: 'mangadex', name: 'MangaDex', badge: 'API v5', color: '#ff6740' },
    { id: 'comick', name: 'Comick.dev', badge: 'Fast CDN', color: '#44a0e5' },
    { id: 'cuutruyen', name: 'Cứu Truyện', badge: 'DRM Vi', color: '#a6e3a1' },
    { id: 'hitomi', name: 'Hitomi.la', badge: 'Nozomi', color: '#f38ba8' },
    { id: 'asura', name: 'Asura Scans', badge: 'WP Madara', color: '#cba6f7' },
    { id: 'manganato', name: 'MangaNato', badge: 'MangaStream', color: '#f9e2af' },
  ];

  const handleSearch = async (e?: React.FormEvent, customSource?: string, customQuery?: string) => {
    if (e) e.preventDefault();
    const targetSource = customSource || source;
    const targetQuery = customQuery !== undefined ? customQuery : query;

    if (!targetQuery.trim() && targetSource !== 'cuutruyen' && targetSource !== 'hitomi') return;

    setLoading(true);
    setError(null);
    try {
      const data = await invoke<MangaItem[]>('search_manga', {
        source: targetSource,
        query: targetQuery,
      });
      setResults(data);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Lỗi khi tìm kiếm');
    } finally {
      setLoading(false);
    }
  };

  const handleSourceChange = (newSource: string) => {
    setSource(newSource);
    if (query.trim() || newSource === 'cuutruyen' || newSource === 'hitomi') {
      handleSearch(undefined, newSource, query);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-hidden select-none">
      {/* Top Search & Filter Bar */}
      <div className="p-3 sm:p-5 border-b border-[#313244] bg-[#181825]/90 backdrop-blur-md shrink-0">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 max-w-5xl mx-auto w-full">
          {/* Desktop Source Dropdown (hidden on small mobile) */}
          <div className="relative shrink-0 hidden sm:block min-w-[200px]">
            <select
              value={source}
              onChange={(e) => handleSourceChange(e.target.value)}
              className="w-full h-11 px-3.5 bg-[#313244] text-[#cdd6f4] rounded-xl text-sm font-medium border border-[#45475a] focus:border-[#b4befe] focus:outline-none appearance-none cursor-pointer pr-9 shadow-inner"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.badge})
                </option>
              ))}
            </select>
            <div className="absolute right-3 top-3.5 pointer-events-none text-[#a6adc8] text-xs">
              ▼
            </div>
          </div>

          {/* Search Box */}
          <div className="flex-1 relative flex items-center">
            <Search className="absolute left-3.5 text-[#6c7086] pointer-events-none" size={18} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm kiếm truyện, tác giả..."
              className="w-full h-11 pl-10 pr-9 bg-[#313244] text-[#cdd6f4] rounded-xl text-sm placeholder-[#6c7086] border border-[#45475a] focus:border-[#b4befe] focus:outline-none shadow-inner"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3 p-1 rounded-full text-[#6c7086] hover:text-[#cdd6f4] cursor-pointer"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {/* Search Button */}
          <button
            type="submit"
            disabled={loading}
            className="h-11 px-5 bg-[#b4befe] text-[#11111b] rounded-xl text-sm font-semibold hover:bg-[#cba6f7] transition-all flex items-center justify-center gap-2 shadow-sm shrink-0 active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            <span>Tìm kiếm</span>
          </button>
        </form>

        {/* Mobile Horizontal Source Chips Slider */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-2.5 pb-0.5 sm:mt-1 max-w-5xl mx-auto">
          <span className="text-[11px] font-semibold text-[#6c7086] uppercase tracking-wider flex items-center gap-1 shrink-0 mr-1 hidden sm:flex">
            <Globe size={12} /> Nguồn:
          </span>
          {sources.map((s) => {
            const isSelected = source === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSourceChange(s.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                  isSelected
                    ? 'bg-[#b4befe] text-[#11111b] shadow-sm font-semibold'
                    : 'bg-[#313244]/80 text-[#a6adc8] hover:bg-[#45475a] hover:text-[#cdd6f4]'
                }`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: isSelected ? '#11111b' : s.color }}
                />
                <span>{s.name}</span>
                <span className={`text-[10px] opacity-75 ${isSelected ? 'text-[#11111b]' : 'text-[#6c7086]'}`}>
                  {s.badge}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-5 md:p-6">
        {error && (
          <div className="p-4 mb-4 rounded-xl bg-[#f38ba8]/10 border border-[#f38ba8]/30 text-[#f38ba8] text-sm max-w-5xl mx-auto flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#f38ba8] shrink-0"></div>
            <span className="break-all">{error}</span>
          </div>
        )}

        {loading && (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-[#a6adc8]">
            <Loader2 size={36} className="animate-spin text-[#b4befe]" />
            <p className="text-sm">Đang tìm kiếm trên {sources.find((s) => s.id === source)?.name}...</p>
          </div>
        )}

        {!loading && results.length === 0 && (
          <div className="h-64 flex flex-col items-center justify-center gap-3 text-[#6c7086] text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-[#313244]/40 flex items-center justify-center text-[#6c7086]">
              <BookOpen size={32} />
            </div>
            <p className="text-sm font-medium text-[#a6adc8]">
              Nhập từ khóa và bấm "Tìm kiếm" để bắt đầu duyệt truyện
            </p>
            <p className="text-xs text-[#6c7086]">
              Hỗ trợ tìm kiếm theo tên manga, manhwa, manhua hoặc tác giả
            </p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 max-w-7xl mx-auto">
            {results.map((manga) => (
              <div
                key={manga.id}
                onClick={() => onSelectManga(manga)}
                className="group flex flex-col bg-[#181825] rounded-2xl overflow-hidden border border-[#313244]/60 hover:border-[#b4befe]/60 hover:shadow-xl transition-all cursor-pointer transform active:scale-95 sm:hover:-translate-y-1"
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

                  {/* Fallback Graphic */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center z-0 opacity-40">
                    <BookOpen size={36} className="text-[#a6adc8] mb-1.5" />
                    <span className="text-[10px] font-medium text-[#bac2de] line-clamp-2">{manga.title}</span>
                  </div>

                  {/* Source Badge */}
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[9px] font-bold bg-[#11111b]/80 backdrop-blur-sm text-[#b4befe] z-20 border border-white/5">
                    {manga.source.toUpperCase()}
                  </div>
                </div>

                {/* Manga Details */}
                <div className="p-2.5 sm:p-3 flex-1 flex flex-col justify-between">
                  <h3 className="font-semibold text-xs sm:text-sm text-[#cdd6f4] line-clamp-2 group-hover:text-[#b4befe] transition-colors leading-snug">
                    {manga.title}
                  </h3>
                  {manga.status && (
                    <p className="text-[10px] text-[#a6adc8] mt-1.5 flex items-center gap-1 font-medium">
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
