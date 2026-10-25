import React from 'react';
import { ArrowLeft, ScrollText, BookOpen, Layers } from 'lucide-react';
import { useStudioStore } from '../../store/useStudioStore';
import { useChapter, useProject } from '../../db/hooks';
import { VerticalWebtoonReader } from './VerticalWebtoonReader';
import { PageReader } from './PageReader';

export const DualModeReader: React.FC = () => {
  const {
    viewMode,
    setViewMode,
    activeProjectId,
    activeChapterId,
  } = useStudioStore();

  const project = useProject(activeProjectId);
  const chapter = useChapter(activeChapterId);

  return (
    <div
      data-testid="dual-mode-reader"
      className="h-screen w-screen flex flex-col bg-background text-text overflow-hidden select-none"
      style={{ backgroundColor: '#121316' }}
    >
      {/* Reader Navigation Header */}
      <header
        data-testid="reader-header"
        className="h-12 w-full bg-toolbar border-b border-border flex items-center justify-between px-4 z-30"
        style={{ backgroundColor: '#1a1b20', borderColor: '#272930' }}
      >
        {/* Left: Back to Studio Button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="exit-reader-btn"
            onClick={() => setViewMode('studio')}
            className="flex items-center gap-2 px-3 py-1 bg-card hover:bg-card/80 border border-border rounded text-xs font-medium text-slate-200 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-primary" />
            <span>Back to Studio</span>
          </button>

          <div className="h-4 w-px bg-border mx-1" />

          {/* Project & Chapter Title */}
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-200 truncate max-w-[200px]">
              {project?.name || 'Untitled Comic'}
            </span>
            {chapter && (
              <>
                <span className="text-muted">•</span>
                <span className="text-muted truncate max-w-[150px]">
                  {chapter.title}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right: Mode Switcher between Vertical & Page */}
        <div
          data-testid="reader-mode-toggle"
          className="flex items-center bg-background p-0.5 rounded border border-border text-xs"
        >
          <button
            type="button"
            data-testid="switch-webtoon-btn"
            onClick={() => setViewMode('vertical_reader')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded transition-colors ${
              viewMode === 'vertical_reader'
                ? 'bg-primary text-white font-medium shadow-sm'
                : 'text-muted hover:text-text'
            }`}
          >
            <ScrollText className="w-3.5 h-3.5" />
            <span>Webtoon (Vertical)</span>
          </button>

          <button
            type="button"
            data-testid="switch-page-btn"
            onClick={() => setViewMode('page_reader')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded transition-colors ${
              viewMode === 'page_reader'
                ? 'bg-primary text-white font-medium shadow-sm'
                : 'text-muted hover:text-text'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Manga (Page)</span>
          </button>
        </div>
      </header>

      {/* Reader Content Body */}
      <main className="flex-1 w-full h-[calc(100vh-48px)] overflow-hidden flex flex-col">
        {viewMode === 'vertical_reader' ? (
          <VerticalWebtoonReader />
        ) : (
          <PageReader />
        )}
      </main>
    </div>
  );
};
