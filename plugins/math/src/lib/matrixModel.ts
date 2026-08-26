/**
 * Math — the Matrix tool's reducer (MATH5), pure so the rail, the editor and the compute line
 * are testable without React or a DOM.
 *
 * The wireframe's Matrix state in one object: a rail of named matrices, the one being edited,
 * the compute line with its inline error, and the shared result history. Three things are
 * worth knowing before reading it:
 *
 *  - **the chips and the line are the same action.** A quick-op chip writes its source into
 *    the compute line and submits it ({@link reduceMatrix}'s `quickOp`), so `det(A)` reaches
 *    the history by the same path a typed `det(A)` does. One history, one code path, and the
 *    line always shows what produced the top card.
 *  - **a failed compute is not history.** It sets `error`, which the compute row renders with
 *    the graphing rail's inline error treatment and the next keystroke clears. History holds
 *    results; a dimension mismatch is a response to a line, not a result.
 *  - **`→ C` reuses the naming rule.** The saved matrix takes the first free name, so it is
 *    the same `C` the button offered before it was pressed.
 *
 * `hydrated` mirrors the shell's `restored` and the other two tools' flags: storage resolves
 * asynchronously, so a restore landing *after* the user created a matrix or ran a line loses.
 */

import {
  DEFAULT_NEW_SIZE,
  QUICK_OPS,
  cellsToText,
  computeMatrix,
  createMatrix,
  isSavableResult,
  matrixFromResult,
  nextMatrixName,
  normalizeDim,
  resizeCells,
  resizeMatrix,
  setMatrixCell,
} from './matrix';
import type { MatrixDef, MatrixResult } from './matrix';

/**
 * How many results the history keeps. It is persisted, so it needs a bound — a matrix result
 * is a whole grid of numbers, which is why this is far shorter than the tape's.
 */
export const HISTORY_LIMIT = 50;

/** One card in the result list: the line that produced it, and what it produced. */
export interface ComputeEntry {
  id: string;
  src: string;
  result: MatrixResult;
}

export interface MatrixState {
  matrices: MatrixDef[];
  /** the matrix the editor is showing, or null when the rail is empty. */
  activeId: string | null;
  /** the compute line, exactly as typed. */
  input: string;
  /** the inline error under the compute row, or null. Cleared by the next keystroke. */
  error: string | null;
  /** newest first — the card under the compute line is the line that just ran. */
  history: ComputeEntry[];
  /** the rail's new-matrix chooser (the hero renders the same chooser inline). */
  newOpen: boolean;
  newRows: number;
  newCols: number;
  /** true once the `n × n…` field is driving the size rather than a preset chip. */
  newCustom: boolean;
  /** monotonic counter behind matrix and history ids (no clock, no RNG). */
  seq: number;
  hydrated: boolean;
}

export const initialMatrixState: MatrixState = {
  matrices: [],
  activeId: null,
  input: '',
  error: null,
  history: [],
  newOpen: false,
  newRows: DEFAULT_NEW_SIZE,
  newCols: DEFAULT_NEW_SIZE,
  newCustom: false,
  seq: 1,
  hydrated: false,
};

/** One persisted matrix, as `lib/persist.ts` stores it (numbers on disk, no runtime id). */
export interface MatrixSeed {
  name: string;
  rows: number;
  cols: number;
  cells: number[][];
}

/** One persisted history entry. */
export interface ComputeSeed {
  src: string;
  result: MatrixResult;
}

export type MatrixAction =
  /** the new-matrix flow: presets, the custom `n × n…` field, then create. */
  | { type: 'openNew' }
  | { type: 'closeNew' }
  /** a preset chip (`2 × 2` / `3 × 3` / `4 × 4`). */
  | { type: 'setNewSize'; rows: number; cols: number }
  /** the `n × n…` chip and its two fields — any size, no cap. */
  | { type: 'setCustomSize'; rows: number; cols: number }
  | { type: 'create'; rows?: number; cols?: number }
  | { type: 'select'; id: string }
  | { type: 'remove'; id: string }
  /** a row/col stepper, or the custom size applied to an existing matrix. */
  | { type: 'resize'; id: string; rows: number; cols: number }
  | { type: 'setCell'; id: string; row: number; col: number; text: string }
  | { type: 'setInput'; src: string }
  /** ↵ / the run button: evaluate the compute line onto the history. */
  | { type: 'submit' }
  /** a quick-op chip, by id — writes its source into the line and runs it. */
  | { type: 'quickOp'; op: string }
  /** `→ C` on a result card. */
  | { type: 'saveResult'; id: string }
  /** apply the state restored from `storage.matrix` on mount. */
  | { type: 'hydrate'; matrices: readonly MatrixSeed[]; history: readonly ComputeSeed[] };

function names(matrices: readonly MatrixDef[]): string[] {
  return matrices.map((def) => def.name);
}

/** Append a result card, newest first, dropping the oldest past {@link HISTORY_LIMIT}. */
function pushEntry(history: readonly ComputeEntry[], entry: ComputeEntry): ComputeEntry[] {
  return [entry, ...history].slice(0, HISTORY_LIMIT);
}

/** Evaluate `src` onto the history. Shared by the compute line and the quick-op chips. */
function run(state: MatrixState, src: string): MatrixState {
  if (src.trim() === '') return state; // ↵ on a blank line is inert.
  const outcome = computeMatrix(src, state.matrices);
  if (!outcome.ok) {
    return { ...state, input: src, error: outcome.message, hydrated: true };
  }
  return {
    ...state,
    input: src,
    error: null,
    history: pushEntry(state.history, { id: `r${state.seq}`, src, result: outcome.result }),
    seq: state.seq + 1,
    hydrated: true,
  };
}

/** The matrix the editor falls back to once `id` is gone: its neighbour, or nothing. */
function neighbourId(matrices: readonly MatrixDef[], id: string): string | null {
  const at = matrices.findIndex((def) => def.id === id);
  if (at === -1) return matrices[0]?.id ?? null;
  const next = matrices[at + 1] ?? matrices[at - 1];
  return next?.id ?? null;
}

function withMatrix(
  state: MatrixState,
  id: string,
  update: (def: MatrixDef) => MatrixDef,
): MatrixState {
  let changed = false;
  const matrices = state.matrices.map((def) => {
    if (def.id !== id) return def;
    const next = update(def);
    if (next !== def) changed = true;
    return next;
  });
  if (!changed) return state;
  // Editing a matrix invalidates the error the *old* numbers produced; the results already
  // on the history stay as they were, since each records what it computed at the time.
  return { ...state, matrices, error: null, hydrated: true };
}

export function reduceMatrix(state: MatrixState, action: MatrixAction): MatrixState {
  switch (action.type) {
    case 'openNew':
      return state.newOpen ? state : { ...state, newOpen: true };

    case 'closeNew':
      return state.newOpen ? { ...state, newOpen: false } : state;

    case 'setNewSize':
    case 'setCustomSize': {
      const custom = action.type === 'setCustomSize';
      const rows = normalizeDim(action.rows, state.newRows);
      const cols = normalizeDim(action.cols, state.newCols);
      if (rows === state.newRows && cols === state.newCols && custom === state.newCustom) {
        return state;
      }
      return { ...state, newRows: rows, newCols: cols, newCustom: custom };
    }

    case 'create': {
      const rows = normalizeDim(action.rows ?? state.newRows, state.newRows);
      const cols = normalizeDim(action.cols ?? state.newCols, state.newCols);
      const def = createMatrix(`m${state.seq}`, nextMatrixName(names(state.matrices)), rows, cols);
      return {
        ...state,
        matrices: [...state.matrices, def],
        activeId: def.id,
        newOpen: false,
        seq: state.seq + 1,
        hydrated: true,
      };
    }

    case 'select':
      if (state.activeId === action.id) return state;
      if (!state.matrices.some((def) => def.id === action.id)) return state;
      return { ...state, activeId: action.id };

    case 'remove': {
      if (!state.matrices.some((def) => def.id === action.id)) return state;
      const fallback = neighbourId(state.matrices, action.id);
      const matrices = state.matrices.filter((def) => def.id !== action.id);
      return {
        ...state,
        matrices,
        activeId: state.activeId === action.id ? fallback : state.activeId,
        // The compute line may well have named the matrix that just left.
        error: null,
        hydrated: true,
      };
    }

    case 'resize':
      return withMatrix(state, action.id, (def) => resizeMatrix(def, action.rows, action.cols));

    case 'setCell':
      return withMatrix(state, action.id, (def) =>
        setMatrixCell(def, action.row, action.col, action.text),
      );

    case 'setInput':
      if (action.src === state.input && state.error === null) return state;
      return { ...state, input: action.src, error: null };

    case 'submit':
      return run(state, state.input);

    case 'quickOp': {
      const op = QUICK_OPS.find((candidate) => candidate.id === action.op);
      const active = state.matrices.find((def) => def.id === state.activeId);
      if (!op || !active) return state;
      return run(state, op.source(active.name));
    }

    case 'saveResult': {
      const entry = state.history.find((candidate) => candidate.id === action.id);
      if (!entry || !isSavableResult(entry.result)) return state;
      const def = matrixFromResult(
        `m${state.seq}`,
        nextMatrixName(names(state.matrices)),
        entry.result,
      );
      return {
        ...state,
        matrices: [...state.matrices, def],
        activeId: def.id,
        seq: state.seq + 1,
        hydrated: true,
      };
    }

    case 'hydrate': {
      // Only the first restore counts; after that the user is driving.
      if (state.hydrated) return state;
      let seq = state.seq;
      const matrices: MatrixDef[] = [];
      for (const seed of action.matrices) {
        const rows = normalizeDim(seed.rows);
        const cols = normalizeDim(seed.cols);
        matrices.push({
          id: `m${seq}`,
          name: seed.name,
          rows,
          cols,
          // A hand-edited blob can disagree with its own `rows`/`cols`; the declared shape
          // wins, and `resizeCells` pads or clips the cells to match it.
          cells: resizeCells(cellsToText(seed.cells), rows, cols),
        });
        seq += 1;
      }
      const history: ComputeEntry[] = [];
      for (const seed of action.history) {
        history.push({ id: `r${seq}`, src: seed.src, result: seed.result });
        seq += 1;
      }
      return {
        ...state,
        matrices,
        history: history.slice(0, HISTORY_LIMIT),
        activeId: matrices[0]?.id ?? null,
        seq,
        hydrated: true,
      };
    }

    default:
      return state;
  }
}

/** The matrix the editor is showing, or null when the rail is empty. */
export function activeMatrix(state: MatrixState): MatrixDef | null {
  return state.matrices.find((def) => def.id === state.activeId) ?? null;
}

/** The name `→ C` would give the next saved result — also the button's own label. */
export function nextName(state: MatrixState): string {
  return nextMatrixName(names(state.matrices));
}
