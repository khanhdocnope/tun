import { Point, BoundingBox, TransformMatrix, ViewportDimensions, ResizeHandle } from '../types/canvas';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 20.0;
export const MIN_BOX_SIZE = 4; // 4px threshold to prevent phantom clicks

/**
 * Clamps zoom scale Z to valid range [0.05, 20.0]
 */
export function clampZoom(scale: number): number {
  if (isNaN(scale) || !isFinite(scale)) return 1.0;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * 3x3 Affine transformation matrix representation:
 * [ X_screen ]   [ scale    0    panX ] [ X_img ]
 * [ Y_screen ] = [   0    scale  panY ] [ Y_img ]
 * [    1     ]   [   0      0      1  ] [   1   ]
 */
export class AffineTransform {
  readonly scale: number;
  readonly panX: number;
  readonly panY: number;

  constructor(matrix: TransformMatrix) {
    this.scale = matrix.scale;
    this.panX = matrix.panX;
    this.panY = matrix.panY;
  }

  /**
   * Forward transformation: image coordinates to screen coordinates
   * X_screen = X_img * Z + Tx
   * Y_screen = Y_img * Z + Ty
   */
  transformPoint(point: Point): Point {
    return {
      x: point.x * this.scale + this.panX,
      y: point.y * this.scale + this.panY,
    };
  }

  /**
   * Inverse transformation: screen coordinates to image coordinates
   * X_img = (X_screen - Tx) / Z
   * Y_img = (Y_screen - Ty) / Z
   */
  inverseTransformPoint(point: Point): Point {
    if (this.scale === 0) {
      throw new Error('Cannot inverse transform with scale of 0');
    }
    return {
      x: (point.x - this.panX) / this.scale,
      y: (point.y - this.panY) / this.scale,
    };
  }

  toMatrix(): TransformMatrix {
    return {
      scale: this.scale,
      panX: this.panX,
      panY: this.panY,
    };
  }
}

/**
 * Forward coordinate mapping: Converts native image coordinates to screen viewport coordinates
 * X_screen = X_img * Z + Tx
 * Y_screen = Y_img * Z + Ty
 */
export function imageToScreen(imagePoint: Point, matrix: TransformMatrix): Point {
  return {
    x: imagePoint.x * matrix.scale + matrix.panX,
    y: imagePoint.y * matrix.scale + matrix.panY,
  };
}

/**
 * Inverse coordinate mapping: Converts screen viewport coordinates to native image pixel coordinates
 * X_img = (X_screen - Tx) / Z
 * Y_img = (Y_screen - Ty) / Z
 */
export function screenToImage(screenPoint: Point, matrix: TransformMatrix): Point {
  if (matrix.scale === 0) {
    throw new Error('Scale cannot be zero in screenToImage');
  }
  return {
    x: (screenPoint.x - matrix.panX) / matrix.scale,
    y: (screenPoint.y - matrix.panY) / matrix.scale,
  };
}

/**
 * Converts a bounding box from image coordinates to screen coordinates
 */
export function boxToScreen(box: BoundingBox, matrix: TransformMatrix): BoundingBox {
  const topLeft = imageToScreen({ x: box.x, y: box.y }, matrix);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: box.width * matrix.scale,
    height: box.height * matrix.scale,
  };
}

/**
 * Converts a bounding box from screen coordinates to image coordinates
 */
export function screenToBox(screenBox: BoundingBox, matrix: TransformMatrix): BoundingBox {
  const topLeft = screenToImage({ x: screenBox.x, y: screenBox.y }, matrix);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: screenBox.width / matrix.scale,
    height: screenBox.height / matrix.scale,
  };
}

/**
 * Zoom-to-cursor invariant calculation:
 * When zooming from scale Z_old to Z_new with cursor at screen position (Cx, Cy),
 * the image coordinate directly under the cursor must remain strictly invariant.
 *
 * Formula:
 * Tx_new = Cx - (Cx - Tx_old) * (Z_new / Z_old)
 * Ty_new = Cy - (Cy - Ty_old) * (Z_new / Z_old)
 */
export function calculateZoomToCursor(
  oldScale: number,
  targetNewScale: number,
  cursorScreen: Point,
  oldPan: Point,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM
): TransformMatrix {
  const clampedScale = Math.min(maxZoom, Math.max(minZoom, targetNewScale));
  const effectiveOldScale = oldScale <= 0 ? 1.0 : oldScale;
  const ratio = clampedScale / effectiveOldScale;

  const panX = cursorScreen.x - (cursorScreen.x - oldPan.x) * ratio;
  const panY = cursorScreen.y - (cursorScreen.y - oldPan.y) * ratio;

  return {
    scale: clampedScale,
    panX,
    panY,
  };
}

/**
 * Fit-to-screen action:
 * Calculates exact scale and pan translation to fit the image entirely inside
 * the viewport container with specified padding margin, centered horizontally and vertically.
 *
 * Z_fit = min((Vw - 2p) / W_img, (Vh - 2p) / H_img)
 * Tx_fit = (Vw - W_img * Z_fit) / 2
 * Ty_fit = (Vh - H_img * Z_fit) / 2
 */
export function calculateFitToScreen(
  viewport: ViewportDimensions,
  image: { width: number; height: number },
  padding = 20
): TransformMatrix {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { scale: 1.0, panX: 0, panY: 0 };
  }

  const effectiveVw = Math.max(10, viewport.width - 2 * padding);
  const effectiveVh = Math.max(10, viewport.height - 2 * padding);

  const scaleX = effectiveVw / image.width;
  const scaleY = effectiveVh / image.height;
  const rawFitScale = Math.min(scaleX, scaleY);
  const scale = clampZoom(rawFitScale);

  const panX = (viewport.width - image.width * scale) / 2;
  const panY = (viewport.height - image.height * scale) / 2;

  return {
    scale,
    panX,
    panY,
  };
}

/**
 * 100% Actual size action:
 * Sets zoom scale Z = 1.0 and centers the image in the current viewport.
 *
 * Tx_100 = (Vw - W_img) / 2
 * Ty_100 = (Vh - H_img) / 2
 */
export function calculateActualSize(
  viewport: ViewportDimensions,
  image: { width: number; height: number }
): TransformMatrix {
  const scale = 1.0;
  const panX = (viewport.width - image.width) / 2;
  const panY = (viewport.height - image.height) / 2;

  return {
    scale,
    panX,
    panY,
  };
}

/**
 * Bounding box normalization:
 * Inverts negative coordinates when user drags bottom-right to top-left,
 * bottom-left to top-right, or top-right to bottom-left.
 *
 * X_min = min(X1, X2), Y_min = min(Y1, Y2)
 * W_raw = |X2 - X1|,   H_raw = |Y2 - Y1|
 */
export function normalizeBox(p1: Point, p2: Point): BoundingBox {
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);

  return { x, y, width, height };
}

/**
 * Bounding box boundary clamping against image extents [0, W_img] x [0, H_img]:
 * Constrains box position and dimensions within source image boundaries.
 *
 * X_clamped = max(0, min(X_min, W_img - 1))
 * Y_clamped = max(0, min(Y_min, H_img - 1))
 * W_clamped = max(0, min(W_raw, W_img - X_clamped))
 * H_clamped = max(0, min(H_raw, H_img - Y_clamped))
 */
export function clampBoxToImage(
  box: BoundingBox,
  imageWidth: number,
  imageHeight: number
): BoundingBox {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // Ensure origin is not negative and not beyond image edge
  const xClamped = Math.max(0, Math.min(box.x, imageWidth - 1));
  const yClamped = Math.max(0, Math.min(box.y, imageHeight - 1));

  // Ensure dimensions do not exceed remaining image space
  const rawWidth = Math.max(0, box.width);
  const rawHeight = Math.max(0, box.height);

  const wClamped = Math.max(0, Math.min(rawWidth, imageWidth - xClamped));
  const hClamped = Math.max(0, Math.min(rawHeight, imageHeight - yClamped));

  return {
    x: xClamped,
    y: yClamped,
    width: wClamped,
    height: hClamped,
  };
}

/**
 * Clamps box position when moving a box of fixed size so it does not overhang image boundaries.
 */
export function clampBoxPositionToImage(
  box: BoundingBox,
  imageWidth: number,
  imageHeight: number
): BoundingBox {
  const maxX = Math.max(0, imageWidth - box.width);
  const maxY = Math.max(0, imageHeight - box.height);

  const x = Math.max(0, Math.min(box.x, maxX));
  const y = Math.max(0, Math.min(box.y, maxY));

  return {
    x,
    y,
    width: box.width,
    height: box.height,
  };
}

/**
 * Minimum size threshold check:
 * Region is valid if and only if W >= 4px and H >= 4px.
 * Suppresses accidental phantom clicks.
 */
export function isBoxValid(box: BoundingBox, minSize = MIN_BOX_SIZE): boolean {
  return box.width >= minSize && box.height >= minSize;
}

/**
 * Calculates new bounding box when dragging one of 8 resize handles
 * (NW, N, NE, E, SE, S, SW, W) with anchor-point locking,
 * boundary clamping, and minimum dimension constraint (>= 4px).
 */
export function resizeBoxWithHandle(
  box: BoundingBox,
  handle: ResizeHandle,
  currentImagePoint: Point,
  imageWidth: number,
  imageHeight: number,
  minSize = MIN_BOX_SIZE
): BoundingBox {
  // Current corners
  const left = box.x;
  const top = box.y;
  const right = box.x + box.width;
  const bottom = box.y + box.height;

  // Clamp currentImagePoint to image dimensions [0, imageWidth] x [0, imageHeight]
  const curX = Math.max(0, Math.min(currentImagePoint.x, imageWidth));
  const curY = Math.max(0, Math.min(currentImagePoint.y, imageHeight));

  let newLeft = left;
  let newTop = top;
  let newRight = right;
  let newBottom = bottom;

  switch (handle) {
    case 'nw': {
      // Anchor is SE corner (right, bottom)
      newLeft = Math.min(curX, right - minSize);
      newTop = Math.min(curY, bottom - minSize);
      break;
    }
    case 'n': {
      // Anchor is bottom edge
      newTop = Math.min(curY, bottom - minSize);
      break;
    }
    case 'ne': {
      // Anchor is SW corner (left, bottom)
      newRight = Math.max(curX, left + minSize);
      newTop = Math.min(curY, bottom - minSize);
      break;
    }
    case 'e': {
      // Anchor is left edge
      newRight = Math.max(curX, left + minSize);
      break;
    }
    case 'se': {
      // Anchor is NW corner (left, top)
      newRight = Math.max(curX, left + minSize);
      newBottom = Math.max(curY, top + minSize);
      break;
    }
    case 's': {
      // Anchor is top edge
      newBottom = Math.max(curY, top + minSize);
      break;
    }
    case 'sw': {
      // Anchor is NE corner (right, top)
      newLeft = Math.min(curX, right - minSize);
      newBottom = Math.max(curY, top + minSize);
      break;
    }
    case 'w': {
      // Anchor is right edge
      newLeft = Math.min(curX, right - minSize);
      break;
    }
  }

  // Ensure coordinates remain within image bounds
  newLeft = Math.max(0, newLeft);
  newTop = Math.max(0, newTop);
  newRight = Math.min(imageWidth, newRight);
  newBottom = Math.min(imageHeight, newBottom);

  const width = Math.max(minSize, newRight - newLeft);
  const height = Math.max(minSize, newBottom - newTop);

  return {
    x: newLeft,
    y: newTop,
    width,
    height,
  };
}
