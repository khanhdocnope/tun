import React, { useEffect, useState } from 'react';
import { ArrowLeft, Download, BookOpen, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
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
      });
    } catch (err) {
      console.error('Download start failed:', err);
    }
  };

  const handleDownloadAll = async () => {
    for (const chapter of chapters) {
      await handleDownloadChapter(chapter);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1e2e] overflow-y-auto">
      {/* Header with Back Button */}
      <div className="p-4 border-b border-[#313244] bg-[#181825]/60 backdrop-blur-md sticky top-0 z-10 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#313244]/60 transition-colors"
        >
          <ArrowLeft size={18} />
          <span>Quay lại Khám phá</span>
        </button>

        <div className="flex items-center gap-3">
          <span className="text-xs text-[#a6adc8]">Định dạng tải:</span>
          <div className="flex bg-[#313244] p-0.5 rounded-lg">
            <button
              onClick={() => setFormat('cbz')}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${
                format === 'cbz' ? 'bg-[#b4befe] text-[#11111b]' : 'text-[#a6adc8] hover:text-[#cdd6f4]'
              }`}
            >
              CBZ (Chuẩn Comic)
            </button>
            <button
              onClick={() => setFormat('zip')}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-colors ${
                format === 'zip' ? 'bg-[#b4befe] text-[#11111b]' : 'text-[#a6adc8] hover:text-[#cdd6f4]'
              }`}
            >
              ZIP (Ảnh thô)
            </button>
          </div>

          <button
            onClick={handleDownloadAll}
            disabled={loading || chapters.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-[#b4befe] text-[#11111b] rounded-xl text-xs font-bold hover:bg-[#cba6f7] transition-colors disabled:opacity-50"
          >
            <Download size={14} />
            <span>Tải toàn bộ ({chapters.length})</span>
          </button>
        </div>
      </div>

      {/* Manga Information Banner */}
      <div className="p-8 max-w-5xl mx-auto w-full flex flex-col md:flex-row gap-8">
        {/* Cover */}
        <div className="w-48 sm:w-56 shrink-0 aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl border border-[#313244] bg-[#11111b] mx-auto md:mx-0">
          <img
            src={manga.cover_url}
            alt={manga.title}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'https://placehold.co/256x360?text=No+Cover';
            }}
          />
        </div>

        {/* Info */}
        <div className="flex-1 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-[#cba6f7]/20 text-[#cba6f7] border border-[#cba6f7]/30">
                {manga.source.toUpperCase()}
              </span>
              {manga.status && (
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-[#a6e3a1]/20 text-[#a6e3a1]">
                  {manga.status}
                </span>
              )}
            </div>

            <h1 className="text-2xl font-extrabold text-[#cdd6f4] tracking-tight">{manga.title}</h1>

            {manga.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {manga.genres.map((g, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-lg text-[11px] bg-[#313244] text-[#a6adc8]">
                    {g}
                  </span>
                ))}
              </div>
            )}

            {manga.description && (
              <p className="mt-4 text-xs text-[#a6adc8] leading-relaxed line-clamp-4 bg-[#181825] p-3 rounded-xl border border-[#313244]/40">
                {manga.description}
              </p>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-[#313244] flex items-center justify-between text-xs text-[#a6adc8]">
            <span>Tổng cộng: <strong className="text-[#cdd6f4]">{chapters.length}</strong> chương</span>
            <span>Hỗ trợ: CBZ + ComicInfo.xml, ZIP</span>
          </div>
        </div>
      </div>

      {/* Chapter List */}
      <div className="max-w-5xl mx-auto w-full px-8 pb-12">
        <h2 className="text-base font-bold text-[#cdd6f4] mb-4 flex items-center gap-2">
          <BookOpen size={18} className="text-[#b4befe]" />
          <span>Danh sách chương</span>
        </h2>

        {loading && (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-[#a6adc8]">
            <Loader2 size={32} className="animate-spin text-[#b4befe]" />
            <p className="text-xs">Đang tải danh sách chương từ máy chủ...</p>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-[#f38ba8]/10 border border-[#f38ba8]/30 text-[#f38ba8] text-xs">
            {error}
          </div>
        )}

        {!loading && chapters.length === 0 && !error && (
          <div className="py-12 text-center text-xs text-[#6c7086]">
            Không tìm thấy chương nào cho bộ truyện này.
          </div>
        )}

        {!loading && chapters.length > 0 && (
          <div className="space-y-2">
            {chapters.map((ch) => {
              const isDownloading = downloadingIds.has(ch.id);
              return (
                <div
                  key={ch.id}
                  className="flex items-center justify-between p-3.5 rounded-xl bg-[#181825] border border-[#313244]/60 hover:border-[#b4befe]/40 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-[#313244] text-[#b4befe] flex items-center justify-center font-bold text-xs">
                      #{ch.chapter_number}
                    </span>
                    <span className="font-semibold text-sm text-[#cdd6f4] group-hover:text-[#b4befe] transition-colors">
                      {ch.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onOpenReader(ch)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#313244] text-[#cdd6f4] hover:bg-[#b4befe] hover:text-[#11111b] transition-colors flex items-center gap-1.5"
                    >
                      <BookOpen size={14} />
                      <span>Đọc ngay</span>
                    </button>

                    <button
                      onClick={() => handleDownloadChapter(ch)}
                      disabled={isDownloading}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                        isDownloading
                          ? 'bg-[#a6e3a1]/20 text-[#a6e3a1] cursor-not-allowed'
                          : 'bg-[#b4befe] text-[#11111b] hover:bg-[#cba6f7]'
                      }`}
                    >
                      {isDownloading ? (
                        <>
                          <CheckCircle2 size={14} />
                          <span>Đã thêm hàng đợi</span>
                        </>
                      ) : (
                        <>
                          <Download size={14} />
                          <span>Tải {format.toUpperCase()}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
