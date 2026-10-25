import { BoundingBox } from './canvas';

export type TextRegionStatus = 'detected' | 'verified' | 'in_translation' | 'translated' | 'approved';
export type ReadingDirectionType = 'vertical' | 'horizontal';

export interface TextStyle {
  fontFamily: string; // 'Comic Neue', 'Bangers', 'Inter', 'Noto Sans JP'
  fontSize: number; // Base font size in px at 100% scale
  fontColor: string; // Hex color '#000000'
  backgroundColor?: string; // Hex color '#ffffff'
  alignment: 'left' | 'center' | 'right';
  verticalAlignment: 'top' | 'middle' | 'bottom';
  bold: boolean;
  italic: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  lineHeight: number;
}

export interface TextRegion {
  id: string; // UUID v4
  pageId: string; // Foreign key -> Page.id
  projectId: string; // Foreign key -> Project.id
  box: BoundingBox;
  polygon?: [number, number][]; // Optional contour points [[x, y], ...]
  sourceText: string;
  translatedText: string;
  confidence: number; // Float 0.0 - 1.0 (1.0 for manual edits)
  status: TextRegionStatus;
  orderIndex: number; // Reading order index (1, 2, 3...)
  readingDirection: ReadingDirectionType;
  style: TextStyle;
  createdAt: number;
  updatedAt: number;
}

export type HistoryActionType =
  | 'ADD_REGION'
  | 'DELETE_REGION'
  | 'UPDATE_REGION'
  | 'MOVE_RESIZE_REGION'
  | 'BATCH_UPDATE';

export interface HistorySnapshot {
  id: string; // UUID v4
  pageId: string;
  actionType: HistoryActionType;
  undoPayload: {
    regionsBefore: TextRegion[];
  };
  redoPayload: {
    regionsAfter: TextRegion[];
  };
  timestamp: number;
}

export interface AppSettings {
  id: string; // 'global_settings'
  activeProjectId?: string;
  activeChapterId?: string;
  activePageId?: string;
  viewMode: 'studio' | 'vertical_reader' | 'page_reader';
  activeTool: 'select' | 'pan' | 'draw_rect';
  zoomLevel: number;
  readerDirection: 'ltr' | 'rtl' | 'vertical';
}
