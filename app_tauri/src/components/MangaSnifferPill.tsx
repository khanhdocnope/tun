import React, { useState } from 'react';
import {
  Sparkles,
  Download,
  BookOpen,
  ArrowDownCircle,
  Loader2,
  X,
  Layers,
  CheckCircle2,
} from 'lucide-react';

interface MangaSnifferPillProps {
  detectedPages: string[];
  isAutoScrolling: boolean;
  scrollProgress: number;
  onTriggerAutoScroll: () => void;
  onDownloadChapter: () => void;
  onReadNative: () => void;
  onCleanWithAi: () => void;
  onDismiss: () => void;
}

export const MangaSnifferPill: React.FC<MangaSnifferPillProps> = ({
  detectedPages,
  isAutoScrolling,
  scrollProgress,
  onTriggerAutoScroll,
  onDownloadChapter,
  onReadNative,
  onCleanWithAi,
  onDismiss,
}) => {
  const [minimized, setMinimized] = useState(false);

  if (detectedPages.length < 3) return null;

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-3.5 py-2 rounded-full bg-son-600/90 hover:bg-son-500 text-white shadow-xl backdrop-blur-md border border-white/20 text-xs font-semibold cursor-pointer transition-all scale-100 hover:scale-105"
        title="Mở bảng điều khiển Manga"
      >
        <Layers size={14} />
        <span>{detectedPages.length} trang</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex items-center gap-2 p-1.5 rounded-2xl bg-ink-900/95 text-paper border border-white/15 shadow-[0_10px_35px_rgba(0,0,0,0.8)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-3 duration-200">
      <div className="flex items-center gap-2 pl-3 pr-2 text-xs font-semibold text-son-300">
        <Layers size={15} className="text-son-400" />
        <span>{detectedPages.length} trang</span>
      </div>

      <div className="h-4 w-px bg-white/15" />

      {/* Auto-scroll button */}
      <button
        onClick={onTriggerAutoScroll}
        disabled={isAutoScrolling}
        className="flex items-center gap-1.5 h-8 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-slate-300 hover:text-paper cursor-pointer disabled:opacity-70 transition-colors"
        title="Tự động cuộn trang để kích hoạt toàn bộ ảnh lazy-load"
      >
        {isAutoScrolling ? (
          <>
            <Loader2 size={13} className="animate-spin text-son-400" />
            <span className="font-mono text-son-300">{scrollProgress}%</span>
          </>
        ) : (
          <>
            <ArrowDownCircle size={14} className="text-emerald-400" />
            <span>Cuộn gom ảnh</span>
          </>
        )}
      </button>

      {/* Download button */}
      <button
        onClick={onDownloadChapter}
        className="flex items-center gap-1.5 h-8 px-3.5 rounded-xl bg-son-600 hover:bg-son-500 text-white text-xs font-semibold shadow-md shadow-son-600/30 cursor-pointer transition-all"
        title="Tải chương truyện này về máy (.CBZ)"
      >
        <Download size={14} />
        <span>Tải về</span>
      </button>

      {/* Read native button */}
      <button
        onClick={onReadNative}
        className="flex items-center gap-1.5 h-8 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-slate-300 hover:text-paper cursor-pointer transition-colors"
        title="Mở đọc trong trình đọc mượt mà của MoeJect"
      >
        <BookOpen size={14} className="text-blue-400" />
        <span>Đọc Native</span>
      </button>

      {/* Clean with AI button */}
      <button
        onClick={onCleanWithAi}
        className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-amber-300 cursor-pointer transition-colors"
        title="Gửi trang sang AI Text Cleaner"
      >
        <Sparkles size={14} />
      </button>

      {/* Minimize / Dismiss */}
      <button
        onClick={() => setMinimized(true)}
        className="p-1.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/10 cursor-pointer transition-colors"
        title="Thu nhỏ"
      >
        <X size={14} />
      </button>
    </div>
  );
};
