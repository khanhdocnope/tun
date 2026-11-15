import React, { useState, useEffect, useRef } from 'react';
import { BrowserHeader } from '../components/BrowserHeader';
import { MangaSpeedDial } from '../components/MangaSpeedDial';
import { MangaSnifferPill } from '../components/MangaSnifferPill';
import { BrowserTab, BookmarkItem, PageItem, ChapterItem } from '../types';
import { scanDocumentForMangaPages, autoScrollAndCollect } from '../services/mangaSniffer';
import { invoke } from '@tauri-apps/api/core';

interface BrowserViewProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenDownloads: () => void;
  onOpenReader: (chapter: ChapterItem, pages: PageItem[]) => void;
  onOpenCleanerWithImage: (imageUrl: string) => void;
}

const DEFAULT_HOME_URL = 'https://mangadex.org';

export const BrowserView: React.FC<BrowserViewProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  onOpenDownloads,
  onOpenReader,
  onOpenCleanerWithImage,
}) => {
  // Saved session URL from previous launch
  const [lastSessionUrl, setLastSessionUrl] = useState<string | null>(() => {
    try {
      return localStorage.getItem('moeject_last_session');
    } catch {
      return null;
    }
  });

  // Bookmarks
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => {
    try {
      const saved = localStorage.getItem('moeject_bookmarks');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Tabs state
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

  // Sniffer & Auto-scroll state
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Save active URL to localStorage whenever it changes
  useEffect(() => {
    if (activeTab?.url && activeTab.url !== 'about:blank') {
      try {
        localStorage.setItem('moeject_last_session', activeTab.url);
      } catch {}
    }
  }, [activeTab?.url]);

  // Tab management
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
  };

  const handleGoBack = () => {
    if (iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.history.back();
      } catch {}
    }
  };

  const handleGoForward = () => {
    if (iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.history.forward();
      } catch {}
    }
  };

  const handleReload = () => {
    if (iframeRef.current) {
      iframeRef.current.src = activeTab.url;
    }
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

  // Run Sniffer when iframe finishes loading or periodically
  const handleIframeLoad = () => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: false } : t))
    );

    // Try sniffing inside frame if same-origin or accessible
    try {
      if (iframeRef.current?.contentDocument) {
        const scan = scanDocumentForMangaPages(iframeRef.current.contentDocument);
        if (scan.pages.length > 0) {
          setTabs((prev) =>
            prev.map((t) =>
              t.id === activeTabId ? { ...t, detectedPages: scan.pages } : t
            )
          );
        }
      }
    } catch {
      // Cross-origin frame: Fallback sniffer can extract URLs or use backend-assisted sniffing
    }
  };

  // Auto-scroll handler
  const handleTriggerAutoScroll = () => {
    setIsAutoScrolling(true);
    setScrollProgress(0);

    try {
      const win = iframeRef.current?.contentWindow;
      if (win) {
        autoScrollAndCollect(
          win,
          (pct, count) => {
            setScrollProgress(pct);
            if (count > 0) {
              setTabs((prev) =>
                prev.map((t) =>
                  t.id === activeTabId
                    ? {
                        ...t,
                        detectedPages: Array.from(
                          new Set([...t.detectedPages, ...scanDocumentForMangaPages(win.document).pages])
                        ),
                      }
                    : t
                )
              );
            }
          },
          (result) => {
            setIsAutoScrolling(false);
            setScrollProgress(100);
            if (result.pages.length > 0) {
              setTabs((prev) =>
                prev.map((t) =>
                  t.id === activeTabId ? { ...t, detectedPages: result.pages } : t
                )
              );
            }
          }
        );
      } else {
        // Fallback simulation
        let cur = 0;
        const iv = setInterval(() => {
          cur += 20;
          setScrollProgress(cur);
          if (cur >= 100) {
            clearInterval(iv);
            setIsAutoScrolling(false);
          }
        }, 200);
      }
    } catch {
      setIsAutoScrolling(false);
    }
  };

  // Trigger Hybrid Chapter Download
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

  // Open detected pages directly in MoeJect Native Reader
  const handleReadNative = () => {
    if (!activeTab || activeTab.detectedPages.length === 0) return;

    const chapter: ChapterItem = {
      id: `browser-${Date.now()}`,
      manga_id: 'browser-manga',
      chapter_number: 1,
      title: activeTab.title || 'Chương hiện tại',
      source: 'browser',
      language: 'vi',
    };

    const pages: PageItem[] = activeTab.detectedPages.map((url, i) => ({
      page_number: i + 1,
      url,
    }));

    onOpenReader(chapter, pages);
  };

  // Send first detected page to AI Text Cleaner
  const handleCleanWithAi = () => {
    if (!activeTab || activeTab.detectedPages.length === 0) return;
    onOpenCleanerWithImage(activeTab.detectedPages[0]);
  };

  const isCurrentBookmarked = bookmarks.some((b) => b.url === activeTab?.url);

  return (
    <div className="flex-1 flex flex-col h-full bg-ink-950 overflow-hidden relative">
      {/* Browser Navigation Header */}
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
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={onToggleSidebar}
        isBookmarked={isCurrentBookmarked}
        onToggleBookmark={handleToggleBookmark}
        onOpenDownloads={onOpenDownloads}
      />

      {/* Browser View Content */}
      <div className="flex-1 relative w-full h-full overflow-hidden bg-ink-950">
        {!activeTab?.url || activeTab.url === 'about:blank' ? (
          <MangaSpeedDial
            onNavigate={handleNavigate}
            bookmarks={bookmarks}
            lastSessionUrl={lastSessionUrl}
            onRestoreSession={() => lastSessionUrl && handleNavigate(lastSessionUrl)}
          />
        ) : (
          <iframe
            ref={iframeRef}
            src={activeTab.url}
            title={activeTab.title}
            onLoad={handleIframeLoad}
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-downloads"
            className="w-full h-full border-none bg-white"
          />
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
