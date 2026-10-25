import JSZip from 'jszip';
import { db } from './index';
import { Project, Chapter, Page } from '../types/project';

/**
 * Robust UUID v4 generator working in both browser and node/jsdom environments
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Natural alphanumeric comparator for filenames (e.g., 'page_2.png' before 'page_10.png')
 */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Sorts an array of filenames using natural alphanumeric collation
 */
export function sortFilenamesNaturally(filenames: string[]): string[] {
  return [...filenames].sort(naturalCompare);
}

/**
 * Helper to convert Blob to ArrayBuffer across all browser and test environments
 */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return await blob.arrayBuffer();
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error || new Error('Failed to read blob'));
      reader.readAsArrayBuffer(blob);
    });
  }
  throw new Error('FileReader or blob.arrayBuffer not available');
}

/**
 * Extracts native image dimensions directly from binary header bytes or fallbacks.
 * Accurately parses PNG, JPEG, and WebP binaries in Node, JSDOM, or real browsers.
 */
export async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const arrayBuffer = await blobToArrayBuffer(blob);
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);


    // 1. PNG Header: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes.length >= 24 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      const width = view.getUint32(16, false);
      const height = view.getUint32(20, false);
      if (width > 0 && height > 0) return { width, height };
    }

    // 2. JPEG Header: FF D8
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      while (offset < bytes.length - 8) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1];
        // SOF markers
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          const height = view.getUint16(offset + 5, false);
          const width = view.getUint16(offset + 7, false);
          if (width > 0 && height > 0) return { width, height };
        }
        if (marker === 0xda || marker === 0xd9) {
          break;
        }
        const length = view.getUint16(offset + 2, false);
        offset += 2 + length;
      }
    }

    // 3. WebP Header: RIFF....WEBP
    if (
      bytes.length >= 30 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // WEBP
    ) {
      const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
      if (type === 'VP8 ' && bytes.length >= 30) {
        const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
        const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
        if (width > 0 && height > 0) return { width, height };
      } else if (type === 'VP8L' && bytes.length >= 25) {
        const b0 = bytes[21];
        const b1 = bytes[22];
        const b2 = bytes[23];
        const b3 = bytes[24];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + ((((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)));
        if (width > 0 && height > 0) return { width, height };
      } else if (type === 'VP8X' && bytes.length >= 30) {
        const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        if (width > 0 && height > 0) return { width, height };
      }
    }
  } catch {
    // ignore binary parse failure and try fallbacks
  }


  // 4. Fallback to createImageBitmap
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      const { width, height } = bitmap;
      if (typeof bitmap.close === 'function') bitmap.close();
      if (width > 0 && height > 0) return { width, height };
    } catch {
      // ignore
    }
  }

  // 5. Fallback to Image element in browser
  if (typeof window !== 'undefined' && typeof window.Image !== 'undefined') {
    try {
      const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('Image decode error'));
        };
        img.src = url;
      });
      if (dims.width > 0 && dims.height > 0) return dims;
    } catch {
      // ignore
    }
  }

  return { width: 800, height: 1200 };
}

/**
 * Determine MIME type from filename extension or blob type
 */
export function inferMimeType(fileName: string, fallbackType?: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (fallbackType === 'image/jpeg' || fallbackType === 'image/webp') return fallbackType;
  return 'image/png';
}

/* ========================================================================= */
/*                              PROJECT CRUD                                 */
/* ========================================================================= */

export async function createProject(data: {
  name: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}): Promise<Project> {
  const trimmed = data.name.trim();
  if (!trimmed) {
    throw new Error('Project name cannot be empty');
  }

  const project: Project = {
    id: generateUUID(),
    name: trimmed,
    sourceLanguage: data.sourceLanguage || 'ja',
    targetLanguage: data.targetLanguage || 'vi',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'draft',
  };

  await db.projects.add(project);
  return project;
}

export async function updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
  await db.projects.update(projectId, {
    ...updates,
    updatedAt: Date.now(),
  });
}

/**
 * Cascading delete: deletes project, all chapters, all pages, all text regions, and history snapshots
 */
export async function deleteProject(projectId: string): Promise<void> {
  await db.transaction('rw', [
    db.projects,
    db.chapters,
    db.pages,
    db.textRegions,
    db.historySnapshots,
  ], async () => {
    // 1. Find all pages in this project
    const pages = await db.pages.where('projectId').equals(projectId).toArray();
    const pageIds = pages.map((p) => p.id);

    // 2. Cascade delete text regions & history snapshots
    if (pageIds.length > 0) {
      await db.textRegions.where('pageId').anyOf(pageIds).delete();
      await db.historySnapshots.where('pageId').anyOf(pageIds).delete();
    }
    await db.textRegions.where('projectId').equals(projectId).delete();

    // 3. Cascade delete pages
    await db.pages.where('projectId').equals(projectId).delete();

    // 4. Cascade delete chapters
    await db.chapters.where('projectId').equals(projectId).delete();

    // 5. Delete project
    await db.projects.delete(projectId);
  });
}

/* ========================================================================= */
/*                              CHAPTER CRUD                                 */
/* ========================================================================= */

export async function createChapter(
  projectId: string,
  title?: string,
  chapterNumber?: number
): Promise<Chapter> {
  const project = await db.projects.get(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const existingChapters = await db.chapters.where('projectId').equals(projectId).toArray();
  const nextNumber = chapterNumber ?? (existingChapters.length + 1);
  const nextOrder = existingChapters.length + 1;

  const chapter: Chapter = {
    id: generateUUID(),
    projectId,
    title: title || `Chapter ${nextNumber}`,
    chapterNumber: nextNumber,
    order: nextOrder,
    pageCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.chapters.add(chapter);
  await db.projects.update(projectId, { updatedAt: Date.now() });
  return chapter;
}

export async function updateChapter(chapterId: string, updates: Partial<Chapter>): Promise<void> {
  await db.chapters.update(chapterId, {
    ...updates,
    updatedAt: Date.now(),
  });
}

/**
 * Cascading delete: deletes chapter, all its pages, text regions, and history snapshots
 */
export async function deleteChapter(chapterId: string): Promise<void> {
  await db.transaction('rw', [
    db.projects,
    db.chapters,
    db.pages,
    db.textRegions,
    db.historySnapshots,
  ], async () => {
    const chapter = await db.chapters.get(chapterId);
    if (!chapter) return;

    // Find all pages in this chapter
    const pages = await db.pages.where('chapterId').equals(chapterId).toArray();
    const pageIds = pages.map((p) => p.id);

    if (pageIds.length > 0) {
      await db.textRegions.where('pageId').anyOf(pageIds).delete();
      await db.historySnapshots.where('pageId').anyOf(pageIds).delete();
      await db.pages.where('chapterId').equals(chapterId).delete();
    }

    await db.chapters.delete(chapterId);
    await db.projects.update(chapter.projectId, { updatedAt: Date.now() });
  });
}

/* ========================================================================= */
/*                              PAGE OPERATIONS                              */
/* ========================================================================= */

/**
 * Cascading delete: deletes page, its associated text regions and history snapshots,
 * and re-sequences remaining pages in chapter to maintain contiguous pageNumbers.
 */
export async function deletePage(pageId: string): Promise<void> {
  await db.transaction('rw', [
    db.chapters,
    db.pages,
    db.textRegions,
    db.historySnapshots,
  ], async () => {
    const page = await db.pages.get(pageId);
    if (!page) return;

    // Delete associated regions and history
    await db.textRegions.where('pageId').equals(pageId).delete();
    await db.historySnapshots.where('pageId').equals(pageId).delete();

    // Delete the page
    await db.pages.delete(pageId);

    // Re-sequence remaining pages
    const remainingPages = await db.pages.where('chapterId').equals(page.chapterId).sortBy('pageNumber');
    for (let i = 0; i < remainingPages.length; i++) {
      if (remainingPages[i].pageNumber !== i + 1) {
        await db.pages.update(remainingPages[i].id, {
          pageNumber: i + 1,
          updatedAt: Date.now(),
        });
      }
    }

    // Update chapter page count
    await db.chapters.update(page.chapterId, {
      pageCount: remainingPages.length,
      updatedAt: Date.now(),
    });
  });
}

/**
 * Reorder pages within a chapter and update sequential pageNumbers (1-based)
 */
export async function reorderPages(chapterId: string, orderedPageIds: string[]): Promise<void> {
  await db.transaction('rw', [db.chapters, db.pages], async () => {
    for (let index = 0; index < orderedPageIds.length; index++) {
      const pageId = orderedPageIds[index];
      await db.pages.update(pageId, {
        pageNumber: index + 1,
        updatedAt: Date.now(),
      });
    }

    await db.chapters.update(chapterId, {
      updatedAt: Date.now(),
    });
  });
}

/* ========================================================================= */
/*                             IMAGE & ZIP IMPORT                            */
/* ========================================================================= */

/**
 * Import a single image file or Blob into a chapter
 */
export async function importSingleImage(
  chapterId: string,
  file: File | Blob,
  fileName?: string
): Promise<Page> {
  const pages = await importImages(chapterId, [file], fileName ? [fileName] : undefined);
  return pages[0];
}

/**
 * Import multiple image files or Blobs into a chapter
 */
export async function importImages(
  chapterId: string,
  files: (File | Blob)[],
  fileNames?: string[]
): Promise<Page[]> {
  const chapter = await db.chapters.get(chapterId);
  if (!chapter) {
    throw new Error(`Chapter ${chapterId} not found`);
  }

  const existingPages = await db.pages.where('chapterId').equals(chapterId).toArray();
  let nextPageNumber = existingPages.length + 1;

  const newPages: Page[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const defaultName = file instanceof File ? file.name : `page_${nextPageNumber}.png`;
    const resolvedName = fileNames && fileNames[i] ? fileNames[i] : defaultName;
    const mimeType = inferMimeType(resolvedName, file.type);
    const { width, height } = await getImageDimensions(file);

    const page: Page = {
      id: generateUUID(),
      chapterId: chapter.id,
      projectId: chapter.projectId,
      pageNumber: nextPageNumber++,
      fileName: resolvedName,
      fileSize: file.size,
      mimeType,
      width,
      height,
      sourceBlob: file,
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    newPages.push(page);
  }

  await db.transaction('rw', [db.pages, db.chapters, db.projects], async () => {
    await db.pages.bulkAdd(newPages);
    await db.chapters.update(chapterId, {
      pageCount: existingPages.length + newPages.length,
      updatedAt: Date.now(),
    });

    // If project has no cover, set coverPageId to first page
    const project = await db.projects.get(chapter.projectId);
    if (project && !project.coverPageId && newPages.length > 0) {
      await db.projects.update(project.id, {
        coverPageId: newPages[0].id,
        updatedAt: Date.now(),
      });
    }
  });

  return newPages;
}

/**
 * Import a ZIP archive using JSZip:
 * - Filters out __MACOSX, .DS_Store, Thumbs.db, desktop.ini, and non-image files
 * - Natural alphanumeric sort so page_2.png comes before page_10.png
 * - Persists pages into Dexie with native dimensions
 */
export async function importZipArchive(
  chapterId: string,
  zipFile: File | Blob
): Promise<Page[]> {
  const chapter = await db.chapters.get(chapterId);
  if (!chapter) {
    throw new Error(`Chapter ${chapterId} not found`);
  }

  const zip = await JSZip.loadAsync(zipFile);
  const validImageRegex = /\.(png|jpe?g|webp)$/i;

  interface ZipEntryMeta {
    fullPath: string;
    baseName: string;
    entry: JSZip.JSZipObject;
  }

  const candidateEntries: ZipEntryMeta[] = [];

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;

    // Filter out macOS hidden paths, .DS_Store, Thumbs.db
    if (
      relativePath.includes('__MACOSX') ||
      relativePath.includes('/.') ||
      relativePath.startsWith('.') ||
      relativePath.endsWith('.DS_Store') ||
      relativePath.endsWith('Thumbs.db') ||
      relativePath.endsWith('desktop.ini')
    ) {
      return;
    }

    if (validImageRegex.test(relativePath)) {
      const baseName = relativePath.split('/').pop() || relativePath;
      candidateEntries.push({
        fullPath: relativePath,
        baseName,
        entry,
      });
    }
  });

  if (candidateEntries.length === 0) {
    throw new Error('No valid comic images (PNG, JPEG, WebP) found in ZIP archive');
  }

  // Sort candidate entries using natural alphanumeric collation on baseName (or fullPath)
  candidateEntries.sort((a, b) => naturalCompare(a.baseName, b.baseName));

  const blobs: Blob[] = [];
  const names: string[] = [];

  for (const item of candidateEntries) {
    const mimeType = inferMimeType(item.baseName);
    const blob = await item.entry.async('blob');
    // Ensure blob has correct MIME type
    const typedBlob = blob.type ? blob : new Blob([blob], { type: mimeType });
    blobs.push(typedBlob);
    names.push(item.baseName);
  }

  return importImages(chapterId, blobs, names);
}

/**
 * Universal importer handling individual images, multiple images, and ZIP archives
 */
export async function importFiles(
  chapterId: string,
  files: (File | Blob)[]
): Promise<Page[]> {
  const importedPages: Page[] = [];

  for (const file of files) {
    const isZip =
      (file instanceof File && (file.name.toLowerCase().endsWith('.zip') || file.type.includes('zip'))) ||
      file.type === 'application/zip' ||
      file.type === 'application/x-zip-compressed';

    if (isZip) {
      const zipPages = await importZipArchive(chapterId, file);
      importedPages.push(...zipPages);
    } else {
      const name = file instanceof File ? file.name : undefined;
      const page = await importSingleImage(chapterId, file, name);
      importedPages.push(page);
    }
  }

  return importedPages;
}
