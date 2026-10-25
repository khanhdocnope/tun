import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { db } from '../db';
import {
  createProject,
  createChapter,
  importSingleImage,
} from '../db/importExport';
import { useStudioStore } from '../store/useStudioStore';
import { TextRegion } from '../types/region';
import { StudioLayout } from '../components/layout/StudioLayout';
import { TopToolbar } from '../components/layout/TopToolbar';
import { ProjectSidebar } from '../components/layout/ProjectSidebar';
import { PropertiesPanel } from '../components/layout/PropertiesPanel';
import { DualModeReader } from '../components/reader/DualModeReader';
import { VerticalWebtoonReader } from '../components/reader/VerticalWebtoonReader';
import { PageReader } from '../components/reader/PageReader';
import { App } from '../App';

/**
 * Creates a valid PNG binary Blob with custom width and height
 */
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

describe('Milestone 3: Studio UI Layout & Dual-Mode Reader', () => {
  beforeEach(async () => {
    await db.clearAllTables();
    useStudioStore.getState().resetStudio();
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  /* ========================================================================= */
  /* 1. StudioLayout & 4-Quadrant Creative Dark Theme                          */
  /* ========================================================================= */
  describe('StudioLayout & Dark Palette (Features 5 & 19)', () => {
    it('renders 4 quadrants with strict dark creative theme tokens and canvas id studio-canvas-stage', () => {
      render(<StudioLayout />);

      // Top Toolbar
      const toolbar = screen.getByTestId('top-toolbar');
      expect(toolbar).toBeInTheDocument();
      expect(toolbar).toHaveStyle({ backgroundColor: '#1a1b20' });

      // Project Sidebar
      const sidebar = screen.getByTestId('project-sidebar');
      expect(sidebar).toBeInTheDocument();
      expect(sidebar).toHaveStyle({ backgroundColor: '#141518' });

      // Main Canvas Stage with required id studio-canvas-stage
      const canvasStage = screen.getByTestId('studio-canvas-stage');
      expect(canvasStage).toBeInTheDocument();
      expect(canvasStage.id).toBe('studio-canvas-stage');
      expect(canvasStage).toHaveStyle({ backgroundColor: '#121316' });

      // Properties Panel
      const properties = screen.getByTestId('properties-panel');
      expect(properties).toBeInTheDocument();
      expect(properties).toHaveStyle({ backgroundColor: '#141518' });
    });

    it('renders empty canvas state when no active page is selected', () => {
      render(<StudioLayout />);
      expect(screen.getByTestId('canvas-empty-state')).toBeInTheDocument();
      expect(screen.getByText('No Comic Page Selected')).toBeInTheDocument();
    });

    it('renders active page image preview in canvas stage when a page is selected', async () => {
      const project = await createProject({ name: 'Solo Test' });
      const chapter = await createChapter(project.id, 'Chapter 1');
      const page = await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 'p1.png');

      useStudioStore.getState().setActiveProject(project.id);
      useStudioStore.getState().setActiveChapter(chapter.id);
      useStudioStore.getState().setActivePage(page.id);

      render(<StudioLayout />);

      await waitFor(() => {
        expect(screen.getByTestId('studio-active-image')).toBeInTheDocument();
      });
      const img = screen.getByTestId('studio-active-image') as HTMLImageElement;
      expect(img.alt).toBe('p1.png');
    });
  });

  /* ========================================================================= */
  /* 2. TopToolbar Controls (Feature 20)                                       */
  /* ========================================================================= */
  describe('TopToolbar Controls (Feature 20)', () => {
    it('switches between studio, webtoon, and page reader modes', () => {
      render(<TopToolbar />);

      // Initially studio
      expect(useStudioStore.getState().viewMode).toBe('studio');

      // Click Webtoon button
      fireEvent.click(screen.getByTestId('mode-webtoon-btn'));
      expect(useStudioStore.getState().viewMode).toBe('vertical_reader');

      // Click Manga Page button
      fireEvent.click(screen.getByTestId('mode-page-btn'));
      expect(useStudioStore.getState().viewMode).toBe('page_reader');

      // Switch back to Studio
      fireEvent.click(screen.getByTestId('mode-studio-btn'));
      expect(useStudioStore.getState().viewMode).toBe('studio');
    });

    it('selects active canvas tool (Select, Pan, Draw)', () => {
      render(<TopToolbar />);

      fireEvent.click(screen.getByTestId('tool-pan-btn'));
      expect(useStudioStore.getState().activeTool).toBe('pan');

      fireEvent.click(screen.getByTestId('tool-draw-btn'));
      expect(useStudioStore.getState().activeTool).toBe('draw_rect');

      fireEvent.click(screen.getByTestId('tool-select-btn'));
      expect(useStudioStore.getState().activeTool).toBe('select');
    });

    it('controls Zoom HUD operations (Zoom In, Zoom Out, Reset, Fit)', () => {
      let fitCalled = false;
      let actualSizeCalled = false;

      render(
        <TopToolbar
          onFitToScreen={() => {
            fitCalled = true;
          }}
          onActualSize={() => {
            actualSizeCalled = true;
          }}
        />
      );

      expect(screen.getByTestId('zoom-reset-btn')).toHaveTextContent('100%');

      // Zoom In
      fireEvent.click(screen.getByTestId('zoom-in-btn'));
      expect(useStudioStore.getState().zoomLevel).toBe(125);
      expect(screen.getByTestId('zoom-reset-btn')).toHaveTextContent('125%');

      // Zoom Out
      fireEvent.click(screen.getByTestId('zoom-out-btn'));
      expect(useStudioStore.getState().zoomLevel).toBe(100);

      // Fit to Screen trigger
      fireEvent.click(screen.getByTestId('fit-screen-btn'));
      expect(fitCalled).toBe(true);

      // Reset Zoom trigger
      fireEvent.click(screen.getByTestId('zoom-reset-btn'));
      expect(actualSizeCalled).toBe(true);
    });

    it('triggers undo and redo actions and dispatches events', () => {
      let undoTriggered = false;
      let redoTriggered = false;

      render(
        <TopToolbar
          canUndo={true}
          canRedo={true}
          onUndo={() => {
            undoTriggered = true;
          }}
          onRedo={() => {
            redoTriggered = true;
          }}
        />
      );

      fireEvent.click(screen.getByTestId('undo-button'));
      expect(undoTriggered).toBe(true);

      fireEvent.click(screen.getByTestId('redo-button'));
      expect(redoTriggered).toBe(true);
    });

    it('toggles sidebar and properties panel visibility', () => {
      render(<TopToolbar />);

      expect(useStudioStore.getState().isSidebarOpen).toBe(true);
      fireEvent.click(screen.getByTestId('toggle-sidebar-button'));
      expect(useStudioStore.getState().isSidebarOpen).toBe(false);

      expect(useStudioStore.getState().isPropertiesOpen).toBe(true);
      fireEvent.click(screen.getByTestId('toggle-properties-button'));
      expect(useStudioStore.getState().isPropertiesOpen).toBe(false);
    });
  });

  /* ========================================================================= */
  /* 3. ProjectSidebar & Project Management (Features 16, 17, 21)              */
  /* ========================================================================= */
  describe('ProjectSidebar Management (Features 16, 17, 21)', () => {
    it('creates a new project and chapter via modal form', async () => {
      render(<ProjectSidebar />);

      // Open modal
      fireEvent.click(screen.getByTestId('new-project-btn'));
      expect(screen.getByTestId('new-project-modal')).toBeInTheDocument();

      // Enter project name
      const nameInput = screen.getByTestId('new-project-name-input');
      fireEvent.change(nameInput, { target: { value: 'Tower of God' } });

      // Submit
      fireEvent.click(screen.getByTestId('create-project-submit'));

      await waitFor(() => {
        expect(screen.queryByTestId('new-project-modal')).not.toBeInTheDocument();
      });

      // Verify created project in Dexie
      const projects = await db.projects.toArray();
      expect(projects.length).toBe(1);
      expect(projects[0].name).toBe('Tower of God');
    });

    it('renders page thumbnail strip with status indicators and active selection', async () => {
      const project = await createProject({ name: 'Strip Test' });
      const chapter = await createChapter(project.id, 'Ch 1');
      const p1 = await importSingleImage(chapter.id, createMockPngBlob(600, 900), 'p1.png');
      const p2 = await importSingleImage(chapter.id, createMockPngBlob(600, 900), 'p2.png');

      // Set status on p2
      await db.pages.update(p2.id, { status: 'ocr_completed' });

      useStudioStore.getState().setActiveProject(project.id);
      useStudioStore.getState().setActiveChapter(chapter.id);
      useStudioStore.getState().setActivePage(p1.id);

      render(<ProjectSidebar />);

      await waitFor(() => {
        expect(screen.getByTestId(`thumbnail-card-${p1.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`thumbnail-card-${p2.id}`)).toBeInTheDocument();
      });

      // Status badges
      expect(screen.getByTestId(`page-status-${p1.id}`)).toHaveTextContent('Idle');
      expect(screen.getByTestId(`page-status-${p2.id}`)).toHaveTextContent('OCR Done');

      // Select p2 on click
      fireEvent.click(screen.getByTestId(`thumbnail-card-${p2.id}`));
      expect(useStudioStore.getState().activePageId).toBe(p2.id);
    });

    it('supports drag-and-drop page reordering', async () => {
      const project = await createProject({ name: 'Reorder Test' });
      const chapter = await createChapter(project.id, 'Ch 1');
      const p1 = await importSingleImage(chapter.id, createMockPngBlob(500, 500), 'p1.png');
      const p2 = await importSingleImage(chapter.id, createMockPngBlob(500, 500), 'p2.png');

      useStudioStore.getState().setActiveProject(project.id);
      useStudioStore.getState().setActiveChapter(chapter.id);

      render(<ProjectSidebar />);

      await waitFor(() => {
        expect(screen.getByTestId(`thumbnail-card-${p1.id}`)).toBeInTheDocument();
      });

      // Simulate dragging p1 onto p2
      const cardP1 = screen.getByTestId(`thumbnail-card-${p1.id}`);
      const cardP2 = screen.getByTestId(`thumbnail-card-${p2.id}`);

      fireEvent.dragStart(cardP1, {
        dataTransfer: {
          setData: () => {},
          getData: () => p1.id,
        },
      });

      fireEvent.dragOver(cardP2);
      fireEvent.drop(cardP2, {
        dataTransfer: {
          getData: () => p1.id,
        },
      });

      await waitFor(async () => {
        const reloadedP1 = await db.pages.get(p1.id);
        const reloadedP2 = await db.pages.get(p2.id);
        expect(reloadedP2?.pageNumber).toBe(1);
        expect(reloadedP1?.pageNumber).toBe(2);
      });
    });
  });

  /* ========================================================================= */
  /* 4. PropertiesPanel & Region Editing (Feature 22)                          */
  /* ========================================================================= */
  describe('PropertiesPanel Inspector (Feature 22)', () => {
    it('displays active page metadata and updates page status', async () => {
      const project = await createProject({ name: 'Props Test' });
      const chapter = await createChapter(project.id, 'Ch 1');
      const page = await importSingleImage(chapter.id, createMockPngBlob(1200, 1800), 'big_scan.png');

      useStudioStore.getState().setActiveProject(project.id);
      useStudioStore.getState().setActiveChapter(chapter.id);
      useStudioStore.getState().setActivePage(page.id);

      render(<PropertiesPanel />);

      await waitFor(() => {
        expect(screen.getByText('big_scan.png')).toBeInTheDocument();
      });

      expect(screen.getByText('1200 × 1800 px')).toBeInTheDocument();

      // Change page status
      const statusSelect = screen.getByTestId('page-status-select');
      fireEvent.change(statusSelect, { target: { value: 'translated' } });

      await waitFor(async () => {
        const updatedPage = await db.pages.get(page.id);
        expect(updatedPage?.status).toBe('translated');
      });
    });

    it('inspects and edits selected TextRegion properties', async () => {
      const project = await createProject({ name: 'Props Region' });
      const chapter = await createChapter(project.id, 'Ch 1');
      const page = await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 'page.png');

      const region: TextRegion = {
        id: 'region-edit-1',
        pageId: page.id,
        projectId: project.id,
        box: { x: 100, y: 150, width: 200, height: 80 },
        sourceText: 'Hello world',
        translatedText: '',
        confidence: 0.95,
        status: 'detected',
        orderIndex: 1,
        readingDirection: 'vertical',
        style: {
          fontFamily: 'Comic Neue',
          fontSize: 18,
          fontColor: '#000000',
          alignment: 'center',
          verticalAlignment: 'middle',
          bold: false,
          italic: false,
          lineHeight: 1.2,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.textRegions.add(region);

      useStudioStore.getState().setActivePage(page.id);
      useStudioStore.getState().setSelectedRegion(region.id);

      render(<PropertiesPanel />);

      await waitFor(() => {
        expect(screen.getByTestId('region-source-text')).toBeInTheDocument();
      });

      // Verify coordinate inputs
      expect(screen.getByTestId('region-box-x')).toHaveValue(100);
      expect(screen.getByTestId('region-box-y')).toHaveValue(150);
      expect(screen.getByTestId('region-box-w')).toHaveValue(200);
      expect(screen.getByTestId('region-box-h')).toHaveValue(80);

      // Edit translation
      const transInput = screen.getByTestId('region-translated-text');
      fireEvent.change(transInput, { target: { value: 'Xin chào thế giới' } });
      fireEvent.click(screen.getByTestId('save-region-btn'));

      await waitFor(async () => {
        const updated = await db.textRegions.get('region-edit-1');
        expect(updated?.translatedText).toBe('Xin chào thế giới');
        expect(updated?.status).toBe('translated');
      });
    });

    it('displays honest empty state when no text region exists', async () => {
      const project = await createProject({ name: 'Empty Reg' });
      const chapter = await createChapter(project.id, 'Ch 1');
      const page = await importSingleImage(chapter.id, createMockPngBlob(500, 500), 'p.png');

      useStudioStore.getState().setActivePage(page.id);

      render(<PropertiesPanel />);

      await waitFor(() => {
        expect(screen.getByText('No text regions detected')).toBeInTheDocument();
      });
    });
  });

  /* ========================================================================= */
  /* 5. VerticalWebtoonReader (Feature 23)                                     */
  /* ========================================================================= */
  describe('VerticalWebtoonReader (Feature 23)', () => {
    it('renders continuous vertical scroll of all chapter pages', async () => {
      const project = await createProject({ name: 'Webtoon Series' });
      const chapter = await createChapter(project.id, 'Chapter 1');
      const p1 = await importSingleImage(chapter.id, createMockPngBlob(800, 1600), 'w1.png');
      const p2 = await importSingleImage(chapter.id, createMockPngBlob(800, 1600), 'w2.png');
      const p3 = await importSingleImage(chapter.id, createMockPngBlob(800, 1600), 'w3.png');

      useStudioStore.getState().setActiveProject(project.id);
      useStudioStore.getState().setActiveChapter(chapter.id);

      render(<VerticalWebtoonReader />);

      await waitFor(() => {
        expect(screen.getByTestId(`webtoon-page-${p1.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`webtoon-page-${p2.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`webtoon-page-${p3.id}`)).toBeInTheDocument();
      });

      expect(screen.getByText('End of Chapter')).toBeInTheDocument();
      expect(screen.getByText('3 pages total')).toBeInTheDocument();
    });
  });

  /* ========================================================================= */
  /* 6. PageReader & Keyboard Navigation (Features 24, 25, 26)                 */
  /* ========================================================================= */
  describe('PageReader & Navigation (Features 24, 25, 26)', () => {
    it('renders single page with page counter HUD', async () => {
      const project = await createProject({ name: 'Manga Series' });
      const chapter = await createChapter(project.id, 'Chapter 1');
      const p1 = await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 'm1.png');
      const p2 = await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 'm2.png');

      useStudioStore.getState().setActiveProject(project.id);
      useStudioStore.getState().setActiveChapter(chapter.id);
      useStudioStore.getState().setActivePage(p1.id);

      render(<PageReader />);

      await waitFor(() => {
        expect(screen.getByTestId('page-counter-hud')).toHaveTextContent('Page 1 of 2');
      });

      // Next button
      fireEvent.click(screen.getByTestId('hud-next-btn'));
      expect(useStudioStore.getState().activePageId).toBe(p2.id);
    });

    it('navigates with Arrow keys in LTR reading direction', async () => {
      const project = await createProject({ name: 'Western Comic' });
      const chapter = await createChapter(project.id, 'Ch 1');
      const p1 = await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 'c1.png');
      const p2 = await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 'c2.png');

      useStudioStore.getState().setActiveProject(project.id);
      useStudioStore.getState().setActiveChapter(chapter.id);
      useStudioStore.getState().setActivePage(p1.id);
      useStudioStore.getState().setReaderDirection('ltr');

      render(<PageReader />);

      await waitFor(() => {
        expect(screen.getByTestId('page-counter-hud')).toHaveTextContent('Page 1 of 2');
      });

      // In LTR: ArrowRight -> Next page
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(useStudioStore.getState().activePageId).toBe(p2.id);

      // In LTR: ArrowLeft -> Prev page
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(useStudioStore.getState().activePageId).toBe(p1.id);
    });

    it('navigates with inverted Arrow keys in RTL Manga reading direction', async () => {
      const project = await createProject({ name: 'Manga RTL' });
      const chapter = await createChapter(project.id, 'Ch 1');
      const p1 = await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 'm1.png');
      const p2 = await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 'm2.png');

      useStudioStore.getState().setActiveProject(project.id);
      useStudioStore.getState().setActiveChapter(chapter.id);
      useStudioStore.getState().setActivePage(p1.id);
      useStudioStore.getState().setReaderDirection('rtl');

      render(<PageReader />);

      await waitFor(() => {
        expect(screen.getByTestId('page-counter-hud')).toHaveTextContent('Page 1 of 2');
      });

      // In RTL: ArrowLeft -> Next page
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(useStudioStore.getState().activePageId).toBe(p2.id);

      // In RTL: ArrowRight -> Prev page
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(useStudioStore.getState().activePageId).toBe(p1.id);
    });

    it('toggles reading direction and spread mode', async () => {
      const project = await createProject({ name: 'Toggles Test' });
      const chapter = await createChapter(project.id, 'Ch 1');
      await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 't1.png');

      useStudioStore.getState().setActiveProject(project.id);
      useStudioStore.getState().setActiveChapter(chapter.id);
      useStudioStore.getState().setReaderDirection('rtl');

      render(<PageReader />);

      // Direction toggle
      await waitFor(() => {
        expect(screen.getByTestId('direction-toggle-btn')).toBeInTheDocument();
      });
      const dirBtn = screen.getByTestId('direction-toggle-btn');
      expect(dirBtn).toHaveTextContent('RTL (Manga)');
      fireEvent.click(dirBtn);
      expect(useStudioStore.getState().readerDirection).toBe('ltr');

      // Spread mode toggle
      const spreadBtn = screen.getByTestId('spread-toggle-btn');
      expect(spreadBtn).toHaveTextContent('Single Page');
      fireEvent.click(spreadBtn);
      expect(spreadBtn).toHaveTextContent('Double Spread');
    });
  });

  /* ========================================================================= */
  /* 7. DualModeReader Decoupled Operations (Feature 27)                       */
  /* ========================================================================= */
  describe('DualModeReader Decoupled View (Feature 27)', () => {
    it('switches between vertical and page readers and exits to studio', async () => {
      const project = await createProject({ name: 'Decoupled Series' });
      const chapter = await createChapter(project.id, 'Ch 1');
      await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 'd1.png');

      useStudioStore.getState().setActiveProject(project.id);
      useStudioStore.getState().setActiveChapter(chapter.id);
      useStudioStore.getState().setViewMode('vertical_reader');

      render(<DualModeReader />);

      expect(screen.getByTestId('vertical-webtoon-reader')).toBeInTheDocument();

      // Switch to page mode
      fireEvent.click(screen.getByTestId('switch-page-btn'));
      expect(useStudioStore.getState().viewMode).toBe('page_reader');

      await waitFor(() => {
        expect(screen.getByTestId('page-reader')).toBeInTheDocument();
      });

      // Exit back to studio mode
      fireEvent.click(screen.getByTestId('exit-reader-btn'));
      expect(useStudioStore.getState().viewMode).toBe('studio');
    });
  });

  /* ========================================================================= */
  /* 8. App Root Integration & Hotkeys                                         */
  /* ========================================================================= */
  describe('App Root Integration', () => {
    it('renders StudioLayout when viewMode is studio, and handles Escape to exit reader', async () => {
      const project = await createProject({ name: 'App Root Test' });
      const chapter = await createChapter(project.id, 'Ch 1');
      await importSingleImage(chapter.id, createMockPngBlob(800, 1200), 'a1.png');

      useStudioStore.getState().setViewMode('studio');

      render(<App />);

      expect(screen.getByTestId('studio-layout')).toBeInTheDocument();

      // Switch to reader mode via Toolbar button
      fireEvent.click(screen.getByTestId('mode-page-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('dual-mode-reader')).toBeInTheDocument();
      });

      // Press Escape to exit reader mode
      fireEvent.keyDown(window, { key: 'Escape' });

      await waitFor(() => {
        expect(useStudioStore.getState().viewMode).toBe('studio');
      });
    });
  });
});
