import React, { useEffect } from 'react';
import { useStudioStore } from './store/useStudioStore';
import { useProjects, useChapters, usePages } from './db/hooks';
import { StudioLayout } from './components/layout/StudioLayout';
import { DualModeReader } from './components/reader/DualModeReader';
import { ImageCanvas } from './components/canvas/ImageCanvas';

export const App: React.FC = () => {
  const {
    viewMode,
    setViewMode,
    activeProjectId,
    activeChapterId,
    activePageId,
    setActiveProject,
    setActiveChapter,
    setActivePage,
  } = useStudioStore();

  const projects = useProjects();
  const chapters = useChapters(activeProjectId);
  const pages = usePages(activeChapterId);

  // Initial database hydration: automatically select most recent project, chapter, and page
  useEffect(() => {
    if (!activeProjectId && projects && projects.length > 0) {
      setActiveProject(projects[0].id);
    }
  }, [activeProjectId, projects, setActiveProject]);

  useEffect(() => {
    if (activeProjectId && !activeChapterId && chapters && chapters.length > 0) {
      setActiveChapter(chapters[0].id);
    }
  }, [activeProjectId, activeChapterId, chapters, setActiveChapter]);

  useEffect(() => {
    if (activeChapterId && !activePageId && pages && pages.length > 0) {
      setActivePage(pages[0].id);
    }
  }, [activeChapterId, activePageId, pages, setActivePage]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Escape exits reader mode back to studio
      if (e.key === 'Escape') {
        const currentMode = useStudioStore.getState().viewMode;
        if (currentMode !== 'studio') {
          e.preventDefault();
          useStudioStore.getState().setViewMode('studio');
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  return (
    <div className="w-full h-full bg-background text-text overflow-hidden">
      {viewMode === 'studio' ? <StudioLayout canvasSlot={<ImageCanvas />} /> : <DualModeReader />}
    </div>
  );
};

export default App;
