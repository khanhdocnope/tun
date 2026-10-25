export const DEFAULT_MAX_HISTORY_DEPTH = 50;

/**
 * Generic state-based history stack supporting undo and redo.
 */
export interface HistoryStack<T> {
  past: T[];
  present: T;
  future: T[];
  maxDepth: number;
}

/**
 * Creates a new HistoryStack initialized with an initial state.
 */
export function createHistoryStack<T>(
  initialState: T,
  maxDepth = DEFAULT_MAX_HISTORY_DEPTH
): HistoryStack<T> {
  return {
    past: [],
    present: initialState,
    future: [],
    maxDepth: Math.max(1, maxDepth),
  };
}

/**
 * Pushes a new state onto the history stack:
 * - Appends current present to past
 * - Updates present to newState
 * - PRUNES future stack (standard branch pruning behavior)
 * - Enforces maxDepth by discarding oldest past entries if past.length > maxDepth
 */
export function pushState<T>(stack: HistoryStack<T>, newState: T): HistoryStack<T> {
  const newPast = [...stack.past, stack.present];
  const trimmedPast =
    newPast.length > stack.maxDepth
      ? newPast.slice(newPast.length - stack.maxDepth)
      : newPast;

  return {
    past: trimmedPast,
    present: newState,
    future: [], // Prune redo history on branching action
    maxDepth: stack.maxDepth,
  };
}

/**
 * Undoes the last action, moving backwards in history:
 * - Returns unchanged stack if cannot undo
 * - Pops previous state from past and sets it to present
 * - Pushes previous present onto the head of future
 */
export function undo<T>(stack: HistoryStack<T>): HistoryStack<T> {
  if (stack.past.length === 0) {
    return stack;
  }

  const previous = stack.past[stack.past.length - 1];
  const newPast = stack.past.slice(0, stack.past.length - 1);
  const newFuture = [stack.present, ...stack.future];

  return {
    past: newPast,
    present: previous,
    future: newFuture,
    maxDepth: stack.maxDepth,
  };
}

/**
 * Redoes the next action, moving forward in history:
 * - Returns unchanged stack if cannot redo
 * - Shifts next state from future and sets it to present
 * - Pushes previous present onto the end of past
 */
export function redo<T>(stack: HistoryStack<T>): HistoryStack<T> {
  if (stack.future.length === 0) {
    return stack;
  }

  const next = stack.future[0];
  const newFuture = stack.future.slice(1);
  const newPast = [...stack.past, stack.present];
  const trimmedPast =
    newPast.length > stack.maxDepth
      ? newPast.slice(newPast.length - stack.maxDepth)
      : newPast;

  return {
    past: trimmedPast,
    present: next,
    future: newFuture,
    maxDepth: stack.maxDepth,
  };
}

/**
 * Checks if undo is available
 */
export function canUndo<T>(stack: HistoryStack<T>): boolean {
  return stack.past.length > 0;
}

/**
 * Checks if redo is available
 */
export function canRedo<T>(stack: HistoryStack<T>): boolean {
  return stack.future.length > 0;
}

/**
 * Clears past and future history while retaining the current present state
 */
export function clearHistory<T>(stack: HistoryStack<T>): HistoryStack<T> {
  return {
    past: [],
    present: stack.present,
    future: [],
    maxDepth: stack.maxDepth,
  };
}

/**
 * Returns current depth statistics of the history stack
 */
export function getHistoryDepth<T>(stack: HistoryStack<T>): {
  past: number;
  future: number;
  total: number;
} {
  return {
    past: stack.past.length,
    future: stack.future.length,
    total: stack.past.length + stack.future.length + 1,
  };
}

/* ========================================================================= */
/*                   COMMAND / SNAPSHOT HISTORY UTILITIES                    */
/* ========================================================================= */

export interface CommandSnapshot<T> {
  id: string;
  actionType: string;
  before: T;
  after: T;
  timestamp: number;
}

export interface CommandHistory<T> {
  undoStack: CommandSnapshot<T>[];
  redoStack: CommandSnapshot<T>[];
  maxDepth: number;
}

/**
 * Creates an empty command history
 */
export function createCommandHistory<T>(
  maxDepth = DEFAULT_MAX_HISTORY_DEPTH
): CommandHistory<T> {
  return {
    undoStack: [],
    redoStack: [],
    maxDepth: Math.max(1, maxDepth),
  };
}

/**
 * Records a new command in the undo stack and clears redo stack (branch pruning).
 */
export function recordCommand<T>(
  history: CommandHistory<T>,
  command: CommandSnapshot<T>
): CommandHistory<T> {
  const newUndo = [...history.undoStack, command];
  const trimmedUndo =
    newUndo.length > history.maxDepth
      ? newUndo.slice(newUndo.length - history.maxDepth)
      : newUndo;

  return {
    undoStack: trimmedUndo,
    redoStack: [], // Branch pruning
    maxDepth: history.maxDepth,
  };
}

/**
 * Pops the top command from the undo stack and moves it to redo stack
 */
export function popUndoCommand<T>(
  history: CommandHistory<T>
): { command: CommandSnapshot<T>; history: CommandHistory<T> } | null {
  if (history.undoStack.length === 0) {
    return null;
  }

  const command = history.undoStack[history.undoStack.length - 1];
  const newUndo = history.undoStack.slice(0, history.undoStack.length - 1);
  const newRedo = [command, ...history.redoStack];

  return {
    command,
    history: {
      undoStack: newUndo,
      redoStack: newRedo,
      maxDepth: history.maxDepth,
    },
  };
}

/**
 * Pops the top command from the redo stack and moves it to undo stack
 */
export function popRedoCommand<T>(
  history: CommandHistory<T>
): { command: CommandSnapshot<T>; history: CommandHistory<T> } | null {
  if (history.redoStack.length === 0) {
    return null;
  }

  const command = history.redoStack[0];
  const newRedo = history.redoStack.slice(1);
  const newUndo = [...history.undoStack, command];
  const trimmedUndo =
    newUndo.length > history.maxDepth
      ? newUndo.slice(newUndo.length - history.maxDepth)
      : newUndo;

  return {
    command,
    history: {
      undoStack: trimmedUndo,
      redoStack: newRedo,
      maxDepth: history.maxDepth,
    },
  };
}

export function canUndoCommand<T>(history: CommandHistory<T>): boolean {
  return history.undoStack.length > 0;
}

export function canRedoCommand<T>(history: CommandHistory<T>): boolean {
  return history.redoStack.length > 0;
}
