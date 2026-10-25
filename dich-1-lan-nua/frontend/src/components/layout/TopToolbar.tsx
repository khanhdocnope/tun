import React, { useState } from 'react';
import {
  MousePointer,
  Hand,
  Square,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Undo2,
  Redo2,
  PanelLeft,
  PanelRight,
  BookOpen,
  ScrollText,
  Edit3,
  Server,
  ScanText,
  Eraser,
  Layers,
  Split,
  Loader2,
} from 'lucide-react';
import { useStudioStore, LayerMode } from '../../store/useStudioStore';
import { ToolType } from '../../types/canvas';
import { ReaderMode } from '../../types/reader';
import { usePage, useTextRegions } from '../../db/hooks';
import { db } from '../../db';
import { detectOCR, processInpaint } from '../../services/api';
import { generateUUID } from '../../db/importExport';
import { TextRegion } from '../../types/region';
import { ServerSettingsModal } from './ServerSettingsModal';
import { useHistoryStore } from '../../store/useHistoryStore';

export interface TopToolbarProps {
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onFitToScreen?: () => void;
  onActualSize?: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onFitToScreen,
  onActualSize,
}) => {
  const {
    activeTool,
    setActiveTool,
    viewMode,
    setViewMode,
    zoomLevel,
    zoomIn,
    zoomOut,
    resetZoom,
    isSidebarOpen,
    toggleSidebar,
    isPropertiesOpen,
    toggleProperties,
    activePageId,
    backendUrl,
    isOcrLoading,
    setIsOcrLoading,
    isInpaintingLoading,
    setIsInpaintingLoading,
    activeLayer,
    setActiveLayer,
    maskDilation,
    selectedOcrEngine,
    selectedInpaintEngine,
    readingOrderDirection,
    setReadingOrderDirection,
    setStatusMessage,
  } = useStudioStore();

  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const page = usePage(activePageId);
  const regions = useTextRegions(activePageId);
  const recordSnapshot = useHistoryStore((s) => s.recordSnapshot);

  const handleUndo = () => {
    if (onUndo) {
      onUndo();
    } else {
      window.dispatchEvent(new CustomEvent('studio:undo'));
    }
  };

  const handleRedo = () => {
    if (onRedo) {
      onRedo();
    } else {
      window.dispatchEvent(new CustomEvent('studio:redo'));
    }
  };

  const handleFit = () => {
    if (onFitToScreen) {
      onFitToScreen();
    } else {
      window.dispatchEvent(new CustomEvent('studio:fit-to-screen'));
    }
  };

  const handleResetZoom = () => {
    resetZoom();
    if (onActualSize) {
      onActualSize();
    } else {
      window.dispatchEvent(new CustomEvent('studio:actual-size'));
    }
  };

  // Run OCR on current page
  const handleRunOcr = async () => {
    if (!page || !page.sourceBlob || isOcrLoading) return;

    setIsOcrLoading(true);
    setStatusMessage({ text: 'Detecting text regions and running OCR...', type: 'info' });

    try {
      const response = await detectOCR(page.sourceBlob, {
        engine: selectedOcrEngine,
        reading_order: readingOrderDirection,
      });

      const currentRegions = regions || [];
      const newRegions: TextRegion[] = response.regions.map((r: any, idx) => {
        const rawBox = r.box || r.bounding_box || { x: 0, y: 0, width: 50, height: 50 };
        return {
          id: r.id || generateUUID(),
          pageId: page.id,
          projectId: page.projectId,
          box: {
            x: Math.round(rawBox.x || 0),
            y: Math.round(rawBox.y || 0),
            width: Math.max(4, Math.round(rawBox.width || 50)),
            height: Math.max(4, Math.round(rawBox.height || 50)),
          },
          polygon: r.polygon,
          sourceText: r.text || '',
          translatedText: '',
          confidence: r.confidence ?? 1.0,
          status: 'detected',
          orderIndex: r.reading_order || idx + 1,
          readingDirection: (r.direction === 'vertical' || r.orientation === 'vertical') ? 'vertical' : 'horizontal',
          style: {
            fontFamily: 'Comic Neue',
            fontSize: 16,
            fontColor: '#000000',
            alignment: 'center',
            verticalAlignment: 'middle',
            bold: false,
            italic: false,
            lineHeight: 1.2,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      });

      // Non-destructive: append or replace detected regions
      await db.textRegions.where('pageId').equals(page.id).delete();
      await db.textRegions.bulkAdd(newRegions);
      await db.pages.update(page.id, {
        status: 'ocr_completed',
        updatedAt: Date.now(),
      });

      await recordSnapshot(page.id, 'BATCH_UPDATE', currentRegions, newRegions);

      setStatusMessage({
        text: `OCR complete: Detected ${newRegions.length} text regions (${response.processing_time_ms}ms)`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMessage({
        text: `OCR Error: ${err.message || 'Detection failed'}`,
        type: 'error',
      });
    } finally {
      setIsOcrLoading(false);
    }
  };

  // Erase text via Inpainting
  const handleRunInpaint = async () => {
    if (!page || !page.sourceBlob || isInpaintingLoading) return;
    const currentRegions = regions || [];
    if (currentRegions.length === 0) {
      setStatusMessage({
        text: 'No text regions to inpaint. Run OCR or draw boxes first.',
        type: 'info',
      });
      return;
    }

    setIsInpaintingLoading(true);
    setStatusMessage({ text: 'Inpainting and erasing dialogue bubbles...', type: 'info' });

    try {
      const inpaintRegions = currentRegions.map((r) => ({
        x: r.box.x,
        y: r.box.y,
        width: r.box.width,
        height: r.box.height,
        polygon: r.polygon,
      }));

      const res = await processInpaint(page.sourceBlob, {
        regions: inpaintRegions,
        dilation: maskDilation,
        engine: selectedInpaintEngine,
      });

      await db.pages.update(page.id, {
        cleanedBlob: res.cleanedBlob,
        updatedAt: Date.now(),
      });

      setActiveLayer('split');
      setStatusMessage({
        text: `Inpainting complete (${res.engine}, ${res.durationMs}ms). Showing Split view.`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusMessage({
        text: `Inpainting failed: ${err.message || 'Processing error'}`,
        type: 'error',
      });
    } finally {
      setIsInpaintingLoading(false);
    }
  };

  return (
    <>
      <header
        data-testid="top-toolbar"
        className="h-12 w-full bg-toolbar border-b border-border flex items-center justify-between px-3 z-30 select-none text-text"
        style={{ backgroundColor: '#1a1b20', borderColor: '#272930' }}
      >
        {/* Left section: Sidebar toggle & Title */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="toggle-sidebar-button"
            onClick={toggleSidebar}
            title={isSidebarOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
            className={`p-1.5 rounded hover:bg-card text-muted hover:text-text transition-colors ${
              isSidebarOpen ? 'text-primary' : ''
            }`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 border-r border-border pr-3">
            <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
            <span className="font-semibold text-xs tracking-wide uppercase text-slate-200">
              Comic Studio
            </span>
          </div>

          {/* Studio / Reader Mode Switcher */}
          <div
            data-testid="mode-switcher"
            className="flex items-center bg-background/80 p-0.5 rounded border border-border text-xs ml-1"
          >
            <button
              type="button"
              data-testid="mode-studio-btn"
              onClick={() => setViewMode('studio')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                viewMode === 'studio'
                  ? 'bg-primary text-white font-medium shadow-sm'
                  : 'text-muted hover:text-text'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Studio</span>
            </button>

            <button
              type="button"
              data-testid="mode-webtoon-btn"
              onClick={() => setViewMode('vertical_reader')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                viewMode === 'vertical_reader'
                  ? 'bg-primary text-white font-medium shadow-sm'
                  : 'text-muted hover:text-text'
              }`}
            >
              <ScrollText className="w-3.5 h-3.5" />
              <span>Webtoon</span>
            </button>

            <button
              type="button"
              data-testid="mode-page-btn"
              onClick={() => setViewMode('page_reader')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                viewMode === 'page_reader'
                  ? 'bg-primary text-white font-medium shadow-sm'
                  : 'text-muted hover:text-text'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Manga</span>
            </button>
          </div>
        </div>

        {/* Center section: Editing & AI Processing Actions */}
        <div className="flex items-center gap-1.5">
          {viewMode === 'studio' ? (
            <>
              {/* Tool Selection Buttons */}
              <div
                data-testid="tool-selector"
                className="flex items-center bg-background/80 p-0.5 rounded border border-border"
              >
                <button
                  type="button"
                  data-testid="tool-select-btn"
                  onClick={() => setActiveTool('select')}
                  title="Select / Move Tool (V)"
                  className={`p-1.5 rounded transition-colors ${
                    activeTool === 'select'
                      ? 'bg-primary text-white'
                      : 'text-muted hover:text-text hover:bg-card'
                  }`}
                >
                  <MousePointer className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  data-testid="tool-pan-btn"
                  onClick={() => setActiveTool('pan')}
                  title="Pan Tool (H / Space)"
                  className={`p-1.5 rounded transition-colors ${
                    activeTool === 'pan'
                      ? 'bg-primary text-white'
                      : 'text-muted hover:text-text hover:bg-card'
                  }`}
                >
                  <Hand className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  data-testid="tool-draw-btn"
                  onClick={() => setActiveTool('draw_rect')}
                  title="Draw Text Region Box (R)"
                  className={`p-1.5 rounded transition-colors ${
                    activeTool === 'draw_rect'
                      ? 'bg-primary text-white'
                      : 'text-muted hover:text-text hover:bg-card'
                  }`}
                >
                  <Square className="w-4 h-4" />
                </button>
              </div>

              {/* Undo & Redo */}
              <div className="flex items-center border-l border-border pl-1.5 gap-0.5">
                <button
                  type="button"
                  data-testid="undo-button"
                  onClick={handleUndo}
                  disabled={!canUndo && !onUndo}
                  title="Undo (Ctrl+Z)"
                  className="p-1.5 rounded text-muted hover:text-text hover:bg-card disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                >
                  <Undo2 className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  data-testid="redo-button"
                  onClick={handleRedo}
                  disabled={!canRedo && !onRedo}
                  title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
                  className="p-1.5 rounded text-muted hover:text-text hover:bg-card disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
              </div>

              {/* Phase 2: AI Processing Actions */}
              <div className="flex items-center border-l border-border pl-2 gap-1.5">
                {/* Reading Order Selector */}
                <button
                  type="button"
                  data-testid="reading-order-toggle"
                  onClick={() =>
                    setReadingOrderDirection(readingOrderDirection === 'rtl' ? 'ltr' : 'rtl')
                  }
                  title={`Reading Order: ${
                    readingOrderDirection === 'rtl' ? 'Right-to-Left (Manga)' : 'Left-to-Right (Webtoon)'
                  }`}
                  className="px-2 py-1 rounded bg-[#141518] hover:bg-[#202227] border border-border text-[11px] font-mono text-slate-300 transition-colors"
                >
                  {readingOrderDirection === 'rtl' ? 'RTL (Manga)' : 'LTR (Webtoon)'}
                </button>

                {/* Run OCR Button */}
                <button
                  type="button"
                  data-testid="run-ocr-btn"
                  onClick={handleRunOcr}
                  disabled={!page || isOcrLoading}
                  title="Detect dialogue bubbles and run OCR on active page"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-600/90 hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-medium transition-colors shadow-sm"
                >
                  {isOcrLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ScanText className="w-3.5 h-3.5" />
                  )}
                  <span>{isOcrLoading ? 'Detecting...' : 'Run OCR'}</span>
                </button>

                {/* Erase Text / Inpaint Button */}
                <button
                  type="button"
                  data-testid="run-inpaint-btn"
                  onClick={handleRunInpaint}
                  disabled={!page || isInpaintingLoading || (regions || []).length === 0}
                  title="Erase dialogue text using OpenCV inpainting"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-600/90 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-medium transition-colors shadow-sm"
                >
                  {isInpaintingLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Eraser className="w-3.5 h-3.5" />
                  )}
                  <span>{isInpaintingLoading ? 'Inpainting...' : 'Erase Text'}</span>
                </button>

                {/* Layer Mode Switcher (Original / Cleaned / Split Preview) */}
                <div
                  data-testid="layer-mode-switcher"
                  className="flex items-center bg-background/80 p-0.5 rounded border border-border text-[11px]"
                >
                  <button
                    type="button"
                    data-testid="layer-original-btn"
                    onClick={() => setActiveLayer('original')}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      activeLayer === 'original'
                        ? 'bg-slate-700 text-white font-medium'
                        : 'text-muted hover:text-text'
                    }`}
                  >
                    Original
                  </button>

                  <button
                    type="button"
                    data-testid="layer-cleaned-btn"
                    onClick={() => setActiveLayer('cleaned')}
                    disabled={!page?.cleanedBlob}
                    title={page?.cleanedBlob ? 'View Inpainted Background' : 'No cleaned image yet (Run Erase Text first)'}
                    className={`px-2 py-0.5 rounded transition-colors disabled:opacity-40 ${
                      activeLayer === 'cleaned'
                        ? 'bg-slate-700 text-white font-medium'
                        : 'text-muted hover:text-text'
                    }`}
                  >
                    Cleaned
                  </button>

                  <button
                    type="button"
                    data-testid="layer-split-btn"
                    onClick={() => setActiveLayer('split')}
                    disabled={!page?.cleanedBlob}
                    title={page?.cleanedBlob ? 'Split Slider Before / After Preview' : 'No cleaned image yet'}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors disabled:opacity-40 ${
                      activeLayer === 'split'
                        ? 'bg-blue-600 text-white font-medium'
                        : 'text-muted hover:text-text'
                    }`}
                  >
                    <Split className="w-3 h-3" />
                    <span>Split</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-xs text-muted flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Reader Consumption Mode</span>
            </div>
          )}
        </div>

        {/* Right section: Server Settings, Zoom HUD & Properties toggle */}
        <div className="flex items-center gap-2">
          {/* Server Connection Pill */}
          <button
            type="button"
            data-testid="open-server-settings-btn"
            onClick={() => setIsServerModalOpen(true)}
            title={`Backend: ${backendUrl} (Click to configure or test)`}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#141518] hover:bg-[#202227] border border-border text-xs text-slate-300 transition-colors"
          >
            <Server className="w-3.5 h-3.5 text-blue-400" />
            <span className="max-w-[120px] truncate font-mono text-[11px]">
              {backendUrl.replace(/^https?:\/\//, '')}
            </span>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </button>

          {/* Zoom HUD */}
          <div
            data-testid="zoom-hud"
            className="flex items-center bg-background/80 rounded border border-border px-1 py-0.5 text-xs text-muted"
          >
            <button
              type="button"
              data-testid="zoom-out-btn"
              onClick={zoomOut}
              title="Zoom Out (-)"
              className="p-1 rounded hover:text-text hover:bg-card transition-colors"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              data-testid="zoom-reset-btn"
              onClick={handleResetZoom}
              title="100% Actual Size"
              className="px-2 font-mono text-[11px] hover:text-primary transition-colors cursor-pointer"
            >
              {zoomLevel}%
            </button>

            <button
              type="button"
              data-testid="zoom-in-btn"
              onClick={zoomIn}
              title="Zoom In (+)"
              className="p-1 rounded hover:text-text hover:bg-card transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              data-testid="fit-screen-btn"
              onClick={handleFit}
              title="Fit to Screen"
              className="p-1 ml-1 border-l border-border hover:text-text hover:bg-card transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Properties Panel Toggle */}
          <button
            type="button"
            data-testid="toggle-properties-button"
            onClick={toggleProperties}
            title={isPropertiesOpen ? 'Collapse Properties' : 'Expand Properties'}
            className={`p-1.5 rounded hover:bg-card text-muted hover:text-text transition-colors ${
              isPropertiesOpen ? 'text-primary' : ''
            }`}
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Server Settings Modal */}
      <ServerSettingsModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
      />
    </>
  );
};
