import { describe, expect, it } from 'vitest';
import {
  MATH_STATE_KEY,
  MATH_STATE_VERSION,
  emptyGraphing,
  emptyMathState,
  emptyMatrixSection,
  emptyScientific,
  graphingSnapshot,
  loadGraphing,
  loadMathState,
  loadMatrixSection,
  loadScientific,
  matrixSeeds,
  matrixSnapshot,
  parseGraphingSection,
  parseMathState,
  parseMatrixSection,
  parseScientificSection,
  saveGraphing,
  saveLastTool,
  saveMatrixSection,
  saveScientific,
  scientificSnapshot,
  serializeGraphingSection,
  serializeMatrixSection,
  serializeScientificSection,
  serializeMathState,
} from '../lib/persist';
import {
  DEFAULT_VIEWPORT,
  blankTailId,
  graphCells,
  initialGraphState,
  plottedCurves,
  reduceGraph,
} from '../lib/graphModel';
import type { GraphState } from '../lib/graphModel';
import { initialSciState, reduceSci } from '../lib/sciModel';
import type { SciAction, SciState } from '../lib/sciModel';
import { TAPE_LIMIT } from '../lib/eval';
import { HISTORY_LIMIT, initialMatrixState, reduceMatrix } from '../lib/matrixModel';
import type { MatrixAction, MatrixState } from '../lib/matrixModel';

/** In-memory stand-in for the host's per-plugin `storage.*` namespace. */
function fakeStorage(seed?: unknown) {
  const cell: { value: unknown } = { value: seed };
  return {
    cell,
    get: async <T>(key: string): Promise<T | null> => {
      expect(key).toBe(MATH_STATE_KEY);
      return (cell.value ?? null) as T | null;
    },
    set: async <T>(key: string, value: T): Promise<void> => {
      expect(key).toBe(MATH_STATE_KEY);
      cell.value = value;
    },
  };
}

describe('parseMathState', () => {
  it('degrades to the empty state for an absent or malformed blob', () => {
    expect(parseMathState(undefined)).toEqual(emptyMathState);
    expect(parseMathState(null)).toEqual(emptyMathState);
    expect(parseMathState('nope')).toEqual(emptyMathState);
    expect(parseMathState([1, 2, 3])).toEqual(emptyMathState);
  });

  it('reads shell.lastTool', () => {
    const parsed = parseMathState({ version: 1, shell: { lastTool: 'matrix' } });
    expect(parsed.shell.lastTool).toBe('matrix');
  });

  it('falls back to Graphing for a lastTool that is not a live tool', () => {
    // A disabled slot, a removed tool, or plain garbage must never strand the shell.
    expect(parseMathState({ shell: { lastTool: 'geometry' } }).shell.lastTool).toBe('graphing');
    expect(parseMathState({ shell: { lastTool: 42 } }).shell.lastTool).toBe('graphing');
    expect(parseMathState({ shell: 'broken' }).shell.lastTool).toBe('graphing');
  });

  it('keeps the on-disk version rather than downgrading it', () => {
    expect(parseMathState({ version: 7, shell: { lastTool: 'graphing' } }).version).toBe(7);
    expect(parseMathState({ version: 'x' }).version).toBe(MATH_STATE_VERSION);
  });

  it('collects the tool sections it does not own', () => {
    const parsed = parseMathState({
      version: 1,
      shell: { lastTool: 'scientific' },
      graphing: { exprs: [{ src: 'sin(x)' }] },
      matrix: { matrices: [] },
    });
    expect(parsed.sections).toEqual({
      graphing: { exprs: [{ src: 'sin(x)' }] },
      matrix: { matrices: [] },
    });
  });
});

describe('serializeMathState', () => {
  it('round-trips through parse without losing anything', () => {
    const onDisk = {
      version: 1,
      shell: { lastTool: 'matrix' },
      scientific: { angleMode: 'deg', keypadCollapsed: true },
    };
    expect(serializeMathState(parseMathState(onDisk))).toEqual(onDisk);
  });

  it('tolerates forward-compatible sections written by a newer build', () => {
    const future = {
      version: 2,
      shell: { lastTool: 'graphing' },
      geometry: { shapes: ['circle'] },
      unknownTopLevel: 'keep me',
    };
    // Reading and rewriting an unknown section must not drop it.
    expect(serializeMathState(parseMathState(future))).toEqual(future);
  });
});

describe('loadMathState / saveLastTool', () => {
  it('restores the last active tool from storage', async () => {
    const storage = fakeStorage({ version: 1, shell: { lastTool: 'scientific' } });
    const loaded = await loadMathState(storage);
    expect(loaded.shell.lastTool).toBe('scientific');
  });

  it('restores the default tool when nothing is stored yet', async () => {
    const loaded = await loadMathState(fakeStorage());
    expect(loaded.shell.lastTool).toBe('graphing');
  });

  it('writes the new tool without clobbering other tools’ saved state', async () => {
    const storage = fakeStorage({
      version: 1,
      shell: { lastTool: 'graphing' },
      graphing: { exprs: [{ src: 'x^2' }] },
    });
    await saveLastTool(storage, 'matrix');
    expect(storage.cell.value).toEqual({
      version: 1,
      shell: { lastTool: 'matrix' },
      graphing: { exprs: [{ src: 'x^2' }] },
    });
  });

  it('skips the write when the stored tool is already current', async () => {
    const storage = fakeStorage({ version: 1, shell: { lastTool: 'matrix' } });
    const before = storage.cell.value;
    await saveLastTool(storage, 'matrix');
    expect(storage.cell.value).toBe(before);
  });
});

/* ================================================================== *
 * MATH3 — the `graphing` section
 * ================================================================== */

/** The spec's data-model example for `graphing`, verbatim. */
const SAVED_GRAPHING = {
  exprs: [{ src: 'a·sin(x)', color: 'blue', visible: true }],
  sliders: [{ symbol: 'a', value: 2, min: -5, max: 5, step: 0.1 }],
  viewport: { xDomain: [-6.7, 6.7], yDomain: [-4.9, 4.9] },
};

describe('parseGraphingSection (MATH3)', () => {
  it('reads the spec’s section shape', () => {
    const parsed = parseGraphingSection(SAVED_GRAPHING);
    expect(parsed.exprs).toEqual(SAVED_GRAPHING.exprs);
    expect(parsed.sliders).toEqual(SAVED_GRAPHING.sliders);
    expect(parsed.viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it('degrades to an empty graph for an absent or malformed section', () => {
    for (const raw of [undefined, null, 'nope', [1, 2, 3]]) {
      expect(parseGraphingSection(raw)).toEqual(emptyGraphing);
    }
  });

  it('drops entries that are not usable expressions, keeping the rest', () => {
    const parsed = parseGraphingSection({
      exprs: [{ src: 'sin(x)' }, { src: '   ' }, { nope: true }, 'garbage', null],
    });
    // A missing colour/visibility falls back rather than losing the row.
    expect(parsed.exprs).toEqual([{ src: 'sin(x)', color: 'blue', visible: true }]);
  });

  it('narrows a colour that is not in the palette', () => {
    expect(parseGraphingSection({ exprs: [{ src: 'x', color: 'chartreuse' }] }).exprs[0].color).toBe(
      'blue',
    );
  });

  it('sanitizes sliders and refuses duplicates of the same symbol', () => {
    const parsed = parseGraphingSection({
      sliders: [
        { symbol: 'a', value: 99, min: 0, max: 10, step: 1 },
        { symbol: 'a', value: 0 },
        { symbol: '', value: 1 },
        { value: 1 },
      ],
    });
    expect(parsed.sliders).toEqual([{ symbol: 'a', value: 10, min: 0, max: 10, step: 1 }]);
  });

  it('falls back to the default window rather than half-restoring one', () => {
    for (const viewport of [
      undefined,
      { xDomain: [-1, 1] },
      { xDomain: [-1, 1], yDomain: [5, 5] },
      { xDomain: [-1, 1], yDomain: [3, -3] },
      { xDomain: 'wide', yDomain: [-1, 1] },
    ]) {
      expect(parseGraphingSection({ viewport }).viewport).toEqual(DEFAULT_VIEWPORT);
    }
    expect(parseGraphingSection({ viewport: { xDomain: [-10, 10], yDomain: [-4, 4] } }).viewport)
      .toEqual({ xDomain: [-10, 10], yDomain: [-4, 4] });
  });
});

describe('serializeGraphingSection (MATH3)', () => {
  it('round-trips the spec’s section through parse without losing anything', () => {
    expect(serializeGraphingSection(parseGraphingSection(SAVED_GRAPHING))).toEqual(SAVED_GRAPHING);
  });

  it('tolerates unknown keys inside the section, written by a newer build', () => {
    const future = { ...SAVED_GRAPHING, polarMode: true, labels: [{ at: 1 }] };
    expect(serializeGraphingSection(parseGraphingSection(future))).toEqual(future);
  });
});

describe('graphingSnapshot (MATH3)', () => {
  function typeIntoTail(state: GraphState, src: string): GraphState {
    return reduceGraph(state, { type: 'editRow', id: blankTailId(state) as string, src });
  }

  it('stores the authored rows, the sliders and the window — not the blank tail', () => {
    let state = typeIntoTail(initialGraphState, 'a·sin(x)');
    state = reduceGraph(state, { type: 'setSliderValue', symbol: 'a', value: 2 });
    expect(graphingSnapshot(state)).toEqual({
      exprs: [{ src: 'a·sin(x)', color: 'blue', visible: true }],
      sliders: [{ symbol: 'a', value: 2, min: -5, max: 5, step: 0.1 }],
      viewport: DEFAULT_VIEWPORT,
      extra: {},
    });
  });

  it('survives a full round-trip: state → disk → state', async () => {
    let state = typeIntoTail(initialGraphState, 'a·sin(x)');
    state = typeIntoTail(state, 'x^2/4 − 2');
    state = reduceGraph(state, { type: 'toggleVisible', id: state.rows[1].id });
    state = reduceGraph(state, { type: 'setSliderValue', symbol: 'a', value: 2 });
    state = reduceGraph(state, { type: 'zoomIn' });

    const storage = fakeStorage();
    await saveGraphing(storage, graphingSnapshot(state));
    const restored = await loadGraphing(storage);
    const reopened = reduceGraph(initialGraphState, {
      type: 'hydrate',
      exprs: restored.exprs,
      sliders: restored.sliders,
      viewport: restored.viewport,
    });

    expect(reopened.rows.map((row) => [row.src, row.color, row.visible])).toEqual([
      ['a·sin(x)', 'blue', true],
      ['x^2/4 − 2', 'orange', false],
      ['', 'green', true],
    ]);
    expect(reopened.sliders).toEqual(state.sliders);
    expect(reopened.viewport).toEqual(state.viewport);
    // …and the reopened graph draws the same curve, at the same parameter value.
    expect(plottedCurves(graphCells(reopened.rows), reopened.sliders)).toEqual(
      plottedCurves(graphCells(state.rows), state.sliders),
    );
  });
});

describe('saveGraphing / loadGraphing (MATH3)', () => {
  it('stamps the version and leaves the shell and other tools alone', async () => {
    const storage = fakeStorage({
      version: 1,
      shell: { lastTool: 'scientific' },
      scientific: { angleMode: 'deg' },
    });
    await saveGraphing(storage, parseGraphingSection(SAVED_GRAPHING));
    expect(storage.cell.value).toEqual({
      version: MATH_STATE_VERSION,
      shell: { lastTool: 'scientific' },
      scientific: { angleMode: 'deg' },
      graphing: SAVED_GRAPHING,
    });
  });

  it('keeps the on-disk version and unknown top-level sections when writing', async () => {
    const storage = fakeStorage({
      version: 4,
      shell: { lastTool: 'graphing' },
      geometry: { shapes: ['circle'] },
    });
    await saveGraphing(storage, emptyGraphing);
    expect(storage.cell.value).toMatchObject({ version: 4, geometry: { shapes: ['circle'] } });
  });

  it('reads back an empty graph when nothing has been saved yet', async () => {
    expect(await loadGraphing(fakeStorage())).toEqual(emptyGraphing);
    expect(await loadGraphing(fakeStorage({ version: 1, shell: { lastTool: 'graphing' } }))).toEqual(
      emptyGraphing,
    );
  });

  it('does not let saving the active tool drop the saved graph', async () => {
    const storage = fakeStorage();
    await saveGraphing(storage, parseGraphingSection(SAVED_GRAPHING));
    await saveLastTool(storage, 'matrix');
    expect(await loadGraphing(storage)).toMatchObject({ exprs: SAVED_GRAPHING.exprs });
    expect(await loadMathState(storage)).toMatchObject({ shell: { lastTool: 'matrix' } });
  });
});

/* ================================================================== *
 * MATH4 — the `scientific` section
 * ================================================================== */

/** The spec's data-model example for `scientific`, verbatim. */
const SAVED_SCIENTIFIC = {
  angleMode: 'deg',
  keypadCollapsed: false,
  tape: [{ src: 'sin(45)', result: '0.7071068', angleMode: 'deg' }],
};

describe('parseScientificSection (MATH4)', () => {
  it('reads the spec’s section shape', () => {
    const parsed = parseScientificSection(SAVED_SCIENTIFIC);
    expect(parsed.angleMode).toBe('deg');
    expect(parsed.keypadCollapsed).toBe(false);
    expect(parsed.tape).toEqual(SAVED_SCIENTIFIC.tape);
  });

  it('degrades to an empty tape for an absent or malformed section', () => {
    for (const raw of [undefined, null, 'nope', [1, 2, 3]]) {
      expect(parseScientificSection(raw)).toEqual(emptyScientific);
    }
  });

  it('drops rows that are not a usable record of an evaluation', () => {
    const parsed = parseScientificSection({
      tape: [
        { src: '1+1', result: '2', angleMode: 'rad' },
        { src: '2+2' }, // no result — nothing to show
        { result: '4' }, // no expression — nothing to recall
        { src: '  ', result: '0' },
        'garbage',
        null,
      ],
    });
    expect(parsed.tape).toEqual([{ src: '1+1', result: '2', angleMode: 'rad' }]);
  });

  it('narrows an angle mode that is not one of the two, per row and overall', () => {
    const parsed = parseScientificSection({
      angleMode: 'grad',
      keypadCollapsed: 'yes',
      tape: [{ src: '1+1', result: '2', angleMode: 7 }],
    });
    expect(parsed.angleMode).toBe('deg');
    // Only a real `true` collapses the keypad — a truthy string is not a boolean.
    expect(parsed.keypadCollapsed).toBe(false);
    expect(parsed.tape[0].angleMode).toBe('deg');
  });

  it('trims a hand-grown tape to the same bound the live model keeps', () => {
    const tape = Array.from({ length: TAPE_LIMIT + 10 }, (_, index) => ({
      src: `${index}+0`,
      result: `${index}`,
      angleMode: 'deg',
    }));
    const parsed = parseScientificSection({ tape });
    expect(parsed.tape).toHaveLength(TAPE_LIMIT);
    expect(parsed.tape[0].src).toBe('10+0');
  });
});

describe('serializeScientificSection (MATH4)', () => {
  it('round-trips the spec’s section through parse without losing anything', () => {
    expect(serializeScientificSection(parseScientificSection(SAVED_SCIENTIFIC))).toEqual(
      SAVED_SCIENTIFIC,
    );
  });

  it('tolerates unknown keys inside the section, written by a newer build', () => {
    const future = { ...SAVED_SCIENTIFIC, memory: 42, precision: { digits: 12 } };
    expect(serializeScientificSection(parseScientificSection(future))).toEqual(future);
  });
});

describe('scientificSnapshot (MATH4)', () => {
  function run(state: SciState, ...actions: SciAction[]): SciState {
    return actions.reduce(reduceSci, state);
  }

  function enter(state: SciState, src: string): SciState {
    return run(state, { type: 'setInput', src }, { type: 'submit' });
  }

  it('stores the mode, the collapse and the successful rows only', () => {
    let state = enter(initialSciState, 'sin(45)');
    state = enter(state, '2 +'); // a failed line is a response, not history
    state = run(state, { type: 'toggleKeypad' });
    expect(scientificSnapshot(state)).toEqual({
      angleMode: 'deg',
      keypadCollapsed: true,
      tape: [{ src: 'sin(45)', result: '0.70710678', angleMode: 'deg' }],
      extra: {},
    });
  });

  it('survives a full round-trip: state → disk → state', async () => {
    let state = enter(initialSciState, '12! / 10!');
    state = enter(state, 'ans × 4');
    state = run(state, { type: 'setAngleMode', mode: 'rad' });
    state = enter(state, 'sin(45)');
    state = run(state, { type: 'toggleKeypad' });

    const storage = fakeStorage();
    await saveScientific(storage, scientificSnapshot(state));
    const restored = await loadScientific(storage);
    const reopened = reduceSci(initialSciState, {
      type: 'hydrate',
      tape: restored.tape,
      angleMode: restored.angleMode,
      keypadCollapsed: restored.keypadCollapsed,
    });

    expect(reopened.tape.map((row) => [row.src, row.result, row.angleMode])).toEqual([
      ['12! / 10!', '132', 'deg'],
      ['ans × 4', '528', 'deg'],
      ['sin(45)', '0.85090352', 'rad'],
    ]);
    expect(reopened.angleMode).toBe('rad');
    expect(reopened.keypadCollapsed).toBe(true);
    // …and the reopened tool keeps chaining from where the session left off.
    expect(enter(reopened, 'ans').tape[3].result).toBe('0.85090352');
  });
});

describe('saveScientific / loadScientific (MATH4)', () => {
  it('stamps the version and leaves the shell and other tools alone', async () => {
    const storage = fakeStorage({
      version: 1,
      shell: { lastTool: 'graphing' },
      graphing: { exprs: [{ src: 'sin(x)' }] },
    });
    await saveScientific(storage, parseScientificSection(SAVED_SCIENTIFIC));
    expect(storage.cell.value).toEqual({
      version: MATH_STATE_VERSION,
      shell: { lastTool: 'graphing' },
      graphing: { exprs: [{ src: 'sin(x)' }] },
      scientific: SAVED_SCIENTIFIC,
    });
  });

  it('reads back an empty tape when nothing has been saved yet', async () => {
    expect(await loadScientific(fakeStorage())).toEqual(emptyScientific);
  });

  it('does not let the two tools’ saves drop each other', async () => {
    const storage = fakeStorage();
    await saveGraphing(storage, parseGraphingSection(SAVED_GRAPHING));
    await saveScientific(storage, parseScientificSection(SAVED_SCIENTIFIC));
    await saveLastTool(storage, 'scientific');
    expect(await loadGraphing(storage)).toMatchObject({ exprs: SAVED_GRAPHING.exprs });
    expect(await loadScientific(storage)).toMatchObject({ tape: SAVED_SCIENTIFIC.tape });
  });
});

/* ================================================================== *
 * MATH5 — the `matrix` section
 * ================================================================== */

/** The spec's data-model example for `matrix`, verbatim. */
const SAVED_MATRIX = {
  matrices: [{ name: 'A', rows: 3, cols: 3, cells: [[2, 1, 0], [1, 3, -1], [0, -1, 2]] }],
  history: [{ src: 'det(A)', result: { scalar: 8 } }],
};

describe('parseMatrixSection (MATH5)', () => {
  it('reads the spec’s section shape', () => {
    const parsed = parseMatrixSection(SAVED_MATRIX);
    expect(parsed.matrices).toEqual(SAVED_MATRIX.matrices);
    expect(parsed.history).toEqual(SAVED_MATRIX.history);
  });

  it('degrades to an empty rail for an absent or malformed section', () => {
    for (const raw of [undefined, null, 'nope', [1, 2, 3]]) {
      expect(parseMatrixSection(raw)).toEqual(emptyMatrixSection);
    }
  });

  it('drops entries that are not a usable matrix', () => {
    const parsed = parseMatrixSection({
      matrices: [
        { name: 'A', rows: 1, cols: 2, cells: [[1, 2]] },
        { rows: 2, cols: 2, cells: [[1, 2], [3, 4]] }, // nameless
        { name: 'B', cells: [[1, 2], [3]] }, // ragged
        { name: 'C', cells: [[1, 'two']] }, // not numbers
        { name: 'D', cells: [] },
        { name: 'A', cells: [[9]] }, // a duplicate name — the first one wins
        'garbage',
        null,
      ],
    });
    expect(parsed.matrices).toEqual([{ name: 'A', rows: 1, cols: 2, cells: [[1, 2]] }]);
  });

  it('keeps a declared size that disagrees with the cells, and floors a bad one', () => {
    const parsed = parseMatrixSection({
      matrices: [
        { name: 'A', rows: 4, cols: 4, cells: [[1, 2], [3, 4]] },
        { name: 'B', rows: 0, cols: 'wide', cells: [[1, 2, 3]] },
      ],
    });
    expect(parsed.matrices[0]).toMatchObject({ rows: 4, cols: 4 });
    // A missing / nonsense dimension falls back to the cells' own shape.
    expect(parsed.matrices[1]).toMatchObject({ rows: 1, cols: 3 });
  });

  it('drops history entries with no source or no readable result', () => {
    const parsed = parseMatrixSection({
      history: [
        { src: 'det(A)', result: { scalar: 8 } },
        { src: 'A × B', result: { cells: [[1, 2], [3, 4]] } },
        { src: 'rank(A)' }, // no result
        { result: { scalar: 1 } }, // no source
        { src: 'x', result: { scalar: 'eight' } },
        { src: 'y', result: { cells: [[1], [2, 3]] } }, // ragged
      ],
    });
    expect(parsed.history).toEqual([
      { src: 'det(A)', result: { scalar: 8 } },
      { src: 'A × B', result: { cells: [[1, 2], [3, 4]] } },
    ]);
  });

  it('trims a hand-grown history to the same bound the live model keeps', () => {
    const history = Array.from({ length: HISTORY_LIMIT + 10 }, (_unused, index) => ({
      src: `det(A) + ${index}`,
      result: { scalar: index },
    }));
    expect(parseMatrixSection({ history }).history).toHaveLength(HISTORY_LIMIT);
  });
});

describe('serializeMatrixSection (MATH5)', () => {
  it('round-trips the spec’s section through parse without losing anything', () => {
    expect(serializeMatrixSection(parseMatrixSection(SAVED_MATRIX))).toEqual(SAVED_MATRIX);
  });

  it('tolerates unknown keys inside the section, written by a newer build', () => {
    const future = { ...SAVED_MATRIX, decomposition: 'lu', pinned: ['A'] };
    expect(serializeMatrixSection(parseMatrixSection(future))).toEqual(future);
  });
});

describe('matrixSnapshot (MATH5)', () => {
  function run(state: MatrixState, ...actions: MatrixAction[]): MatrixState {
    return actions.reduce(reduceMatrix, state);
  }

  /** A 2 × 2 `A` holding `[[1, 2], [3, 4]]`, plus one computed result. */
  function worked(): MatrixState {
    let state = run(initialMatrixState, { type: 'create', rows: 2, cols: 2 });
    const id = state.matrices[0].id;
    [[1, 2], [3, 4]].forEach((row, r) =>
      row.forEach((value, c) => {
        state = run(state, { type: 'setCell', id, row: r, col: c, text: String(value) });
      }),
    );
    return run(state, { type: 'setInput', src: 'det(A)' }, { type: 'submit' });
  }

  it('stores cells as numbers, and an unreadable cell as zero', () => {
    let state = worked();
    state = run(state, { type: 'setCell', id: state.matrices[0].id, row: 0, col: 1, text: '' });
    expect(matrixSnapshot(state).matrices).toEqual([
      { name: 'A', rows: 2, cols: 2, cells: [[1, 0], [3, 4]] },
    ]);
  });

  it('survives a full round-trip: state → disk → state', async () => {
    let state = worked();
    state = run(state, { type: 'setInput', src: 'A × A' }, { type: 'submit' });
    state = run(state, { type: 'saveResult', id: state.history[0].id });

    const storage = fakeStorage();
    await saveMatrixSection(storage, matrixSnapshot(state));
    const restored = await loadMatrixSection(storage);
    const reopened = reduceMatrix(initialMatrixState, {
      type: 'hydrate',
      ...matrixSeeds(restored),
    });

    expect(reopened.matrices.map((def) => def.name)).toEqual(['A', 'B']);
    expect(reopened.matrices[1].cells).toEqual([
      ['7', '10'],
      ['15', '22'],
    ]);
    expect(reopened.history.map((entry) => entry.src)).toEqual(['A × A', 'det(A)']);
    expect(reopened.history[1].result).toEqual({ kind: 'scalar', value: -2 });
    // …and the reopened tool computes against the restored rail.
    const again = run(reopened, { type: 'setInput', src: 'det(B)' }, { type: 'submit' });
    expect(again.error).toBeNull();
    expect(again.history[0].result).toEqual({ kind: 'scalar', value: 4 });
  });
});

describe('saveMatrixSection / loadMatrixSection (MATH5)', () => {
  it('stamps the version and leaves the shell and other tools alone', async () => {
    const storage = fakeStorage({
      version: 1,
      shell: { lastTool: 'graphing' },
      scientific: SAVED_SCIENTIFIC,
    });
    await saveMatrixSection(storage, parseMatrixSection(SAVED_MATRIX));
    expect(storage.cell.value).toEqual({
      version: MATH_STATE_VERSION,
      shell: { lastTool: 'graphing' },
      scientific: SAVED_SCIENTIFIC,
      matrix: SAVED_MATRIX,
    });
  });

  it('reads back an empty rail when nothing has been saved yet', async () => {
    expect(await loadMatrixSection(fakeStorage())).toEqual(emptyMatrixSection);
  });

  it('does not let the three tools’ saves drop each other', async () => {
    const storage = fakeStorage();
    await saveGraphing(storage, parseGraphingSection(SAVED_GRAPHING));
    await saveScientific(storage, parseScientificSection(SAVED_SCIENTIFIC));
    await saveMatrixSection(storage, parseMatrixSection(SAVED_MATRIX));
    await saveLastTool(storage, 'matrix');
    expect(await loadGraphing(storage)).toMatchObject({ exprs: SAVED_GRAPHING.exprs });
    expect(await loadScientific(storage)).toMatchObject({ tape: SAVED_SCIENTIFIC.tape });
    expect(await loadMatrixSection(storage)).toMatchObject({ matrices: SAVED_MATRIX.matrices });
  });
});
