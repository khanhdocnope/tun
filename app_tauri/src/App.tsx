import React, { useState } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { BrowseView } from './views/BrowseView';
import { MangaDetailView } from './views/MangaDetailView';
import { DownloadsView } from './views/DownloadsView';
import { LibraryView } from './views/LibraryView';
import { ReaderView } from './views/ReaderView';
import { CleanerStudioView } from './views/CleanerStudioView';
import { SettingsView } from './views/SettingsView';
import { ChapterItem, LibraryBook, MangaItem } from './types';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('browse');
  const [selectedManga, setSelectedManga] = useState<MangaItem | null>(null);
  const [readerOnlineChapter, setReaderOnlineChapter] = useState<ChapterItem | null>(null);
  const [readerOfflineBook, setReaderOfflineBook] = useState<LibraryBook | null>(null);
  const [downloadCount, setDownloadCount] = useState<number>(0);

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
      {/* Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSelectedManga(null);
        }}
        downloadCount={downloadCount}
      />

      {/* Main View Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
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

        {/* Modal In-App Reader (Webtoon / Manga) */}
        {(readerOnlineChapter || readerOfflineBook) && (
          <ReaderView
            onlineChapter={readerOnlineChapter || undefined}
            offlineBook={readerOfflineBook || undefined}
            onClose={handleCloseReader}
          />
        )}
      </main>
    </div>
  );
}

export default App;
