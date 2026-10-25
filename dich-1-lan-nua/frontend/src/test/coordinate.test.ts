import { describe, it, expect } from 'vitest';
import {
  AffineTransform,
  imageToScreen,
  screenToImage,
  boxToScreen,
  screenToBox,
  calculateZoomToCursor,
  calculateFitToScreen,
  calculateActualSize,
  normalizeBox,
  clampBoxToImage,
  clampBoxPositionToImage,
  isBoxValid,
  resizeBoxWithHandle,
  clampZoom,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../utils/coordinate';
import { TransformMatrix, Point, BoundingBox } from '../types/canvas';

describe('Coordinate Transformation Mathematics', () => {
  describe('Forward & Inverse Mapping (Affine Matrix Roundtrips)', () => {
    it('satisfies roundtrip precision |P - M^-1(M(P))| < 1e-6 across diverse coordinates and transforms', () => {
      const testCases: { matrix: TransformMatrix; points: Point[] }[] = [
        {
          matrix: { scale: 1.0, panX: 0, panY: 0 },
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 150 },
            { x: 1234.5678, y: 9876.5432 },
          ],
        },
        {
          matrix: { scale: 2.75, panX: -340.5, panY: 512.25 },
          points: [
            { x: 50.123, y: 75.987 },
            { x: 1920.45, y: 1080.89 },
            { x: 0.0001, y: 0.0001 },
          ],
        },
        {
          matrix: { scale: 0.05, panX: 120, panY: -450 },
          points: [
            { x: 800, y: 16000 },
            { x: 400, y: 8000 },
          ],
        },
        {
          matrix: { scale: 20.0, panX: -10000, panY: 25000 },
          points: [
            { x: 512.33333, y: 256.66667 },
            { x: 12.34567, y: 98.76543 },
          ],
        },
      ];

      for (const { matrix, points } of testCases) {
        const affine = new AffineTransform(matrix);
        for (const p of points) {
          // Direct function roundtrip
          const screenP = imageToScreen(p, matrix);
          const recoveredP = screenToImage(screenP, matrix);

          expect(Math.abs(p.x - recoveredP.x)).toBeLessThan(1e-6);
          expect(Math.abs(p.y - recoveredP.y)).toBeLessThan(1e-6);

          // AffineTransform class roundtrip
          const screenAff = affine.transformPoint(p);
          const recoveredAff = affine.inverseTransformPoint(screenAff);

          expect(Math.abs(p.x - recoveredAff.x)).toBeLessThan(1e-6);
          expect(Math.abs(p.y - recoveredAff.y)).toBeLessThan(1e-6);

          // Inverse roundtrip: Screen -> Image -> Screen
          const imgP = screenToImage(screenP, matrix);
          const recoveredScreenP = imageToScreen(imgP, matrix);

          expect(Math.abs(screenP.x - recoveredScreenP.x)).toBeLessThan(1e-6);
          expect(Math.abs(screenP.y - recoveredScreenP.y)).toBeLessThan(1e-6);
        }
      }
    });

    it('converts bounding box between image space and screen space accurately', () => {
      const matrix: TransformMatrix = { scale: 1.5, panX: 100, panY: 200 };
      const imageBox: BoundingBox = { x: 50, y: 80, width: 200, height: 150 };

      const screenBox = boxToScreen(imageBox, matrix);
      expect(screenBox).toEqual({
        x: 50 * 1.5 + 100, // 175
        y: 80 * 1.5 + 200, // 320
        width: 200 * 1.5, // 300
        height: 150 * 1.5, // 225
      });

      const recoveredImageBox = screenToBox(screenBox, matrix);
      expect(Math.abs(recoveredImageBox.x - imageBox.x)).toBeLessThan(1e-6);
      expect(Math.abs(recoveredImageBox.y - imageBox.y)).toBeLessThan(1e-6);
      expect(Math.abs(recoveredImageBox.width - imageBox.width)).toBeLessThan(1e-6);
      expect(Math.abs(recoveredImageBox.height - imageBox.height)).toBeLessThan(1e-6);
    });

    it('throws error when inverse transforming with zero scale', () => {
      const zeroMatrix: TransformMatrix = { scale: 0, panX: 10, panY: 10 };
      expect(() => screenToImage({ x: 10, y: 10 }, zeroMatrix)).toThrow();
      expect(() => new AffineTransform(zeroMatrix).inverseTransformPoint({ x: 10, y: 10 })).toThrow();
    });
  });

  describe('Zoom-to-Cursor Invariance', () => {
    it('maintains the exact image point under cursor stationary before and after zoom', () => {
      const cursors: Point[] = [
        { x: 300, y: 400 }, // Center-ish
        { x: 0, y: 0 }, // Top-left
        { x: 1920, y: 1080 }, // Bottom-right
        { x: -50, y: -100 }, // Outside viewport boundary
      ];

      const initialTransform: TransformMatrix = { scale: 1.0, panX: 50, panY: 80 };
      const zoomLevels = [0.25, 0.5, 1.2, 2.0, 5.0, 15.0];

      for (const cursor of cursors) {
        // Point in image space before zoom
        const imgPointBefore = screenToImage(cursor, initialTransform);

        for (const newScale of zoomLevels) {
          const newTransform = calculateZoomToCursor(
            initialTransform.scale,
            newScale,
            cursor,
            { x: initialTransform.panX, y: initialTransform.panY }
          );

          // Point in image space after zoom at the exact same screen cursor
          const imgPointAfter = screenToImage(cursor, newTransform);

          expect(Math.abs(imgPointBefore.x - imgPointAfter.x)).toBeLessThan(1e-6);
          expect(Math.abs(imgPointBefore.y - imgPointAfter.y)).toBeLessThan(1e-6);
        }
      }
    });

    it('clamps zoom scale to [0.05, 20.0]', () => {
      const cursor = { x: 500, y: 500 };
      const pan = { x: 0, y: 0 };

      const zoomedWayOut = calculateZoomToCursor(1.0, 0.001, cursor, pan);
      expect(zoomedWayOut.scale).toBe(MIN_ZOOM);

      const zoomedWayIn = calculateZoomToCursor(1.0, 50.0, cursor, pan);
      expect(zoomedWayIn.scale).toBe(MAX_ZOOM);

      expect(clampZoom(-5)).toBe(MIN_ZOOM);
      expect(clampZoom(100)).toBe(MAX_ZOOM);
      expect(clampZoom(1.5)).toBe(1.5);
    });
  });

  describe('Fit to Screen & Actual Size Calculations', () => {
    it('fits extreme aspect ratio: tall Webtoon strip (800 x 16000px)', () => {
      const viewport = { width: 1200, height: 900 };
      const image = { width: 800, height: 16000 };
      const padding = 20;

      const transform = calculateFitToScreen(viewport, image, padding);

      // Height constraint should dominate: (900 - 40) / 16000 = 860 / 16000 = 0.05375
      const expectedScale = 860 / 16000;
      expect(Math.abs(transform.scale - expectedScale)).toBeLessThan(1e-6);

      // Image should fit inside viewport vertically with padding
      const renderedHeight = image.height * transform.scale;
      expect(renderedHeight).toBeCloseTo(860);

      // Image should be horizontally centered
      const expectedPanX = (viewport.width - image.width * transform.scale) / 2;
      expect(transform.panX).toBeCloseTo(expectedPanX);
      const expectedPanY = (viewport.height - image.height * transform.scale) / 2;
      expect(transform.panY).toBeCloseTo(expectedPanY);
    });

    it('fits extreme aspect ratio: wide double spread (4000 x 1800px)', () => {
      const viewport = { width: 1000, height: 800 };
      const image = { width: 4000, height: 1800 };
      const padding = 20;

      const transform = calculateFitToScreen(viewport, image, padding);

      // Width constraint dominates: (1000 - 40) / 4000 = 960 / 4000 = 0.24
      const expectedScale = 960 / 4000;
      expect(Math.abs(transform.scale - expectedScale)).toBeLessThan(1e-6);

      // Rendered width should equal 960
      expect(image.width * transform.scale).toBeCloseTo(960);
      expect(transform.panX).toBeCloseTo((viewport.width - 960) / 2);
    });

    it('fits square image (1000 x 1000px) centered', () => {
      const viewport = { width: 800, height: 600 };
      const image = { width: 1000, height: 1000 };
      const padding = 10;

      const transform = calculateFitToScreen(viewport, image, padding);
      // Height dominates: (600 - 20) / 1000 = 0.58
      expect(transform.scale).toBeCloseTo(0.58);
      expect(transform.panX).toBeCloseTo((800 - 1000 * 0.58) / 2);
      expect(transform.panY).toBeCloseTo((600 - 1000 * 0.58) / 2);
    });

    it('calculates 100% actual size (scale = 1.0) centered in viewport', () => {
      const viewport = { width: 1200, height: 800 };
      const image = { width: 1000, height: 600 };

      const transform = calculateActualSize(viewport, image);
      expect(transform.scale).toBe(1.0);
      expect(transform.panX).toBe((1200 - 1000) / 2); // 100
      expect(transform.panY).toBe((800 - 600) / 2); // 100
    });
  });

  describe('Bounding Box Normalization', () => {
    it('normalizes top-left to bottom-right drag', () => {
      const p1: Point = { x: 100, y: 150 };
      const p2: Point = { x: 300, y: 450 };
      const box = normalizeBox(p1, p2);

      expect(box).toEqual({ x: 100, y: 150, width: 200, height: 300 });
    });

    it('normalizes bottom-right to top-left inverted drag', () => {
      const p1: Point = { x: 500, y: 600 };
      const p2: Point = { x: 200, y: 300 };
      const box = normalizeBox(p1, p2);

      expect(box).toEqual({ x: 200, y: 300, width: 300, height: 300 });
    });

    it('normalizes top-right to bottom-left inverted drag', () => {
      const p1: Point = { x: 400, y: 100 };
      const p2: Point = { x: 150, y: 350 };
      const box = normalizeBox(p1, p2);

      expect(box).toEqual({ x: 150, y: 100, width: 250, height: 250 });
    });

    it('normalizes bottom-left to top-right inverted drag', () => {
      const p1: Point = { x: 150, y: 350 };
      const p2: Point = { x: 400, y: 100 };
      const box = normalizeBox(p1, p2);

      expect(box).toEqual({ x: 150, y: 100, width: 250, height: 250 });
    });
  });

  describe('Bounding Box Clamping & Minimum Threshold', () => {
    it('clamps box overhang outside image bounds [0, W_img] x [0, H_img]', () => {
      const imageW = 1000;
      const imageH = 1500;

      // Box starts at negative position
      const overhangingTopLeft: BoundingBox = { x: -50, y: -20, width: 200, height: 300 };
      const clampedTL = clampBoxToImage(overhangingTopLeft, imageW, imageH);
      expect(clampedTL.x).toBe(0);
      expect(clampedTL.y).toBe(0);
      expect(clampedTL.width).toBe(200);
      expect(clampedTL.height).toBe(300);

      // Box overhangs bottom-right
      const overhangingBottomRight: BoundingBox = { x: 900, y: 1400, width: 250, height: 200 };
      const clampedBR = clampBoxToImage(overhangingBottomRight, imageW, imageH);
      expect(clampedBR.x).toBe(900);
      expect(clampedBR.y).toBe(1400);
      expect(clampedBR.width).toBe(100); // 1000 - 900
      expect(clampedBR.height).toBe(100); // 1500 - 1400
    });

    it('clamps box movement so fixed-size box never leaves image bounds', () => {
      const imageW = 1000;
      const imageH = 1500;
      const box: BoundingBox = { x: 950, y: 1450, width: 100, height: 100 };

      const clampedMove = clampBoxPositionToImage(box, imageW, imageH);
      expect(clampedMove.x).toBe(900); // imageW - width
      expect(clampedMove.y).toBe(1400); // imageH - height
      expect(clampedMove.width).toBe(100);
      expect(clampedMove.height).toBe(100);
    });

    it('validates 4px threshold correctly to suppress phantom clicks', () => {
      // Discard boxes smaller than 4x4
      expect(isBoxValid({ x: 10, y: 10, width: 1, height: 1 })).toBe(false);
      expect(isBoxValid({ x: 10, y: 10, width: 3, height: 20 })).toBe(false);
      expect(isBoxValid({ x: 10, y: 10, width: 20, height: 3 })).toBe(false);
      expect(isBoxValid({ x: 10, y: 10, width: 0, height: 0 })).toBe(false);

      // Accept boxes >= 4x4
      expect(isBoxValid({ x: 10, y: 10, width: 4, height: 4 })).toBe(true);
      expect(isBoxValid({ x: 10, y: 10, width: 100, height: 50 })).toBe(true);
    });
  });

  describe('8-Point Box Resize Handles', () => {
    const initialBox: BoundingBox = { x: 100, y: 100, width: 200, height: 150 };
    const imageW = 1000;
    const imageH = 1000;

    it('resizes via SE handle (locking NW anchor)', () => {
      // Drag SE corner to (400, 350)
      const newBox = resizeBoxWithHandle(initialBox, 'se', { x: 400, y: 350 }, imageW, imageH);
      expect(newBox.x).toBe(100);
      expect(newBox.y).toBe(100);
      expect(newBox.width).toBe(300); // 400 - 100
      expect(newBox.height).toBe(250); // 350 - 100
    });

    it('resizes via NW handle (locking SE anchor)', () => {
      // SE anchor is at (300, 250). Drag NW to (50, 60)
      const newBox = resizeBoxWithHandle(initialBox, 'nw', { x: 50, y: 60 }, imageW, imageH);
      expect(newBox.x).toBe(50);
      expect(newBox.y).toBe(60);
      expect(newBox.width).toBe(250); // 300 - 50
      expect(newBox.height).toBe(190); // 250 - 60
    });

    it('resizes via NE handle (locking SW anchor)', () => {
      // SW anchor is at (100, 250). Drag NE to (350, 50)
      const newBox = resizeBoxWithHandle(initialBox, 'ne', { x: 350, y: 50 }, imageW, imageH);
      expect(newBox.x).toBe(100);
      expect(newBox.y).toBe(50);
      expect(newBox.width).toBe(250); // 350 - 100
      expect(newBox.height).toBe(200); // 250 - 50
    });

    it('resizes via SW handle (locking NE anchor)', () => {
      // NE anchor is at (300, 100). Drag SW to (50, 300)
      const newBox = resizeBoxWithHandle(initialBox, 'sw', { x: 50, y: 300 }, imageW, imageH);
      expect(newBox.x).toBe(50);
      expect(newBox.y).toBe(100);
      expect(newBox.width).toBe(250); // 300 - 50
      expect(newBox.height).toBe(200); // 300 - 100
    });

    it('resizes via N handle (locking bottom edge)', () => {
      const newBox = resizeBoxWithHandle(initialBox, 'n', { x: 150, y: 50 }, imageW, imageH);
      expect(newBox.x).toBe(100);
      expect(newBox.y).toBe(50);
      expect(newBox.width).toBe(200);
      expect(newBox.height).toBe(200); // bottom was 250, so 250 - 50 = 200
    });

    it('resizes via S handle (locking top edge)', () => {
      const newBox = resizeBoxWithHandle(initialBox, 's', { x: 150, y: 400 }, imageW, imageH);
      expect(newBox.x).toBe(100);
      expect(newBox.y).toBe(100);
      expect(newBox.width).toBe(200);
      expect(newBox.height).toBe(300); // 400 - 100 = 300
    });

    it('resizes via W handle (locking right edge)', () => {
      const newBox = resizeBoxWithHandle(initialBox, 'w', { x: 50, y: 150 }, imageW, imageH);
      expect(newBox.x).toBe(50);
      expect(newBox.y).toBe(100);
      expect(newBox.width).toBe(250); // right was 300, so 300 - 50 = 250
      expect(newBox.height).toBe(150);
    });

    it('resizes via E handle (locking left edge)', () => {
      const newBox = resizeBoxWithHandle(initialBox, 'e', { x: 450, y: 150 }, imageW, imageH);
      expect(newBox.x).toBe(100);
      expect(newBox.y).toBe(100);
      expect(newBox.width).toBe(350); // 450 - 100 = 350
      expect(newBox.height).toBe(150);
    });

    it('enforces minimum size 4x4 when dragging handles past opposite anchor (inverted resize prevention)', () => {
      // SE anchor is at (300, 250). Drag NW past SE to (350, 300)
      const newBoxNW = resizeBoxWithHandle(initialBox, 'nw', { x: 350, y: 300 }, imageW, imageH);
      expect(newBoxNW.width).toBeGreaterThanOrEqual(4);
      expect(newBoxNW.height).toBeGreaterThanOrEqual(4);

      // NW anchor is at (100, 100). Drag SE past NW to (50, 50)
      const newBoxSE = resizeBoxWithHandle(initialBox, 'se', { x: 50, y: 50 }, imageW, imageH);
      expect(newBoxSE.width).toBeGreaterThanOrEqual(4);
      expect(newBoxSE.height).toBeGreaterThanOrEqual(4);
    });

    it('clamps resize handles to image canvas boundary', () => {
      // Drag SE handle far beyond image width (1000) and height (1000)
      const newBox = resizeBoxWithHandle(initialBox, 'se', { x: 1500, y: 1800 }, imageW, imageH);
      expect(newBox.x + newBox.width).toBeLessThanOrEqual(imageW);
      expect(newBox.y + newBox.height).toBeLessThanOrEqual(imageH);
      expect(newBox.width).toBe(900); // 1000 - 100
      expect(newBox.height).toBe(900); // 1000 - 100
    });
  });
});
