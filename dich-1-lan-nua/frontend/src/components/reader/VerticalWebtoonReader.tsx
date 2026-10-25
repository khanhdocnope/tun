import React, { useState, useEffect, useRef } from 'react';
import { useStudioStore } from '../../store/useStudioStore';
import { usePages } from '../../db/hooks';
import { Page } from '../../types/project';
import { ArrowUp, BookOpen, Layers } from 'lucide-react';

const WebtoonPageItem: React.FC<{
  page: Page;
  index: number;
  total: number;
}> = ({ page, index, total }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    if (page.sourceBlob) {
      try {
        url = URL.createObjectURL(page.sourceBlob);
        setImageUrl(url);
      } catch {
        setImageUrl(null);
      }
    }
    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [page.sourceBlob]);

  return (
    <div
      data-testid={`webtoon-page-${page.id}`}
      className="relative w-full flex flex-col items-center bg-black/40 group"
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`Page ${page.pageNumber}`}
          loading="lazy"
          className="w-full h-auto object-contain block select-none pointer-events-none"
        />
      ) : (
        <div className="w-full aspect-[3/4] bg-card flex flex-col items-center justify-center text-muted">
          <BookOpen className="w-8 h-8 mb-2 opacity-50" />
          <span className="text-xs">Loading page #{page.pageNumber}...</span>
        </div>
      )}

      {/* Floating page number marker */}
      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-[11px] font-mono text-slate-300">
        Page {page.pageNumber} / {total}
      </div>
    </div>
  );
};

export const VerticalWebtoonReader: React.FC = () => {
  const { activeChapterId } = useStudioStore();
  const pages = usePages(activeChapterId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const handleScroll = () => {
    if (containerRef.current) {
      setShowScrollTop(containerRef.current.scrollTop > 600);
    }
  };

  const scrollToTop = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div
      data-testid="vertical-webtoon-reader"
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 h-full w-full overflow-y-auto bg-black relative flex flex-col items-center scroll-smooth"
    >
      {pages && pages.length > 0 ? (
        <div className="w-full max-w-3xl flex flex-col items-center shadow-2xl py-4 space-y-0.5">
          {pages.map((page, index) => (
            <WebtoonPageItem
              key={page.id}
              page={page}
              index={index}
              total={pages.length}
            />
          ))}

          {/* End of chapter indicator */}
          <div className="w-full py-12 flex flex-col items-center justify-center text-muted border-t border-border/40 mt-6">
            <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-1">
              End of Chapter
            </span>
            <span className="text-[11px] text-muted">
              {pages.length} pages total
            </span>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-muted p-8 text-center space-y-3">
          <Layers className="w-10 h-10 opacity-40 text-primary" />
          <h3 className="font-semibold text-sm text-slate-200">
            No Pages in Current Chapter
          </h3>
          <p className="text-xs text-muted max-w-xs">
            Return to Studio mode to import comic pages or ZIP scans.
          </p>
        </div>
      )}

      {/* Floating Scroll to Top button */}
      {showScrollTop && (
        <button
          type="button"
          data-testid="webtoon-scroll-top-btn"
          onClick={scrollToTop}
          title="Scroll to top"
          className="fixed bottom-6 right-6 p-2.5 rounded-full bg-primary hover:bg-blue-600 text-white shadow-lg transition-transform hover:scale-105 z-30"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};
