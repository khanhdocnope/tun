import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { db, clearAllTables } from '../db';
import { createProject, createChapter, importSingleImage } from '../db/importExport';
import { useStudioStore } from '../store/useStudioStore';
import { useCanvasStore } from '../store/useCanvasStore';
import { useHistoryStore } from '../store/useHistoryStore';
import { ImageCanvas } from '../components/canvas/ImageCanvas';
import { CanvasOverlay } from '../components/canvas/CanvasOverlay';
import { ZoomControls } from '../components/canvas/ZoomControls';
import { TextRegion } from '../types/region';

function createMockPngBlob(width: number, height: number): Blob {
  const buffer = new Uint8Array(45);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.set([0x00, 0x00, 0x00, 0x0d], 8);
  buffer.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(buffer.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  buffer.set([0x08, 0x06, 0x00, 0x00, 0x00], 24);
  buffer.set([0x00, 0x00, 0x00, 0x00], 29);
  buffer.set([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], 33);
  return new Blob([buffer], { type: 'image/png' });
}

describe('Canvas Components (ImageCanvas, CanvasOverlay, ZoomControls)', () => {
  beforeEach(async () => {
    await clearAllTables();
    useStudioStore.getState().resetStudio();
    useCanvasStore.getState().resetCanvas();
    useHistoryStore.setState({ pageHistories: {} });
  });

  describe('ZoomControls Component', () => {
    it('renders zoom percentage and triggers zoom actions', () => {
      useCanvasStore.setState({ scale: 1.0 });

      render(<ZoomControls />);

      expect(screen.getByTestId('zoom-controls')).toBeInTheDocument();
      expect(screen.getByTestId('zoom-percentage-btn')).toHaveTextContent('100%');

      // Zoom In
      fireEvent.click(screen.getByTestId('zoom-in-btn'));
      expect(useCanvasStore.getState().scale).toBeCloseTo(1.25);
      expect(screen.getByTestId('zoom-percentage-btn')).toHaveTextContent('125%');

      // Zoom Out
      fireEvent.click(screen.getByTestId('zoom-out-btn'));
      expect(useCanvasStore.getState().scale).toBeCloseTo(1.0);

      // Reset / Actual Size
      useCanvasStore.setState({ scale: 2.5 });
      fireEvent.click(screen.getByTestId('actual-size-btn'));
      expect(useCanvasStore.getState().scale).toBe(1.0);
    });
  });

  describe('CanvasOverlay Component', () => {
    const pageId = 'test-page-1';
    const projectId = 'test-proj-1';
    const imageDims = { width: 1000, height: 1500 };
    const containerBounds = { width: 800, height: 600, left: 0, top: 0 };

    const mockRegion: TextRegion = {
      id: 'reg-1',
      pageId,
      projectId,
      box: { x: 100, y: 150, width: 200, height: 100 },
      sourceText: 'Speech bubble',
      translatedText: 'Bong bóng thoại',
      confidence: 0.98,
      status: 'verified',
      orderIndex: 1,
      readingDirection: 'horizontal',
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
      createdAt: 1000,
      updatedAt: 1000,
    };

    it('renders bounding boxes and order badges for regions', () => {
      render(
        <CanvasOverlay
          pageId={pageId}
          projectId={projectId}
          regions={[mockRegion]}
          imageDimensions={imageDims}
          containerBounds={containerBounds}
        />
      );

      expect(screen.getByTestId('canvas-overlay')).toBeInTheDocument();
      expect(screen.getByTestId('region-box-reg-1')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('Bong bóng thoại')).toBeInTheDocument();
    });

    it('renders 8 resize handles when region is selected', () => {
      useCanvasStore.setState({ selectedRegionId: 'reg-1' });

      render(
        <CanvasOverlay
          pageId={pageId}
          projectId={projectId}
          regions={[mockRegion]}
          imageDimensions={imageDims}
          containerBounds={containerBounds}
        />
      );

      const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      for (const h of handles) {
        expect(screen.getByTestId(`handle-${h}`)).toBeInTheDocument();
      }
    });

    it('suppresses rectangle creation smaller than 4x4px (phantom click protection)', async () => {
      useStudioStore.setState({ activeTool: 'draw_rect' });

      render(
        <CanvasOverlay
          pageId={pageId}
          projectId={projectId}
          regions={[]}
          imageDimensions={imageDims}
          containerBounds={containerBounds}
        />
      );

      const overlay = screen.getByTestId('canvas-overlay');

      // Pointer down at (50, 50)
      fireEvent.pointerDown(overlay, { clientX: 50, clientY: 50, button: 0 });

      // Move only 2px to (52, 51)
      fireEvent.pointerMove(overlay, { clientX: 52, clientY: 51 });

      // Pointer up
      fireEvent.pointerUp(overlay, { clientX: 52, clientY: 51, button: 0 });

      // No region should be added to Dexie
      const regionsInDb = await db.textRegions.where('pageId').equals(pageId).toArray();
      expect(regionsInDb.length).toBe(0);
    });

    it('creates new TextRegion and records snapshot when drawn box >= 4x4px', async () => {
      useStudioStore.setState({ activeTool: 'draw_rect' });

      render(
        <CanvasOverlay
          pageId={pageId}
          projectId={projectId}
          regions={[]}
          imageDimensions={imageDims}
          containerBounds={containerBounds}
        />
      );

      const overlay = screen.getByTestId('canvas-overlay');

      // Drag from (100, 100) to (300, 250)
      fireEvent.pointerDown(overlay, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(overlay, { clientX: 300, clientY: 250 });
      fireEvent.pointerUp(overlay, { clientX: 300, clientY: 250, button: 0 });

      await waitFor(async () => {
        const regionsInDb = await db.textRegions.where('pageId').equals(pageId).toArray();
        expect(regionsInDb.length).toBe(1);
        expect(regionsInDb[0].box.width).toBe(200);
        expect(regionsInDb[0].box.height).toBe(150);
        expect(useCanvasStore.getState().selectedRegionId).toBe(regionsInDb[0].id);
      });
    });
  });

  describe('ImageCanvas Component', () => {
    it('renders honest empty state when no page is active', () => {
      render(<ImageCanvas pageId={null} />);

      expect(screen.getByTestId('canvas-empty-state')).toBeInTheDocument();
      expect(screen.getByText('No Page Selected')).toBeInTheDocument();
    });

    it('renders image canvas stage and overlay when active page is provided', async () => {
      const project = await createProject({ name: 'Canvas Test' });
      const chapter = await createChapter(project.id, 'Ch 1');
      const page = await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 'canvas_p1.png');

      useStudioStore.getState().setActiveProject(project.id);
      useStudioStore.getState().setActiveChapter(chapter.id);
      useStudioStore.getState().setActivePage(page.id);

      render(<ImageCanvas pageId={page.id} />);

      await waitFor(() => {
        expect(screen.getByTestId('image-canvas-container')).toBeInTheDocument();
        expect(screen.getByTestId('canvas-stage')).toBeInTheDocument();
        expect(screen.getByTestId('canvas-image')).toBeInTheDocument();
        expect(screen.getByTestId('canvas-overlay')).toBeInTheDocument();
        expect(screen.getByTestId('zoom-controls')).toBeInTheDocument();
      });
    });
  });
});
