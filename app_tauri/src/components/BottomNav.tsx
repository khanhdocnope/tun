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
    { id: 'cleaner' as NavTab, label: 'AI Clean', icon: Wand2 },
    { id: 'settings' as NavTab, label: 'Cài đặt', icon: SettingsIcon },
  ];

  return (
    <nav className="md:hidden fixed bottom-3 left-3 right-3 z-40 select-none pb-[env(safe-area-inset-bottom)] pointer-events-none">
      <div className="h-16 bg-[#0c0d18]/90 backdrop-blur-2xl border border-white/[0.1] rounded-3xl shadow-[0_12px_40px_rgba(0,0,0,0.85)] flex items-center justify-around px-2 pointer-events-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`flex flex-col items-center justify-center flex-1 h-full py-1 transition-all duration-200 relative active:scale-90 cursor-pointer ${
                isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {/* Active Glow Pill Indicator */}
              {isActive && (
                <span className="absolute top-1 w-8 h-1 rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400 shadow-[0_0_10px_rgba(168,85,247,0.7)]" />
              )}

              <div className="relative mt-1">
                <div
                  className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-all ${
                    isActive
                      ? 'bg-gradient-to-tr from-violet-600 to-purple-500 text-white shadow-md shadow-violet-500/30'
                      : ''
                  }`}
                >
                  <Icon size={19} className={isActive ? 'text-white' : 'currentColor'} />
                </div>

                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-fuchsia-500 text-white text-[10px] font-extrabold flex items-center justify-center shadow-md shadow-fuchsia-500/40">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>

              <span
                className={`text-[10px] mt-0.5 tracking-tight ${
                  isActive ? 'text-white font-bold' : 'text-slate-400 font-medium'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
