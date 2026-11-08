import React, { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { BottomNav } from './components/BottomNav';
import { BrowseView } from './views/BrowseView';
import { MangaDetailView } from './views/MangaDetailView';
import { DownloadsView } from './views/DownloadsView';
import { LibraryView } from './views/LibraryView';
import { ReaderView } from './views/ReaderView';
import { CleanerStudioView } from './views/CleanerStudioView';
import { SettingsView } from './views/SettingsView';
import { ChapterItem, LibraryBook, MangaItem, DownloadTask } from './types';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('browse');
  const [selectedManga, setSelectedManga] = useState<MangaItem | null>(null);
  const [readerOnlineChapter, setReaderOnlineChapter] = useState<ChapterItem | null>(null);
  const [readerOfflineBook, setReaderOfflineBook] = useState<LibraryBook | null>(null);
  const [downloadCount, setDownloadCount] = useState<number>(0);

  // Sync active download count
  useEffect(() => {
    invoke<DownloadTask[]>('get_download_queue')
      .then((q) => {
        const active = q.filter((t) => t.status === 'downloading' || t.status === 'queued' || t.status === 'packaging').length;
        setDownloadCount(active);
      })
      .catch(() => {});

    const unlisten = listen<DownloadTask>('download-progress', () => {
      invoke<DownloadTask[]>('get_download_queue')
        .then((q) => {
          const active = q.filter((t) => t.status === 'downloading' || t.status === 'queued' || t.status === 'packaging').length;
          setDownloadCount(active);
        })
        .catch(() => {});
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleSelectManga = (manga: MangaItem) => {
    setSelectedManga(manga);
  };

  const handleBackToBrowse = () => {
    setSelectedManga(null);
  };

  const handleOpenOnlineReader = (chapter: ChapterItem) => {
    setReaderOnlineChapter(chapter);
    setReaderOfflineBook(null);
  };

  const handleOpenOfflineReader = (book: LibraryBook) => {
    setReaderOfflineBook(book);
    setReaderOnlineChapter(null);
  };

  const handleCloseReader = () => {
    setReaderOnlineChapter(null);
    setReaderOfflineBook(null);
  };

  return (
    <div className="flex h-screen w-screen bg-[#1e1e2e] text-[#cdd6f4] overflow-hidden font-sans">
      {/* Desktop Left Sidebar (>= 768px) */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSelectedManga(null);
        }}
        downloadCount={downloadCount}
      />

      {/* Main View Area with Mobile Bottom Padding */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative pb-16 md:pb-0">
        {activeTab === 'browse' && (
          selectedManga ? (
            <MangaDetailView
              manga={selectedManga}
              onBack={handleBackToBrowse}
              onOpenReader={handleOpenOnlineReader}
            />
          ) : (
            <BrowseView onSelectManga={handleSelectManga} />
          )
        )}

        {activeTab === 'downloads' && <DownloadsView />}

        {activeTab === 'library' && (
          <LibraryView onOpenBook={handleOpenOfflineReader} />
        )}

        {activeTab === 'cleaner' && <CleanerStudioView />}

        {activeTab === 'settings' && <SettingsView />}
      </main>

      {/* Mobile Bottom Navigation Bar (< 768px) */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSelectedManga(null);
        }}
        downloadCount={downloadCount}
      />

      {/* Fullscreen In-App Reader Modal */}
      {(readerOnlineChapter || readerOfflineBook) && (
        <ReaderView
          onlineChapter={readerOnlineChapter || undefined}
          offlineBook={readerOfflineBook || undefined}
          onClose={handleCloseReader}
        />
      )}
    </div>
  );
}
export default App;
