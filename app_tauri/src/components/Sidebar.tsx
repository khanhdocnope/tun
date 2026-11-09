import React, { useState } from 'react';
import { Compass, Download, BookOpen, Wand2, Settings as SettingsIcon, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export type NavTab = 'browse' | 'downloads' | 'library' | 'cleaner' | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  downloadCount: number;
}

export const NAV_ITEMS = [
  { id: 'browse' as NavTab, label: 'Khám phá', icon: Compass },
  { id: 'downloads' as NavTab, label: 'Tải về', icon: Download },
  { id: 'library' as NavTab, label: 'Kệ truyện', icon: BookOpen },
  { id: 'cleaner' as NavTab, label: 'Xóa chữ AI', icon: Wand2 },
  { id: 'settings' as NavTab, label: 'Cài đặt', icon: SettingsIcon },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, downloadCount }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`hidden md:flex flex-col shrink-0 h-full bg-ink-900 border-r border-white/[0.06] transition-[width] duration-200 ${
        collapsed ? 'w-[72px]' : 'w-56'
      }`}
    >
      {/* Wordmark — vùng kéo cửa sổ */}
      <div data-tauri-drag-region className={`h-16 flex items-center gap-3 px-4 ${collapsed ? 'justify-center' : ''}`}>
        <span className="w-8 h-8 rounded-[3px] bg-son-600 text-white grid place-items-center font-display font-black text-lg shrink-0">
          M
        </span>
        {!collapsed && (
          <span className="font-display font-extrabold text-2xl text-paper leading-none" style={{ fontStretch: '75%' }}>
            MoeJect
          </span>
        )}
      </div>

      <nav className="flex-1 px-2.5 pt-3 space-y-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          const badge = id === 'downloads' ? downloadCount : 0;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              title={collapsed ? label : undefined}
              className={`relative w-full h-11 flex items-center gap-3 rounded-md cursor-pointer transition-colors ${
                collapsed ? 'justify-center' : 'px-3'
              } ${active ? 'bg-ink-700 text-paper font-semibold' : 'text-slate-400 hover:text-paper hover:bg-white/[0.04]'}`}
            >
              {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-son-500" />}
              {active && !collapsed && (
                <span className="halftone absolute right-0 inset-y-0 w-16 text-white/[0.09] pointer-events-none rounded-r-md [mask-image:linear-gradient(90deg,transparent,black)]" />
              )}
              <Icon size={19} className={active ? 'text-son-400' : ''} />
              {!collapsed && <span className="text-sm">{label}</span>}
              {badge > 0 && (
                <span
                  className={`bg-son-600 text-white text-[11px] font-bold rounded-full min-w-5 h-5 px-1.5 grid place-items-center ${
                    collapsed ? 'absolute top-1 right-2' : 'ml-auto relative'
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        title={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
        className={`m-2.5 h-10 flex items-center gap-3 rounded-md text-slate-500 hover:text-paper hover:bg-white/[0.04] cursor-pointer ${
          collapsed ? 'justify-center' : 'px-3'
        }`}
      >
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        {!collapsed && <span className="text-xs">Thu gọn</span>}
      </button>
    </aside>
  );
};
