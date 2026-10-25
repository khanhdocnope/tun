import React, { useState, useRef, useCallback } from 'react';
import { BoundingBox, Point, ResizeHandle, TransformMatrix } from '../../types/canvas';
import { TextRegion, TextStyle } from '../../types/region';
import {
  boxToScreen,
  clampBoxPositionToImage,
  clampBoxToImage,
  isBoxValid,
  normalizeBox,
  resizeBoxWithHandle,
  screenToImage,
} from '../../utils/coordinate';
import { useCanvasStore } from '../../store/useCanvasStore';
import { useStudioStore } from '../../store/useStudioStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import { db } from '../../db';
import { generateUUID } from '../../db/importExport';

export interface CanvasOverlayProps {
  pageId: string;
  projectId: string;
  regions: TextRegion[];
  imageDimensions: { width: number; height: number };
  containerBounds: { width: number; height: number; left: number; top: number };
}

const defaultTextStyle: TextStyle = {
  fontFamily: 'Comic Neue',
  fontSize: 16,
  fontColor: '#000000',
  alignment: 'center',
  verticalAlignment: 'middle',
  bold: false,
  italic: false,
  lineHeight: 1.2,
};

const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export const CanvasOverlay: React.FC<CanvasOverlayProps> = ({
  pageId,
  projectId,
  regions,
  imageDimensions,
  containerBounds,
}) => {
  const scale = useCanvasStore((s) => s.scale);
  const panX = useCanvasStore((s) => s.panX);
  const panY = useCanvasStore((s) => s.panY);
  const selectedRegionId = useCanvasStore((s) => s.selectedRegionId);
  const setSelectedRegionId = useCanvasStore((s) => s.setSelectedRegionId);
  const setIsDragging = useCanvasStore((s) => s.setIsDragging);
  const setIsResizing = useCanvasStore((s) => s.setIsResizing);
  const setDrawingBoxInStore = useCanvasStore((s) => s.setDrawingBox);

  const activeTool = useStudioStore((s) => s.activeTool);
  const setStudioSelectedRegion = useStudioStore((s) => s.setSelectedRegion);

  const recordSnapshot = useHistoryStore((s) => s.recordSnapshot);

  // Interaction State
  type InteractionMode =
    | { type: 'idle' }
    | { type: 'drawing'; startImgPoint: Point; currentBox: BoundingBox }
    | {
        type: 'moving';
        region: TextRegion;
        initialBox: BoundingBox;
        startScreenPoint: Point;
        currentBox: BoundingBox;
      }
    | {
        type: 'resizing';
        region: TextRegion;
        handle: ResizeHandle;
        initialBox: BoundingBox;
        currentBox: BoundingBox;
      };

  const [interaction, setInteraction] = useState<InteractionMode>({ type: 'idle' });
  const interactionRef = useRef<InteractionMode>({ type: 'idle' });
  const overlayRef = useRef<SVGSVGElement>(null);

  const transform: TransformMatrix = { scale, panX, panY };

  // Helper to convert screen mouse event to image coordinates
  const getScreenPoint = useCallback(
    (e: React.PointerEvent | PointerEvent): Point => {
      const anyE = e as any;
      const rawX = anyE.clientX ?? anyE.nativeEvent?.clientX ?? 0;
      const rawY = anyE.clientY ?? anyE.nativeEvent?.clientY ?? 0;
      return {
        x: rawX - containerBounds.left,
        y: rawY - containerBounds.top,
      };
    },
    [containerBounds.left, containerBounds.top]
  );

  const getImagePoint = useCallback(
    (screenP: Point): Point => {
      return screenToImage(screenP, transform);
    },
    [transform]
  );

  // Sync selected region with both stores
  const handleSelectRegion = (id: string | null) => {
    setSelectedRegionId(id);
    setStudioSelectedRegion(id);
  };

  /* ========================================================================= */
  /*                        POINTER EVENT HANDLERS                             */
  /* ========================================================================= */

  // 1. POINTER DOWN on Background Canvas
  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const isPrimaryButton = e.button === 0 || e.button === undefined;
    if (activeTool === 'pan' || !isPrimaryButton) {
      return; // Let pan tool or non-primary clicks pass through
    }

    const screenP = getScreenPoint(e);
    const imgP = getImagePoint(screenP);

    if (activeTool === 'draw_rect') {
      e.stopPropagation();
      try {
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      } catch {
        // ignore
      }

      const initialBox: BoundingBox = { x: imgP.x, y: imgP.y, width: 0, height: 0 };
      const nextInter: InteractionMode = {
        type: 'drawing',
        startImgPoint: imgP,
        currentBox: initialBox,
      };
      interactionRef.current = nextInter;
      setInteraction(nextInter);
      setDrawingBoxInStore(initialBox);
    } else if (activeTool === 'select') {
      // Clicked on empty space: deselect
      handleSelectRegion(null);
    }
  };

  // 2. POINTER DOWN on Region Box (Move / Select)
  const handleRegionPointerDown = (
    e: React.PointerEvent,
    region: TextRegion
  ) => {
    const isPrimary = e.button === 0 || e.button === undefined;
    if (activeTool !== 'select' || !isPrimary) return;

    e.stopPropagation();
    handleSelectRegion(region.id);

    const screenP = getScreenPoint(e);

    try {
      overlayRef.current?.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    const nextInter: InteractionMode = {
      type: 'moving',
      region,
      initialBox: { ...region.box },
      startScreenPoint: screenP,
      currentBox: { ...region.box },
    };
    interactionRef.current = nextInter;
    setInteraction(nextInter);
    setIsDragging(true);
  };

  // 3. POINTER DOWN on Resize Handle
  const handleResizeHandlePointerDown = (
    e: React.PointerEvent,
    region: TextRegion,
    handle: ResizeHandle
  ) => {
    e.stopPropagation();
    const isPrimary = e.button === 0 || e.button === undefined;
    if (!isPrimary) return;

    try {
      overlayRef.current?.setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    const nextInter: InteractionMode = {
      type: 'resizing',
      region,
      handle,
      initialBox: { ...region.box },
      currentBox: { ...region.box },
    };
    interactionRef.current = nextInter;
    setInteraction(nextInter);
    setIsResizing(true, handle);
  };

  // 4. POINTER MOVE (Track Draw / Move / Resize)
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const curInteraction = interactionRef.current;
    if (curInteraction.type === 'idle') return;

    const screenP = getScreenPoint(e);
    const imgP = getImagePoint(screenP);

    if (curInteraction.type === 'drawing') {
      const normalized = normalizeBox(curInteraction.startImgPoint, imgP);
      const clamped = clampBoxToImage(normalized, imageDimensions.width, imageDimensions.height);

      const nextInter: InteractionMode = {
        ...curInteraction,
        currentBox: clamped,
      };
      interactionRef.current = nextInter;
      setInteraction(nextInter);
      setDrawingBoxInStore(clamped);
    } else if (curInteraction.type === 'moving') {
      const deltaXScreen = screenP.x - curInteraction.startScreenPoint.x;
      const deltaYScreen = screenP.y - curInteraction.startScreenPoint.y;

      const deltaXImg = deltaXScreen / scale;
      const deltaYImg = deltaYScreen / scale;

      const targetBox: BoundingBox = {
        x: Math.round(curInteraction.initialBox.x + deltaXImg),
        y: Math.round(curInteraction.initialBox.y + deltaYImg),
        width: curInteraction.initialBox.width,
        height: curInteraction.initialBox.height,
      };

      const clampedMove = clampBoxPositionToImage(
        targetBox,
        imageDimensions.width,
        imageDimensions.height
      );

      const nextInter: InteractionMode = {
        ...curInteraction,
        currentBox: clampedMove,
      };
      interactionRef.current = nextInter;
      setInteraction(nextInter);
    } else if (curInteraction.type === 'resizing') {
      const resized = resizeBoxWithHandle(
        curInteraction.initialBox,
        curInteraction.handle,
        imgP,
        imageDimensions.width,
        imageDimensions.height
      );

      const nextInter: InteractionMode = {
        ...curInteraction,
        currentBox: resized,
      };
      interactionRef.current = nextInter;
      setInteraction(nextInter);
    }
  };

  // 5. POINTER UP (Commit Changes to Dexie & History)
  const handlePointerUp = async (e: React.PointerEvent<SVGSVGElement>) => {
    const activeInter = interactionRef.current;
    if (activeInter.type === 'idle') return;

    interactionRef.current = { type: 'idle' };
    setInteraction({ type: 'idle' });

    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    if (activeInter.type === 'drawing') {
      const screenP = getScreenPoint(e);
      const imgP = getImagePoint(screenP);
      const normalized = normalizeBox(activeInter.startImgPoint, imgP);
      const clamped = clampBoxToImage(normalized, imageDimensions.width, imageDimensions.height);
      const box = isBoxValid(clamped, 4) ? clamped : activeInter.currentBox;
      setDrawingBoxInStore(null);

      // Verify minimum threshold >= 4px to suppress phantom clicks
      if (isBoxValid(box, 4)) {
        const newRegion: TextRegion = {
          id: generateUUID(),
          pageId,
          projectId,
          box,
          sourceText: '',
          translatedText: '',
          confidence: 1.0,
          status: 'detected',
          orderIndex: regions.length + 1,
          readingDirection: 'horizontal',
          style: defaultTextStyle,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const beforeList = [...regions];
        const afterList = [...regions, newRegion];

        await db.textRegions.add(newRegion);
        await recordSnapshot(pageId, 'ADD_REGION', beforeList, afterList);

        handleSelectRegion(newRegion.id);
      }
    } else if (activeInter.type === 'moving') {
      setIsDragging(false);
      const { region, initialBox, currentBox } = activeInter;

      // Only save if position actually changed
      if (currentBox.x !== initialBox.x || currentBox.y !== initialBox.y) {
        const updatedRegion: TextRegion = {
          ...region,
          box: currentBox,
          updatedAt: Date.now(),
        };

        const beforeList = regions.map((r) => (r.id === region.id ? region : r));
        const afterList = regions.map((r) => (r.id === region.id ? updatedRegion : r));

        await db.textRegions.update(region.id, {
          box: currentBox,
          updatedAt: Date.now(),
        });
        await recordSnapshot(pageId, 'MOVE_RESIZE_REGION', beforeList, afterList);
      }
    } else if (activeInter.type === 'resizing') {
      setIsResizing(false, null);
      const { region, initialBox, currentBox } = activeInter;

      // Only save if dimensions or position actually changed
      if (
        currentBox.x !== initialBox.x ||
        currentBox.y !== initialBox.y ||
        currentBox.width !== initialBox.width ||
        currentBox.height !== initialBox.height
      ) {
        const updatedRegion: TextRegion = {
          ...region,
          box: currentBox,
          updatedAt: Date.now(),
        };

        const beforeList = regions.map((r) => (r.id === region.id ? region : r));
        const afterList = regions.map((r) => (r.id === region.id ? updatedRegion : r));

        await db.textRegions.update(region.id, {
          box: currentBox,
          updatedAt: Date.now(),
        });
        await recordSnapshot(pageId, 'MOVE_RESIZE_REGION', beforeList, afterList);
      }
    }
  };

  /* ========================================================================= */
  /*                           RENDER HELPERS                                  */
  /* ========================================================================= */

  // Helper to get screen coordinate of a handle
  const getHandleScreenPoint = (screenBox: BoundingBox, handle: ResizeHandle): Point => {
    const { x, y, width, height } = screenBox;
    switch (handle) {
      case 'nw':
        return { x, y };
      case 'n':
        return { x: x + width / 2, y };
      case 'ne':
        return { x: x + width, y };
      case 'e':
        return { x: x + width, y: y + height / 2 };
      case 'se':
        return { x: x + width, y: y + height };
      case 's':
        return { x: x + width / 2, y: y + height };
      case 'sw':
        return { x, y: y + height };
      case 'w':
        return { x, y: y + height / 2 };
    }
  };

  const getHandleCursor = (handle: ResizeHandle): string => {
    switch (handle) {
      case 'nw':
      case 'se':
        return 'nwse-resize';
      case 'ne':
      case 'sw':
        return 'nesw-resize';
      case 'n':
      case 's':
        return 'ns-resize';
      case 'e':
      case 'w':
        return 'ew-resize';
    }
  };

  // Cursor style for entire canvas overlay
  let canvasCursor = 'default';
  if (activeTool === 'draw_rect') canvasCursor = 'crosshair';
  else if (activeTool === 'pan') canvasCursor = 'grab';

  return (
    <svg
      ref={overlayRef}
      className="absolute inset-0 w-full h-full pointer-events-auto select-none"
      style={{ cursor: canvasCursor }}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      data-testid="canvas-overlay"
    >
      {/* 1. Render all committed text regions */}
      {regions.map((region) => {
        const isSelected = selectedRegionId === region.id;
        const isMovingThis =
          interaction.type === 'moving' && interaction.region.id === region.id;
        const isResizingThis =
          interaction.type === 'resizing' && interaction.region.id === region.id;

        // Use active interaction box if currently being moved/resized
        const effectiveBox = isMovingThis || isResizingThis ? interaction.currentBox : region.box;
        const screenBox = boxToScreen(effectiveBox, transform);

        // Status badge color
        const borderColor = isSelected
          ? '#3b82f6'
          : region.status === 'approved'
          ? '#10b981'
          : region.status === 'translated'
          ? '#6366f1'
          : '#f59e0b';

        return (
          <g key={region.id} data-testid={`region-group-${region.id}`}>
            {/* Optional Polygon Outline (if detected by RapidOCR) */}
            {region.polygon && region.polygon.length >= 3 && (
              <polygon
                points={region.polygon
                  .map(([px, py]) => `${px * scale + panX},${py * scale + panY}`)
                  .join(' ')}
                fill="none"
                stroke={borderColor}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.6}
                pointerEvents="none"
              />
            )}

            {/* Box Rectangle */}
            <rect
              x={screenBox.x}
              y={screenBox.y}
              width={screenBox.width}
              height={screenBox.height}
              fill={isSelected ? 'rgba(59, 130, 246, 0.18)' : 'rgba(245, 158, 11, 0.08)'}
              stroke={borderColor}
              strokeWidth={isSelected ? 2 : 1.5}
              strokeDasharray={isSelected ? undefined : '4 2'}
              style={{
                cursor: activeTool === 'select' ? 'move' : undefined,
              }}
              onPointerDown={(e) => handleRegionPointerDown(e, region)}
              data-testid={`region-box-${region.id}`}
            />

            {/* Region Order Badge */}
            <g transform={`translate(${screenBox.x}, ${Math.max(0, screenBox.y - 18)})`}>
              <rect
                x={0}
                y={0}
                width={Math.max(18, (region.orderIndex.toString().length + 1) * 8)}
                height={16}
                rx={3}
                fill={borderColor}
              />
              <text
                x={Math.max(18, (region.orderIndex.toString().length + 1) * 8) / 2}
                y={12}
                textAnchor="middle"
                fontSize={10}
                fontWeight="bold"
                fill="#ffffff"
              >
                {region.orderIndex}
              </text>
            </g>

            {/* Translated / Source Text Preview Tag */}
            {region.translatedText || region.sourceText ? (
              <g transform={`translate(${screenBox.x}, ${screenBox.y + screenBox.height + 2})`}>
                <rect
                  x={0}
                  y={0}
                  width={Math.min(160, Math.max(40, (region.translatedText || region.sourceText).length * 7))}
                  height={15}
                  rx={2}
                  fill="#18191d"
                  opacity={0.85}
                />
                <text
                  x={4}
                  y={11}
                  fontSize={9}
                  fill="#94a3b8"
                  className="font-sans"
                >
                  {(region.translatedText || region.sourceText).slice(0, 20)}
                </text>
              </g>
            ) : null}

            {/* 2. Render 8 Resize Handles if Selected */}
            {isSelected &&
              RESIZE_HANDLES.map((handle) => {
                const handlePos = getHandleScreenPoint(screenBox, handle);
                const handleSize = 8;
                return (
                  <rect
                    key={handle}
                    x={handlePos.x - handleSize / 2}
                    y={handlePos.y - handleSize / 2}
                    width={handleSize}
                    height={handleSize}
                    fill="#ffffff"
                    stroke="#2563eb"
                    strokeWidth={2}
                    rx={1}
                    style={{ cursor: getHandleCursor(handle) }}
                    onPointerDown={(e) => handleResizeHandlePointerDown(e, region, handle)}
                    data-testid={`handle-${handle}`}
                  />
                );
              })}
          </g>
        );
      })}

      {/* 3. Render Drawing Rubber-band Box */}
      {interaction.type === 'drawing' && (
        <g data-testid="drawing-box-preview">
          {(() => {
            const screenBox = boxToScreen(interaction.currentBox, transform);
            return (
              <rect
                x={screenBox.x}
                y={screenBox.y}
                width={screenBox.width}
                height={screenBox.height}
                fill="rgba(59, 130, 246, 0.2)"
                stroke="#3b82f6"
                strokeWidth={2}
                strokeDasharray="4 4"
              />
            );
          })()}
        </g>
      )}
    </svg>
  );
};
