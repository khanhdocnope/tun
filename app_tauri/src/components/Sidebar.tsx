import React, { useState } from 'react';
import {
  Compass,
  Download,
  BookOpen,
  Wand2,
  Settings as SettingsIcon,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Flame,
} from 'lucide-react';

export type NavTab = 'browse' | 'downloads' | 'library' | 'cleaner' | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  downloadCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, downloadCount }) => {
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    { id: 'browse' as NavTab, label: 'Khám phá', icon: Compass, hot: true },
    { id: 'downloads' as NavTab, label: 'Tải về', icon: Download, badge: downloadCount },
    { id: 'library' as NavTab, label: 'Kệ truyện', icon: BookOpen },
    { id: 'cleaner' as NavTab, label: 'AI Cleaner', icon: Wand2, spark: true },
    { id: 'settings' as NavTab, label: 'Cài đặt', icon: SettingsIcon },
  ];

  return (
    <aside
      className={`hidden md:flex flex-col justify-between shrink-0 h-full transition-all duration-300 z-30 select-none relative bg-[#0a0b12]/90 backdrop-blur-2xl border-r border-white/[0.07] ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Glow highlight background blur */}
      <div className="absolute top-0 left-0 w-32 h-32 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

      <div>
        {/* Brand Header & Window Drag Area */}
        <div
          data-tauri-drag-region
          className={`h-20 flex items-center border-b border-white/[0.06] cursor-default px-4 relative ${
            collapsed ? 'justify-center' : 'justify-between'
          }`}
        >
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="relative group shrink-0">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-violet-600 via-purple-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-violet-500/25 ring-1 ring-white/20 transition-transform group-hover:scale-105">
                <Sparkles size={20} className="text-white" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full ring-2 ring-[#0a0b12]" />
            </div>

            {!collapsed && (
              <div className="flex flex-col overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold text-base tracking-wide text-white">MoeJect</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-violet-500/20 text-violet-300 border border-violet-500/30 font-mono">
                    PRO
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium truncate">Manga Universe</span>
              </div>
            )}
          </div>

          {/* Collapse/Expand Toggle Button */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`p-1.5 rounded-xl bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer border border-white/[0.06] active:scale-90 ${
              collapsed ? 'absolute -right-3 top-7 z-40 bg-[#131524] shadow-md shadow-black/50' : ''
            }`}
            title={collapsed ? 'Mở rộng thanh menu' : 'Thu gọn thanh menu'}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Section title */}
        {!collapsed && (
          <div className="px-5 pt-5 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center justify-between">
            <span>Menu chính</span>
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500/60" />
          </div>
        )}

        {/* Navigation Items */}
        <nav className="p-3 space-y-1.5 mt-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center rounded-2xl transition-all duration-200 cursor-pointer relative group ${
                  collapsed ? 'justify-center p-3' : 'px-3.5 py-2.5 justify-between'
                } ${
                  isActive
                    ? 'bg-gradient-to-r from-violet-600/30 via-purple-600/20 to-transparent text-white font-semibold border-l-2 border-violet-400 shadow-sm shadow-violet-500/10'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors shrink-0 ${
                      isActive
                        ? 'bg-violet-500 text-white shadow-md shadow-violet-500/40'
                        : 'bg-white/[0.03] text-slate-400 group-hover:text-slate-200 group-hover:bg-white/[0.06]'
                    }`}
                  >
                    <Icon size={18} />
                  </div>

                  {!collapsed && (
                    <span className="text-sm font-medium tracking-wide">{item.label}</span>
                  )}
                </div>

                {/* Badges */}
                {!collapsed && (
                  <div className="flex items-center gap-1.5">
                    {item.hot && !isActive && (
                      <Flame size={14} className="text-amber-400 animate-pulse" />
                    )}
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="px-2 py-0.5 text-[11px] font-extrabold rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/30 animate-pulse">
                        {item.badge}
                      </span>
                    )}
                  </div>
                )}

                {/* Collapsed Badge Dot */}
                {collapsed && item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-fuchsia-500 ring-2 ring-[#0a0b12] animate-ping" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer System Status */}
      <div className="p-3.5 border-t border-white/[0.06] bg-black/20 m-2 rounded-2xl border border-white/[0.04]">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            {!collapsed && (
              <span className="text-[11px] font-medium text-slate-400">Tauri Engine</span>
            )}
          </div>
          {!collapsed && (
            <span className="font-mono text-[10px] text-slate-500 font-semibold bg-white/[0.04] px-1.5 py-0.5 rounded border border-white/[0.05]">
              v2.0
            </span>
          )}
        </div>
      </div>
    </aside>
  );
};
