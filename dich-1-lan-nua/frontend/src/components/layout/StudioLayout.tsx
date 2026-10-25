import React, { useState, useEffect } from 'react';
import { useStudioStore } from '../../store/useStudioStore';
import { usePage } from '../../db/hooks';
import { TopToolbar } from './TopToolbar';
import { ProjectSidebar } from './ProjectSidebar';
import { PropertiesPanel } from './PropertiesPanel';
import { Image as ImageIcon, CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface StudioLayoutProps {
  canvasSlot?: React.ReactNode;
}

export const StudioLayout: React.FC<StudioLayoutProps> = ({ canvasSlot }) => {
  const { activePageId, zoomLevel, statusMessage, setStatusMessage } = useStudioStore();
  const page = usePage(activePageId);
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    if (page?.sourceBlob) {
      try {
        url = URL.createObjectURL(page.sourceBlob);
        setPageImageUrl(url);
      } catch {
        setPageImageUrl(null);
      }
    } else {
      setPageImageUrl(null);
    }

    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [page?.sourceBlob]);

  // Auto dismiss status message after 6 seconds
  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => {
      setStatusMessage(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [statusMessage, setStatusMessage]);

  return (
    <div
      data-testid="studio-layout"
      className="h-screen w-screen flex flex-col bg-background text-text overflow-hidden select-none"
      style={{ backgroundColor: '#121316' }}
    >
      {/* 1. Top Toolbar */}
      <TopToolbar />

      {/* 2. Middle Row: Sidebar + Canvas Stage + Properties Panel */}
      <div className="flex-1 flex flex-row overflow-hidden relative">
        {/* Left Sidebar */}
        <ProjectSidebar />

        {/* Center Canvas Stage Container */}
        <main
          id="studio-canvas-stage"
          data-testid="studio-canvas-stage"
          className="flex-1 h-full relative overflow-hidden bg-background canvas-checkerboard flex items-center justify-center"
          style={{ backgroundColor: '#121316' }}
        >
          {canvasSlot ? (
            canvasSlot
          ) : page && pageImageUrl ? (
            <div
              data-testid="canvas-stage-viewport"
              className="relative max-w-full max-h-full flex items-center justify-center transition-transform duration-75"
              style={{
                transform: `scale(${zoomLevel / 100})`,
                transformOrigin: 'center center',
              }}
            >
              <img
                src={pageImageUrl}
                alt={page.fileName}
                data-testid="studio-active-image"
                className="max-h-[calc(100vh-80px)] max-w-[calc(100vw-620px)] object-contain shadow-2xl rounded border border-border"
              />
            </div>
          ) : (
            <div
              data-testid="canvas-empty-state"
              className="flex flex-col items-center justify-center p-8 text-center text-muted max-w-md space-y-3"
            >
              <div className="w-14 h-14 rounded-2xl bg-card border border-border flex items-center justify-center text-muted">
                <ImageIcon className="w-7 h-7 text-primary/70" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-sm text-slate-200">
                  No Comic Page Selected
                </h3>
                <p className="text-xs text-muted leading-relaxed">
                  Select a page from the sidebar thumbnail strip, or create a new project and import manga scans to start translating.
                </p>
              </div>
            </div>
          )}

          {/* Floating Status / Toast Banner */}
          {statusMessage && (
            <div
              data-testid="studio-status-toast"
              className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-40 px-3.5 py-2 rounded-lg border shadow-2xl flex items-center gap-2.5 text-xs animate-in fade-in slide-in-from-bottom-2 duration-200 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/90 border-emerald-700 text-emerald-200'
                  : statusMessage.type === 'error'
                  ? 'bg-rose-950/90 border-rose-700 text-rose-200'
                  : 'bg-slate-900/90 border-slate-700 text-slate-200'
              }`}
            >
              {statusMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
              {statusMessage.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
              {statusMessage.type === 'info' && <Info className="w-4 h-4 text-blue-400 shrink-0" />}
              <span className="font-medium">{statusMessage.text}</span>
              <button
                type="button"
                onClick={() => setStatusMessage(null)}
                className="text-slate-400 hover:text-white p-0.5 ml-1 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </main>

        {/* Right Properties Panel */}
        <PropertiesPanel />
      </div>
    </div>
  );
};
