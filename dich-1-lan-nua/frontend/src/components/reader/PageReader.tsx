import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useStudioStore } from '../../store/useStudioStore';
import { usePages } from '../../db/hooks';
import { Page } from '../../types/project';
import { ReadingDirection } from '../../types/reader';
import {
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Columns,
  Square,
  ArrowRightLeft,
  Layers,
} from 'lucide-react';

export const PageReader: React.FC = () => {
  const {
    activeChapterId,
    activePageId,
    setActivePage,
    readerDirection,
    setReaderDirection,
  } = useStudioStore();

  const pages = usePages(activeChapterId);
  const [spreadMode, setSpreadMode] = useState<'single' | 'double'>('single');

  // Compute active index
  const currentIndex = useMemo(() => {
    if (!pages || pages.length === 0) return 0;
    const idx = pages.findIndex((p) => p.id === activePageId);
    return idx >= 0 ? idx : 0;
  }, [pages, activePageId]);

  // Object URLs for active page(s)
  const [primaryUrl, setPrimaryUrl] = useState<string | null>(null);
  const [secondaryUrl, setSecondaryUrl] = useState<string | null>(null);

  const currentPage = pages?.[currentIndex];
  const secondPage =
    spreadMode === 'double' && pages && currentIndex + 1 < pages.length
      ? pages[currentIndex + 1]
      : null;

  useEffect(() => {
    let url1: string | null = null;
    let url2: string | null = null;

    if (currentPage?.sourceBlob) {
      try {
        url1 = URL.createObjectURL(currentPage.sourceBlob);
        setPrimaryUrl(url1);
      } catch {
        setPrimaryUrl(null);
      }
    } else {
      setPrimaryUrl(null);
    }

    if (secondPage?.sourceBlob) {
      try {
        url2 = URL.createObjectURL(secondPage.sourceBlob);
        setSecondaryUrl(url2);
      } catch {
        setSecondaryUrl(null);
      }
    } else {
      setSecondaryUrl(null);
    }

    return () => {
      if (url1) URL.revokeObjectURL(url1);
      if (url2) URL.revokeObjectURL(url2);
    };
  }, [currentPage?.sourceBlob, secondPage?.sourceBlob]);

  const stepSize = spreadMode === 'double' ? 2 : 1;

  const goToNextPage = useCallback(() => {
    if (!pages || pages.length === 0) return;
    const nextIdx = Math.min(pages.length - 1, currentIndex + stepSize);
    if (nextIdx !== currentIndex) {
      setActivePage(pages[nextIdx].id);
    }
  }, [pages, currentIndex, stepSize, setActivePage]);

  const goToPrevPage = useCallback(() => {
    if (!pages || pages.length === 0) return;
    const prevIdx = Math.max(0, currentIndex - stepSize);
    if (prevIdx !== currentIndex) {
      setActivePage(pages[prevIdx].id);
    }
  }, [pages, currentIndex, stepSize, setActivePage]);

  // Keyboard navigation handler (Feature 25 & 26)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing inside an input or textarea
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        // In LTR: ArrowRight goes forward (Next)
        // In RTL (Manga): ArrowRight goes backward (Previous)
        if (readerDirection === 'rtl') {
          goToPrevPage();
        } else {
          goToNextPage();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        // In LTR: ArrowLeft goes backward (Previous)
        // In RTL (Manga): ArrowLeft goes forward (Next)
        if (readerDirection === 'rtl') {
          goToNextPage();
        } else {
          goToPrevPage();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [readerDirection, goToNextPage, goToPrevPage]);

  const toggleDirection = () => {
    const newDir: ReadingDirection = readerDirection === 'rtl' ? 'ltr' : 'rtl';
    setReaderDirection(newDir);
  };

  const toggleSpread = () => {
    setSpreadMode((prev) => (prev === 'single' ? 'double' : 'single'));
  };

  if (!pages || pages.length === 0) {
    return (
      <div
        data-testid="page-reader-empty"
        className="flex-1 h-full w-full flex flex-col items-center justify-center bg-black text-muted p-8 text-center space-y-3"
      >
        <Layers className="w-10 h-10 opacity-40 text-primary" />
        <h3 className="font-semibold text-sm text-slate-200">
          No Pages to Display
        </h3>
        <p className="text-xs text-muted max-w-xs">
          Please add comic pages to the current chapter in Studio mode.
        </p>
      </div>
    );
  }

  const isFirstPage = currentIndex === 0;
  const isLastPage =
    spreadMode === 'double'
      ? currentIndex >= pages.length - 2
      : currentIndex === pages.length - 1;

  return (
    <div
      data-testid="page-reader"
      className="flex-1 h-full w-full bg-black relative flex flex-col items-center justify-between select-none overflow-hidden"
    >
      {/* Main Page Viewport */}
      <div className="flex-1 w-full flex items-center justify-center p-4 relative">
        {/* Navigation clickable overlays on screen sides */}
            <button
              type="button"
              data-testid="nav-left-btn"
              onClick={readerDirection === 'rtl' ? goToNextPage : goToPrevPage}
              disabled={readerDirection === 'rtl' ? isLastPage : isFirstPage}
              title={readerDirection === 'rtl' ? 'Next Page' : 'Previous Page'}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/60 hover:bg-primary/80 text-white backdrop-blur-sm transition-all disabled:opacity-0 disabled:pointer-events-none"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            <button
              type="button"
              data-testid="nav-right-btn"
              onClick={readerDirection === 'rtl' ? goToPrevPage : goToNextPage}
              disabled={readerDirection === 'rtl' ? isFirstPage : isLastPage}
              title={readerDirection === 'rtl' ? 'Previous Page' : 'Next Page'}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/60 hover:bg-primary/80 text-white backdrop-blur-sm transition-all disabled:opacity-0 disabled:pointer-events-none"
            >
              <ChevronRight className="w-6 h-6" />
            </button>

            {/* Display Container: Single Page or Double Spread */}
            <div
              data-testid="page-display-container"
              className="max-h-[calc(100vh-120px)] max-w-[calc(100vw-80px)] flex items-center justify-center gap-1 shadow-2xl"
            >
              {readerDirection === 'rtl' && secondPage && secondaryUrl ? (
                // In RTL Manga spread, second page is on left, first page is on right
                <>
                  <img
                    src={secondaryUrl}
                    alt={`Page ${secondPage.pageNumber}`}
                    data-testid="secondary-page-image"
                    className="max-h-[calc(100vh-120px)] w-auto object-contain rounded-l border-r border-black/40"
                  />
                  {primaryUrl && (
                    <img
                      src={primaryUrl}
                      alt={`Page ${currentPage?.pageNumber}`}
                      data-testid="primary-page-image"
                      className="max-h-[calc(100vh-120px)] w-auto object-contain rounded-r"
                    />
                  )}
                </>
              ) : (
                // In LTR spread or single page
                <>
                  {primaryUrl ? (
                    <img
                      src={primaryUrl}
                      alt={`Page ${currentPage?.pageNumber}`}
                      data-testid="primary-page-image"
                      className="max-h-[calc(100vh-120px)] w-auto object-contain rounded"
                    />
                  ) : (
                    <div className="w-80 aspect-[3/4] bg-card flex flex-col items-center justify-center text-muted">
                      <BookOpen className="w-8 h-8 mb-2 opacity-50" />
                      <span className="text-xs">Loading page...</span>
                    </div>
                  )}

                  {spreadMode === 'double' && secondaryUrl && secondPage && (
                    <img
                      src={secondaryUrl}
                      alt={`Page ${secondPage.pageNumber}`}
                      data-testid="secondary-page-image"
                      className="max-h-[calc(100vh-120px)] w-auto object-contain rounded"
                    />
                  )}
                </>
              )}
            </div>
      </div>

      {/* Bottom Floating Control HUD */}
      <footer
        data-testid="page-reader-hud"
        className="h-12 w-full bg-toolbar/90 backdrop-blur border-t border-border flex items-center justify-between px-6 z-30 text-xs text-text"
        style={{ backgroundColor: '#1a1b20f0', borderColor: '#272930' }}
      >
        {/* Left: Direction Switcher */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="direction-toggle-btn"
            onClick={toggleDirection}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-background rounded border border-border hover:border-primary text-text font-medium transition-colors"
            title="Toggle Reading Direction"
          >
            <ArrowRightLeft className="w-3.5 h-3.5 text-primary" />
            <span>Direction: {readerDirection === 'rtl' ? 'RTL (Manga)' : 'LTR (Western)'}</span>
          </button>

          <button
            type="button"
            data-testid="spread-toggle-btn"
            onClick={toggleSpread}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-background rounded border border-border hover:border-primary text-text font-medium transition-colors"
            title="Toggle Single / Spread View"
          >
            {spreadMode === 'single' ? (
              <>
                <Square className="w-3.5 h-3.5 text-primary" />
                <span>Single Page</span>
              </>
            ) : (
              <>
                <Columns className="w-3.5 h-3.5 text-primary" />
                <span>Double Spread</span>
              </>
            )}
          </button>
        </div>

        {/* Center: Page Counter HUD */}
        <div
          data-testid="page-counter-hud"
          className="font-mono text-sm text-slate-200 bg-background/80 px-3 py-1 rounded border border-border"
        >
          Page {currentPage?.pageNumber || currentIndex + 1}
          {spreadMode === 'double' && secondPage ? `-${secondPage.pageNumber}` : ''} of{' '}
          {pages?.length || 0}
        </div>

        {/* Right: Manual Prev / Next controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="hud-prev-btn"
            onClick={goToPrevPage}
            disabled={isFirstPage}
            className="px-3 py-1 bg-background rounded border border-border hover:bg-card disabled:opacity-40 transition-colors"
          >
            Prev
          </button>

          <button
            type="button"
            data-testid="hud-next-btn"
            onClick={goToNextPage}
            disabled={isLastPage}
            className="px-3 py-1 bg-primary hover:bg-blue-600 text-white rounded font-medium disabled:opacity-40 transition-colors"
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  );
};
