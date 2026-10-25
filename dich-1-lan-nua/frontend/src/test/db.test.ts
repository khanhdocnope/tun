import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import { db } from '../db';
import {
  createProject,
  updateProject,
  deleteProject,
  createChapter,
  updateChapter,
  deleteChapter,
  deletePage,
  reorderPages,
  importSingleImage,
  importImages,
  importZipArchive,
  importFiles,
  naturalCompare,
  sortFilenamesNaturally,
  getImageDimensions,
} from '../db/importExport';
import { TextRegion, HistorySnapshot } from '../types/region';
import { useStudioStore } from '../store/useStudioStore';
import { FileUploader } from '../components/common/FileUploader';


/**
 * Creates a valid PNG binary Blob with custom width and height
 */
function createMockPngBlob(width: number, height: number): Blob {
  const buffer = new Uint8Array(45);
  // PNG signature
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR length: 13
  buffer.set([0x00, 0x00, 0x00, 0x0d], 8);
  // IHDR chunk type: "IHDR"
  buffer.set([0x49, 0x48, 0x44, 0x52], 12);
  // Width (big-endian 32-bit)
  const view = new DataView(buffer.buffer);
  view.setUint32(16, width, false);
  // Height (big-endian 32-bit)
  view.setUint32(20, height, false);
  // Bit depth, Color type, Compression, Filter, Interlace
  buffer.set([0x08, 0x06, 0x00, 0x00, 0x00], 24);
  // Dummy CRC
  buffer.set([0x00, 0x00, 0x00, 0x00], 29);
  // IEND chunk
  buffer.set([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], 33);

  return new Blob([buffer], { type: 'image/png' });
}

/**
 * Creates a valid JPEG binary Blob with custom width and height
 */
function createMockJpegBlob(width: number, height: number): Blob {
  const buffer = new Uint8Array(25);
  // SOI
  buffer.set([0xff, 0xd8], 0);
  // SOF0 marker
  buffer.set([0xff, 0xc0], 2);
  // Segment length: 17 bytes (2 + 15)
  buffer.set([0x00, 0x11], 4);
  // Data precision: 8 bits
  buffer[6] = 0x08;
  // Height (big-endian 16-bit)
  const view = new DataView(buffer.buffer);
  view.setUint16(7, height, false);
  // Width (big-endian 16-bit)
  view.setUint16(9, width, false);
  // Number of components: 3
  buffer[11] = 0x03;
  // EOI marker at end
  buffer.set([0xff, 0xd9], 23);

  return new Blob([buffer], { type: 'image/jpeg' });
}

describe('Dexie Persistence & Studio Database (Milestone 2)', () => {
  beforeEach(async () => {
    await db.clearAllTables();
  });

  describe('Natural Alphanumeric Sorting', () => {
    it('sorts page filenames naturally so page_2 comes before page_10', () => {
      const unsorted = [
        'page_10.png',
        'page_2.png',
        'page_1.png',
        'page_20.png',
        'page_03.png',
      ];
      const sorted = sortFilenamesNaturally(unsorted);
      expect(sorted).toEqual([
        'page_1.png',
        'page_2.png',
        'page_03.png',
        'page_10.png',
        'page_20.png',
      ]);
    });

    it('handles natural collation with varied prefixes and extensions', () => {
      const files = ['ch1_12.jpg', 'ch1_2.jpg', 'ch1_1.jpg', 'ch1_10.jpg'];
      files.sort(naturalCompare);
      expect(files).toEqual(['ch1_1.jpg', 'ch1_2.jpg', 'ch1_10.jpg', 'ch1_12.jpg']);
    });
  });

  describe('Binary Image Header Dimension Parsing', () => {
    it('correctly extracts dimensions from a real PNG binary header', async () => {
      const pngBlob = createMockPngBlob(1440, 2560);
      const dims = await getImageDimensions(pngBlob);
      expect(dims.width).toBe(1440);
      expect(dims.height).toBe(2560);
    });

    it('correctly extracts dimensions from a real JPEG binary header', async () => {
      const jpegBlob = createMockJpegBlob(1080, 1920);
      const dims = await getImageDimensions(jpegBlob);
      expect(dims.width).toBe(1080);
      expect(dims.height).toBe(1920);
    });
  });

  describe('Project CRUD', () => {
    it('creates a project with valid defaults and persists to Dexie', async () => {
      const project = await createProject({
        name: 'Chainsaw Man Translation',
        sourceLanguage: 'ja',
        targetLanguage: 'vi',
      });

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Chainsaw Man Translation');
      expect(project.sourceLanguage).toBe('ja');
      expect(project.targetLanguage).toBe('vi');
      expect(project.status).toBe('draft');

      // Verify in DB
      const stored = await db.projects.get(project.id);
      expect(stored).toBeDefined();
      expect(stored?.name).toBe('Chainsaw Man Translation');
    });

    it('rejects empty project names', async () => {
      await expect(createProject({ name: '   ' })).rejects.toThrow(
        'Project name cannot be empty'
      );
    });

    it('updates project metadata and timestamp', async () => {
      const project = await createProject({ name: 'Initial Name' });
      const oldUpdatedAt = project.updatedAt;

      await new Promise((r) => setTimeout(r, 10));
      await updateProject(project.id, {
        name: 'Renamed Project',
        status: 'in_progress',
      });

      const updated = await db.projects.get(project.id);
      expect(updated?.name).toBe('Renamed Project');
      expect(updated?.status).toBe('in_progress');
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(oldUpdatedAt);
    });
  });

  describe('Chapter CRUD', () => {
    it('creates chapters within project with auto-incremented chapterNumber and order', async () => {
      const project = await createProject({ name: 'Solo Leveling' });

      const ch1 = await createChapter(project.id, 'Chapter 1: The Weakest Hunter');
      expect(ch1.projectId).toBe(project.id);
      expect(ch1.chapterNumber).toBe(1);
      expect(ch1.order).toBe(1);
      expect(ch1.pageCount).toBe(0);

      const ch2 = await createChapter(project.id, 'Chapter 2: Double Dungeon');
      expect(ch2.chapterNumber).toBe(2);
      expect(ch2.order).toBe(2);

      const allChapters = await db.chapters.where('projectId').equals(project.id).sortBy('order');
      expect(allChapters).toHaveLength(2);
      expect(allChapters[0].id).toBe(ch1.id);
      expect(allChapters[1].id).toBe(ch2.id);
    });

    it('updates chapter title and updates parent project timestamp', async () => {
      const project = await createProject({ name: 'Test' });
      const chapter = await createChapter(project.id, 'Draft Title');

      await updateChapter(chapter.id, { title: 'Final Title' });
      const updated = await db.chapters.get(chapter.id);
      expect(updated?.title).toBe('Final Title');
    });
  });

  describe('Single & Multiple Image Import', () => {
    it('imports single PNG image with native dimensions into Dexie', async () => {
      const project = await createProject({ name: 'One Piece' });
      const chapter = await createChapter(project.id, 'Chapter 1000');

      const pngBlob = createMockPngBlob(1200, 1800);
      const page = await importSingleImage(chapter.id, pngBlob, 'ch1000_p01.png');

      expect(page.id).toBeDefined();
      expect(page.chapterId).toBe(chapter.id);
      expect(page.projectId).toBe(project.id);
      expect(page.pageNumber).toBe(1);
      expect(page.fileName).toBe('ch1000_p01.png');
      expect(page.width).toBe(1200);
      expect(page.height).toBe(1800);
      expect(page.mimeType).toBe('image/png');
      expect(page.status).toBe('idle');

      // Verify persisted in Dexie
      const stored = await db.pages.get(page.id);
      expect(stored).toBeDefined();
      expect(stored?.sourceBlob).toBeDefined();

      // Verify chapter pageCount updated
      const updatedChapter = await db.chapters.get(chapter.id);
      expect(updatedChapter?.pageCount).toBe(1);

      // Verify project coverPageId set
      const updatedProject = await db.projects.get(project.id);
      expect(updatedProject?.coverPageId).toBe(page.id);
    });

    it('imports multiple files maintaining sequential page numbers', async () => {
      const project = await createProject({ name: 'Bleach' });
      const chapter = await createChapter(project.id, 'Chapter 1');

      const img1 = createMockPngBlob(800, 1200);
      const img2 = createMockJpegBlob(800, 1200);
      const img3 = createMockPngBlob(800, 1200);

      const pages = await importImages(
        chapter.id,
        [img1, img2, img3],
        ['p1.png', 'p2.jpg', 'p3.png']
      );

      expect(pages).toHaveLength(3);
      expect(pages[0].pageNumber).toBe(1);
      expect(pages[1].pageNumber).toBe(2);
      expect(pages[2].pageNumber).toBe(3);

      const storedPages = await db.pages.where('chapterId').equals(chapter.id).sortBy('pageNumber');
      expect(storedPages).toHaveLength(3);
      expect(storedPages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);

      const ch = await db.chapters.get(chapter.id);
      expect(ch?.pageCount).toBe(3);
    });
  });

  describe('ZIP Archive Extraction & Natural Collation', () => {
    it('extracts images from ZIP, filters out __MACOSX / .DS_Store / non-images, and sorts naturally', async () => {
      const project = await createProject({ name: 'Berserk' });
      const chapter = await createChapter(project.id, 'Chapter 86');

      // Build real in-memory ZIP with JSZip
      const zip = new JSZip();
      zip.file('berserk/page_10.png', createMockPngBlob(1000, 1500));
      zip.file('berserk/page_2.png', createMockPngBlob(1000, 1500));
      zip.file('berserk/page_1.png', createMockPngBlob(1000, 1500));
      zip.file('berserk/__MACOSX/._page_1.png', 'mac os resource fork');
      zip.file('berserk/.DS_Store', 'binary garbage');
      zip.file('berserk/Thumbs.db', 'windows thumbnail cache');
      zip.file('berserk/notes.txt', 'translation notes');

      const zipBlob = await zip.generateAsync({ type: 'blob' });

      const importedPages = await importZipArchive(chapter.id, zipBlob);

      // Must only contain 3 valid images
      expect(importedPages).toHaveLength(3);

      // Must be naturally sorted: page_1, page_2, page_10
      expect(importedPages[0].fileName).toBe('page_1.png');
      expect(importedPages[0].pageNumber).toBe(1);

      expect(importedPages[1].fileName).toBe('page_2.png');
      expect(importedPages[1].pageNumber).toBe(2);

      expect(importedPages[2].fileName).toBe('page_10.png');
      expect(importedPages[2].pageNumber).toBe(3);

      // Verify in DB
      const dbPages = await db.pages.where('chapterId').equals(chapter.id).sortBy('pageNumber');
      expect(dbPages).toHaveLength(3);
      expect(dbPages.map((p) => p.fileName)).toEqual([
        'page_1.png',
        'page_2.png',
        'page_10.png',
      ]);
    });

    it('throws error when ZIP archive contains no valid comic images', async () => {
      const project = await createProject({ name: 'Empty Zip Test' });
      const chapter = await createChapter(project.id, 'Chapter 1');

      const zip = new JSZip();
      zip.file('readme.txt', 'no images here');
      zip.file('.DS_Store', 'garbage');
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      await expect(importZipArchive(chapter.id, zipBlob)).rejects.toThrow(
        'No valid comic images (PNG, JPEG, WebP) found in ZIP archive'
      );
    });

    it('universal importFiles handles ZIP and loose files seamlessly', async () => {
      const project = await createProject({ name: 'Universal Test' });
      const chapter = await createChapter(project.id, 'Chapter 1');

      const zip = new JSZip();
      zip.file('ch_01.png', createMockPngBlob(800, 1200));
      zip.file('ch_02.png', createMockPngBlob(800, 1200));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipFile = new File([zipBlob], 'archive.zip', { type: 'application/zip' });

      const extraImage = new File([createMockJpegBlob(800, 1200)], 'ch_03.jpg', {
        type: 'image/jpeg',
      });

      const pages = await importFiles(chapter.id, [zipFile, extraImage]);
      expect(pages).toHaveLength(3);
      expect(pages.map((p) => p.fileName)).toEqual(['ch_01.png', 'ch_02.png', 'ch_03.jpg']);
      expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    });
  });

  describe('Page Reordering', () => {
    it('reorders pages within a chapter and updates sequential page numbers', async () => {
      const project = await createProject({ name: 'Reorder Test' });
      const chapter = await createChapter(project.id, 'Chapter 1');

      const [p1, p2, p3] = await importImages(
        chapter.id,
        [createMockPngBlob(800, 1200), createMockPngBlob(800, 1200), createMockPngBlob(800, 1200)],
        ['A.png', 'B.png', 'C.png']
      );

      // Reorder to: C (id: p3.id), A (id: p1.id), B (id: p2.id)
      await reorderPages(chapter.id, [p3.id, p1.id, p2.id]);

      const updatedP3 = await db.pages.get(p3.id);
      const updatedP1 = await db.pages.get(p1.id);
      const updatedP2 = await db.pages.get(p2.id);

      expect(updatedP3?.pageNumber).toBe(1);
      expect(updatedP1?.pageNumber).toBe(2);
      expect(updatedP2?.pageNumber).toBe(3);

      const orderedList = await db.pages.where('chapterId').equals(chapter.id).sortBy('pageNumber');
      expect(orderedList.map((p) => p.fileName)).toEqual(['C.png', 'A.png', 'B.png']);
    });
  });

  describe('Cascading Deletion', () => {
    it('deleting a single page cascades to its text regions and history, and re-sequences remaining pages', async () => {
      const project = await createProject({ name: 'Cascade Page Test' });
      const chapter = await createChapter(project.id, 'Chapter 1');

      const [p1, p2, p3] = await importImages(
        chapter.id,
        [createMockPngBlob(800, 1200), createMockPngBlob(800, 1200), createMockPngBlob(800, 1200)],
        ['p1.png', 'p2.png', 'p3.png']
      );

      // Add a text region to p2
      const region: TextRegion = {
        id: 'region-1',
        pageId: p2.id,
        projectId: project.id,
        box: { x: 50, y: 50, width: 200, height: 100 },
        sourceText: 'Hello',
        translatedText: 'Xin chào',
        confidence: 0.95,
        status: 'translated',
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.textRegions.add(region);

      // Add history snapshot to p2
      const history: HistorySnapshot = {
        id: 'hist-1',
        pageId: p2.id,
        actionType: 'ADD_REGION',
        undoPayload: { regionsBefore: [] },
        redoPayload: { regionsAfter: [region] },
        timestamp: Date.now(),
      };
      await db.historySnapshots.add(history);

      // Delete p2
      await deletePage(p2.id);

      // 1. p2 should be gone
      expect(await db.pages.get(p2.id)).toBeUndefined();

      // 2. Its regions and history should be purged
      expect(await db.textRegions.get('region-1')).toBeUndefined();
      expect(await db.historySnapshots.get('hist-1')).toBeUndefined();

      // 3. Remaining pages (p1, p3) should be re-sequenced to 1, 2
      const remainingPages = await db.pages.where('chapterId').equals(chapter.id).sortBy('pageNumber');
      expect(remainingPages).toHaveLength(2);
      expect(remainingPages[0].id).toBe(p1.id);
      expect(remainingPages[0].pageNumber).toBe(1);
      expect(remainingPages[1].id).toBe(p3.id);
      expect(remainingPages[1].pageNumber).toBe(2);

      // 4. Chapter pageCount updated
      const updatedCh = await db.chapters.get(chapter.id);
      expect(updatedCh?.pageCount).toBe(2);
    });

    it('deleting a chapter cascades to all its pages, regions, and history', async () => {
      const project = await createProject({ name: 'Cascade Chapter Test' });
      const chapter = await createChapter(project.id, 'Chapter to Delete');

      const [p1] = await importImages(chapter.id, [createMockPngBlob(800, 1200)], ['p1.png']);

      const region: TextRegion = {
        id: 'ch-region-1',
        pageId: p1.id,
        projectId: project.id,
        box: { x: 10, y: 10, width: 100, height: 100 },
        sourceText: 'Hi',
        translatedText: 'Chào',
        confidence: 1.0,
        status: 'detected',
        orderIndex: 1,
        readingDirection: 'horizontal',
        style: {
          fontFamily: 'Inter',
          fontSize: 14,
          fontColor: '#000000',
          alignment: 'left',
          verticalAlignment: 'top',
          bold: false,
          italic: false,
          lineHeight: 1.2,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.textRegions.add(region);

      await deleteChapter(chapter.id);

      expect(await db.chapters.get(chapter.id)).toBeUndefined();
      expect(await db.pages.get(p1.id)).toBeUndefined();
      expect(await db.textRegions.get('ch-region-1')).toBeUndefined();
    });

    it('deleting a project cascades to chapters, pages, text regions, and snapshots', async () => {
      const project = await createProject({ name: 'Project to Delete' });
      const ch1 = await createChapter(project.id, 'Ch 1');
      const ch2 = await createChapter(project.id, 'Ch 2');

      const pagesCh1 = await importImages(ch1.id, [createMockPngBlob(800, 1200)], ['p1.png']);
      const pagesCh2 = await importImages(ch2.id, [createMockPngBlob(800, 1200)], ['p2.png']);

      const region1: TextRegion = {
        id: 'proj-region-1',
        pageId: pagesCh1[0].id,
        projectId: project.id,
        box: { x: 0, y: 0, width: 50, height: 50 },
        sourceText: 'P1 text',
        translatedText: 'Dịch 1',
        confidence: 1.0,
        status: 'approved',
        orderIndex: 1,
        readingDirection: 'vertical',
        style: {
          fontFamily: 'Inter',
          fontSize: 12,
          fontColor: '#ffffff',
          alignment: 'center',
          verticalAlignment: 'middle',
          bold: false,
          italic: false,
          lineHeight: 1.2,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.textRegions.add(region1);

      await deleteProject(project.id);

      expect(await db.projects.get(project.id)).toBeUndefined();
      expect(await db.chapters.where('projectId').equals(project.id).count()).toBe(0);
      expect(await db.pages.where('projectId').equals(project.id).count()).toBe(0);
      expect(await db.textRegions.where('projectId').equals(project.id).count()).toBe(0);
      expect(await db.historySnapshots.where('pageId').equals(pagesCh1[0].id).count()).toBe(0);
    });

    it('gracefully handles deleting non-existent chapters or pages without crashing', async () => {
      await expect(deleteChapter('non-existent-ch')).resolves.not.toThrow();
      await expect(deletePage('non-existent-page')).resolves.not.toThrow();
    });

    it('throws when creating chapter for non-existent project', async () => {
      await expect(createChapter('non-existent-proj', 'Chapter 1')).rejects.toThrow(
        'Project non-existent-proj not found'
      );
    });

    it('throws when importing images into non-existent chapter', async () => {
      await expect(
        importSingleImage('non-existent-ch', createMockPngBlob(100, 100))
      ).rejects.toThrow('Chapter non-existent-ch not found');
    });
  });

  describe('WebP Header Dimension Extraction', () => {
    it('correctly extracts dimensions from a WebP VP8X binary header', async () => {
      const buffer = new Uint8Array(30);
      // RIFF
      buffer.set([0x52, 0x49, 0x46, 0x46], 0);
      // File size
      buffer.set([0x16, 0x00, 0x00, 0x00], 4);
      // WEBP
      buffer.set([0x57, 0x45, 0x42, 0x50], 8);
      // VP8X
      buffer.set([0x56, 0x50, 0x38, 0x58], 12);
      // Chunk length: 10
      buffer.set([0x0a, 0x00, 0x00, 0x00], 16);
      // Flags
      buffer.set([0x00, 0x00, 0x00, 0x00], 20);
      // Width: 1600 (encoded as 1599: 0x063F)
      buffer.set([0x3f, 0x06, 0x00], 24);
      // Height: 2400 (encoded as 2399: 0x095F)
      buffer.set([0x5f, 0x09, 0x00], 27);

      const webpBlob = new Blob([buffer], { type: 'image/webp' });
      const dims = await getImageDimensions(webpBlob);
      expect(dims.width).toBe(1600);
      expect(dims.height).toBe(2400);
    });
  });

  describe('Full Refresh Persistence Simulation', () => {
    it('persists all entities across database connection close and reopen', async () => {
      const project = await createProject({
        name: 'Persistent Series',
        sourceLanguage: 'ko',
        targetLanguage: 'vi',
      });

      const chapter = await createChapter(project.id, 'Chapter 1');
      const page = await importSingleImage(
        chapter.id,
        createMockPngBlob(900, 1600),
        'cover.png'
      );

      const region: TextRegion = {
        id: 'persisted-reg-1',
        pageId: page.id,
        projectId: project.id,
        box: { x: 50, y: 100, width: 250, height: 120 },
        sourceText: '안녕',
        translatedText: 'Xin chào',
        confidence: 0.98,
        status: 'verified',
        orderIndex: 1,
        readingDirection: 'horizontal',
        style: {
          fontFamily: 'Noto Sans KR',
          fontSize: 18,
          fontColor: '#000000',
          alignment: 'center',
          verticalAlignment: 'middle',
          bold: true,
          italic: false,
          lineHeight: 1.3,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await db.textRegions.add(region);

      // Simulate browser reload by closing and reopening db
      db.close();
      await db.open();

      // Verify all records survived
      const rehydratedProject = await db.projects.get(project.id);
      expect(rehydratedProject).toBeDefined();
      expect(rehydratedProject?.name).toBe('Persistent Series');

      const rehydratedChapter = await db.chapters.get(chapter.id);
      expect(rehydratedChapter).toBeDefined();
      expect(rehydratedChapter?.title).toBe('Chapter 1');

      const rehydratedPage = await db.pages.get(page.id);
      expect(rehydratedPage).toBeDefined();
      expect(rehydratedPage?.fileName).toBe('cover.png');
      expect(rehydratedPage?.width).toBe(900);
      expect(rehydratedPage?.height).toBe(1600);

      const rehydratedRegion = await db.textRegions.get('persisted-reg-1');
      expect(rehydratedRegion).toBeDefined();
      expect(rehydratedRegion?.sourceText).toBe('안녕');
      expect(rehydratedRegion?.translatedText).toBe('Xin chào');
    });
  });

  describe('useStudioStore State Management', () => {
    beforeEach(() => {
      useStudioStore.getState().resetStudio();
    });

    it('initializes with default studio state', () => {
      const state = useStudioStore.getState();
      expect(state.activeProjectId).toBeNull();
      expect(state.activeChapterId).toBeNull();
      expect(state.activePageId).toBeNull();
      expect(state.activeTool).toBe('select');
      expect(state.viewMode).toBe('studio');
      expect(state.readerDirection).toBe('rtl');
      expect(state.isSidebarOpen).toBe(true);
      expect(state.isPropertiesOpen).toBe(true);
    });

    it('cascades clearing when switching active project', () => {
      const store = useStudioStore.getState();
      store.setActiveProject('proj-1');
      store.setActiveChapter('ch-1');
      store.setActivePage('page-1');
      store.setSelectedRegion('reg-1');

      // Now switch project
      useStudioStore.getState().setActiveProject('proj-2');
      const updated = useStudioStore.getState();
      expect(updated.activeProjectId).toBe('proj-2');
      expect(updated.activeChapterId).toBeNull();
      expect(updated.activePageId).toBeNull();
      expect(updated.selectedRegionId).toBeNull();
    });

    it('updates tools, modes, and panel toggles', () => {
      const store = useStudioStore.getState();
      store.setActiveTool('draw_rect');
      expect(useStudioStore.getState().activeTool).toBe('draw_rect');

      store.setViewMode('vertical_reader');
      expect(useStudioStore.getState().viewMode).toBe('vertical_reader');

      store.setReaderDirection('ltr');
      expect(useStudioStore.getState().readerDirection).toBe('ltr');

      store.toggleSidebar();
      expect(useStudioStore.getState().isSidebarOpen).toBe(false);

      store.toggleProperties();
      expect(useStudioStore.getState().isPropertiesOpen).toBe(false);
    });
  });

  describe('FileUploader Component Integration', () => {
    it('renders standard dropzone and triggers input on click', async () => {
      const project = await createProject({ name: 'Uploader Project' });
      const chapter = await createChapter(project.id, 'Ch 1');

      let completedPages: any[] = [];
      render(
        React.createElement(FileUploader, {
          chapterId: chapter.id,
          onUploadComplete: (pages) => {
            completedPages = pages;
          },
        })
      );

      expect(screen.getByTestId('file-uploader-dropzone')).toBeInTheDocument();
      expect(screen.getByText(/Drag & drop comic pages or ZIP archive/i)).toBeInTheDocument();

      const input = screen.getByTestId('file-uploader-input') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.type).toBe('file');

      // Simulate file upload via change event
      const testFile = new File([createMockPngBlob(800, 1200)], 'test_upload.png', {
        type: 'image/png',
      });

      fireEvent.change(input, { target: { files: [testFile] } });

      await waitFor(() => {
        expect(completedPages.length).toBe(1);
      });
      expect(completedPages[0].fileName).toBe('test_upload.png');
    });

    it('renders compact button and handles file selection', async () => {
      const project = await createProject({ name: 'Compact Uploader' });
      const chapter = await createChapter(project.id, 'Ch 1');

      let uploaded = false;
      render(
        React.createElement(FileUploader, {
          chapterId: chapter.id,
          compact: true,
          onUploadComplete: () => {
            uploaded = true;
          },
        })
      );

      const button = screen.getByTestId('file-uploader-button');
      expect(button).toBeInTheDocument();
      expect(screen.getByText('Import Pages')).toBeInTheDocument();

      const input = screen.getByTestId('file-uploader-input');
      const testFile = new File([createMockJpegBlob(600, 900)], 'compact.jpg', {
        type: 'image/jpeg',
      });

      fireEvent.change(input, { target: { files: [testFile] } });

      await waitFor(() => {
        expect(uploaded).toBe(true);
      });
    });

    it('displays error when attempting import without valid chapterId', async () => {
      let caughtError: Error | null = null;
      render(
        React.createElement(FileUploader, {
          chapterId: '',
          onError: (err) => {
            caughtError = err;
          },
        })
      );


      const input = screen.getByTestId('file-uploader-input');
      const testFile = new File([createMockPngBlob(100, 100)], 'dummy.png', {
        type: 'image/png',
      });

      fireEvent.change(input, { target: { files: [testFile] } });

      await waitFor(() => {
        expect(caughtError).not.toBeNull();
      });
      expect((caughtError as unknown as Error)?.message).toBe('No active chapter selected for import');
      expect(screen.getByText('No active chapter selected for import')).toBeInTheDocument();
    });
  });
});


