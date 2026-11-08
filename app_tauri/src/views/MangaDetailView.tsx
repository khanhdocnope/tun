import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Download, BookOpen, Loader2, Sparkles, CheckCircle2, ArrowUpDown, Search, Eye } from 'lucide-react';
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

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-y-auto select-none">
      {/* Top Floating App Bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between p-3 sm:p-4 bg-[#181825]/90 backdrop-blur-md border-b border-[#313244]">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#313244]/80 text-[#cdd6f4] hover:bg-[#b4befe] hover:text-[#11111b] transition-all text-sm font-semibold active:scale-95 cursor-pointer"
        >
          <ArrowLeft size={16} />
          <span>Quay lại</span>
        </button>

        <div className="flex items-center gap-2">
          {/* Format Toggle Pill */}
          <div className="flex bg-[#313244] p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setFormat('cbz')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                format === 'cbz' ? 'bg-[#b4befe] text-[#11111b] shadow-sm font-bold' : 'text-[#a6adc8] hover:text-[#cdd6f4]'
              }`}
            >
              CBZ
            </button>
            <button
              onClick={() => setFormat('zip')}
              className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                format === 'zip' ? 'bg-[#b4befe] text-[#11111b] shadow-sm font-bold' : 'text-[#a6adc8] hover:text-[#cdd6f4]'
              }`}
            >
              ZIP
            </button>
          </div>

          <button
            onClick={handleDownloadAll}
            disabled={loading || chapters.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#b4befe] text-[#11111b] rounded-xl text-xs font-bold hover:bg-[#cba6f7] transition-all active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <Download size={14} />
            <span className="hidden sm:inline">Tải toàn bộ</span> ({chapters.length})
          </button>
        </div>
      </div>

      {/* Hero Header Area */}
      <div className="relative overflow-hidden bg-gradient-to-b from-[#181825] to-[#1e1e2e] border-b border-[#313244] p-4 sm:p-8">
        {/* Blurred Cover Backdrop */}
        {manga.cover_url && (
          <div
            className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-15 scale-125 pointer-events-none"
            style={{ backgroundImage: `url(${manga.cover_url})` }}
          />
        )}

        <div className="relative z-10 max-w-5xl mx-auto flex flex-col md:flex-row gap-5 sm:gap-8 items-center md:items-start text-center md:text-left">
          {/* Cover Card */}
          <div className="w-36 sm:w-52 aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl border border-[#45475a] bg-[#11111b] shrink-0 relative group">
            {manga.cover_url ? (
              <img
                src={manga.cover_url}
                alt={manga.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : null}
            <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center -z-0 opacity-40">
              <BookOpen size={42} className="text-[#a6adc8]" />
            </div>
            <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#11111b]/80 backdrop-blur-sm text-[#b4befe]">
              {manga.source.toUpperCase()}
            </div>
          </div>

          {/* Metadata */}
          <div className="flex-1 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-2">
                <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-[#cba6f7]/20 text-[#cba6f7] border border-[#cba6f7]/30">
                  {manga.source.toUpperCase()}
                </span>
                {manga.status && (
                  <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-[#a6e3a1]/20 text-[#a6e3a1] border border-[#a6e3a1]/30 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#a6e3a1]"></span>
                    {manga.status}
                  </span>
                )}
              </div>

              <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-[#cdd6f4] leading-tight">
                {manga.title}
              </h1>

              {manga.authors && manga.authors.length > 0 && (
                <p className="text-xs sm:text-sm text-[#a6adc8] mt-1.5">
                  Tác giả: <span className="text-[#cdd6f4] font-medium">{manga.authors.join(', ')}</span>
                </p>
              )}

              {/* Genre Chips */}
              {manga.genres && manga.genres.length > 0 && (
                <div className="flex flex-wrap justify-center md:justify-start gap-1.5 mt-3">
                  {manga.genres.map((g, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 text-[11px] rounded-lg bg-[#313244]/80 text-[#bac2de] border border-white/5"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {/* Description */}
              {manga.description && (
                <p className="text-xs sm:text-sm text-[#a6adc8] mt-3 line-clamp-3 leading-relaxed max-w-3xl">
                  {manga.description}
                </p>
              )}
            </div>

            {/* Quick Action Button */}
            {firstChapter && (
              <div className="pt-2 flex justify-center md:justify-start">
                <button
                  onClick={() => onOpenReader(firstChapter)}
                  className="px-6 py-2.5 bg-gradient-to-r from-[#b4befe] to-[#cba6f7] text-[#11111b] rounded-xl text-sm font-bold shadow-lg shadow-[#b4befe]/20 hover:opacity-95 transition-all flex items-center gap-2 active:scale-95 cursor-pointer"
                >
                  <Eye size={18} />
                  <span>Đọc từ chương 1 ({firstChapter.title})</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chapter List Section */}
      <div className="max-w-5xl mx-auto w-full p-4 sm:p-8">
        {/* Chapter Header & Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-[#cdd6f4]">
              Danh sách chương ({chapters.length})
            </h2>
            <button
              onClick={() => setSortDesc(!sortDesc)}
              className="p-1.5 rounded-lg bg-[#313244] text-[#a6adc8] hover:text-[#cdd6f4] transition-colors flex items-center gap-1 text-xs font-medium cursor-pointer"
              title="Đổi thứ tự hiển thị"
            >
              <ArrowUpDown size={14} />
              <span>{sortDesc ? 'Mới nhất' : 'Cũ nhất'}</span>
            </button>
          </div>

          {/* Chapter Filter Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-[#6c7086] pointer-events-none" size={16} />
            <input
              type="text"
              value={chapterSearch}
              onChange={(e) => setChapterSearch(e.target.value)}
              placeholder="Lọc số chương..."
              className="w-full sm:w-48 h-9 pl-9 pr-3 bg-[#313244] text-[#cdd6f4] rounded-xl text-xs placeholder-[#6c7086] border border-[#45475a] focus:border-[#b4befe] focus:outline-none"
            />
          </div>
        </div>

        {error && (
          <div className="p-4 mb-4 rounded-xl bg-[#f38ba8]/10 border border-[#f38ba8]/30 text-[#f38ba8] text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="h-48 flex flex-col items-center justify-center gap-3 text-[#a6adc8]">
            <Loader2 size={32} className="animate-spin text-[#b4befe]" />
            <p className="text-xs">Đang nạp danh sách chương...</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredChapters.map((chapter) => {
              const isDownloading = downloadingIds.has(chapter.id);
              return (
                <div
                  key={chapter.id}
                  className="flex items-center justify-between p-3.5 sm:p-4 rounded-xl bg-[#181825] border border-[#313244]/60 hover:border-[#b4befe]/40 transition-all group min-h-[50px]"
                >
                  {/* Chapter Info Click to Read */}
                  <div
                    onClick={() => onOpenReader(chapter)}
                    className="flex-1 cursor-pointer pr-3"
                  >
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-[#cdd6f4] group-hover:text-[#b4befe] transition-colors">
                        {chapter.title}
                      </h4>
                      {chapter.language && chapter.language !== 'all' && (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-[#313244] text-[#a6adc8]">
                          {chapter.language}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onOpenReader(chapter)}
                      className="p-2 rounded-xl text-[#a6adc8] hover:text-[#b4befe] hover:bg-[#313244] transition-all cursor-pointer active:scale-90"
                      title="Đọc ngay"
                    >
                      <BookOpen size={16} />
                    </button>

                    <button
                      onClick={() => handleDownloadChapter(chapter)}
                      disabled={isDownloading}
                      className={`p-2 rounded-xl transition-all cursor-pointer active:scale-90 ${
                        isDownloading
                          ? 'bg-[#a6e3a1]/20 text-[#a6e3a1]'
                          : 'bg-[#313244] text-[#cdd6f4] hover:bg-[#b4befe] hover:text-[#11111b]'
                      }`}
                      title={`Tải về dạng ${format.toUpperCase()}`}
                    >
                      {isDownloading ? (
                        <CheckCircle2 size={16} className="text-[#a6e3a1]" />
                      ) : (
                        <Download size={16} />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}

            {filteredChapters.length === 0 && !loading && (
              <div className="p-8 text-center text-[#6c7086] text-xs">
                Không tìm thấy chương nào khớp với bộ lọc.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
