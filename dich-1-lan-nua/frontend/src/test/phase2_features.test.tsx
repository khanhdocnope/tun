import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useStudioStore } from '../store/useStudioStore';
import { ServerSettingsModal } from '../components/layout/ServerSettingsModal';
import { TopToolbar } from '../components/layout/TopToolbar';
import { PropertiesPanel } from '../components/layout/PropertiesPanel';
import { ImageCanvas } from '../components/canvas/ImageCanvas';
import { db } from '../db';
import * as api from '../services/api';

describe('Phase 2 Frontend Features & Studio Integration', () => {
  beforeEach(async () => {
    await db.clearAllTables();
    useStudioStore.getState().resetStudio();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await db.clearAllTables();
  });

  describe('API Service (services/api.ts)', () => {
    it('manages backend URL storage and fallback', () => {
      localStorage.removeItem('comic_backend_url');
      expect(api.getBackendUrl()).toBe(api.DEFAULT_BACKEND_URL);

      api.setBackendUrl('https://my-hf-space.hf.space/');
      expect(api.getBackendUrl()).toBe('https://my-hf-space.hf.space');

      api.setBackendUrl('');
      expect(api.getBackendUrl()).toBe(api.DEFAULT_BACKEND_URL);
    });

    it('tests backend connection and handles Hugging Face Space latency', async () => {
      vi.spyOn(global, 'fetch').mockImplementationOnce(async (url) => {
        expect(url).toContain('/api/v1/health');
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const res = await api.testBackendConnection('https://test-space.hf.space');
      expect(res.ok).toBe(true);
      expect(res.isHfSpace).toBe(true);
      expect(res.status).toBe(200);
    });

    it('detectOCR formats request and returns parsed regions', async () => {
      const mockOcrResult: api.OCRDetectResponseAPI = {
        regions: [
          {
            id: 'reg-1',
            polygon: [[10, 10], [50, 10], [50, 40], [10, 40]],
            bounding_box: { x: 10, y: 10, width: 40, height: 30 },
            text: 'Manga dialogue text',
            confidence: 0.95,
            orientation: 'horizontal',
            reading_order: 1,
          },
        ],
        engine: 'rapidocr',
        detected_languages: ['en', 'ja'],
        reading_order: 'rtl',
        image_width: 800,
        image_height: 1200,
        processing_time_ms: 45,
      };

      vi.spyOn(global, 'fetch').mockImplementationOnce(async (url, init) => {
        expect(url).toContain('/api/v1/ocr/detect');
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify(mockOcrResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const fakeBlob = new Blob(['fake image bytes'], { type: 'image/png' });
      const data = await api.detectOCR(fakeBlob, { engine: 'rapidocr', reading_order: 'rtl' });
      expect(data.regions).toHaveLength(1);
      expect(data.regions[0].text).toBe('Manga dialogue text');
      expect(data.regions[0].confidence).toBe(0.95);
    });

    it('processInpaint receives cleaned image blob and headers', async () => {
      const cleanedPngBytes = new Uint8Array([137, 80, 78, 71]);
      vi.spyOn(global, 'fetch').mockImplementationOnce(async (url, init) => {
        expect(url).toContain('/api/v1/inpaint/process');
        return new Response(cleanedPngBytes, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'X-Inpaint-Engine': 'opencv_telea',
            'X-Inpaint-Duration-Ms': '15',
          },
        });
      });

      const fakeBlob = new Blob(['fake image bytes'], { type: 'image/png' });
      const result = await api.processInpaint(fakeBlob, {
        regions: [{ x: 10, y: 10, width: 40, height: 30 }],
        dilation: 3,
        engine: 'opencv_telea',
      });

      expect(result.engine).toBe('opencv_telea');
      expect(result.durationMs).toBe(15);
      expect(result.cleanedBlob).toBeInstanceOf(Blob);
    });

    it('eraseTextInRegion calls smart erase endpoint and parses headers', async () => {
      const cleanedPngBytes = new Uint8Array([137, 80, 78, 71]);
      vi.spyOn(global, 'fetch').mockImplementationOnce(async (url, init) => {
        expect(url).toContain('/api/v1/erase-text-in-region');
        const body = init?.body as FormData;
        expect(body.get('region')).toBeNull();
        expect(body.get('regions')).toBe(JSON.stringify([[10, 10, 40, 30]]));
        return new Response(cleanedPngBytes, {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'X-SmartErase-Engine': 'lama',
            'X-SmartErase-Text-Boxes': '2',
            'X-SmartErase-Mask-Coverage': '1.5',
            'X-SmartErase-Elapsed-Ms': '100',
            'X-SmartErase-Status': 'ok',
          },
        });
      });

      const fakeBlob = new Blob(['fake image bytes'], { type: 'image/png' });
      const result = await api.eraseTextInRegion(fakeBlob, {
        regions: [[10, 10, 40, 30]],
        dilation: 6,
        engine: 'lama',
      });

      expect(result.engine).toBe('lama');
      expect(result.textBoxes).toBe(2);
      expect(result.maskCoverage).toBe(1.5);
      expect(result.elapsedMs).toBe(100);
      expect(result.status).toBe('ok');
      expect(result.cleanedBlob).toBeInstanceOf(Blob);
    });
  });

  describe('ServerSettingsModal Component', () => {
    it('renders and allows testing connection and changing backend URL', async () => {
      vi.spyOn(api, 'testBackendConnection').mockResolvedValueOnce({
        ok: true,
        status: 200,
        message: 'Backend operational',
        latencyMs: 35,
        isHfSpace: true,
      });

      const handleClose = vi.fn();
      render(<ServerSettingsModal isOpen={true} onClose={handleClose} />);

      expect(screen.getByTestId('server-settings-modal')).toBeInTheDocument();
      const input = screen.getByTestId('backend-url-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'https://test-manga-backend.hf.space' } });

      const testBtn = screen.getByTestId('test-connection-btn');
      fireEvent.click(testBtn);

      await waitFor(() => {
        expect(screen.getByTestId('connection-status-banner')).toHaveTextContent(/Connection Successful/i);
      });
    });
  });

  describe('TopToolbar Phase 2 Actions', () => {
    it('renders OCR, Erase, Layer and Reading order buttons', async () => {
      // Seed a project and page
      const projectId = 'proj-p2-test';
      const chapterId = 'chap-p2-test';
      const pageId = 'page-p2-test';

      await db.projects.add({
        id: projectId,
        name: 'Phase 2 Test Project',
        sourceLanguage: 'ja',
        targetLanguage: 'vi',
        status: 'draft',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await db.chapters.add({
        id: chapterId,
        projectId,
        title: 'Chapter 1',
        chapterNumber: 1,
        order: 1,
        pageCount: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const fakePngBlob = new Blob(['png data'], { type: 'image/png' });
      await db.pages.add({
        id: pageId,
        projectId,
        chapterId,
        pageNumber: 1,
        fileName: 'page01.png',
        fileSize: 1024,
        mimeType: 'image/png',
        width: 800,
        height: 1200,
        sourceBlob: fakePngBlob,
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      useStudioStore.getState().setActiveProject(projectId);
      useStudioStore.getState().setActiveChapter(chapterId);
      useStudioStore.getState().setActivePage(pageId);

      render(<TopToolbar />);

      expect(screen.getByTestId('run-ocr-btn')).toBeInTheDocument();
      expect(screen.getByTestId('run-inpaint-btn')).toBeInTheDocument();
      expect(screen.getByTestId('reading-order-toggle')).toHaveTextContent(/RTL \(Manga\)/i);
      expect(screen.getByTestId('layer-original-btn')).toBeInTheDocument();
      expect(screen.getByTestId('layer-cleaned-btn')).toBeInTheDocument();

      // Toggle reading order
      fireEvent.click(screen.getByTestId('reading-order-toggle'));
      expect(screen.getByTestId('reading-order-toggle')).toHaveTextContent(/LTR \(Webtoon\)/i);
    });

    it('triggers OCR workflow and populates Dexie textRegions table', async () => {
      const projectId = 'proj-ocr-1';
      const chapterId = 'chap-ocr-1';
      const pageId = 'page-ocr-1';

      await db.pages.add({
        id: pageId,
        projectId,
        chapterId,
        pageNumber: 1,
        fileName: 'test.png',
        fileSize: 500,
        mimeType: 'image/png',
        width: 400,
        height: 600,
        sourceBlob: new Blob(['test image'], { type: 'image/png' }),
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      useStudioStore.getState().setActivePage(pageId);

      vi.spyOn(api, 'detectOCR').mockResolvedValueOnce({
        regions: [
          {
            id: 'ocr-bubble-1',
            polygon: [[10, 10], [100, 10], [100, 80], [10, 80]],
            bounding_box: { x: 10, y: 10, width: 90, height: 70 },
            text: 'Hello Comic World',
            confidence: 0.98,
            orientation: 'horizontal',
            reading_order: 1,
          },
        ],
        engine: 'rapidocr',
        detected_languages: ['en'],
        reading_order: 'rtl',
        image_width: 400,
        image_height: 600,
        processing_time_ms: 25,
      });

      render(<TopToolbar />);

      await waitFor(() => {
        expect(screen.getByTestId('run-ocr-btn')).not.toBeDisabled();
      });

      const ocrBtn = screen.getByTestId('run-ocr-btn');
      fireEvent.click(ocrBtn);

      await waitFor(async () => {
        const storedRegions = await db.textRegions.where('pageId').equals(pageId).toArray();
        expect(storedRegions).toHaveLength(1);
        expect(storedRegions[0].sourceText).toBe('Hello Comic World');
        expect(storedRegions[0].confidence).toBe(0.98);
        expect(storedRegions[0].status).toBe('detected');
      });

      const updatedPage = await db.pages.get(pageId);
      expect(updatedPage?.status).toBe('ocr_completed');
    });
  });

  describe('PropertiesPanel Confidence & Single Bubble Inpainting', () => {
    it('displays OCR confidence badge and mask dilation slider', async () => {
      const pageId = 'page-prop-test';
      const regionId = 'reg-prop-test';

      await db.pages.add({
        id: pageId,
        projectId: 'proj-1',
        chapterId: 'chap-1',
        pageNumber: 1,
        fileName: 'page.png',
        fileSize: 2048,
        mimeType: 'image/png',
        width: 600,
        height: 800,
        sourceBlob: new Blob(['data'], { type: 'image/png' }),
        status: 'ocr_completed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await db.textRegions.add({
        id: regionId,
        pageId,
        projectId: 'proj-1',
        box: { x: 50, y: 50, width: 120, height: 80 },
        sourceText: 'Original Japanese Text',
        translatedText: '',
        confidence: 0.92,
        status: 'detected',
        orderIndex: 1,
        readingDirection: 'vertical',
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
      });

      useStudioStore.getState().setActivePage(pageId);
      useStudioStore.getState().setSelectedRegion(regionId);

      render(<PropertiesPanel />);

      await waitFor(() => {
        expect(screen.getByTestId('region-confidence-badge')).toHaveTextContent('92% confidence');
      });

      expect(screen.getByTestId('erase-single-bubble-btn')).toBeInTheDocument();
      expect(screen.getByTestId('mask-dilation-slider')).toBeInTheDocument();
    });
  });

  describe('ImageCanvas Split Comparison Mode', () => {
    it('renders split slider handle when activeLayer is split and cleanedBlob exists', async () => {
      const pageId = 'page-split-test';
      const fakeBlob = new Blob(['data'], { type: 'image/png' });
      const cleanedBlob = new Blob(['cleaned data'], { type: 'image/png' });

      await db.pages.add({
        id: pageId,
        projectId: 'proj-1',
        chapterId: 'chap-1',
        pageNumber: 1,
        fileName: 'split_test.png',
        fileSize: 1024,
        mimeType: 'image/png',
        width: 800,
        height: 1200,
        sourceBlob: fakeBlob,
        cleanedBlob: cleanedBlob,
        status: 'ocr_completed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      useStudioStore.getState().setActivePage(pageId);
      useStudioStore.getState().setActiveLayer('split');

      render(<ImageCanvas pageId={pageId} />);

      await waitFor(() => {
        expect(screen.getByTestId('split-slider-handle')).toBeInTheDocument();
        expect(screen.getByTestId('canvas-split-cleaned-layer')).toBeInTheDocument();
      });
    });
  });
});
