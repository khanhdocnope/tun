export interface MangaItem {
  id: string;
  title: string;
  cover_url: string;
  source: string;
  description?: string;
  authors: string[];
  status?: string;
  genres: string[];
}

export interface ChapterItem {
  id: string;
  manga_id: string;
  chapter_number: number;
  title: string;
  source: string;
  language: string;
}

export interface PageItem {
  page_number: number;
  url: string;
}

export type DownloadStatus = 'queued' | 'downloading' | 'packaging' | 'completed' | 'failed' | 'cancelled';

export interface DownloadTask {
  id: string;
  manga_id: string;
  manga_title: string;
  chapter_id: string;
  chapter_title: string;
  status: DownloadStatus;
  total_pages: number;
  downloaded_pages: number;
  file_format: string;
  error_message?: string;
}

export interface LibraryBook {
  file_name: string;
  file_path: string;
  manga_title: string;
  chapter_title: string;
  total_pages: number;
  cover_base64?: string;
  file_format: string;
}

export interface AppSettings {
  download_dir: string;
  max_concurrent_chapters: number;
  max_connections_per_host: number;
  preferred_format: string;
  hf_space_url: string;
  hf_token?: string;
  reader_mode: 'webtoon' | 'manga';
  cleaner_mode: CleanerMode;
  auto_prefer_local: boolean;
  local_model_dir?: string | null;
  cloud_timeout_secs: number;
}

export type CleanerMode = 'auto' | 'cloud' | 'local';

export interface CleanerStatus {
  mode: CleanerMode;
  cloud_available: boolean;
  local_available: boolean;
}

export interface CleanRequest {
  image_base64: string;
  detector: string;
  inpainter: string;
  dilation_offset: number;
  clean_mode: string;
  max_dim?: number | null;
}

export interface CleanResponse {
  cleaned_image_base64: string;
  time_taken?: string;
  backend?: 'cloud' | 'local' | null;
  mime?: string | null;
}

export interface SourceInfo {
  id: string;
  name: string;
  url: string;
  language: string;
  is_custom: boolean;
}

export interface SourceCatalogEntry {
  id: string;
  name: string;
  url: string;
  template: string;
  languages: string[];
  tags: string[];
}

