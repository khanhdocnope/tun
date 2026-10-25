import { describe, it, expect, beforeEach } from 'vitest';
import {
  createHistoryStack,
  pushState,
  undo,
  redo,
  canUndo,
  canRedo,
  clearHistory,
  getHistoryDepth,
  createCommandHistory,
  recordCommand,
  popUndoCommand,
  popRedoCommand,
  canUndoCommand,
  canRedoCommand,
} from '../utils/history';
import { useHistoryStore } from '../store/useHistoryStore';
import { db } from '../db';
import { TextRegion } from '../types/region';

describe('Undo / Redo History Stack', () => {
  beforeEach(async () => {
    await db.clearAllTables();
    useHistoryStore.setState({ pageHistories: {} });
  });

  describe('Pure State-Based History Stack', () => {
    it('initializes with empty past and future, and given present state', () => {
      const stack = createHistoryStack<string>('initial');
      expect(stack.present).toBe('initial');
      expect(stack.past).toEqual([]);
      expect(stack.future).toEqual([]);
      expect(canUndo(stack)).toBe(false);
      expect(canRedo(stack)).toBe(false);
      expect(getHistoryDepth(stack)).toEqual({ past: 0, future: 0, total: 1 });
    });

    it('pushes states and handles single-step undo and redo', () => {
      let stack = createHistoryStack<number>(1);
      stack = pushState(stack, 2);
      stack = pushState(stack, 3);

      expect(stack.present).toBe(3);
      expect(stack.past).toEqual([1, 2]);
      expect(stack.future).toEqual([]);
      expect(canUndo(stack)).toBe(true);
      expect(canRedo(stack)).toBe(false);

      // Undo to 2
      stack = undo(stack);
      expect(stack.present).toBe(2);
      expect(stack.past).toEqual([1]);
      expect(stack.future).toEqual([3]);
      expect(canUndo(stack)).toBe(true);
      expect(canRedo(stack)).toBe(true);

      // Undo to 1
      stack = undo(stack);
      expect(stack.present).toBe(1);
      expect(stack.past).toEqual([]);
      expect(stack.future).toEqual([2, 3]);
      expect(canUndo(stack)).toBe(false);
      expect(canRedo(stack)).toBe(true);

      // Undo past boundary is no-op
      const atBoundary = undo(stack);
      expect(atBoundary).toBe(stack);

      // Redo back to 2
      stack = redo(stack);
      expect(stack.present).toBe(2);
      expect(stack.past).toEqual([1]);
      expect(stack.future).toEqual([3]);

      // Redo back to 3
      stack = redo(stack);
      expect(stack.present).toBe(3);
      expect(stack.past).toEqual([1, 2]);
      expect(stack.future).toEqual([]);

      // Redo past boundary is no-op
      const atFutureBoundary = redo(stack);
      expect(atFutureBoundary).toBe(stack);
    });

    it('prunes future history branch when new action is taken after undo', () => {
      let stack = createHistoryStack<string>('State A');
      stack = pushState(stack, 'State B');
      stack = pushState(stack, 'State C');

      // Undo to State B
      stack = undo(stack);
      expect(stack.present).toBe('State B');
      expect(stack.future).toEqual(['State C']);

      // Perform a new branching edit State D
      stack = pushState(stack, 'State D');
      expect(stack.present).toBe('State D');
      expect(stack.past).toEqual(['State A', 'State B']);
      // State C must be pruned
      expect(stack.future).toEqual([]);
      expect(canRedo(stack)).toBe(false);

      // Undo now leads back to State B, not State C
      stack = undo(stack);
      expect(stack.present).toBe('State B');
    });

    it('enforces maximum depth limit (>= 50 operations) and trims oldest history', () => {
      const maxDepth = 50;
      let stack = createHistoryStack<number>(0, maxDepth);

      // Push 75 operations
      for (let i = 1; i <= 75; i++) {
        stack = pushState(stack, i);
      }

      expect(stack.present).toBe(75);
      expect(stack.past.length).toBe(maxDepth); // exactly 50
      // Oldest 25 operations (0..24) should have been pruned
      expect(stack.past[0]).toBe(25);
      expect(stack.past[stack.past.length - 1]).toBe(74);

      // Can undo exactly 50 times back to 25
      for (let i = 0; i < maxDepth; i++) {
        expect(canUndo(stack)).toBe(true);
        stack = undo(stack);
      }

      expect(stack.present).toBe(25);
      expect(canUndo(stack)).toBe(false);
    });

    it('clears past and future history while retaining present state', () => {
      let stack = createHistoryStack<string>('v1');
      stack = pushState(stack, 'v2');
      stack = pushState(stack, 'v3');
      stack = undo(stack); // present: 'v2', past: ['v1'], future: ['v3']

      stack = clearHistory(stack);
      expect(stack.present).toBe('v2');
      expect(stack.past).toEqual([]);
      expect(stack.future).toEqual([]);
      expect(canUndo(stack)).toBe(false);
      expect(canRedo(stack)).toBe(false);
    });
  });

  describe('Command / Snapshot-Based History', () => {
    it('records commands and pops undo and redo correctly', () => {
      let history = createCommandHistory<{ count: number }>(50);
      expect(canUndoCommand(history)).toBe(false);
      expect(canRedoCommand(history)).toBe(false);

      // Record command 1
      history = recordCommand(history, {
        id: 'cmd-1',
        actionType: 'ADD_REGION',
        before: { count: 0 },
        after: { count: 1 },
        timestamp: Date.now(),
      });

      // Record command 2
      history = recordCommand(history, {
        id: 'cmd-2',
        actionType: 'UPDATE_REGION',
        before: { count: 1 },
        after: { count: 2 },
        timestamp: Date.now(),
      });

      expect(canUndoCommand(history)).toBe(true);
      expect(history.undoStack.length).toBe(2);

      // Pop undo for command 2
      const undo1 = popUndoCommand(history);
      expect(undo1).not.toBeNull();
      expect(undo1!.command.id).toBe('cmd-2');
      history = undo1!.history;
      expect(canRedoCommand(history)).toBe(true);

      // Pop redo for command 2
      const redo1 = popRedoCommand(history);
      expect(redo1).not.toBeNull();
      expect(redo1!.command.id).toBe('cmd-2');
      history = redo1!.history;
      expect(canRedoCommand(history)).toBe(false);
    });

    it('prunes redo stack on new command after undo', () => {
      let history = createCommandHistory<string>(50);
      history = recordCommand(history, {
        id: '1',
        actionType: 'A',
        before: 'none',
        after: 'first',
        timestamp: 1,
      });
      history = recordCommand(history, {
        id: '2',
        actionType: 'B',
        before: 'first',
        after: 'second',
        timestamp: 2,
      });

      const undoRes = popUndoCommand(history);
      history = undoRes!.history;
      expect(history.redoStack.length).toBe(1);

      // New action taken
      history = recordCommand(history, {
        id: '3',
        actionType: 'C',
        before: 'first',
        after: 'third',
        timestamp: 3,
      });

      expect(history.redoStack.length).toBe(0);
      expect(canRedoCommand(history)).toBe(false);
    });

    it('trims undoStack when exceeding max depth', () => {
      const maxDepth = 50;
      let history = createCommandHistory<number>(maxDepth);

      for (let i = 1; i <= 60; i++) {
        history = recordCommand(history, {
          id: `cmd-${i}`,
          actionType: 'EDIT',
          before: i - 1,
          after: i,
          timestamp: i,
        });
      }

      expect(history.undoStack.length).toBe(maxDepth);
      expect(history.undoStack[0].id).toBe('cmd-11');
      expect(history.undoStack[history.undoStack.length - 1].id).toBe('cmd-60');
    });
  });

  describe('Dexie Integration with useHistoryStore', () => {
    const pageId = 'page-123';
    const sampleRegion1: TextRegion = {
      id: 'region-1',
      pageId,
      projectId: 'proj-1',
      box: { x: 10, y: 10, width: 100, height: 50 },
      sourceText: 'Hello',
      translatedText: 'Xin chào',
      confidence: 1.0,
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

    const sampleRegion2: TextRegion = {
      ...sampleRegion1,
      id: 'region-2',
      box: { x: 200, y: 300, width: 80, height: 40 },
      sourceText: 'World',
      translatedText: 'Thế giới',
      orderIndex: 2,
    };

    it('records region snapshot, persists to Dexie, and performs undo/redo rollback', async () => {
      const store = useHistoryStore.getState();

      // Initially no regions in db
      await db.textRegions.where('pageId').equals(pageId).delete();

      // Action 1: Add region 1
      await db.textRegions.add(sampleRegion1);
      await store.recordSnapshot(pageId, 'ADD_REGION', [], [sampleRegion1]);

      expect(useHistoryStore.getState().canUndo(pageId)).toBe(true);
      expect(useHistoryStore.getState().canRedo(pageId)).toBe(false);

      // Verify Dexie db has region 1
      let dbRegions = await db.textRegions.where('pageId').equals(pageId).toArray();
      expect(dbRegions.length).toBe(1);
      expect(dbRegions[0].id).toBe('region-1');

      // Verify snapshot in Dexie
      const snapshots = await db.historySnapshots.where('pageId').equals(pageId).toArray();
      expect(snapshots.length).toBe(1);
      expect(snapshots[0].actionType).toBe('ADD_REGION');

      // Action 2: Add region 2
      await db.textRegions.add(sampleRegion2);
      await store.recordSnapshot(pageId, 'ADD_REGION', [sampleRegion1], [sampleRegion1, sampleRegion2]);

      dbRegions = await db.textRegions.where('pageId').equals(pageId).toArray();
      expect(dbRegions.length).toBe(2);

      // Undo Action 2: Should revert to [sampleRegion1]
      const undoSuccess2 = await useHistoryStore.getState().undo(pageId);
      expect(undoSuccess2).toBe(true);
      expect(useHistoryStore.getState().canRedo(pageId)).toBe(true);

      dbRegions = await db.textRegions.where('pageId').equals(pageId).toArray();
      expect(dbRegions.length).toBe(1);
      expect(dbRegions[0].id).toBe('region-1');

      // Undo Action 1: Should revert to []
      const undoSuccess1 = await useHistoryStore.getState().undo(pageId);
      expect(undoSuccess1).toBe(true);
      expect(useHistoryStore.getState().canUndo(pageId)).toBe(false);

      dbRegions = await db.textRegions.where('pageId').equals(pageId).toArray();
      expect(dbRegions.length).toBe(0);

      // Redo Action 1: Should restore [sampleRegion1]
      const redoSuccess1 = await useHistoryStore.getState().redo(pageId);
      expect(redoSuccess1).toBe(true);
      expect(useHistoryStore.getState().canUndo(pageId)).toBe(true);

      dbRegions = await db.textRegions.where('pageId').equals(pageId).toArray();
      expect(dbRegions.length).toBe(1);
      expect(dbRegions[0].id).toBe('region-1');

      // Redo Action 2: Should restore [sampleRegion1, sampleRegion2]
      const redoSuccess2 = await useHistoryStore.getState().redo(pageId);
      expect(redoSuccess2).toBe(true);
      expect(useHistoryStore.getState().canRedo(pageId)).toBe(false);

      dbRegions = await db.textRegions.where('pageId').equals(pageId).toArray();
      expect(dbRegions.length).toBe(2);
    });

    it('loads history from Dexie into store', async () => {
      // Direct insertion into db.historySnapshots
      const snap = {
        id: 'snap-custom',
        pageId,
        actionType: 'ADD_REGION' as const,
        undoPayload: { regionsBefore: [] },
        redoPayload: { regionsAfter: [sampleRegion1] },
        timestamp: 5000,
      };
      await db.historySnapshots.add(snap);

      await useHistoryStore.getState().loadHistory(pageId);
      expect(useHistoryStore.getState().canUndo(pageId)).toBe(true);
      expect(useHistoryStore.getState().canRedo(pageId)).toBe(false);
    });
  });
});
