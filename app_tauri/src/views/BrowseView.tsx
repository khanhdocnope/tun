import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Sparkles,
  BookOpen,
  Loader2,
  X,
  Globe,
  Flame,
  Star,
  Eye,
  TrendingUp,
  Tag,
  Compass,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { MangaItem } from '../types';
import { invoke } from '@tauri-apps/api/core';

interface BrowseViewProps {
  onSelectManga: (manga: MangaItem) => void;
}

// Preset trending showcase items for instant zero-latency visual pop
const SHOWCASE_FALLBACKS: MangaItem[] = [
  {
    id: '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0',
    title: 'Solo Leveling (Tôi Thăng Cấp Một Mình)',
    cover_url: 'https://uploads.mangadex.org/covers/32d76d19-8a05-4db0-9fc2-e0b0648fe9d0/d2e1b1d7-b892-411a-9694-8bfd4fbbe388.jpg',
    source: 'mangadex',
    description: '10 năm trước, sau khi "Cánh cổng" kết nối thế giới thực với thế giới quái vật mở ra, một số người dân bình thường đã nhận được sức mạnh thức tỉnh để săn lùng quái vật.',
    authors: ['Chugong', 'DUBU (REDICE STUDIO)'],
    status: 'Completed',
    genres: ['Action', 'Fantasy', 'Manhwa', 'Supernatural'],
  },
  {
    id: 'a1c7c817-4e59-43b7-9365-09675a149a6f',
    title: 'One Piece (Đảo Hải Tặc)',
    cover_url: 'https://uploads.mangadex.org/covers/a1c7c817-4e59-43b7-9365-09675a149a6f/a65824c8-3c32-4d22-b52b-741c305c4ec1.jpg',
    source: 'mangadex',
    description: 'Gol D. Roger là Vua Hải Tặc hùng mạnh nhất trong lịch sử. Trước lúc bị xử tử, ông đã tuyên bố về kho báu vĩ đại nhất One Piece nằm ở cuối Đại Hải Trình.',
    authors: ['Eiichiro Oda'],
    status: 'Ongoing',
    genres: ['Action', 'Adventure', 'Comedy', 'Shounen'],
  },
  {
    id: 'c52b2ce3-7f95-469c-96b0-474fb724fb32',
    title: 'Chainsaw Man (Thợ Săn Quỷ)',
    cover_url: 'https://uploads.mangadex.org/covers/c52b2ce3-7f95-469c-96b0-474fb724fb32/9338f0fa-35e6-4d76-92f5-b77a7b8e5cfc.jpg',
    source: 'mangadex',
    description: 'Denji là một thanh niên nghèo khổ sống chung với chú quỷ cưa Pochita. Sau khi bị phản bội và sát hại, Denji hồi sinh thành Thợ săn quỷ Chainsaw Man.',
    authors: ['Tatsuki Fujimoto'],
    status: 'Ongoing',
    genres: ['Action', 'Horror', 'Supernatural', 'Dark Fantasy'],
  },
];

const SOURCES = [
  { id: 'mangadex', name: 'MangaDex', badge: 'API v5', color: '#a855f7', bg: 'from-purple-500/20 to-indigo-500/20' },
  { id: 'comick', name: 'Comick.dev', badge: 'Fast CDN', color: '#38bdf8', bg: 'from-cyan-500/20 to-blue-500/20' },
  { id: 'cuutruyen', name: 'Cứu Truyện', badge: 'DRM Vi', color: '#10b981', bg: 'from-emerald-500/20 to-teal-500/20' },
  { id: 'hitomi', name: 'Hitomi.la', badge: 'Nozomi', color: '#ec4899', bg: 'from-pink-500/20 to-rose-500/20' },
  { id: 'asura', name: 'Asura Scans', badge: 'WP Madara', color: '#8b5cf6', bg: 'from-violet-500/20 to-purple-500/20' },
  { id: 'manganato', name: 'MangaNato', badge: 'MangaStream', color: '#f59e0b', bg: 'from-amber-500/20 to-orange-500/20' },
];

const POPULAR_TAGS = ['Tất cả', 'Solo', 'Action', 'Manhwa', 'Isekai', 'Romance', 'Fantasy', 'One Piece', 'Horror'];

export const BrowseView: React.FC<BrowseViewProps> = ({ onSelectManga }) => {
  const [source, setSource] = useState('mangadex');
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState('Tất cả');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MangaItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);

  // Auto-fetch popular manga upon initial mount so screen is NEVER empty!
  useEffect(() => {
    fetchTrendingOrSearch('mangadex', 'Solo');
  }, []);

  const fetchTrendingOrSearch = async (targetSource: string, targetQuery: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<MangaItem[]>('search_manga', {
        source: targetSource,
        query: targetQuery,
      });

      if (data && data.length > 0) {
        setResults(data);
      } else {
        // Fallback to showcase if network or query empty
        setResults(SHOWCASE_FALLBACKS);
      }
    } catch (err: any) {
      console.warn('Network search error, using showcase fallbacks:', err);
      setResults(SHOWCASE_FALLBACKS);
      setError(typeof err === 'string' ? err : err.message || 'Lỗi kết nối nguồn truyện');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = query.trim() || 'Solo';
    fetchTrendingOrSearch(source, q);
  };

  const handleSourceSelect = (newSource: string) => {
    setSource(newSource);
    const q = query.trim() || (newSource === 'cuutruyen' ? '' : 'Solo');
    fetchTrendingOrSearch(newSource, q);
  };

  const handleTagClick = (tag: string) => {
    setActiveTag(tag);
    if (tag === 'Tất cả') {
      fetchTrendingOrSearch(source, 'Solo');
    } else {
      setQuery(tag);
      fetchTrendingOrSearch(source, tag);
    }
  };

  // Hero Manga Spotlight Selection
  const heroManga = useMemo(() => {
    if (results.length > 0) {
      return results[heroIndex % results.length];
    }
    return SHOWCASE_FALLBACKS[0];
  }, [results, heroIndex]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#07080e] overflow-hidden select-none relative">
      {/* Ambient background glow orb */}
      <div className="absolute top-10 left-1/3 w-96 h-96 bg-violet-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-40 right-10 w-80 h-80 bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none" />

      {/* TOP HEADER: Search bar & Source Switcher */}
      <div className="p-3 sm:p-5 border-b border-white/[0.06] bg-[#0c0d18]/85 backdrop-blur-2xl shrink-0 z-20 space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2.5 max-w-6xl mx-auto w-full">
          {/* Source Dropdown Selector (Desktop) */}
          <div className="relative shrink-0 hidden lg:block w-52">
            <select
              value={source}
              onChange={(e) => handleSourceSelect(e.target.value)}
              className="w-full h-12 px-3.5 bg-white/[0.04] text-white rounded-2xl text-xs font-semibold border border-white/10 hover:border-violet-500/40 focus:border-violet-500 focus:outline-none appearance-none cursor-pointer pr-9 shadow-inner transition-colors"
            >
              {SOURCES.map((s) => (
                <option key={s.id} value={s.id} className="bg-[#10121f] text-white">
                  {s.name} ({s.badge})
                </option>
              ))}
            </select>
            <div className="absolute right-3.5 top-4 pointer-events-none text-slate-400 text-xs">
              ▼
            </div>
          </div>

          {/* Search Box with Glassmorphism */}
          <div className="flex-1 relative flex items-center group">
            <Search
              className="absolute left-4 text-slate-400 group-focus-within:text-violet-400 transition-colors pointer-events-none"
              size={19}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm kiếm theo tên truyện, tác giả, manhwa..."
              className="w-full h-12 pl-12 pr-10 bg-white/[0.04] text-white rounded-2xl text-sm placeholder-slate-500 border border-white/10 focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all shadow-inner"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3.5 p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Search Button */}
          <button
            type="submit"
            disabled={loading}
            className="h-12 px-6 bg-gradient-to-r from-violet-600 via-purple-600 to-cyan-500 text-white rounded-2xl text-sm font-bold shadow-lg shadow-violet-600/25 hover:shadow-violet-600/40 hover:opacity-95 transition-all flex items-center justify-center gap-2 shrink-0 active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            <span className="hidden sm:inline">Khám phá</span>
          </button>
        </form>

        {/* Source Pills & Quick Filter Tags */}
        <div className="flex flex-col gap-2 max-w-6xl mx-auto">
          {/* Source horizontal tabs */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 shrink-0 mr-1 hidden sm:flex">
              <Globe size={13} className="text-violet-400" /> Nguồn:
            </span>
            {SOURCES.map((s) => {
              const isSelected = source === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => handleSourceSelect(s.id)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer active:scale-95 border ${
                    isSelected
                      ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white border-violet-400/50 shadow-md shadow-violet-600/30 font-bold'
                      : 'bg-white/[0.03] text-slate-400 border-white/[0.06] hover:bg-white/[0.07] hover:text-white'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full ring-2 ring-white/20"
                    style={{ backgroundColor: s.color }}
                  />
                  <span>{s.name}</span>
                  <span
                    className={`text-[10px] px-1 rounded ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-slate-500'
                    }`}
                  >
                    {s.badge}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Quick genre filter tags */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1 shrink-0 mr-1 hidden md:flex">
              <Tag size={11} className="text-cyan-400" /> Thể loại:
            </span>
            {POPULAR_TAGS.map((t) => (
              <button
                key={t}
                onClick={() => handleTagClick(t)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all shrink-0 cursor-pointer ${
                  activeTag === t
                    ? 'bg-white/10 text-cyan-300 border border-cyan-400/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MAIN SCROLLABLE CONTENT */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 space-y-6 sm:space-y-8">
        {/* HERO SPOTLIGHT BANNER */}
        {heroManga && (
          <div className="max-w-7xl mx-auto relative rounded-3xl overflow-hidden border border-white/[0.1] bg-gradient-to-r from-[#0d0f1a] to-[#14172a] shadow-2xl group">
            {/* Blurred ambient backdrop */}
            {heroManga.cover_url && (
              <div
                className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-20 scale-125 transition-transform duration-700 group-hover:scale-130"
                style={{ backgroundImage: `url(${heroManga.cover_url})` }}
              />
            )}

            {/* Gradient Dark Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-r from-[#07080e] via-[#07080e]/80 to-transparent z-10" />

            <div className="relative z-20 p-5 sm:p-8 md:p-10 flex flex-col md:flex-row items-center md:items-stretch gap-6 md:gap-10">
              {/* Cover Showcase 3D */}
              <div
                onClick={() => onSelectManga(heroManga)}
                className="w-40 sm:w-52 md:w-60 aspect-[3/4] rounded-2xl overflow-hidden shadow-[0_15px_40px_rgba(0,0,0,0.8)] border border-white/20 bg-[#07080e] shrink-0 cursor-pointer transform md:group-hover:-translate-y-1 transition-transform relative"
              >
                {heroManga.cover_url ? (
                  <img
                    src={heroManga.cover_url}
                    alt={heroManga.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : null}

                <div className="absolute top-2.5 right-2.5 px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold bg-black/75 backdrop-blur-md text-cyan-300 border border-cyan-400/30">
                  {heroManga.source.toUpperCase()}
                </div>
              </div>

              {/* Spotlight Info */}
              <div className="flex-1 flex flex-col justify-between text-center md:text-left space-y-4">
                <div>
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-3">
                    <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-gradient-to-r from-rose-500 to-amber-500 text-white shadow-md shadow-rose-500/25 flex items-center gap-1.5 uppercase tracking-wider">
                      <Flame size={14} className="animate-bounce" />
                      Tiêu điểm thịnh hành
                    </span>
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-white/10 text-cyan-300 border border-white/10 flex items-center gap-1">
                      <Star size={12} className="text-amber-400 fill-amber-400" />
                      9.8 / 10
                    </span>
                  </div>

                  <h1
                    onClick={() => onSelectManga(heroManga)}
                    className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tight leading-tight cursor-pointer hover:text-violet-300 transition-colors line-clamp-2"
                  >
                    {heroManga.title}
                  </h1>

                  {heroManga.authors && heroManga.authors.length > 0 && (
                    <p className="text-xs sm:text-sm text-slate-400 mt-2 font-medium">
                      Tác giả: <span className="text-slate-200">{heroManga.authors.join(', ')}</span>
                    </p>
                  )}

                  {/* Genre Pills */}
                  {heroManga.genres && heroManga.genres.length > 0 && (
                    <div className="flex flex-wrap justify-center md:justify-start gap-2 mt-3">
                      {heroManga.genres.slice(0, 5).map((g, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-1 rounded-xl text-xs font-semibold bg-white/[0.05] text-slate-300 border border-white/[0.08]"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Summary */}
                  {heroManga.description && (
                    <p className="text-xs sm:text-sm text-slate-400 mt-3 line-clamp-2 md:line-clamp-3 leading-relaxed max-w-2xl">
                      {heroManga.description}
                    </p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="pt-2 flex flex-wrap items-center justify-center md:justify-start gap-3">
                  <button
                    onClick={() => onSelectManga(heroManga)}
                    className="px-7 py-3 bg-gradient-to-r from-violet-600 via-purple-600 to-cyan-500 text-white rounded-2xl text-sm font-bold shadow-xl shadow-violet-600/30 hover:opacity-95 transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                  >
                    <BookOpen size={18} />
                    <span>Đọc ngay</span>
                  </button>

                  <button
                    onClick={() => onSelectManga(heroManga)}
                    className="px-5 py-3 rounded-2xl bg-white/[0.07] text-white hover:bg-white/[0.12] border border-white/10 transition-all text-sm font-semibold flex items-center gap-2 cursor-pointer active:scale-95"
                  >
                    <span>Xem chi tiết</span>
                    <ArrowRight size={16} />
                  </button>

                  {/* Next hero banner switcher */}
                  {results.length > 1 && (
                    <button
                      onClick={() => setHeroIndex((prev) => (prev + 1) % results.length)}
                      className="p-3 rounded-2xl bg-white/[0.05] text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer"
                      title="Chuyển sang bộ tiêu điểm tiếp theo"
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION HEADER: Trending Manga Grid */}
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <TrendingUp size={18} />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-wide">
                Danh sách thịnh hành & Mới cập nhật
              </h2>
              <p className="text-xs text-slate-400">
                Tìm thấy {results.length} bộ truyện nổi bật từ{' '}
                {SOURCES.find((s) => s.id === source)?.name}
              </p>
            </div>
          </div>

          <button
            onClick={() => fetchTrendingOrSearch(source, query.trim() || 'Solo')}
            disabled={loading}
            className="p-2 rounded-xl bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08] border border-white/[0.06] transition-all cursor-pointer"
            title="Làm mới danh sách"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* ERROR NOTICE */}
        {error && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs sm:text-sm max-w-7xl mx-auto flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {/* LOADING SHIMMER SKELETONS */}
        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5 max-w-7xl mx-auto">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[3/4] rounded-2xl skeleton-shimmer border border-white/[0.05] p-3 flex flex-col justify-end"
              >
                <div className="w-3/4 h-4 bg-white/10 rounded-md mb-2" />
                <div className="w-1/2 h-3 bg-white/10 rounded-md" />
              </div>
            ))}
          </div>
        )}

        {/* MANGA CARDS GRID */}
        {!loading && results.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3.5 sm:gap-5 max-w-7xl mx-auto">
            {results.map((manga) => (
              <div
                key={manga.id}
                onClick={() => onSelectManga(manga)}
                className="group flex flex-col bg-[#0d0f1a] rounded-2xl sm:rounded-3xl overflow-hidden border border-white/[0.07] hover:border-violet-500/50 hover:shadow-[0_12px_35px_rgba(139,92,246,0.3)] transition-all duration-300 cursor-pointer transform active:scale-95 sm:hover:-translate-y-1.5 relative"
              >
                {/* 3:4 Cover Art Container */}
                <div className="aspect-[3/4] relative overflow-hidden bg-gradient-to-br from-[#121422] to-[#07080e] flex items-center justify-center">
                  {manga.cover_url ? (
                    <img
                      src={manga.cover_url}
                      alt={manga.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-108 transition-transform duration-500 relative z-10"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : null}

                  {/* Fallback Graphic */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center z-0 opacity-40">
                    <BookOpen size={36} className="text-slate-400 mb-1" />
                    <span className="text-[11px] font-medium text-slate-300 line-clamp-2">
                      {manga.title}
                    </span>
                  </div>

                  {/* Glassmorphic Source Badge (Top Left) */}
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[9px] font-black bg-black/60 backdrop-blur-md text-violet-300 border border-white/10 z-20 uppercase tracking-wider">
                    {manga.source}
                  </div>

                  {/* Star Rating Badge (Top Right) */}
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-lg text-[9px] font-bold bg-black/60 backdrop-blur-md text-amber-300 border border-white/10 z-20 flex items-center gap-0.5">
                    <Star size={10} className="fill-amber-400 text-amber-400" />
                    <span>4.9</span>
                  </div>

                  {/* Bottom Vignette Gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0d0f1a] via-transparent to-transparent opacity-80 z-10" />
                </div>

                {/* Card Info Details */}
                <div className="p-3 sm:p-3.5 flex-1 flex flex-col justify-between bg-[#0d0f1a] relative z-20">
                  <h3 className="font-bold text-xs sm:text-sm text-white line-clamp-2 group-hover:text-violet-300 transition-colors leading-snug">
                    {manga.title}
                  </h3>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    {manga.status ? (
                      <span className="flex items-center gap-1 font-medium text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        {manga.status}
                      </span>
                    ) : (
                      <span className="text-slate-500">Manga</span>
                    )}

                    <span className="text-[10px] text-violet-400 font-semibold group-hover:translate-x-0.5 transition-transform">
                      Đọc →
                    </span>
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
