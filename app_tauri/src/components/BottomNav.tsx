import React from 'react';
import { NavTab, NAV_ITEMS } from './Sidebar';

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  downloadCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange, downloadCount }) => (
  <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-ink-900 border-t border-white/[0.08] pb-[env(safe-area-inset-bottom)]">
    <div className="h-16 flex">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id;
        const badge = id === 'downloads' ? downloadCount : 0;
        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`relative flex-1 flex flex-col items-center justify-center gap-1 cursor-pointer ${
              active ? 'text-paper' : 'text-slate-500'
            }`}
          >
            {active && <span className="absolute top-0 inset-x-5 h-0.5 bg-son-500" />}
            <span className="relative">
              <Icon size={21} className={active ? 'text-son-400' : ''} />
              {badge > 0 && (
                <span className="absolute -top-1.5 -right-2.5 bg-son-600 text-white text-[10px] font-bold rounded-full min-w-4 h-4 px-1 grid place-items-center">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </span>
            <span className={`text-[11px] ${active ? 'font-semibold' : ''}`}>{label}</span>
          </button>
        );
      })}
    </div>
  </nav>
);
