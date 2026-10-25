import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './index';
import { Project, Chapter, Page } from '../types/project';
import { TextRegion, AppSettings } from '../types/region';

/**
 * Live query hook for all projects ordered by most recently updated
 */
export function useProjects(): Project[] | undefined {
  return useLiveQuery(() => db.projects.orderBy('updatedAt').reverse().toArray());
}

/**
 * Live query hook for a specific project by ID
 */
export function useProject(projectId?: string | null): Project | undefined {
  return useLiveQuery(() => (projectId ? db.projects.get(projectId) : undefined), [projectId]);
}

/**
 * Live query hook for chapters within a project, ordered by chapter order
 */
export function useChapters(projectId?: string | null): Chapter[] | undefined {
  return useLiveQuery(
    () => (projectId ? db.chapters.where('projectId').equals(projectId).sortBy('order') : []),
    [projectId]
  );
}

/**
 * Live query hook for a specific chapter by ID
 */
export function useChapter(chapterId?: string | null): Chapter | undefined {
  return useLiveQuery(() => (chapterId ? db.chapters.get(chapterId) : undefined), [chapterId]);
}

/**
 * Live query hook for pages within a chapter, ordered by pageNumber
 */
export function usePages(chapterId?: string | null): Page[] | undefined {
  return useLiveQuery(
    () => (chapterId ? db.pages.where('chapterId').equals(chapterId).sortBy('pageNumber') : []),
    [chapterId]
  );
}

/**
 * Live query hook for a specific page by ID
 */
export function usePage(pageId?: string | null): Page | undefined {
  return useLiveQuery(() => (pageId ? db.pages.get(pageId) : undefined), [pageId]);
}

/**
 * Live query hook for text regions on a page, ordered by reading order
 */
export function useTextRegions(pageId?: string | null): TextRegion[] | undefined {
  return useLiveQuery(
    () => (pageId ? db.textRegions.where('pageId').equals(pageId).sortBy('orderIndex') : []),
    [pageId]
  );
}

/**
 * Live query hook for global app settings
 */
export function useAppSettings(): AppSettings | undefined {
  return useLiveQuery(() => db.appSettings.get('global_settings'));
}
