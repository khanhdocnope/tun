export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TransformMatrix {
  scale: number; // Z zoom factor [0.05, 20.0]
  panX: number; // Tx pan translation in screen pixels
  panY: number; // Ty pan translation in screen pixels
}

export type ToolType = 'select' | 'pan' | 'draw_rect';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface ViewportDimensions {
  width: number;
  height: number;
}
