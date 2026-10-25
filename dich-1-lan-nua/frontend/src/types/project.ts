export type ProjectStatus = 'draft' | 'in_progress' | 'completed';

export interface Project {
  id: string; // UUID v4
  name: string;
  sourceLanguage: string; // ISO 639-1: 'ja', 'ko', 'zh', 'en', etc.
  targetLanguage: string; // 'vi', 'en', etc.
  createdAt: number; // Timestamp ms
  updatedAt: number; // Timestamp ms
  coverPageId?: string;
  thumbnailDataUrl?: string;
  status: ProjectStatus;
}

export interface Chapter {
  id: string; // UUID v4
  projectId: string; // Foreign key -> Project.id
  title: string;
  chapterNumber: number;
  order: number;
  pageCount: number;
  createdAt: number;
  updatedAt: number;
}

export type PageStatus = 'idle' | 'processing' | 'ocr_completed' | 'translated' | 'error';

export interface Page {
  id: string; // UUID v4
  chapterId: string; // Foreign key -> Chapter.id
  projectId: string; // Foreign key -> Project.id
  pageNumber: number; // 1-indexed display order
  fileName: string;
  fileSize: number; // Bytes
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | string;
  width: number; // Native bitmap pixel width
  height: number; // Native bitmap pixel height
  sourceBlob: Blob; // Original binary stored in IndexedDB
  cleanedBlob?: Blob; // Inpainted/cleaned background binary
  thumbnailBlob?: Blob; // Downscaled preview binary
  status: PageStatus;
  createdAt: number;
  updatedAt: number;
}
