import React, { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { BottomNav } from './components/BottomNav';
import { BrowserView } from './views/BrowserView';
import { BrowseView } from './views/BrowseView';
import { MangaDetailView } from './views/MangaDetailView';
import { DownloadsView } from './views/DownloadsView';
import { LibraryView } from './views/LibraryView';
import { ReaderView } from './views/ReaderView';
import { CleanerStudioView } from './views/CleanerStudioView';
import { SettingsView } from './views/SettingsView';
import { ChapterItem, LibraryBook, MangaItem, DownloadTask, PageItem } from './types';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('browser');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedManga, setSelectedManga] = useState<MangaItem | null>(null);
  const [readerOnlineChapter, setReaderOnlineChapter] = useState<ChapterItem | null>(null);
  const [readerOfflineBook, setReaderOfflineBook] = useState<LibraryBook | null>(null);
  const [readerBrowserPages, setReaderBrowserPages] = useState<PageItem[] | null>(null);
  const [readerBrowserTitle, setReaderBrowserTitle] = useState<string | null>(null);
  const [cleanerInitialImage, setCleanerInitialImage] = useState<string | null>(null);
  const [downloadCount, setDownloadCount] = useState<number>(0);

  // Sync active download count in real-time
  useEffect(() => {
    invoke<DownloadTask[]>('get_download_queue')
      .then((q) => {
        const active = q.filter(
          (t) => t.status === 'downloading' || t.status === 'queued' || t.status === 'packaging'
        ).length;
        setDownloadCount(active);
      })
      .catch(() => {});

    const unlisten = listen<DownloadTask>('download-progress', () => {
      invoke<DownloadTask[]>('get_download_queue')
        .then((q) => {
          const active = q.filter(
            (t) => t.status === 'downloading' || t.status === 'queued' || t.status === 'packaging'
          ).length;
          setDownloadCount(active);
        })
        .catch(() => {});
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Hide native browser pane when navigating away from browser view or opening reader
  useEffect(() => {
    if (activeTab !== 'browser' || readerOnlineChapter || readerOfflineBook || readerBrowserPages) {
      invoke('hide_browser_pane').catch(() => {});
    }
  }, [activeTab, readerOnlineChapter, readerOfflineBook, readerBrowserPages]);

  const handleSelectManga = (manga: MangaItem) => {
    setSelectedManga(manga);
  };

  const handleBackToBrowse = () => {
    setSelectedManga(null);
  };

  const handleOpenOnlineReader = (chapter: ChapterItem) => {
    setReaderOnlineChapter(chapter);
    setReaderOfflineBook(null);
    setReaderBrowserPages(null);
  };

  const handleOpenOfflineReader = (book: LibraryBook) => {
    setReaderOfflineBook(book);
    setReaderOnlineChapter(null);
    setReaderBrowserPages(null);
  };

  const handleOpenBrowserReader = (pages: PageItem[], title: string) => {
    setReaderBrowserPages(pages);
    setReaderBrowserTitle(title);
    setReaderOnlineChapter(null);
    setReaderOfflineBook(null);
  };

  const handleOpenCleanerWithImage = (b64Image: string) => {
    setCleanerInitialImage(b64Image);
    setActiveTab('cleaner');
  };

  const handleCloseReader = () => {
    setReaderOnlineChapter(null);
    setReaderOfflineBook(null);
    setReaderBrowserPages(null);
    setReaderBrowserTitle(null);
  };

  return (
    <div className="flex h-screen w-screen bg-[#0f1524] text-slate-100 overflow-hidden font-sans relative selection:bg-son-500 selection:text-white">
      {/* Desktop Left Sidebar & Mobile Drawer */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSelectedManga(null);
          setIsSidebarOpen(false);
        }}
        downloadCount={downloadCount}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* Main Viewport */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative pb-16 md:pb-0">
        {activeTab === 'browser' && (
          <BrowserView
            onOpenDownloads={() => setActiveTab('downloads')}
            onOpenReader={handleOpenBrowserReader}
            onOpenCleanerWithImage={handleOpenCleanerWithImage}
            onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          />
        )}

        {activeTab === 'browse' &&
          (selectedManga ? (
            <MangaDetailView
              manga={selectedManga}
              onBack={handleBackToBrowse}
              onOpenReader={handleOpenOnlineReader}
            />
          ) : (
            <BrowseView onSelectManga={handleSelectManga} />
          ))}

        {activeTab === 'downloads' && <DownloadsView />}

        {activeTab === 'library' && (
          <LibraryView onOpenBook={handleOpenOfflineReader} />
        )}

        {activeTab === 'cleaner' && (
          <CleanerStudioView initialImage={cleanerInitialImage} />
        )}

        {activeTab === 'settings' && <SettingsView />}
      </main>

      {/* Mobile Floating Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSelectedManga(null);
        }}
        downloadCount={downloadCount}
      />

      {/* Fullscreen Cinematic Reader Modal */}
      {(readerOnlineChapter || readerOfflineBook || readerBrowserPages) && (
        <ReaderView
          onlineChapter={readerOnlineChapter || undefined}
          offlineBook={readerOfflineBook || undefined}
          browserPages={readerBrowserPages || undefined}
          browserTitle={readerBrowserTitle || undefined}
          onClose={handleCloseReader}
        />
      )}
    </div>
  );
}

export default App;
