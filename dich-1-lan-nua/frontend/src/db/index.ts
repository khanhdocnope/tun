import Dexie, { Table } from 'dexie';
import { Project, Chapter, Page } from '../types/project';
import { TextRegion, HistorySnapshot, AppSettings } from '../types/region';

export class ComicTranslationStudioDB extends Dexie {
  projects!: Table<Project, string>;
  chapters!: Table<Chapter, string>;
  pages!: Table<Page, string>;
  textRegions!: Table<TextRegion, string>;
  historySnapshots!: Table<HistorySnapshot, string>;
  appSettings!: Table<AppSettings, string>;

  constructor() {
    super('ComicTranslationStudioDB');
    this.version(1).stores({
      projects: 'id, name, createdAt, updatedAt, status',
      chapters: 'id, projectId, order, createdAt',
      pages: 'id, chapterId, projectId, pageNumber, status, createdAt',
      textRegions: 'id, pageId, projectId, status, orderIndex, updatedAt',
      historySnapshots: 'id, pageId, timestamp',
      appSettings: 'id',
    });
  }

  /**
   * Helper to clear all data in the database (useful for testing and reset)
   */
  async clearAllTables(): Promise<void> {
    await this.projects.clear();
    await this.chapters.clear();
    await this.pages.clear();
    await this.textRegions.clear();
    await this.historySnapshots.clear();
    await this.appSettings.clear();
  }
}

export const db = new ComicTranslationStudioDB();

export async function clearAllTables(): Promise<void> {
  return db.clearAllTables();
}
