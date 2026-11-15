import React from 'react';
import {
  Globe,
  Star,
  RotateCcw,
  BookOpen,
  Search,
  ExternalLink,
  Flame,
} from 'lucide-react';
import { BookmarkItem } from '../types';

interface MangaSpeedDialProps {
  onNavigate: (url: string) => void;
  bookmarks: BookmarkItem[];
  lastSessionUrl?: string | null;
  onRestoreSession: () => void;
}

const POPULAR_HUBS = [
  {
    name: 'MangaDex',
    url: 'https://mangadex.org',
    desc: 'Kho manga toàn cầu lớn nhất',
    color: 'from-orange-500/20 to-orange-600/5',
    border: 'border-orange-500/30',
  },
  {
    name: 'Cứu Truyện',
    url: 'https://cuutruyen.net',
    desc: 'Bản dịch tiếng Việt chất lượng cao',
    color: 'from-emerald-500/20 to-emerald-600/5',
    border: 'border-emerald-500/30',
  },
  {
    name: 'ComicK',
    url: 'https://comick.dev',
    desc: 'Kho Manhwa/Manga cập nhật liên tục',
    color: 'from-blue-500/20 to-blue-600/5',
    border: 'border-blue-500/30',
  },
  {
    name: 'Hitomi.la',
    url: 'https://hitomi.la',
    desc: 'Hơn 100,000+ bộ tranh gallery',
    color: 'from-purple-500/20 to-purple-600/5',
    border: 'border-purple-500/30',
  },
  {
    name: 'Asura Scans',
    url: 'https://asuracomic.net',
    desc: 'Chuyên Manhwa hành động, solo level',
    color: 'from-rose-500/20 to-rose-600/5',
    border: 'border-rose-500/30',
  },
  {
    name: 'NetTruyen',
    url: 'https://nettruyenx.com',
    desc: 'Cộng đồng đọc truyện phong phú',
    color: 'from-cyan-500/20 to-cyan-600/5',
    border: 'border-cyan-500/30',
  },
];

export const MangaSpeedDial: React.FC<MangaSpeedDialProps> = ({
  onNavigate,
  bookmarks,
  lastSessionUrl,
  onRestoreSession,
}) => {
  return (
    <div className="w-full h-full overflow-y-auto px-6 py-10 bg-ink-950 flex flex-col items-center select-none">
      <div className="max-w-4xl w-full flex flex-col items-center">
        {/* Logo & Slogan */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-son-600 to-amber-500 flex items-center justify-center shadow-lg shadow-son-600/30 text-white font-black text-xl">
            M
          </div>
          <h1 className="text-2xl font-bold text-paper font-heading">
            MoeJect <span className="text-son-400 font-sans text-sm font-normal ml-1">Manga Browser</span>
          </h1>
        </div>
        <p className="text-xs text-slate-400 mb-8 text-center max-w-md">
          Trình duyệt chuyên manga siêu nhẹ — Vượt mọi tường lửa và rào cản Cloudflare tự nhiên.
        </p>

        {/* Restore Previous Session Banner if available */}
        {lastSessionUrl && (
          <div className="w-full max-w-xl mb-8 p-3.5 rounded-xl bg-ink-900 border border-son-500/30 flex items-center justify-between gap-4 shadow-lg shadow-black/40">
            <div className="flex items-center gap-3 min-w-0">
              <RotateCcw size={18} className="text-son-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-paper">Khôi phục phiên đọc dở</p>
                <p className="text-[11px] text-slate-400 truncate">{lastSessionUrl}</p>
              </div>
            </div>
            <button
              onClick={onRestoreSession}
              className="px-3.5 py-1.5 rounded-lg bg-son-600 hover:bg-son-500 text-white text-xs font-semibold shrink-0 cursor-pointer transition-colors shadow-sm"
            >
              Mở lại ngay
            </button>
          </div>
        )}

        {/* Popular Manga Hubs Grid */}
        <div className="w-full mb-10">
          <div className="flex items-center gap-2 mb-4 text-xs font-semibold text-slate-400">
            <Flame size={15} className="text-son-400" />
            <span>Nguồn Truyện Phổ Biến</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {POPULAR_HUBS.map((hub) => (
              <button
                key={hub.name}
                onClick={() => onNavigate(hub.url)}
                className={`flex items-start gap-3 p-3.5 rounded-xl bg-gradient-to-br ${hub.color} bg-ink-900 border ${hub.border} hover:border-son-400 text-left cursor-pointer transition-all hover:scale-[1.02] shadow-md group`}
              >
                <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0 text-slate-200 group-hover:text-son-300 transition-colors">
                  <Globe size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs font-semibold text-paper group-hover:text-son-300 flex items-center justify-between">
                    <span>{hub.name}</span>
                    <ExternalLink size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{hub.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* User Bookmarks */}
        {bookmarks.length > 0 && (
          <div className="w-full">
            <div className="flex items-center gap-2 mb-4 text-xs font-semibold text-slate-400">
              <Star size={15} className="text-amber-400" />
              <span>Dấu trang của bạn ({bookmarks.length})</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
              {bookmarks.map((bm) => (
                <button
                  key={bm.id}
                  onClick={() => onNavigate(bm.url)}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg bg-ink-900/60 hover:bg-ink-850 border border-white/5 hover:border-white/15 text-left cursor-pointer transition-colors"
                >
                  <BookOpen size={14} className="text-slate-400 shrink-0" />
                  <span className="text-xs text-slate-300 truncate">{bm.title || bm.url}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
