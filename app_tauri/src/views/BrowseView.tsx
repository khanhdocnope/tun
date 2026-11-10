import React, { useState, useEffect } from 'react';
import { Search, X, Loader2, RefreshCw, BookOpen, Plus, Globe } from 'lucide-react';
import { MangaItem } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { SourceCatalogModal } from '../components/SourceCatalogModal';
import { SmartCover } from '../components/SmartCover';

interface BrowseViewProps {
  onSelectManga: (manga: MangaItem) => void;
}

// Preset trending showcase items for instant zero-latency visual pop
const SHOWCASE_FALLBACKS: MangaItem[] = [
  {
    id: '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0',
    title: 'Solo Leveling (Tôi Thăng Cấp Một Mình)',
    cover_url: 'https://uploads.mangadex.org/covers/32d76d19-8a05-4db0-9fc2-e0b0648fe9d0/e90bdc47-c8b9-4df7-b2c0-17641b645ee1.jpg.256.jpg',
    source: 'mangadex',
    description: '10 năm trước, sau khi "Cánh cổng" kết nối thế giới thực với thế giới quái vật mở ra, một số người dân bình thường đã nhận được sức mạnh thức tỉnh để săn lùng quái vật.',
    authors: ['Chugong', 'DUBU (REDICE STUDIO)'],
    status: 'Completed',
    genres: ['Action', 'Fantasy', 'Manhwa', 'Supernatural'],
  },
  {
    id: 'a1c7c817-4e59-43b7-9365-09675a149a6f',
    title: 'One Piece (Đảo Hải Tặc)',
    cover_url: 'https://uploads.mangadex.org/covers/a1c7c817-4e59-43b7-9365-09675a149a6f/2f4aca53-64c7-46ac-ae85-3bc9b3169890.png',
    source: 'mangadex',
    description: 'Gol D. Roger là Vua Hải Tặc hùng mạnh nhất trong lịch sử. Trước lúc bị xử tử, ông đã tuyên bố về kho báu vĩ đại nhất One Piece nằm ở cuối Đại Hải Trình.',
    authors: ['Eiichiro Oda'],
    status: 'Ongoing',
    genres: ['Action', 'Adventure', 'Comedy', 'Shounen'],
  },
  {
    id: 'e896c48c-3150-437d-ba57-d8567eb399ae',
    title: 'Chainsaw Man (Thợ Săn Quỷ)',
    cover_url: 'https://uploads.mangadex.org/covers/e896c48c-3150-437d-ba57-d8567eb399ae/fa06e4e4-ef2a-477b-bfb6-a2a88793620b.jpg.256.jpg',
    source: 'mangadex',
    description: 'Denji là một thanh niên nghèo khổ sống chung với chú quỷ cưa Pochita. Sau khi bị phản bội và sát hại, Denji hồi sinh thành Thợ săn quỷ Chainsaw Man.',
    authors: ['Tatsuki Fujimoto'],
    status: 'Ongoing',
    genres: ['Action', 'Horror', 'Supernatural', 'Dark Fantasy'],
  },
];

const DEFAULT_SOURCES = [
  { id: 'mangadex', name: 'MangaDex' },
  { id: 'comick', name: 'ComicK' },
  { id: 'cuutruyen', name: 'Cứu Truyện' },
  { id: 'nettruyen', name: 'NetTruyen' },
  { id: 'asurascans', name: 'Asura Scans' },
  { id: 'manganato', name: 'MangaNato' },
  { id: 'hitomi', name: 'Hitomi' },
];

const GENRES = ['Tất cả', 'Solo', 'Action', 'Manhwa', 'Isekai', 'Romance', 'Fantasy', 'Horror'];

export const BrowseView: React.FC<BrowseViewProps> = ({ onSelectManga }) => {
  const [sourcesList, setSourcesList] = useState<{ id: string; name: string }[]>(() => {
    try {
      const saved = localStorage.getItem('moeject_pinned_sources');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_SOURCES;
  });

  const [source, setSource] = useState('mangadex');
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('Tất cả');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MangaItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);

  useEffect(() => {
    load('mangadex', 'Solo');
  }, []);

  const load = async (src: string, q: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<MangaItem[]>('search_manga', { source: src, query: q });
      setResults(data && data.length > 0 ? data : SHOWCASE_FALLBACKS);
    } catch (err: any) {
      setResults(SHOWCASE_FALLBACKS);
      setError(typeof err === 'string' ? err : err.message || 'Không kết nối được nguồn truyện');
    } finally {
      setLoading(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    load(source, query.trim() || 'Solo');
  };

  const pickSource = (id: string) => {
    setSource(id);
    load(id, query.trim() || (id === 'cuutruyen' ? '' : 'Solo'));
  };

  const handleSelectCatalogSource = (newSource: { id: string; name: string }) => {
    setSourcesList((prev) => {
      const exists = prev.some((s) => s.id === newSource.id);
      const updated = exists ? prev : [...prev, newSource];
      try {
        localStorage.setItem('moeject_pinned_sources', JSON.stringify(updated));
      } catch {}
      return updated;
    });
    pickSource(newSource.id);
  };

  const pickGenre = (g: string) => {
    setGenre(g);
    setQuery(g === 'Tất cả' ? '' : g);
    load(source, g === 'Tất cả' ? 'Solo' : g);
  };

  const sourceName = sourcesList.find((s) => s.id === source)?.name || source;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <header className="shrink-0 bg-ink-900 border-b border-white/[0.06] px-4 sm:px-8 pt-4 sm:pt-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-end gap-3 lg:gap-8">
            <h1 className="text-4xl sm:text-5xl text-paper leading-none">Khám phá</h1>
            <form onSubmit={submit} className="flex-1 flex gap-2 lg:max-w-xl lg:ml-auto">
              <div className="relative flex-1">
                <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tên truyện hoặc tác giả"
                  className="w-full h-11 pl-10 pr-9 bg-ink-950 text-paper rounded-md text-sm placeholder-slate-500 border border-white/10 focus:border-pencil-400 focus:outline-none"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-paper cursor-pointer" title="Xóa">
                    <X size={15} />
                  </button>
                )}
              </div>
              <button type="submit" disabled={loading} className="h-11 px-5 rounded-md bg-son-600 hover:bg-son-500 text-white text-sm font-semibold cursor-pointer disabled:opacity-60 flex items-center gap-2 transition-colors">
                {loading && <Loader2 size={15} className="animate-spin" />}
                Tìm
              </button>
            </form>
          </div>

          {/* Nguồn truyện: tab chữ, gạch chân son cho nguồn đang chọn + nút mở catalog */}
          <div className="flex items-center gap-6 overflow-x-auto no-scrollbar mt-4">
            {sourcesList.map((s) => (
              <button
                key={s.id}
                onClick={() => pickSource(s.id)}
                className={`shrink-0 pb-3 text-sm border-b-2 cursor-pointer transition-colors ${
                  source === s.id ? 'border-son-500 text-paper font-semibold' : 'border-transparent text-slate-400 hover:text-paper'
                }`}
              >
                {s.name}
              </button>
            ))}

            <button
              onClick={() => setIsCatalogOpen(true)}
              className="shrink-0 pb-3 text-sm text-son-400 hover:text-son-300 font-semibold flex items-center gap-1.5 cursor-pointer border-b-2 border-transparent transition-colors ml-auto"
              title="Khám phá kho hơn 1,300 nguồn truyện HakuNeko"
            >
              <Globe size={15} />
              <span>Kho 1,300+ nguồn</span>
              <Plus size={14} className="opacity-80" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-5">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {GENRES.map((g) => (
              <button
                key={g}
                onClick={() => pickGenre(g)}
                className={`shrink-0 h-8 px-3.5 rounded-full text-xs cursor-pointer border transition-colors ${
                  genre === g ? 'bg-paper text-ink-950 border-paper font-semibold' : 'border-white/10 text-slate-400 hover:text-paper hover:border-white/25'
                }`}
              >
                {g}
              </button>
            ))}
            <button onClick={() => load(source, query.trim() || 'Solo')} disabled={loading} className="ml-auto shrink-0 p-2 text-slate-500 hover:text-paper cursor-pointer" title="Làm mới">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {error && (
            <p className="mt-4 text-sm text-son-300 border-l-2 border-son-500 pl-3 py-1">
              Không kết nối được {sourceName}. Đang hiển thị danh sách mẫu. <span className="text-slate-500">({error})</span>
            </p>
          )}

          <p className="mt-5 mb-4 text-sm text-slate-400">
            {loading ? 'Đang tìm…' : `${results.length} truyện từ ${sourceName}`}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-7 pb-6">
            {loading
              ? Array.from({ length: 12 }).map((_, i) => <div key={i} className="aspect-[3/4] rounded-[3px] skeleton-shimmer" />)
              : results.map((m) => (
                  <button key={m.id} onClick={() => onSelectManga(m)} className="group text-left cursor-pointer self-start">
                    <div className="cover aspect-[3/4] rounded-[3px] overflow-hidden bg-ink-800 ring-1 ring-white/10 group-hover:ring-2 group-hover:ring-son-400 transition-shadow">
                      <SmartCover url={m.cover_url} title={m.title} source={m.source} />
                    </div>
                    <h3 className="mt-2.5 text-[13px] font-semibold text-paper leading-snug line-clamp-2 group-hover:text-son-300 transition-colors">{m.title}</h3>
                    {m.authors.length > 0 && <p className="mt-0.5 text-xs text-slate-500 truncate">{m.authors.join(', ')}</p>}
                  </button>
                ))}
          </div>
        </div>
      </div>

      {/* Modal kho nguồn HakuNeko 1,300+ nguồn */}
      <SourceCatalogModal
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        onSelectSource={handleSelectCatalogSource}
        currentSourceId={source}
      />
    </div>
  );
};

