import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Lock,
  Search,
  Plus,
  X,
  Star,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
  Download,
} from 'lucide-react';
import { BrowserTab } from '../types';

interface BrowserHeaderProps {
  tabs: BrowserTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onGoHome: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  onOpenDownloads: () => void;
}

export const BrowserHeader: React.FC<BrowserHeaderProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onGoHome,
  isSidebarOpen,
  onToggleSidebar,
  isBookmarked,
  onToggleBookmark,
  onOpenDownloads,
}) => {
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const [inputUrl, setInputUrl] = useState(activeTab?.url || '');

  useEffect(() => {
    if (activeTab) {
      setInputUrl(activeTab.url);
    }
  }, [activeTab?.url, activeTabId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = inputUrl.trim();
    if (!val) return;

    if (val.startsWith('http://') || val.startsWith('https://')) {
      onNavigate(val);
    } else if (val.includes('.') && !val.includes(' ')) {
      onNavigate(`https://${val}`);
    } else {
      // Treat as search query via Google
      onNavigate(`https://www.google.com/search?q=${encodeURIComponent(val)}`);
    }
  };

  return (
    <header className="bg-ink-900 border-b border-white/[0.08] select-none text-slate-300">
      {/* Top Tabs Bar */}
      <div className="flex items-center px-2 pt-1 gap-1 overflow-x-auto no-scrollbar">
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-md hover:bg-white/10 text-slate-400 hover:text-paper transition-colors shrink-0 mr-1"
          title={isSidebarOpen ? 'Thu gọn thanh bên' : 'Mở bảng điều khiển'}
        >
          {isSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </button>

        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group flex items-center gap-2 max-w-[200px] min-w-[120px] h-8 px-3 rounded-t-lg text-xs cursor-pointer border-t border-x transition-all ${
                isActive
                  ? 'bg-ink-800 border-white/15 text-paper font-medium shadow-sm'
                  : 'bg-transparent border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              <div className="w-2 h-2 rounded-full shrink-0 bg-son-500 opacity-80" />
              <span className="truncate flex-1">{tab.title || 'Tab mới'}</span>

              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-paper transition-opacity"
                  title="Đóng tab"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}

        <button
          onClick={onNewTab}
          className="p-1.5 rounded-md hover:bg-white/10 text-slate-400 hover:text-paper transition-colors shrink-0 ml-1"
          title="Mở tab mới"
        >
          <Plus size={15} />
        </button>
      </div>

      {/* Navigation & URL Bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-ink-850">
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onGoBack}
            disabled={!activeTab?.canGoBack}
            className="p-1.5 rounded-md hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Quay lại"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            onClick={onGoForward}
            disabled={!activeTab?.canGoForward}
            className="p-1.5 rounded-md hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Tiến lên"
          >
            <ArrowRight size={16} />
          </button>
          <button
            onClick={onReload}
            className="p-1.5 rounded-md hover:bg-white/10 text-slate-300 hover:text-paper transition-colors"
            title="Tải lại trang"
          >
            <RotateCw size={15} className={activeTab?.isLoading ? 'animate-spin text-son-400' : ''} />
          </button>
          <button
            onClick={onGoHome}
            className="p-1.5 rounded-md hover:bg-white/10 text-slate-300 hover:text-paper transition-colors"
            title="Trang chủ Manga"
          >
            <Home size={16} />
          </button>
        </div>

        {/* Address / URL Input */}
        <form onSubmit={handleSubmit} className="flex-1 relative flex items-center">
          <div className="absolute left-3 text-slate-500 flex items-center pointer-events-none">
            {inputUrl.startsWith('https://') ? (
              <Lock size={13} className="text-emerald-400" />
            ) : (
              <Search size={14} />
            )}
          </div>

          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="Nhập URL web truyện hoặc từ khóa tìm kiếm…"
            className="w-full h-8 pl-8 pr-9 rounded-md bg-ink-950/80 border border-white/10 text-xs text-paper placeholder-slate-500 focus:outline-none focus:border-son-500/80 focus:ring-1 focus:ring-son-500/50 transition-all"
          />

          <button
            type="button"
            onClick={onToggleBookmark}
            className={`absolute right-2.5 p-1 rounded hover:bg-white/10 transition-colors ${
              isBookmarked ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
            }`}
            title={isBookmarked ? 'Bỏ đánh dấu' : 'Đánh dấu trang này'}
          >
            <Star size={14} fill={isBookmarked ? 'currentColor' : 'none'} />
          </button>
        </form>

        <button
          onClick={onOpenDownloads}
          className="p-1.5 rounded-md hover:bg-white/10 text-slate-300 hover:text-son-400 transition-colors shrink-0 ml-1"
          title="Mở hàng đợi tải"
        >
          <Download size={16} />
        </button>
      </div>
    </header>
  );
};
