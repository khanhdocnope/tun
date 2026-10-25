import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { usePage, useTextRegions } from '../../db/hooks';
import { useCanvasStore } from '../../store/useCanvasStore';
import { useStudioStore } from '../../store/useStudioStore';
import { useHistoryStore, useHistoryHotkeys } from '../../store/useHistoryStore';
import { db } from '../../db';
import { CanvasOverlay } from './CanvasOverlay';
import { ZoomControls } from './ZoomControls';
import { calculateFitToScreen, calculateZoomToCursor } from '../../utils/coordinate';
import { Image as ImageIcon, ChevronsLeftRight } from 'lucide-react';

export interface ImageCanvasProps {
  pageId?: string | null;
  className?: string;
}

export const ImageCanvas: React.FC<ImageCanvasProps> = ({
  pageId: propPageId,
  className = '',
}) => {
  const studioActivePageId = useStudioStore((s) => s.activePageId);
  const activeTool = useStudioStore((s) => s.activeTool);
  const setActiveTool = useStudioStore((s) => s.setActiveTool);
  const activeLayer = useStudioStore((s) => s.activeLayer);
  const splitSliderPos = useStudioStore((s) => s.splitSliderPos);
  const setSplitSliderPos = useStudioStore((s) => s.setSplitSliderPos);

  const effectivePageId = propPageId !== undefined ? propPageId : studioActivePageId;
  const page = usePage(effectivePageId);
  const regions = useTextRegions(effectivePageId);

  // History hotkeys (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
  useHistoryHotkeys(effectivePageId || null);

  // Canvas Store State
  const scale = useCanvasStore((s) => s.scale);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const setPan = useCanvasStore((s) => s.setPan);
  const setTransform = useCanvasStore((s) => s.setTransform);
  const setViewportDimensions = useCanvasStore((s) => s.setViewportDimensions);
  const setImageDimensions = useCanvasStore((s) => s.setImageDimensions);
  const selectedRegionId = useCanvasStore((s) => s.selectedRegionId);
  const setSelectedRegionId = useCanvasStore((s) => s.setSelectedRegionId);

  const recordSnapshot = useHistoryStore((s) => s.recordSnapshot);

  // Container refs & measurement
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerBounds, setContainerBounds] = useState({
    width: 800,
    height: 600,
    left: 0,
    top: 0,
  });

  // Spacebar pan hold state
  const [isSpaceHeld, setIsSpaceHeld] = useState(false);
  const previousToolRef = useRef(activeTool);

  // Viewport panning drag state
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; initialPanX: number; initialPanY: number }>({
    x: 0,
    y: 0,
    initialPanX: 0,
    initialPanY: 0,
  });

  // Split slider drag state
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);

  // Track if initial fit-to-screen has run for the current page
  const hasFitInitialPageRef = useRef<string | null>(null);

  /* ========================================================================= */
  /*                            IMAGE URL LIFECYCLE                            */
  /* ========================================================================= */

  const imageUrl = useMemo(() => {
    if (!page?.sourceBlob) return null;
    return URL.createObjectURL(page.sourceBlob);
  }, [page?.sourceBlob]);

  const cleanedUrl = useMemo(() => {
    if (!page?.cleanedBlob) return null;
    return URL.createObjectURL(page.cleanedBlob);
  }, [page?.cleanedBlob]);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
    };
  }, [cleanedUrl]);

  // Update canvas store image dimensions when page loads
  useEffect(() => {
    if (page?.width && page?.height) {
      setImageDimensions({ width: page.width, height: page.height });
    } else {
      setImageDimensions(null);
    }
  }, [page?.width, page?.height, setImageDimensions]);

  /* ========================================================================= */
  /*                        CONTAINER RESIZE OBSERVER                          */
  /* ========================================================================= */

  const updateBounds = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const bounds = {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
    };
    setContainerBounds(bounds);
    setViewportDimensions({ width: rect.width, height: rect.height });
  }, [setViewportDimensions]);

  useEffect(() => {
    updateBounds();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      observer = new ResizeObserver(() => {
        updateBounds();
      });
      observer.observe(containerRef.current);
    }

    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds);

    return () => {
      if (observer) {
        observer.disconnect();
      }
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds);
    };
  }, [updateBounds]);

  // Auto fit-to-screen on initial page load
  useEffect(() => {
    if (
      effectivePageId &&
      page &&
      page.width > 0 &&
      page.height > 0 &&
      containerBounds.width > 0 &&
      containerBounds.height > 0 &&
      hasFitInitialPageRef.current !== effectivePageId
    ) {
      hasFitInitialPageRef.current = effectivePageId;
      const fitMatrix = calculateFitToScreen(
        { width: containerBounds.width, height: containerBounds.height },
        { width: page.width, height: page.height },
        24
      );
      setTransform(fitMatrix);
    }
  }, [effectivePageId, page, containerBounds.width, containerBounds.height, setTransform]);

  /* ========================================================================= */
  /*                        WHEEL ZOOM (CURSOR-INVARIANT)                      */
  /* ========================================================================= */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const cursor = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      const zoomFactor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const currentScale = useCanvasStore.getState().scale;
      const currentPanX = useCanvasStore.getState().panX;
      const currentPanY = useCanvasStore.getState().panY;

      const targetScale = currentScale * zoomFactor;

      const newMatrix = calculateZoomToCursor(
        currentScale,
        targetScale,
        cursor,
        { x: currentPanX, y: currentPanY }
      );

      setTransform(newMatrix);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [setTransform]);

  /* ========================================================================= */
  /*                       KEYBOARD PAN & DELETE SHORTCUTS                     */
  /* ========================================================================= */

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space' && !e.repeat && !isSpaceHeld) {
        setIsSpaceHeld(true);
        previousToolRef.current = useStudioStore.getState().activeTool;
        setActiveTool('pan');
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRegionId && effectivePageId) {
        e.preventDefault();
        const currentRegions = regions || [];
        const regionToDelete = currentRegions.find((r) => r.id === selectedRegionId);
        if (regionToDelete) {
          const remaining = currentRegions.filter((r) => r.id !== selectedRegionId);
          void db.textRegions.delete(selectedRegionId);
          void recordSnapshot(effectivePageId, 'DELETE_REGION', currentRegions, remaining);
          setSelectedRegionId(null);
          useStudioStore.getState().setSelectedRegion(null);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceHeld(false);
        setActiveTool(previousToolRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    isSpaceHeld,
    selectedRegionId,
    effectivePageId,
    regions,
    setActiveTool,
    setSelectedRegionId,
    recordSnapshot,
  ]);

  /* ========================================================================= */
  /*                          VIEWPORT PAN DRAG                                */
  /* ========================================================================= */

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingSplit) return;

    const isPanTrigger = activeTool === 'pan' || e.button === 1 || isSpaceHeld;
    if (isPanTrigger) {
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        initialPanX: panX,
        initialPanY: panY,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingSplit && page) {
      // Calculate split slider position relative to the image stage width
      const imageLeftOnScreen = containerBounds.left + panX;
      const imageWidthOnScreen = page.width * scale;
      if (imageWidthOnScreen > 0) {
        const mouseX = e.clientX - imageLeftOnScreen;
        const newPct = (mouseX / imageWidthOnScreen) * 100;
        setSplitSliderPos(Math.max(0, Math.min(100, Math.round(newPct))));
      }
      return;
    }

    if (!isPanning) return;
    const deltaX = e.clientX - panStartRef.current.x;
    const deltaY = e.clientY - panStartRef.current.y;

    setPan(
      panStartRef.current.initialPanX + deltaX,
      panStartRef.current.initialPanY + deltaY
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingSplit) {
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setIsDraggingSplit(false);
    }
    if (isPanning) {
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setIsPanning(false);
    }
  };

  /* ========================================================================= */
  /*                                  RENDER                                   */
  /* ========================================================================= */

  if (!effectivePageId || !page) {
    return (
      <div
        ref={containerRef}
        className={`relative w-full h-full bg-[#121316] flex flex-col items-center justify-center select-none text-[#94a3b8] ${className}`}
        data-testid="canvas-empty-state"
      >
        <div className="flex flex-col items-center max-w-sm text-center p-6 bg-[#18191d] border border-[#272930] rounded-xl shadow-xl">
          <div className="p-3 bg-[#141518] border border-[#272930] rounded-full mb-3 text-blue-400">
            <ImageIcon className="w-8 h-8" />
          </div>
          <h3 className="text-base font-semibold text-[#f1f5f9] mb-1">No Page Selected</h3>
          <p className="text-xs text-[#94a3b8] leading-relaxed">
            Select a comic page from the sidebar or import new pages to start precision editing.
          </p>
        </div>
      </div>
    );
  }

  const cursorStyle = isPanning
    ? 'grabbing'
    : isDraggingSplit
    ? 'col-resize'
    : activeTool === 'pan' || isSpaceHeld
    ? 'grab'
    : 'default';

  const isSplitMode = activeLayer === 'split' && Boolean(cleanedUrl);
  const showCleanedDirectly = activeLayer === 'cleaned' && Boolean(cleanedUrl);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full bg-[#121316] overflow-hidden select-none outline-none ${className}`}
      style={{ cursor: cursorStyle }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      data-testid="image-canvas-container"
    >
      {/* Precision Transformed Canvas Stage */}
      <div
        className="absolute origin-top-left will-change-transform pointer-events-none"
        style={{
          transform: `translate3d(${panX}px, ${panY}px, 0px) scale(${scale})`,
          width: page.width,
          height: page.height,
        }}
        data-testid="canvas-stage"
      >
        {/* Layer 1: Base Image (Original or Inpainted Cleaned) */}
        {imageUrl ? (
          <img
            src={showCleanedDirectly && cleanedUrl ? cleanedUrl : imageUrl}
            alt={page.fileName}
            className="w-full h-full block select-none pointer-events-none shadow-2xl"
            draggable={false}
            data-testid="canvas-image"
          />
        ) : null}

        {/* Layer 2: Split Mode Comparison Overlay (Cleaned Image clipped to splitSliderPos) */}
        {isSplitMode && cleanedUrl && (
          <div
            className="absolute inset-0 pointer-events-none overflow-hidden"
            style={{
              clipPath: `polygon(${splitSliderPos}% 0, 100% 0, 100% 100%, ${splitSliderPos}% 100%)`,
            }}
            data-testid="canvas-split-cleaned-layer"
          >
            <img
              src={cleanedUrl}
              alt="Cleaned preview"
              className="w-full h-full block select-none pointer-events-none"
              draggable={false}
            />
          </div>
        )}

        {/* Layer 3: Split Mode Divider Handle */}
        {isSplitMode && (
          <div
            className="absolute top-0 bottom-0 pointer-events-auto flex items-center justify-center cursor-col-resize group"
            style={{
              left: `${splitSliderPos}%`,
              transform: 'translateX(-50%)',
              width: '24px',
              zIndex: 15,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
              setIsDraggingSplit(true);
            }}
            data-testid="split-slider-handle"
          >
            {/* Visual divider line */}
            <div className="w-[2px] h-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />

            {/* Draggable center pill icon */}
            <div className="absolute w-6 h-6 rounded-full bg-blue-600 border border-white text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <ChevronsLeftRight className="w-3.5 h-3.5" />
            </div>

            {/* Indicator label badges */}
            <div className="absolute top-3 right-4 px-1.5 py-0.5 rounded bg-black/75 border border-white/20 text-[10px] font-medium text-white pointer-events-none">
              Original
            </div>
            <div className="absolute top-3 left-4 px-1.5 py-0.5 rounded bg-black/75 border border-white/20 text-[10px] font-medium text-white pointer-events-none">
              Cleaned
            </div>
          </div>
        )}
      </div>

      {/* Interactive Canvas Overlay (Bounding Boxes, Handles, Drawing Tool) */}
      <CanvasOverlay
        pageId={effectivePageId}
        projectId={page.projectId}
        regions={regions || []}
        imageDimensions={{ width: page.width, height: page.height }}
        containerBounds={containerBounds}
      />

      {/* Floating Zoom HUD Controls */}
      <div className="absolute bottom-4 right-4 z-20">
        <ZoomControls />
      </div>
    </div>
  );
};
