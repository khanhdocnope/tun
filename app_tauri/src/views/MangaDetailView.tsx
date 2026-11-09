import React, { useEffect, useState, useMemo } from 'react';
import {
  ArrowLeft,
  Download,
  BookOpen,
  Loader2,
  Sparkles,
  CheckCircle2,
  ArrowUpDown,
  Search,
  Eye,
  Layers,
  Share2,
} from 'lucide-react';
import { MangaItem, ChapterItem, DownloadTask } from '../types';
import { invoke } from '@tauri-apps/api/core';

interface MangaDetailViewProps {
  manga: MangaItem;
  onBack: () => void;
  onOpenReader: (chapter: ChapterItem) => void;
}

export const MangaDetailView: React.FC<MangaDetailViewProps> = ({
  manga,
  onBack,
  onOpenReader,
}) => {
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<'cbz' | 'zip'>('cbz');
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [chapterSearch, setChapterSearch] = useState('');
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    loadChapters();
  }, [manga]);

  const loadChapters = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<ChapterItem[]>('get_manga_chapters', {
        source: manga.source,
        mangaId: manga.id,
      });
      setChapters(data);
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Lỗi khi tải danh sách chương');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadChapter = async (chapter: ChapterItem) => {
    const task: DownloadTask = {
      id: `${manga.source}_${chapter.id}_${Date.now()}`,
      manga_id: manga.id,
      manga_title: manga.title,
      chapter_id: chapter.id,
      chapter_title: chapter.title,
      status: 'queued',
      total_pages: 0,
      downloaded_pages: 0,
      file_format: format,
    };

    setDownloadingIds((prev) => new Set(prev).add(chapter.id));
    try {
      await invoke('start_download', {
        task,
        source: manga.source,
        chapterId: chapter.id,
      });
    } catch (err) {
      console.error('Failed to start download:', err);
    }
  };

  const handleDownloadAll = async () => {
    for (const chapter of chapters) {
      if (!downloadingIds.has(chapter.id)) {
        await handleDownloadChapter(chapter);
      }
    }
  };

  // Filter & Sort Chapters
  const filteredChapters = useMemo(() => {
    let result = [...chapters];
    if (chapterSearch.trim()) {
      const q = chapterSearch.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.chapter_number.toString().includes(q)
      );
    }
    result.sort((a, b) =>
      sortDesc
        ? b.chapter_number - a.chapter_number
        : a.chapter_number - b.chapter_number
    );
    return result;
  }, [chapters, chapterSearch, sortDesc]);

  const firstChapter = chapters.length > 0
    ? [...chapters].sort((a, b) => a.chapter_number - b.chapter_number)[0]
    : null;

  const latestChapter = chapters.length > 0
    ? [...chapters].sort((a, b) => b.chapter_number - a.chapter_number)[0]
    : null;

  return (
    <div className="flex-1 h-full bg-[#0f1524] overflow-y-auto select-none relative">
      {/* Top Floating Glass Navigation Bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between p-3.5 sm:p-4 bg-[#131a2c]/85 backdrop-blur-2xl border-b border-white/[0.08]">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/[0.05] text-slate-300 hover:text-white hover:bg-white/[0.1] transition-all text-xs sm:text-sm font-semibold active:scale-95 cursor-pointer border border-white/[0.08]"
        >
          <ArrowLeft size={16} />
          <span>Quay lại</span>
        </button>

        <div className="flex items-center gap-3">
          {/* Format Toggle Pill (CBZ / ZIP) */}
          <div className="flex bg-white/[0.04] p-1 rounded-2xl border border-white/[0.08] text-xs font-semibold">
            <button
              onClick={() => setFormat('cbz')}
              className={`px-3 py-1 rounded-xl transition-all cursor-pointer ${
                format === 'cbz'
                  ? 'bg-violet-600 text-white shadow-md font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              CBZ
            </button>
            <button
              onClick={() => setFormat('zip')}
              className={`px-3 py-1 rounded-xl transition-all cursor-pointer ${
                format === 'zip'
                  ? 'bg-violet-600 text-white shadow-md font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              ZIP
            </button>
          </div>

          <button
            onClick={handleDownloadAll}
            disabled={loading || chapters.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white rounded-2xl text-xs font-bold shadow-lg hover:opacity-95 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Tải toàn bộ</span> ({chapters.length})
          </button>
        </div>
      </div>

      {/* Cinematic Hero Header */}
      <div className="relative overflow-hidden border-b border-white/[0.08] p-5 sm:p-10 md:p-12">
        {/* Massive Ambient Blurred Backdrop */}
        {manga.cover_url && (
          <div
            className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-25 scale-125 pointer-events-none"
            style={{ backgroundImage: `url(${manga.cover_url})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0f1524]/80 to-[#0f1524] pointer-events-none" />

        <div className="relative z-10 max-w-6xl mx-auto flex flex-col md:flex-row gap-6 sm:gap-10 items-center md:items-start text-center md:text-left">
          {/* Cover Card 3D Frame */}
          <div className="w-44 sm:w-60 aspect-[3/4] rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.9)] border-2 border-white/20 bg-[#182036] shrink-0 relative group">
            {manga.cover_url ? (
              <img
                src={manga.cover_url}
                alt={manga.title}
                referrerPolicy="no-referrer"
                className="relative z-10 w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : null}

            <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center -z-0 opacity-40">
              <BookOpen size={48} className="text-slate-400" />
            </div>
          </div>

          {/* Details & Action Buttons */}
          <div className="flex-1 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-3">
                <span className="px-3 py-1 text-xs font-bold rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                  {manga.source.toUpperCase()}
                </span>
                {manga.status && (
                  <span className="px-3 py-1 text-xs font-medium rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {{ ongoing: 'Đang ra', completed: 'Hoàn thành' }[manga.status.toLowerCase()] ?? manga.status}
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white leading-tight tracking-tight">
                {manga.title}
              </h1>

              {manga.authors && manga.authors.length > 0 && (
                <p className="text-xs sm:text-sm text-slate-400 mt-2">
                  Tác giả: <span className="text-slate-200 font-medium">{manga.authors.join(', ')}</span>
                </p>
              )}

              {/* Genres */}
              {manga.genres && manga.genres.length > 0 && (
                <div className="flex flex-wrap justify-center md:justify-start gap-1.5 mt-3">
                  {manga.genres.map((g, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 text-xs rounded-xl bg-white/[0.04] text-slate-300 border border-white/[0.06]"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {/* Description */}
              {manga.description && (
                <p className="text-xs sm:text-sm text-slate-400 mt-4 line-clamp-4 leading-relaxed max-w-3xl">
                  {manga.description}
                </p>
              )}
            </div>

            {/* Quick Action Buttons */}
            <div className="pt-3 flex flex-wrap justify-center md:justify-start gap-3">
              {firstChapter && (
                <button
                  onClick={() => onOpenReader(firstChapter)}
                  className="px-6 py-3 bg-violet-600 text-white rounded-2xl text-sm font-bold shadow-xl hover:opacity-95 transition-all flex items-center gap-2 active:scale-95 cursor-pointer"
                >
                  <Eye size={18} />
                  <span>Đọc từ đầu (Chap {firstChapter.chapter_number})</span>
                </button>
              )}

              {latestChapter && latestChapter.id !== firstChapter?.id && (
                <button
                  onClick={() => onOpenReader(latestChapter)}
                  className="px-5 py-3 rounded-2xl bg-white/[0.06] text-white hover:bg-white/[0.1] border border-white/10 transition-all text-sm font-semibold flex items-center gap-2 active:scale-95 cursor-pointer"
                >
                  <Layers size={18} className="text-cyan-400" />
                  <span>Chap mới nhất ({latestChapter.chapter_number})</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Chapter List Section */}
      <div className="max-w-6xl mx-auto w-full p-4 sm:p-8 space-y-4">
        {/* Controls Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#182036] p-4 rounded-2xl border border-white/[0.06]">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-white">
              Danh sách chương ({chapters.length})
            </h2>
            <button
              onClick={() => setSortDesc(!sortDesc)}
              className="p-1.5 px-3 rounded-xl bg-white/[0.05] text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-white/[0.06]"
              title="Đổi thứ tự hiển thị"
            >
              <ArrowUpDown size={14} className="text-violet-400" />
              <span>{sortDesc ? 'Mới nhất' : 'Cũ nhất'}</span>
            </button>
          </div>

          {/* Chapter Filter Search */}
          <div className="relative">
            <Search className="absolute left-3.5 top-3 text-slate-500 pointer-events-none" size={16} />
            <input
              type="text"
              value={chapterSearch}
              onChange={(e) => setChapterSearch(e.target.value)}
              placeholder="Lọc theo số chương..."
              className="w-full sm:w-56 h-10 pl-10 pr-3.5 bg-white/[0.04] text-white rounded-xl text-xs placeholder-slate-500 border border-white/10 focus:border-violet-500/60 focus:outline-none"
            />
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs sm:text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="h-48 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 size={36} className="animate-spin text-violet-500" />
            <p className="text-xs">Đang tải danh sách chương...</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredChapters.map((chapter) => {
              const isDownloading = downloadingIds.has(chapter.id);
              return (
                <div
                  key={chapter.id}
                  className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-[#182036] border border-white/[0.06] hover:border-violet-500/40 hover:bg-white/[0.02] transition-all group min-h-[56px]"
                >
                  {/* Chapter Info Click to Read */}
                  <div
                    onClick={() => onOpenReader(chapter)}
                    className="flex-1 cursor-pointer pr-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <h4 className="text-xs sm:text-sm font-semibold text-slate-200 group-hover:text-violet-300 transition-colors">
                        {chapter.title}
                      </h4>
                      {chapter.language && chapter.language !== 'all' && (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-400 border border-white/[0.06]">
                          {chapter.language}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onOpenReader(chapter)}
                      className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-violet-600/20 transition-all cursor-pointer active:scale-90"
                      title="Đọc chương này"
                    >
                      <BookOpen size={16} />
                    </button>

                    <button
                      onClick={() => handleDownloadChapter(chapter)}
                      disabled={isDownloading}
                      className={`p-2.5 rounded-xl transition-all cursor-pointer active:scale-90 ${
                        isDownloading
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-white/[0.05] text-slate-300 hover:bg-violet-600 hover:text-white border border-white/[0.08]'
                      }`}
                      title={`Tải về dạng ${format.toUpperCase()}`}
                    >
                      {isDownloading ? (
                        <CheckCircle2 size={16} className="text-emerald-400" />
                      ) : (
                        <Download size={16} />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}

            {filteredChapters.length === 0 && !loading && (
              <div className="p-12 text-center text-slate-500 text-xs">
                Không tìm thấy chương nào khớp với bộ lọc.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
