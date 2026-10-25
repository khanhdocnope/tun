import { create } from 'zustand';
import { useEffect } from 'react';
import { db } from '../db';
import { generateUUID } from '../db/importExport';
import { HistoryActionType, HistorySnapshot, TextRegion } from '../types/region';
import { DEFAULT_MAX_HISTORY_DEPTH } from '../utils/history';

export interface PageHistory {
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
}

export interface HistoryState {
  pageHistories: Record<string, PageHistory>;

  // Actions
  recordSnapshot: (
    pageId: string,
    actionType: HistoryActionType,
    regionsBefore: TextRegion[],
    regionsAfter: TextRegion[]
  ) => Promise<HistorySnapshot>;
  undo: (pageId: string) => Promise<boolean>;
  redo: (pageId: string) => Promise<boolean>;
  canUndo: (pageId: string) => boolean;
  canRedo: (pageId: string) => boolean;
  clearHistory: (pageId: string) => Promise<void>;
  loadHistory: (pageId: string) => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  pageHistories: {},

  recordSnapshot: async (pageId, actionType, regionsBefore, regionsAfter) => {
    const snapshot: HistorySnapshot = {
      id: generateUUID(),
      pageId,
      actionType,
      undoPayload: {
        regionsBefore: JSON.parse(JSON.stringify(regionsBefore)),
      },
      redoPayload: {
        regionsAfter: JSON.parse(JSON.stringify(regionsAfter)),
      },
      timestamp: Date.now(),
    };

    // Save snapshot to Dexie
    await db.historySnapshots.add(snapshot);

    // Update in-memory state with branch pruning and max depth
    set((state) => {
      const currentHistory = state.pageHistories[pageId] || {
        undoStack: [],
        redoStack: [],
      };

      const newUndoStack = [...currentHistory.undoStack, snapshot];
      const trimmedUndoStack =
        newUndoStack.length > DEFAULT_MAX_HISTORY_DEPTH
          ? newUndoStack.slice(newUndoStack.length - DEFAULT_MAX_HISTORY_DEPTH)
          : newUndoStack;

      return {
        pageHistories: {
          ...state.pageHistories,
          [pageId]: {
            undoStack: trimmedUndoStack,
            redoStack: [], // Branch pruning: clear forward redo stack on new action
          },
        },
      };
    });

    return snapshot;
  },

  undo: async (pageId) => {
    const history = get().pageHistories[pageId];
    if (!history || history.undoStack.length === 0) {
      return false;
    }

    const snapshot = history.undoStack[history.undoStack.length - 1];
    const targetRegions = snapshot.undoPayload.regionsBefore;

    // Apply target regions to Dexie inside atomic transaction
    await db.transaction('rw', [db.textRegions], async () => {
      await db.textRegions.where('pageId').equals(pageId).delete();
      if (targetRegions.length > 0) {
        await db.textRegions.bulkAdd(targetRegions);
      }
    });

    // Move snapshot from undoStack to redoStack
    set((state) => {
      const pageHist = state.pageHistories[pageId];
      if (!pageHist) return state;

      const newUndo = pageHist.undoStack.slice(0, pageHist.undoStack.length - 1);
      const newRedo = [snapshot, ...pageHist.redoStack];

      return {
        pageHistories: {
          ...state.pageHistories,
          [pageId]: {
            undoStack: newUndo,
            redoStack: newRedo,
          },
        },
      };
    });

    return true;
  },

  redo: async (pageId) => {
    const history = get().pageHistories[pageId];
    if (!history || history.redoStack.length === 0) {
      return false;
    }

    const snapshot = history.redoStack[0];
    const targetRegions = snapshot.redoPayload.regionsAfter;

    // Apply target regions to Dexie inside atomic transaction
    await db.transaction('rw', [db.textRegions], async () => {
      await db.textRegions.where('pageId').equals(pageId).delete();
      if (targetRegions.length > 0) {
        await db.textRegions.bulkAdd(targetRegions);
      }
    });

    // Move snapshot from redoStack to undoStack
    set((state) => {
      const pageHist = state.pageHistories[pageId];
      if (!pageHist) return state;

      const newRedo = pageHist.redoStack.slice(1);
      const newUndo = [...pageHist.undoStack, snapshot];
      const trimmedUndo =
        newUndo.length > DEFAULT_MAX_HISTORY_DEPTH
          ? newUndo.slice(newUndo.length - DEFAULT_MAX_HISTORY_DEPTH)
          : newUndo;

      return {
        pageHistories: {
          ...state.pageHistories,
          [pageId]: {
            undoStack: trimmedUndo,
            redoStack: newRedo,
          },
        },
      };
    });

    return true;
  },

  canUndo: (pageId) => {
    const history = get().pageHistories[pageId];
    return !!history && history.undoStack.length > 0;
  },

  canRedo: (pageId) => {
    const history = get().pageHistories[pageId];
    return !!history && history.redoStack.length > 0;
  },

  clearHistory: async (pageId) => {
    await db.historySnapshots.where('pageId').equals(pageId).delete();
    set((state) => {
      const newHistories = { ...state.pageHistories };
      delete newHistories[pageId];
      return { pageHistories: newHistories };
    });
  },

  loadHistory: async (pageId) => {
    const snapshots = await db.historySnapshots
      .where('pageId')
      .equals(pageId)
      .sortBy('timestamp');

    const trimmed =
      snapshots.length > DEFAULT_MAX_HISTORY_DEPTH
        ? snapshots.slice(snapshots.length - DEFAULT_MAX_HISTORY_DEPTH)
        : snapshots;

    set((state) => ({
      pageHistories: {
        ...state.pageHistories,
        [pageId]: {
          undoStack: trimmed,
          redoStack: [],
        },
      },
    }));
  },
}));

/**
 * Hook to register global keyboard shortcuts:
 * - Ctrl+Z: Undo
 * - Ctrl+Y or Ctrl+Shift+Z: Redo
 * Ignores keystrokes when user is editing in text input/textarea.
 */
export function useHistoryHotkeys(pageId: string | null) {
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  useEffect(() => {
    if (!pageId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input or textarea or contenteditable element
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isModifierPressed = isMac ? e.metaKey : e.ctrlKey;

      if (!isModifierPressed) return;

      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          // Ctrl+Shift+Z => Redo
          void redo(pageId);
        } else {
          // Ctrl+Z => Undo
          void undo(pageId);
        }
      } else if (e.key.toLowerCase() === 'y') {
        // Ctrl+Y => Redo
        e.preventDefault();
        void redo(pageId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pageId, undo, redo]);
}
