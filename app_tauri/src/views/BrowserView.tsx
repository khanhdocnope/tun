import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserHeader } from '../components/BrowserHeader';
import { MangaSpeedDial } from '../components/MangaSpeedDial';
import { MangaSnifferPill } from '../components/MangaSnifferPill';
import { BrowserTab, BookmarkItem, PageItem } from '../types';
import { invoke } from '@tauri-apps/api/core';

interface BrowserViewProps {
  onToggleSidebar: () => void;
  onOpenDownloads: () => void;
  onOpenReader: (pages: PageItem[], title: string) => void;
  onOpenCleanerWithImage: (imageUrl: string) => void;
}

const DEFAULT_HOME_URL = 'https://mangadex.org';

const SNIFFER_SCRIPT = `(() => {
  try {
    const images = Array.from(document.querySelectorAll('img, canvas'));
    const urls = [];
    for (const el of images) {
      if (el.tagName === 'CANVAS') {
        try { urls.push(el.toDataURL('image/jpeg', 0.95)); } catch(e) {}
        continue;
      }
      const rect = el.getBoundingClientRect();
      const w = el.naturalWidth || rect.width || 0;
      const h = el.naturalHeight || rect.height || 0;
      if (w < 180 || h < 250) continue;
      const src = el.src || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || el.getAttribute('data-url') || '';
      if (src && !src.startsWith('data:image/svg') && !src.includes('banner') && !src.includes('ads')) {
        urls.push(src);
      }
    }
    return JSON.stringify({
      title: document.title,
      pages: Array.from(new Set(urls))
    });
  } catch(e) {
    return JSON.stringify({ title: document.title, pages: [], error: String(e) });
  }
})()`;

const SCROLL_STEP_SCRIPT = `(() => {
  window.scrollBy({ top: 450, behavior: 'smooth' });
  const docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  const curY = window.scrollY + window.innerHeight;
  return JSON.stringify({
    pct: Math.min(100, Math.round((curY / docH) * 100)),
    reachedBottom: curY >= (docH - 100)
  });
})()`;

export const BrowserView: React.FC<BrowserViewProps> = ({
  onToggleSidebar,
  onOpenDownloads,
  onOpenReader,
  onOpenCleanerWithImage,
}) => {
  const [lastSessionUrl] = useState<string | null>(() => {
    try {
      return localStorage.getItem('moeject_last_session');
    } catch {
      return null;
    }
  });

  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => {
    try {
      const saved = localStorage.getItem('moeject_bookmarks');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [tabs, setTabs] = useState<BrowserTab[]>(() => {
    const initialUrl = lastSessionUrl || DEFAULT_HOME_URL;
    return [
      {
        id: 'tab-1',
        title: 'Manga Hub',
        url: initialUrl,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        detectedPages: [],
      },
    ];
  });
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');

  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Helper to compute container bounds
  const getBounds = useCallback(() => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) return null;
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }, []);

  // Sync native webview bounds or visibility
  useEffect(() => {
    const bounds = getBounds();
    if (!activeTab?.url || activeTab.url === 'about:blank') {
      invoke('hide_browser_pane').catch(() => {});
      return;
    }

    if (bounds) {
      invoke('open_browser_pane', { url: activeTab.url, bounds }).catch((err) => {
        console.warn('Native browser pane open notice:', err);
      });
    }

    try {
      localStorage.setItem('moeject_last_session', activeTab.url);
    } catch {}
  }, [activeTab?.url, getBounds]);

  // Handle window resize and layout shifts
  useEffect(() => {
    const handleResize = () => {
      const bounds = getBounds();
      if (bounds && activeTab?.url && activeTab.url !== 'about:blank') {
        invoke('update_browser_bounds', { bounds }).catch(() => {});
      }
    };

    window.addEventListener('resize', handleResize);
    const observer = new ResizeObserver(() => handleResize());
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [getBounds, activeTab?.url]);

  // Periodic DOM Manga Sniffer via native eval
  useEffect(() => {
    if (!activeTab?.url || activeTab.url === 'about:blank') return;

    let mounted = true;
    const runSniffer = async () => {
      try {
        const rawJson = await invoke<string>('browser_eval', { script: SNIFFER_SCRIPT });
        const res = JSON.parse(rawJson);
        if (mounted && res.pages && res.pages.length > 0) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === activeTabId
                ? {
                    ...t,
                    title: res.title || t.title,
                    detectedPages: Array.from(new Set([...t.detectedPages, ...res.pages])),
                  }
                : t
            )
          );
        }
      } catch {
        // Silently ignore if pane isn't focused or navigating
      }
    };

    // Run immediately and every 3 seconds
    const timer = setTimeout(runSniffer, 1200);
    const interval = setInterval(runSniffer, 3000);

    return () => {
      mounted = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [activeTab?.url, activeTabId]);

  // Tab controls
  const handleSelectTab = (id: string) => setActiveTabId(id);

  const handleCloseTab = (id: string) => {
    if (tabs.length <= 1) return;
    const newTabs = tabs.filter((t) => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  };

  const handleNewTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: BrowserTab = {
      id: newId,
      title: 'Tab mới',
      url: '',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      detectedPages: [],
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newId);
  };

  const handleNavigate = (url: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              url,
              isLoading: true,
              title: url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || url,
              detectedPages: [],
            }
          : t
      )
    );

    if (url && url !== 'about:blank') {
      invoke('browser_navigate', { url }).catch(() => {});
    } else {
      invoke('hide_browser_pane').catch(() => {});
    }
  };

  const handleGoBack = () => {
    invoke('browser_action', { action: 'back' }).catch(() => {});
  };

  const handleGoForward = () => {
    invoke('browser_action', { action: 'forward' }).catch(() => {});
  };

  const handleReload = () => {
    invoke('browser_action', { action: 'reload' }).catch(() => {});
  };

  const handleGoHome = () => {
    handleNavigate('');
  };

  const handleToggleBookmark = () => {
    if (!activeTab?.url) return;
    const isBookmarked = bookmarks.some((b) => b.url === activeTab.url);
    let updated: BookmarkItem[];
    if (isBookmarked) {
      updated = bookmarks.filter((b) => b.url !== activeTab.url);
    } else {
      updated = [
        ...bookmarks,
        {
          id: `bm-${Date.now()}`,
          title: activeTab.title || activeTab.url,
          url: activeTab.url,
        },
      ];
    }
    setBookmarks(updated);
    try {
      localStorage.setItem('moeject_bookmarks', JSON.stringify(updated));
    } catch {}
  };

  // Auto-scroll through entire chapter to wake up lazy-loaded images
  const handleTriggerAutoScroll = () => {
    setIsAutoScrolling(true);
    setScrollProgress(0);

    const scrollInterval = setInterval(async () => {
      try {
        const raw = await invoke<string>('browser_eval', { script: SCROLL_STEP_SCRIPT });
        const data = JSON.parse(raw);
        setScrollProgress(data.pct || 0);

        // Scan images during scroll
        const scanRaw = await invoke<string>('browser_eval', { script: SNIFFER_SCRIPT });
        const scanData = JSON.parse(scanRaw);
        if (scanData.pages && scanData.pages.length > 0) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === activeTabId
                ? {
                    ...t,
                    detectedPages: Array.from(new Set([...t.detectedPages, ...scanData.pages])),
                  }
                : t
            )
          );
        }

        if (data.reachedBottom || data.pct >= 100) {
          clearInterval(scrollInterval);
          setIsAutoScrolling(false);
          setScrollProgress(100);
        }
      } catch {
        clearInterval(scrollInterval);
        setIsAutoScrolling(false);
      }
    }, 160);
  };

  // Start background CBZ download via Rust backend
  const handleDownloadChapter = async () => {
    if (!activeTab || activeTab.detectedPages.length === 0) return;

    try {
      await invoke('start_browser_download', {
        urls: activeTab.detectedPages,
        mangaTitle: activeTab.title || 'Manga',
        chapterTitle: `Chapter_${new Date().toISOString().slice(0, 10)}`,
        referer: activeTab.url,
      });
      onOpenDownloads();
    } catch (err: any) {
      alert(`Lỗi khi tạo tác vụ tải: ${typeof err === 'string' ? err : err.message || err}`);
    }
  };

  // Open pages directly in Native Reader
  const handleReadNative = () => {
    if (!activeTab || activeTab.detectedPages.length === 0) return;

    const pages: PageItem[] = activeTab.detectedPages.map((url, i) => ({
      page_number: i + 1,
      url,
      drm_data: NoneOrUndefined(),
      fallback_urls: [],
    }));

    onOpenReader(pages, activeTab.title || 'Đang đọc');
  };

  // Helper for drm_data
  function NoneOrUndefined() {
    return undefined;
  }

  // Open in AI Text Cleaner
  const handleCleanWithAi = () => {
    if (!activeTab || activeTab.detectedPages.length === 0) return;
    onOpenCleanerWithImage(activeTab.detectedPages[0]);
  };

  const isCurrentBookmarked = bookmarks.some((b) => b.url === activeTab?.url);

  return (
    <div className="flex-1 flex flex-col h-full bg-ink-950 overflow-hidden relative">
      {/* Top Browser Navigation Bar & Multi-Tabs */}
      <BrowserHeader
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
        onNavigate={handleNavigate}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onGoHome={handleGoHome}
        isSidebarOpen={false}
        onToggleSidebar={onToggleSidebar}
        isBookmarked={isCurrentBookmarked}
        onToggleBookmark={handleToggleBookmark}
        onOpenDownloads={onOpenDownloads}
      />

      {/* Main Viewport: Speed Dial when empty, or Native Webview Bounds */}
      <div
        ref={containerRef}
        className="flex-1 relative w-full h-full overflow-hidden bg-ink-950"
      >
        {!activeTab?.url || activeTab.url === 'about:blank' ? (
          <MangaSpeedDial
            onNavigate={handleNavigate}
            bookmarks={bookmarks}
            lastSessionUrl={lastSessionUrl}
            onRestoreSession={() => lastSessionUrl && handleNavigate(lastSessionUrl)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-slate-500 select-none">
            {/* The native child webview renders directly in front of this container */}
            <div className="animate-pulse flex flex-col items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-son-500 border-t-transparent animate-spin" />
              <p className="text-xs text-slate-400">Đang hiển thị phiên duyệt web thực...</p>
            </div>
          </div>
        )}

        {/* Floating Manga Sniffer Pill Widget */}
        <MangaSnifferPill
          detectedPages={activeTab?.detectedPages || []}
          isAutoScrolling={isAutoScrolling}
          scrollProgress={scrollProgress}
          onTriggerAutoScroll={handleTriggerAutoScroll}
          onDownloadChapter={handleDownloadChapter}
          onReadNative={handleReadNative}
          onCleanWithAi={handleCleanWithAi}
          onDismiss={() => {
            setTabs((prev) =>
              prev.map((t) => (t.id === activeTabId ? { ...t, detectedPages: [] } : t))
            );
          }}
        />
      </div>
    </div>
  );
};
