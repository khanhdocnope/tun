import { create } from 'zustand';
import {
  BoundingBox,
  Point,
  ResizeHandle,
  TransformMatrix,
  ViewportDimensions,
} from '../types/canvas';
import {
  calculateActualSize,
  calculateFitToScreen,
  calculateZoomToCursor,
  clampZoom,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../utils/coordinate';

export interface CanvasState {
  scale: number; // Z zoom scale in [0.05, 20.0]
  panX: number; // Tx pan translation in screen pixels
  panY: number; // Ty pan translation in screen pixels
  selectedRegionId: string | null;
  isDragging: boolean;
  isResizing: boolean;
  activeHandle: ResizeHandle | null;
  drawingBox: BoundingBox | null;
  viewportDimensions: ViewportDimensions;
  imageDimensions: { width: number; height: number } | null;

  // Actions
  setScale: (scale: number) => void;
  setPan: (panX: number, panY: number) => void;
  setTransform: (matrix: TransformMatrix) => void;
  zoomIn: (factor?: number, center?: Point) => void;
  zoomOut: (factor?: number, center?: Point) => void;
  zoomToCursor: (cursor: Point, deltaOrNewScale: number, isRelative?: boolean) => void;
  fitToScreen: (viewport?: ViewportDimensions, image?: { width: number; height: number }) => void;
  actualSize: (viewport?: ViewportDimensions, image?: { width: number; height: number }) => void;
  setSelectedRegionId: (regionId: string | null) => void;
  setIsDragging: (isDragging: boolean) => void;
  setIsResizing: (isResizing: boolean, handle?: ResizeHandle | null) => void;
  setDrawingBox: (box: BoundingBox | null) => void;
  setViewportDimensions: (dims: ViewportDimensions) => void;
  setImageDimensions: (dims: { width: number; height: number } | null) => void;
  resetCanvas: () => void;
}

const initialCanvasState = {
  scale: 1.0,
  panX: 0,
  panY: 0,
  selectedRegionId: null,
  isDragging: false,
  isResizing: false,
  activeHandle: null,
  drawingBox: null,
  viewportDimensions: { width: 800, height: 600 },
  imageDimensions: null,
};

export const useCanvasStore = create<CanvasState>((set, get) => ({
  ...initialCanvasState,

  setScale: (scale) =>
    set({
      scale: clampZoom(scale),
    }),

  setPan: (panX, panY) =>
    set({
      panX,
      panY,
    }),

  setTransform: (matrix) =>
    set({
      scale: clampZoom(matrix.scale),
      panX: matrix.panX,
      panY: matrix.panY,
    }),

  zoomIn: (factor = 1.25, center) => {
    const { scale, panX, panY, viewportDimensions } = get();
    const targetCenter = center || {
      x: viewportDimensions.width / 2,
      y: viewportDimensions.height / 2,
    };
    const targetScale = scale * factor;
    const newTransform = calculateZoomToCursor(
      scale,
      targetScale,
      targetCenter,
      { x: panX, y: panY },
      MIN_ZOOM,
      MAX_ZOOM
    );
    set(newTransform);
  },

  zoomOut: (factor = 1.25, center) => {
    const { scale, panX, panY, viewportDimensions } = get();
    const targetCenter = center || {
      x: viewportDimensions.width / 2,
      y: viewportDimensions.height / 2,
    };
    const targetScale = scale / factor;
    const newTransform = calculateZoomToCursor(
      scale,
      targetScale,
      targetCenter,
      { x: panX, y: panY },
      MIN_ZOOM,
      MAX_ZOOM
    );
    set(newTransform);
  },

  zoomToCursor: (cursor, deltaOrNewScale, isRelative = true) => {
    const { scale, panX, panY } = get();
    let targetScale: number;

    if (isRelative) {
      // deltaOrNewScale is a multiplier (e.g. 1.1 or 0.9)
      targetScale = scale * deltaOrNewScale;
    } else {
      // deltaOrNewScale is the absolute target scale
      targetScale = deltaOrNewScale;
    }

    const newTransform = calculateZoomToCursor(
      scale,
      targetScale,
      cursor,
      { x: panX, y: panY },
      MIN_ZOOM,
      MAX_ZOOM
    );
    set(newTransform);
  },

  fitToScreen: (viewportOverride, imageOverride) => {
    const { viewportDimensions, imageDimensions } = get();
    const vp = viewportOverride || viewportDimensions;
    const img = imageOverride || imageDimensions;

    if (!img) return;

    const transform = calculateFitToScreen(vp, img, 20);
    set(transform);
  },

  actualSize: (viewportOverride, imageOverride) => {
    const { viewportDimensions, imageDimensions } = get();
    const vp = viewportOverride || viewportDimensions;
    const img = imageOverride || imageDimensions;

    if (!img) {
      set({ scale: 1.0, panX: 0, panY: 0 });
      return;
    }

    const transform = calculateActualSize(vp, img);
    set(transform);
  },

  setSelectedRegionId: (regionId) =>
    set({
      selectedRegionId: regionId,
    }),

  setIsDragging: (isDragging) =>
    set({
      isDragging,
    }),

  setIsResizing: (isResizing, handle = null) =>
    set({
      isResizing,
      activeHandle: isResizing ? handle : null,
    }),

  setDrawingBox: (drawingBox) =>
    set({
      drawingBox,
    }),

  setViewportDimensions: (viewportDimensions) =>
    set({
      viewportDimensions,
    }),

  setImageDimensions: (imageDimensions) =>
    set({
      imageDimensions,
    }),

  resetCanvas: () => set(initialCanvasState),
}));
