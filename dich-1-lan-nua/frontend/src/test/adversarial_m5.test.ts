/**
 * Tier 5 Adversarial Coverage & Hardening Suite (Challenger M5)
 * Empirically tests edge boundaries, floating point drift, history stack bounds,
 * binary image header parsing resilience, and natural sorting anomalies.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateZoomToCursor,
  calculateFitToScreen,
  calculateActualSize,
  clampZoom,
  screenToImage,
  imageToScreen,
  normalizeBox,
  clampBoxToImage,
  clampBoxPositionToImage,
  resizeBoxWithHandle,
  isBoxValid,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../utils/coordinate';
import {
  createHistoryStack,
  pushState,
  undo,
  redo,
  canUndo,
  canRedo,
  DEFAULT_MAX_HISTORY_DEPTH,
} from '../utils/history';
import {
  naturalCompare,
  sortFilenamesNaturally,
  getImageDimensions,
} from '../db/importExport';
import { Point, BoundingBox, ResizeHandle } from '../types/canvas';

describe('Tier 5 Adversarial: Coordinate Drift & Geometric Stress', () => {
  it('resists floating point coordinate drift over 200 alternating zoom-in / zoom-out cycles', () => {
    let scale = 1.0;
    let panX = 100.0;
    let panY = 150.0;
    const cursor: Point = { x: 387.451, y: 521.892 };

    // Record initial invariant image point under cursor
    const initialImgPoint = screenToImage(cursor, { scale, panX, panY });

    const factor = 1.15;

    for (let i = 0; i < 200; i++) {
      // Zoom in
      const zoomInMatrix = calculateZoomToCursor(scale, scale * factor, cursor, { x: panX, y: panY });
      scale = zoomInMatrix.scale;
      panX = zoomInMatrix.panX;
      panY = zoomInMatrix.panY;

      // Verify cursor invariant during zoom in
      const curImgPoint1 = screenToImage(cursor, { scale, panX, panY });
      expect(Math.abs(curImgPoint1.x - initialImgPoint.x)).toBeLessThan(1e-5);
      expect(Math.abs(curImgPoint1.y - initialImgPoint.y)).toBeLessThan(1e-5);

      // Zoom out
      const zoomOutMatrix = calculateZoomToCursor(scale, scale / factor, cursor, { x: panX, y: panY });
      scale = zoomOutMatrix.scale;
      panX = zoomOutMatrix.panX;
      panY = zoomOutMatrix.panY;

      // Verify cursor invariant during zoom out
      const curImgPoint2 = screenToImage(cursor, { scale, panX, panY });
      expect(Math.abs(curImgPoint2.x - initialImgPoint.x)).toBeLessThan(1e-5);
      expect(Math.abs(curImgPoint2.y - initialImgPoint.y)).toBeLessThan(1e-5);
    }

    // After 200 cycles, scale and pan should return very close to initial with zero catastrophic drift
    expect(Math.abs(scale - 1.0)).toBeLessThan(1e-5);
    expect(Math.abs(panX - 100.0)).toBeLessThan(1e-4);
    expect(Math.abs(panY - 150.0)).toBeLessThan(1e-4);
  });

  it('handles adversarial cursor inputs (negative, off-screen, extreme floating point numbers)', () => {
    const extremeCursors: Point[] = [
      { x: -99999.5, y: -88888.3 },
      { x: 1e7, y: 1e7 },
      { x: 0.0000001, y: -0.0000001 },
    ];

    for (const cursor of extremeCursors) {
      const transform = calculateZoomToCursor(1.0, 2.5, cursor, { x: 50, y: 50 });
      expect(isFinite(transform.scale)).toBe(true);
      expect(isFinite(transform.panX)).toBe(true);
      expect(isFinite(transform.panY)).toBe(true);

      const imgP1 = screenToImage(cursor, { scale: 1.0, panX: 50, panY: 50 });
      const imgP2 = screenToImage(cursor, transform);
      expect(Math.abs(imgP1.x - imgP2.x)).toBeLessThan(1e-4);
      expect(Math.abs(imgP1.y - imgP2.y)).toBeLessThan(1e-4);
    }
  });

  it('maintains invariant pan translation when zoom attempts to exceed MIN_ZOOM or MAX_ZOOM bounds', () => {
    const cursor = { x: 400, y: 300 };
    const pan = { x: 120, y: 80 };

    // At MAX_ZOOM (20.0), zooming in further should NOT shift pan
    const atMax = calculateZoomToCursor(MAX_ZOOM, MAX_ZOOM * 2, cursor, pan);
    expect(atMax.scale).toBe(MAX_ZOOM);
    expect(atMax.panX).toBe(pan.x);
    expect(atMax.panY).toBe(pan.y);

    // At MIN_ZOOM (0.05), zooming out further should NOT shift pan
    const atMin = calculateZoomToCursor(MIN_ZOOM, MIN_ZOOM / 2, cursor, pan);
    expect(atMin.scale).toBe(MIN_ZOOM);
    expect(atMin.panX).toBe(pan.x);
    expect(atMin.panY).toBe(pan.y);
  });

  it('handles degenerate viewport and image dimensions in fitToScreen and actualSize gracefully', () => {
    const degenerateCases = [
      { vp: { width: 0, height: 0 }, img: { width: 100, height: 100 } },
      { vp: { width: 800, height: 600 }, img: { width: 0, height: 0 } },
      { vp: { width: -100, height: -200 }, img: { width: 500, height: 500 } },
      { vp: { width: 800, height: 600 }, img: { width: -50, height: 50 } },
    ];

    for (const c of degenerateCases) {
      const fit = calculateFitToScreen(c.vp, c.img);
      expect(isFinite(fit.scale)).toBe(true);
      expect(isFinite(fit.panX)).toBe(true);
      expect(isFinite(fit.panY)).toBe(true);
      expect(fit.scale).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(fit.scale).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  it('stress-tests all 8 resize handles under aggressive cross-over inversions', () => {
    const imageW = 1000;
    const imageH = 1000;
    const baseBox: BoundingBox = { x: 400, y: 400, width: 200, height: 200 };
    const handles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    // Move handle all the way across past opposite anchor to far negative and far positive coordinates
    const extremePoints: Point[] = [
      { x: -500, y: -500 },
      { x: 1500, y: 1500 },
      { x: 500, y: 500 }, // right in middle of box
    ];

    for (const handle of handles) {
      for (const pt of extremePoints) {
        const resized = resizeBoxWithHandle(baseBox, handle, pt, imageW, imageH, 4);

        // Every resulting box must:
        // 1. Have width >= 4 and height >= 4
        expect(resized.width).toBeGreaterThanOrEqual(4);
        expect(resized.height).toBeGreaterThanOrEqual(4);
        // 2. Be clamped within [0, imageW] x [0, imageH]
        expect(resized.x).toBeGreaterThanOrEqual(0);
        expect(resized.y).toBeGreaterThanOrEqual(0);
        expect(resized.x + resized.width).toBeLessThanOrEqual(imageW);
        expect(resized.y + resized.height).toBeLessThanOrEqual(imageH);
      }
    }
  });
});

describe('Tier 5 Adversarial: History Stack Saturation & Branch Pruning', () => {
  it('enforces strict maxDepth = 50 under 300 rapid sequential state transitions', () => {
    let stack = createHistoryStack<number>(0, DEFAULT_MAX_HISTORY_DEPTH);

    for (let i = 1; i <= 300; i++) {
      stack = pushState(stack, i);
      expect(stack.past.length).toBeLessThanOrEqual(DEFAULT_MAX_HISTORY_DEPTH);
      expect(stack.present).toBe(i);
      expect(stack.future.length).toBe(0);
    }

    expect(stack.past.length).toBe(50);
    expect(stack.present).toBe(300);
    // Oldest element in past should be 300 - 50 = 250
    expect(stack.past[0]).toBe(250);
    expect(stack.past[49]).toBe(299);

    // Perform 50 consecutive undos
    for (let step = 1; step <= 50; step++) {
      expect(canUndo(stack)).toBe(true);
      stack = undo(stack);
      expect(stack.present).toBe(300 - step);
    }

    // Now stack.past must be empty, present is 250, canUndo is false
    expect(stack.past.length).toBe(0);
    expect(stack.present).toBe(250);
    expect(canUndo(stack)).toBe(false);

    // Attempting further undos must be safe no-op
    const noopUndo = undo(stack);
    expect(noopUndo.present).toBe(250);
    expect(noopUndo.past.length).toBe(0);

    // Perform 50 redos back to 300
    for (let step = 1; step <= 50; step++) {
      expect(canRedo(stack)).toBe(true);
      stack = redo(stack);
      expect(stack.present).toBe(250 + step);
    }

    expect(stack.present).toBe(300);
    expect(canRedo(stack)).toBe(false);
  });

  it('prunes future redo branch immediately upon new action after partial undo', () => {
    let stack = createHistoryStack<string>('init');

    // Push 10 steps
    for (let i = 1; i <= 10; i++) {
      stack = pushState(stack, `step_${i}`);
    }

    // Undo 5 steps to step_5
    for (let i = 0; i < 5; i++) {
      stack = undo(stack);
    }
    expect(stack.present).toBe('step_5');
    expect(stack.future.length).toBe(5);

    // Branch off by pushing a new alternative step
    stack = pushState(stack, 'step_5_alternative');

    // Future stack MUST be immediately wiped
    expect(stack.future.length).toBe(0);
    expect(canRedo(stack)).toBe(false);
    expect(stack.present).toBe('step_5_alternative');
    expect(stack.past[stack.past.length - 1]).toBe('step_5');
  });
});

describe('Tier 5 Adversarial: Natural Sorting & Collation Edge Cases', () => {
  it('correctly orders complex, adversarial, and multilingual manga scan filenames', () => {
    const filenames = [
      'page_100.png',
      'page_2.png',
      'page_001.png',
      'page_10.png',
      'page_02.png',
      'page_1.png',
      'page_20.png',
      'page_10a.png',
      'page_10b.png',
      'page_9.png',
    ];

    const sorted = sortFilenamesNaturally(filenames);

    // Check order:
    // page_001.png / page_1.png -> page_2.png / page_02.png -> page_9.png -> page_10.png -> page_10a.png -> page_10b.png -> page_20.png -> page_100.png
    const page10Idx = sorted.indexOf('page_10.png');
    const page2Idx = sorted.indexOf('page_2.png');
    const page100Idx = sorted.indexOf('page_100.png');
    const page9Idx = sorted.indexOf('page_9.png');

    expect(page2Idx).toBeLessThan(page9Idx);
    expect(page9Idx).toBeLessThan(page10Idx);
    expect(page10Idx).toBeLessThan(page100Idx);
  });

  it('handles Unicode, Asian characters, and bracketed scanlation conventions', () => {
    const mangaFiles = [
      '[Group] Manga - c01 p010.jpg',
      '[Group] Manga - c01 p002.jpg',
      '[Group] Manga - c01 p001.jpg',
      '第10話.png',
      '第1話.png',
      '第2話.png',
      'Trang 10.webp',
      'Trang 2.webp',
      'Trang 1.webp',
    ];

    const sorted = sortFilenamesNaturally(mangaFiles);

    // Within same prefix, numeric order must hold
    expect(sorted.indexOf('第1話.png')).toBeLessThan(sorted.indexOf('第2話.png'));
    expect(sorted.indexOf('第2話.png')).toBeLessThan(sorted.indexOf('第10話.png'));

    expect(sorted.indexOf('Trang 1.webp')).toBeLessThan(sorted.indexOf('Trang 2.webp'));
    expect(sorted.indexOf('Trang 2.webp')).toBeLessThan(sorted.indexOf('Trang 10.webp'));

    expect(sorted.indexOf('[Group] Manga - c01 p001.jpg')).toBeLessThan(sorted.indexOf('[Group] Manga - c01 p002.jpg'));
    expect(sorted.indexOf('[Group] Manga - c01 p002.jpg')).toBeLessThan(sorted.indexOf('[Group] Manga - c01 p010.jpg'));
  });
});

describe('Tier 5 Adversarial: Image Binary Dimension Extraction Resilience', () => {
  it('parses truncated, malformed, or corrupt blobs without throwing or freezing', async () => {
    const corruptBlobs = [
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), // Truncated PNG
      new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), // Truncated JPEG
      new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: 'image/webp' }), // Truncated WebP
      new Blob([new Uint8Array([])], { type: 'image/png' }), // Zero byte
      new Blob([new Uint8Array(100).fill(0)], { type: 'application/octet-stream' }), // Garbage zeros
    ];

    for (const blob of corruptBlobs) {
      const dims = await getImageDimensions(blob);
      expect(dims).toBeDefined();
      expect(dims.width).toBeGreaterThan(0);
      expect(dims.height).toBeGreaterThan(0);
      // Safe fallback values (800 x 1200) should be returned instead of unhandled promise rejection
      expect(isFinite(dims.width)).toBe(true);
      expect(isFinite(dims.height)).toBe(true);
    }
  });

  it('accurately parses binary dimensions from synthetic valid PNG header', async () => {
    // Construct valid 33-byte PNG header with IHDR 1200x1800
    const buffer = new ArrayBuffer(33);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    // IHDR chunk length 13
    view.setUint32(8, 13, false);
    // Chunk type: "IHDR"
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    // Width: 1200
    view.setUint32(16, 1200, false);
    // Height: 1800
    view.setUint32(20, 1800, false);
    // Bit depth, color type, compression, filter, interlace
    bytes.set([8, 2, 0, 0, 0], 24);

    const blob = new Blob([buffer], { type: 'image/png' });
    const dims = await getImageDimensions(blob);
    expect(dims.width).toBe(1200);
    expect(dims.height).toBe(1800);
  });
});
