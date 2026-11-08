import React from 'react';
import { Compass, Download, BookOpen, Wand2, Settings as SettingsIcon } from 'lucide-react';

export type NavTab = 'browse' | 'downloads' | 'library' | 'cleaner' | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  downloadCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, downloadCount }) => {
  const navItems = [
    { id: 'browse' as NavTab, label: 'Khám phá', icon: Compass },
    { id: 'downloads' as NavTab, label: 'Tải về', icon: Download, badge: downloadCount },
    { id: 'library' as NavTab, label: 'Kệ truyện', icon: BookOpen },
    { id: 'cleaner' as NavTab, label: 'AI Cleaner', icon: Wand2 },
    { id: 'settings' as NavTab, label: 'Cài đặt', icon: SettingsIcon },
  ];

  return (
    <aside className="hidden md:flex w-64 bg-[#181825] border-r border-[#313244] flex-col justify-between select-none shrink-0 h-full">
      <div>
        {/* Brand Header & Window Drag Area */}
        <div
          data-tauri-drag-region
          className="p-5 flex items-center gap-3 border-b border-[#313244]/60 cursor-default"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#cba6f7] to-[#b4befe] flex items-center justify-center shadow-lg shadow-[#cba6f7]/20 shrink-0">
            <span className="font-extrabold text-[#11111b] text-xl">M</span>
          </div>
          <div className="overflow-hidden">
            <h1 className="font-bold text-base text-[#cdd6f4] tracking-wide truncate">MoeJect</h1>
            <p className="text-[11px] text-[#a6adc8] truncate">Omni Manga Ecosystem</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="p-3 space-y-1.5 mt-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#313244] text-[#b4befe] shadow-sm font-semibold'
                    : 'text-[#a6adc8] hover:bg-[#313244]/50 hover:text-[#cdd6f4]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon size={18} className={isActive ? 'text-[#b4befe]' : 'text-[#6c7086]'} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-[#cba6f7] text-[#11111b] shadow-sm">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-[#313244]/60 bg-[#11111b]/30">
        <div className="flex items-center justify-between text-xs text-[#6c7086]">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#a6e3a1] animate-pulse"></span>
            <span>Tauri v2 Native</span>
          </span>
          <span className="font-mono text-[10px] text-[#a6adc8]">v1.0.0</span>
        </div>
      </div>
    </aside>
  );
};
