import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  activeMatrix,
  initialMatrixState,
  nextName,
  reduceMatrix,
} from '../lib/matrixModel';
import type { MatrixAction, MatrixState } from '../lib/matrixModel';
import { DEFAULT_NEW_SIZE, MIN_DIM } from '../lib/matrix';

function run(state: MatrixState, ...actions: MatrixAction[]): MatrixState {
  return actions.reduce(reduceMatrix, state);
}

/** Fill a matrix's cells row-major from `values`. */
function fill(state: MatrixState, id: string, values: number[][]): MatrixState {
  const actions: MatrixAction[] = [];
  values.forEach((row, r) =>
    row.forEach((value, c) => actions.push({ type: 'setCell', id, row: r, col: c, text: String(value) })),
  );
  return run(state, ...actions);
}

/** The wireframe's default state: `A` and `B`, both 3 × 3, `A` the one being edited. */
function railWithAB(): MatrixState {
  let state = run(initialMatrixState, { type: 'create', rows: 3, cols: 3 });
  const a = state.matrices[0].id;
  state = fill(state, a, [
    [2, 1, 0],
    [1, 3, -1],
    [0, -1, 2],
  ]);
  state = run(state, { type: 'create', rows: 3, cols: 3 });
  const b = state.matrices[1].id;
  state = fill(state, b, [
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 0],
  ]);
  return run(state, { type: 'select', id: a });
}

describe('the matrix rail (MATH5)', () => {
  it('opens empty, with the 3 × 3 preset selected', () => {
    expect(initialMatrixState.matrices).toHaveLength(0);
    expect(activeMatrix(initialMatrixState)).toBeNull();
    expect(initialMatrixState.newRows).toBe(DEFAULT_NEW_SIZE);
    expect(initialMatrixState.newCustom).toBe(false);
    expect(nextName(initialMatrixState)).toBe('A');
  });

  it('creates A, B, C… at the chosen size and selects the new one', () => {
    let state = run(initialMatrixState, { type: 'setNewSize', rows: 2, cols: 2 });
    state = run(state, { type: 'create' });
    expect(state.matrices[0].name).toBe('A');
    expect(state.matrices[0].rows).toBe(2);
    expect(activeMatrix(state)?.name).toBe('A');

    state = run(state, { type: 'create' });
    expect(state.matrices.map((def) => def.name)).toEqual(['A', 'B']);
    expect(activeMatrix(state)?.name).toBe('B');
  });

  it('takes a custom n × n with no upper cap, and remembers it is custom', () => {
    const state = run(
      initialMatrixState,
      { type: 'setCustomSize', rows: 12, cols: 40 },
      { type: 'create' },
    );
    expect(state.newCustom).toBe(true);
    expect(state.matrices[0].rows).toBe(12);
    expect(state.matrices[0].cols).toBe(40);
    expect(state.matrices[0].cells[11]).toHaveLength(40);
  });

  it('opens and closes the new-matrix chooser, and creating closes it', () => {
    let state = run(initialMatrixState, { type: 'openNew' });
    expect(state.newOpen).toBe(true);
    expect(run(state, { type: 'closeNew' }).newOpen).toBe(false);
    state = run(state, { type: 'create' });
    expect(state.newOpen).toBe(false);
  });

  it('deletes a matrix, falls back to its neighbour, and frees the name', () => {
    let state = railWithAB();
    const [a, b] = state.matrices.map((def) => def.id);
    state = run(state, { type: 'select', id: a }, { type: 'remove', id: a });
    expect(state.matrices.map((def) => def.name)).toEqual(['B']);
    expect(state.activeId).toBe(b);
    expect(nextName(state)).toBe('A');
  });

  it('steps a dimension without losing what is already typed', () => {
    let state = railWithAB();
    const a = state.matrices[0].id;
    state = run(state, { type: 'resize', id: a, rows: 4, cols: 3 });
    expect(activeMatrix(state)?.cells[0]).toEqual(['2', '1', '0']);
    expect(activeMatrix(state)?.cells[3]).toEqual(['0', '0', '0']);
    state = run(state, { type: 'resize', id: a, rows: 3, cols: 3 });
    expect(activeMatrix(state)?.cells).toEqual([
      ['2', '1', '0'],
      ['1', '3', '-1'],
      ['0', '-1', '2'],
    ]);
    // …and never past the floor.
    state = run(state, { type: 'resize', id: a, rows: 0, cols: 0 });
    expect(activeMatrix(state)?.rows).toBe(MIN_DIM);
  });
});

describe('the compute line and its history (MATH5)', () => {
  it('evaluates a typed line onto the history, newest first', () => {
    let state = railWithAB();
    state = run(state, { type: 'setInput', src: 'A × B' }, { type: 'submit' });
    expect(state.error).toBeNull();
    expect(state.history).toHaveLength(1);
    expect(state.history[0].src).toBe('A × B');

    state = run(state, { type: 'setInput', src: 'det(A)' }, { type: 'submit' });
    expect(state.history.map((entry) => entry.src)).toEqual(['det(A)', 'A × B']);
    expect(state.history[0].result).toEqual({ kind: 'scalar', value: 8 });
  });

  it('shares one history with the quick-op chips, which also fill the line', () => {
    let state = railWithAB();
    state = run(state, { type: 'setInput', src: 'A × B' }, { type: 'submit' });
    state = run(state, { type: 'quickOp', op: 'det' });
    expect(state.input).toBe('det(A)');
    expect(state.history).toHaveLength(2);
    expect(state.history[0].result).toEqual({ kind: 'scalar', value: 8 });

    // The chip follows the selected matrix, not the one that happened to be first.
    state = run(state, { type: 'select', id: state.matrices[1].id }, { type: 'quickOp', op: 'rank' });
    expect(state.input).toBe('rank(B)');
  });

  it('keeps a failed line out of the history and shows it inline instead', () => {
    let state = railWithAB();
    state = run(state, { type: 'resize', id: state.matrices[1].id, rows: 2, cols: 2 });
    state = run(state, { type: 'setInput', src: 'A + B' }, { type: 'submit' });
    expect(state.history).toHaveLength(0);
    expect(state.error).toBe(
      'Cannot add a 3 × 3 to a 2 × 2 — both matrices must have the same size',
    );
    // The next keystroke clears it — the error belongs to the line that produced it.
    expect(run(state, { type: 'setInput', src: 'A + ' }).error).toBeNull();
  });

  it('clears the error when the matrices it complained about change', () => {
    let state = railWithAB();
    state = run(state, { type: 'resize', id: state.matrices[1].id, rows: 2, cols: 2 });
    state = run(state, { type: 'setInput', src: 'A + B' }, { type: 'submit' });
    expect(state.error).not.toBeNull();
    state = run(state, { type: 'resize', id: state.matrices[1].id, rows: 3, cols: 3 });
    expect(state.error).toBeNull();
  });

  it('is inert on a blank line', () => {
    const state = railWithAB();
    expect(run(state, { type: 'submit' })).toBe(state);
  });

  it('bounds the history so a long session cannot grow the blob without limit', () => {
    let state = railWithAB();
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
      state = run(state, { type: 'setInput', src: `det(A) + ${index}` }, { type: 'submit' });
    }
    expect(state.history).toHaveLength(HISTORY_LIMIT);
    expect(state.history[0].src).toBe(`det(A) + ${HISTORY_LIMIT + 4}`);
  });
});

describe('saving a result as a matrix (MATH5)', () => {
  it('→ C creates the matrix the button offered, and selects it', () => {
    let state = railWithAB();
    expect(nextName(state)).toBe('C');
    state = run(state, { type: 'setInput', src: 'A × B' }, { type: 'submit' });
    state = run(state, { type: 'saveResult', id: state.history[0].id });

    const saved = activeMatrix(state);
    expect(saved?.name).toBe('C');
    expect(saved?.rows).toBe(3);
    expect(saved?.cells[0]).toEqual(['2', '1', '3']);
    expect(nextName(state)).toBe('D');
  });

  it('the saved matrix is a first-class one — computable by name', () => {
    let state = railWithAB();
    state = run(state, { type: 'setInput', src: 'A × B' }, { type: 'submit' });
    state = run(state, { type: 'saveResult', id: state.history[0].id });
    state = run(state, { type: 'setInput', src: 'det(C)' }, { type: 'submit' });
    expect(state.error).toBeNull();
    // det(A × B) = det(A)·det(B) = 8 · −2.
    expect(state.history[0].result).toEqual({ kind: 'scalar', value: -16 });
  });

  it('refuses to save a scalar result — there is no matrix to make', () => {
    let state = railWithAB();
    state = run(state, { type: 'quickOp', op: 'det' });
    const before = state.matrices.length;
    state = run(state, { type: 'saveResult', id: state.history[0].id });
    expect(state.matrices).toHaveLength(before);
  });
});

describe('restore (MATH5)', () => {
  const seeds = {
    matrices: [{ name: 'A', rows: 2, cols: 2, cells: [[1, 2], [3, 4]] }],
    history: [{ src: 'det(A)', result: { kind: 'scalar' as const, value: -2 } }],
  };

  it('rebuilds the rail and the history, selecting the first matrix', () => {
    const state = run(initialMatrixState, { type: 'hydrate', ...seeds });
    expect(state.matrices).toHaveLength(1);
    expect(activeMatrix(state)?.cells).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(state.history[0].src).toBe('det(A)');
    expect(state.hydrated).toBe(true);
    // The restored matrix is live: the compute line can name it.
    const computed = run(state, { type: 'setInput', src: 'det(A)' }, { type: 'submit' });
    expect(computed.history[0].result).toEqual({ kind: 'scalar', value: -2 });
  });

  it('pads or clips cells that disagree with their own declared size', () => {
    const state = run(initialMatrixState, {
      type: 'hydrate',
      matrices: [{ name: 'A', rows: 3, cols: 3, cells: [[1, 2], [3, 4]] }],
      history: [],
    });
    expect(activeMatrix(state)?.cells).toEqual([
      ['1', '2', '0'],
      ['3', '4', '0'],
      ['0', '0', '0'],
    ]);
  });

  it('loses to work the user has already done — a late restore never clobbers', () => {
    const working = run(initialMatrixState, { type: 'create', rows: 2, cols: 2 });
    const state = run(working, { type: 'hydrate', ...seeds });
    expect(state).toBe(working);
  });

  it('keeps ids unique across matrices and history, so a save cannot collide', () => {
    const state = run(initialMatrixState, { type: 'hydrate', ...seeds });
    const ids = [...state.matrices.map((def) => def.id), ...state.history.map((row) => row.id)];
    expect(new Set(ids).size).toBe(ids.length);
    const created = run(state, { type: 'create' });
    expect(new Set(created.matrices.map((def) => def.id)).size).toBe(created.matrices.length);
  });
});
