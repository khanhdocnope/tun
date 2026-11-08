import React from 'react';
import { Compass, Download, BookOpen, Wand2, Settings as SettingsIcon } from 'lucide-react';
import { NavTab } from './Sidebar';

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  downloadCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onTabChange,
  downloadCount,
}) => {
  const navItems = [
    { id: 'browse' as NavTab, label: 'Khám phá', icon: Compass },
    { id: 'downloads' as NavTab, label: 'Tải về', icon: Download, badge: downloadCount },
    { id: 'library' as NavTab, label: 'Kệ truyện', icon: BookOpen },
    { id: 'cleaner' as NavTab, label: 'AI Cleaner', icon: Wand2 },
    { id: 'settings' as NavTab, label: 'Cài đặt', icon: SettingsIcon },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#181825]/95 backdrop-blur-xl border-t border-[#313244]/80 z-40 flex items-center justify-around px-2 pb-[env(safe-area-inset-bottom)] select-none shadow-2xl"
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all relative active:scale-95 cursor-pointer ${
              isActive ? 'text-[#b4befe]' : 'text-[#6c7086] hover:text-[#a6adc8]'
            }`}
          >
            {/* Active Pill Highlight */}
            {isActive && (
              <span className="absolute top-1.5 w-8 h-1 rounded-full bg-[#b4befe] shadow-sm shadow-[#b4befe]/50 transition-all" />
            )}

            <div className="relative mt-1">
              <Icon size={20} className={isActive ? 'text-[#b4befe]' : 'currentColor'} />
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-[#cba6f7] text-[#11111b] text-[10px] font-extrabold flex items-center justify-center shadow-md">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </div>

            <span className={`text-[10px] mt-0.5 font-medium tracking-tight ${isActive ? 'text-[#cdd6f4] font-semibold' : ''}`}>
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
