import { describe, expect, it } from 'vitest';
import {
  MATH_STATE_KEY,
  MATH_STATE_VERSION,
  emptyGraphing,
  emptyMathState,
  graphingSnapshot,
  loadGraphing,
  loadMathState,
  parseGraphingSection,
  parseMathState,
  saveGraphing,
  saveLastTool,
  serializeGraphingSection,
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
