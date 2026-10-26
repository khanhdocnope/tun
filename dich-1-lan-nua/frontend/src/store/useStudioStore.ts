import { create } from 'zustand';
import { ToolType } from '../types/canvas';
import { ReaderMode, ReadingDirection } from '../types/reader';
import { getBackendUrl, setBackendUrl as persistBackendUrl } from '../services/api';

export type LayerMode = 'original' | 'cleaned' | 'split';

export interface StatusMessage {
  text: string;
  type: 'info' | 'success' | 'error';
}

export interface StudioState {
  activeProjectId: string | null;
  activeChapterId: string | null;
  activePageId: string | null;
  selectedRegionId: string | null;
  activeTool: ToolType;
  viewMode: ReaderMode;
  readerDirection: ReadingDirection;
  isSidebarOpen: boolean;
  isPropertiesOpen: boolean;
  zoomLevel: number;

  // Phase 2: Processing, layers & backend settings
  backendUrl: string;
  isOcrLoading: boolean;
  isInpaintingLoading: boolean;
  activeLayer: LayerMode;
  splitSliderPos: number; // 0 to 100 percentage
  maskDilation: number; // 0 to 20 px
  selectedOcrEngine: string;
  selectedInpaintEngine:
    | 'auto'
    | 'flat'
    | 'texture'
    | 'flatten'
    | 'lama'
    | 'opencv_telea'
    | 'opencv_ns';
  readingOrderDirection: 'rtl' | 'ltr';
  statusMessage: StatusMessage | null;

  // Actions
  setActiveProject: (projectId: string | null) => void;
  setActiveChapter: (chapterId: string | null) => void;
  setActivePage: (pageId: string | null) => void;
  setSelectedRegion: (regionId: string | null) => void;
  setActiveTool: (tool: ToolType) => void;
  setViewMode: (mode: ReaderMode) => void;
  setReaderDirection: (direction: ReadingDirection) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  toggleProperties: () => void;
  setPropertiesOpen: (isOpen: boolean) => void;
  setZoomLevel: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  resetStudio: () => void;

  // Phase 2 Actions
  setBackendUrl: (url: string) => void;
  setIsOcrLoading: (loading: boolean) => void;
  setIsInpaintingLoading: (loading: boolean) => void;
  setActiveLayer: (layer: LayerMode) => void;
  setSplitSliderPos: (pos: number) => void;
  setMaskDilation: (dilation: number) => void;
  setSelectedOcrEngine: (engine: string) => void;
  setSelectedInpaintEngine: (
    engine:
      | 'auto'
      | 'flat'
      | 'texture'
      | 'flatten'
      | 'lama'
      | 'opencv_telea'
      | 'opencv_ns'
  ) => void;
  setReadingOrderDirection: (direction: 'rtl' | 'ltr') => void;
  setStatusMessage: (msg: StatusMessage | null) => void;
}

const initialState = {
  activeProjectId: null,
  activeChapterId: null,
  activePageId: null,
  selectedRegionId: null,
  activeTool: 'select' as ToolType,
  viewMode: 'studio' as ReaderMode,
  readerDirection: 'rtl' as ReadingDirection,
  isSidebarOpen: true,
  isPropertiesOpen: true,
  zoomLevel: 100,

  // Phase 2 defaults
  backendUrl: getBackendUrl(),
  isOcrLoading: false,
  isInpaintingLoading: false,
  activeLayer: 'original' as LayerMode,
  splitSliderPos: 50,
  maskDilation: 5,
  selectedOcrEngine: 'rapidocr',
  selectedInpaintEngine: 'auto' as const,
  readingOrderDirection: 'rtl' as const,
  statusMessage: null as StatusMessage | null,
};

export const useStudioStore = create<StudioState>((set) => ({
  ...initialState,

  setActiveProject: (projectId) =>
    set({
      activeProjectId: projectId,
      activeChapterId: null,
      activePageId: null,
      selectedRegionId: null,
    }),

  setActiveChapter: (chapterId) =>
    set({
      activeChapterId: chapterId,
      activePageId: null,
      selectedRegionId: null,
    }),

  setActivePage: (pageId) =>
    set({
      activePageId: pageId,
      selectedRegionId: null,
    }),

  setSelectedRegion: (regionId) =>
    set({
      selectedRegionId: regionId,
    }),

  setActiveTool: (tool) =>
    set({
      activeTool: tool,
    }),

  setViewMode: (mode) =>
    set({
      viewMode: mode,
    }),

  setReaderDirection: (direction) =>
    set({
      readerDirection: direction,
    }),

  toggleSidebar: () =>
    set((state) => ({
      isSidebarOpen: !state.isSidebarOpen,
    })),

  setSidebarOpen: (isOpen) =>
    set({
      isSidebarOpen: isOpen,
    }),

  toggleProperties: () =>
    set((state) => ({
      isPropertiesOpen: !state.isPropertiesOpen,
    })),

  setPropertiesOpen: (isOpen) =>
    set({
      isPropertiesOpen: isOpen,
    }),

  setZoomLevel: (zoom) =>
    set({
      zoomLevel: Math.max(5, Math.min(2000, Math.round(zoom))),
    }),

  zoomIn: () =>
    set((state) => ({
      zoomLevel: Math.min(2000, Math.round(state.zoomLevel * 1.25)),
    })),

  zoomOut: () =>
    set((state) => ({
      zoomLevel: Math.max(5, Math.round(state.zoomLevel / 1.25)),
    })),

  resetZoom: () =>
    set({
      zoomLevel: 100,
    }),

  setBackendUrl: (url) => {
    persistBackendUrl(url);
    set({ backendUrl: url });
  },

  setIsOcrLoading: (loading) => set({ isOcrLoading: loading }),
  setIsInpaintingLoading: (loading) => set({ isInpaintingLoading: loading }),
  setActiveLayer: (layer) => set({ activeLayer: layer }),
  setSplitSliderPos: (pos) => set({ splitSliderPos: Math.max(0, Math.min(100, pos)) }),
  setMaskDilation: (dilation) => set({ maskDilation: Math.max(0, Math.min(20, dilation)) }),
  setSelectedOcrEngine: (engine) => set({ selectedOcrEngine: engine }),
  setSelectedInpaintEngine: (engine) => set({ selectedInpaintEngine: engine }),
  setReadingOrderDirection: (direction) => set({ readingOrderDirection: direction }),
  setStatusMessage: (statusMessage) => set({ statusMessage }),

  resetStudio: () => set(initialState),
}));
