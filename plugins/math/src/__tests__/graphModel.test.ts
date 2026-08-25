import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEWPORT,
  GRAPH_PALETTE,
  SUGGESTION_CHIPS,
  ZOOM_STEP,
  blankTailId,
  graphCells,
  graphColorVar,
  initialGraphState,
  plottedCurves,
  reduceGraph,
  windowReadout,
} from '../lib/graphModel';
import type { GraphState } from '../lib/graphModel';

/** Type `src` into the row at `position` (0-based), as the rail's input does. */
function type(state: GraphState, position: number, src: string): GraphState {
  return reduceGraph(state, { type: 'editRow', id: state.rows[position].id, src });
}

/** Type into whichever row is currently the blank tail. */
function typeIntoTail(state: GraphState, src: string): GraphState {
  const id = blankTailId(state);
  expect(id, 'expected a blank tail').not.toBeNull();
  return reduceGraph(state, { type: 'editRow', id: id as string, src });
}

const sources = (state: GraphState) => state.rows.map((row) => row.src);

describe('graph rail — the always-present blank next cell (MATH2)', () => {
  it('starts with a single blank row, selected', () => {
    expect(initialGraphState.rows).toHaveLength(1);
    expect(initialGraphState.rows[0].src).toBe('');
    expect(initialGraphState.activeId).toBe(initialGraphState.rows[0].id);
    expect(blankTailId(initialGraphState)).toBe(initialGraphState.rows[0].id);
  });

  it('appends the next blank as soon as the tail is typed into', () => {
    const state = typeIntoTail(initialGraphState, 'sin(x)');
    expect(sources(state)).toEqual(['sin(x)', '']);
    // …and again for the row after that, so "add" is only ever typing.
    const two = typeIntoTail(state, 'x^2/4 − 2');
    expect(sources(two)).toEqual(['sin(x)', 'x^2/4 − 2', '']);
  });

  it('appends only once per row, however many keystrokes it takes', () => {
    let state = initialGraphState;
    for (const src of ['s', 'si', 'sin', 'sin(', 'sin(x', 'sin(x)']) {
      state = type(state, 0, src);
    }
    expect(sources(state)).toEqual(['sin(x)', '']);
  });

  it('does not append when a row above the tail is edited', () => {
    const state = typeIntoTail(initialGraphState, 'sin(x)');
    const edited = type(state, 0, 'cos(x)');
    expect(sources(edited)).toEqual(['cos(x)', '']);
  });

  it('keeps an emptied row — clearing text is not deleting the row', () => {
    const state = typeIntoTail(initialGraphState, 'sin(x)');
    const cleared = type(state, 0, '');
    expect(cleared.rows).toHaveLength(2);
    expect(sources(cleared)).toEqual(['', '']);
  });

  it('gives every row a stable id and palette colour, cycling through the six', () => {
    let state = initialGraphState;
    for (let i = 0; i < 7; i += 1) state = typeIntoTail(state, `x+${i}`);
    expect(state.rows.slice(0, 7).map((row) => row.color)).toEqual([
      ...GRAPH_PALETTE,
      GRAPH_PALETTE[0],
    ]);
    expect(new Set(state.rows.map((row) => row.id)).size).toBe(state.rows.length);
    expect(graphColorVar('blue')).toBe('var(--graph-blue)');
  });

  it('is deterministic — no clock, no RNG in the ids', () => {
    const once = typeIntoTail(initialGraphState, 'sin(x)');
    const twice = typeIntoTail(initialGraphState, 'sin(x)');
    expect(once.rows.map((r) => r.id)).toEqual(twice.rows.map((r) => r.id));
  });
});

describe('graph rail — delete and hide (MATH2)', () => {
  it('removes a row and keeps the blank tail', () => {
    let state = typeIntoTail(initialGraphState, 'sin(x)');
    state = typeIntoTail(state, 'cos(x)');
    const kept = reduceGraph(state, { type: 'deleteRow', id: state.rows[0].id });
    expect(sources(kept)).toEqual(['cos(x)', '']);
  });

  it('never leaves the rail without somewhere to type', () => {
    let state = typeIntoTail(initialGraphState, 'sin(x)');
    for (const row of [...state.rows]) {
      state = reduceGraph(state, { type: 'deleteRow', id: row.id });
    }
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].src).toBe('');
    expect(blankTailId(state)).toBe(state.rows[0].id);
  });

  it('clears the selection when the selected row is deleted', () => {
    const state = typeIntoTail(initialGraphState, 'sin(x)');
    const selected = reduceGraph(state, { type: 'selectRow', id: state.rows[0].id });
    const deleted = reduceGraph(selected, { type: 'deleteRow', id: state.rows[0].id });
    expect(deleted.activeId).toBeNull();
  });

  it('ignores actions aimed at a row that is gone', () => {
    for (const action of ['deleteRow', 'toggleVisible', 'editRow'] as const) {
      const next = reduceGraph(initialGraphState, {
        type: action,
        id: 'nope',
        src: 'x',
      } as never);
      expect(next).toBe(initialGraphState);
    }
  });

  it('hides a curve without losing its row, colour or text', () => {
    const state = typeIntoTail(initialGraphState, 'sin(x)');
    const hidden = reduceGraph(state, { type: 'toggleVisible', id: state.rows[0].id });
    expect(hidden.rows[0]).toMatchObject({ src: 'sin(x)', visible: false, color: 'blue' });
    expect(plottedCurves(graphCells(hidden.rows))).toEqual([]);
    // …and back again.
    const shown = reduceGraph(hidden, { type: 'toggleVisible', id: state.rows[0].id });
    expect(plottedCurves(graphCells(shown.rows))).toHaveLength(1);
  });
});

describe('graph rail — parse errors mark only their own row (MATH2)', () => {
  /** The wireframe's error state: a valid curve above a row that fails to parse. */
  function errorState(): GraphState {
    let state = typeIntoTail(initialGraphState, 'x^2/4 − 2');
    state = typeIntoTail(state, '2x^3 −');
    return state;
  }

  it('marks the failing row and leaves the valid one plotting', () => {
    const cells = graphCells(errorState().rows);
    expect(cells).toHaveLength(3);

    expect(cells[0].error).toBeNull();
    expect(cells[0].fn).toBe('x^2/4 - 2');

    expect(cells[1].error).toMatch(/Unexpected end of expression/);
    expect(cells[1].fn).toBeNull();

    // The always-present blank tail is neither an error nor a curve.
    expect(cells[2]).toMatchObject({ blank: true, error: null, fn: null });
  });

  it('draws exactly the valid curve — the broken row takes nothing with it', () => {
    const curves = plottedCurves(graphCells(errorState().rows));
    expect(curves).toHaveLength(1);
    expect(curves[0]).toMatchObject({ fn: 'x^2/4 - 2', color: 'blue' });
  });

  it('keeps a curve plotting while a *later* row is mid-typing', () => {
    let state = typeIntoTail(initialGraphState, 'sin(x)');
    state = typeIntoTail(state, 'x^'); // half-typed
    const cells = graphCells(state.rows);
    expect(cells[1].error).toBeTruthy();
    expect(plottedCurves(cells).map((c) => c.fn)).toEqual(['sin(x)']);
  });

  it('numbers the gutter by rail position, error rows included', () => {
    expect(graphCells(errorState().rows).map((cell) => cell.index)).toEqual([1, 2, 3]);
  });

  it('reports an undetermined parameter as the row’s error (sliders are MATH3)', () => {
    const state = typeIntoTail(initialGraphState, 'a·x + b');
    const cell = graphCells(state.rows)[0];
    expect(cell.error).toBe('Unknown variables “a”, “b”');
    expect(cell.fn).toBeNull();

    const single = graphCells(typeIntoTail(initialGraphState, 'a*x').rows)[0];
    expect(single.error).toBe('Unknown variable “a”');
  });

  it('marks a row that reaches for a blocked symbol', () => {
    const state = typeIntoTail(initialGraphState, 'import("./evil.js")');
    const cell = graphCells(state.rows)[0];
    expect(cell.error).toContain('“import” is not allowed');
    expect(plottedCurves(graphCells(state.rows))).toEqual([]);
  });
});

describe('graph viewport — zoom stack and readout (MATH2)', () => {
  it('opens on the wireframe’s window', () => {
    expect(initialGraphState.viewport).toEqual(DEFAULT_VIEWPORT);
    expect(windowReadout(DEFAULT_VIEWPORT)).toBe('−6.7 ≤ x ≤ 6.7 · −4.9 ≤ y ≤ 4.9');
  });

  it('zooms about the centre, narrowing in and widening out', () => {
    const zoomed = reduceGraph(initialGraphState, { type: 'zoomIn' });
    const width = zoomed.viewport.xDomain[1] - zoomed.viewport.xDomain[0];
    expect(width).toBeCloseTo(13.4 / ZOOM_STEP, 6);
    // Centred: symmetric bounds stay symmetric.
    expect(zoomed.viewport.xDomain[0]).toBeCloseTo(-zoomed.viewport.xDomain[1], 6);

    const out = reduceGraph(initialGraphState, { type: 'zoomOut' });
    expect(out.viewport.xDomain[1] - out.viewport.xDomain[0]).toBeCloseTo(13.4 * ZOOM_STEP, 6);
  });

  it('zooms an off-centre window about its own centre, not the origin', () => {
    const panned = reduceGraph(initialGraphState, {
      type: 'setViewport',
      viewport: { xDomain: [0, 10], yDomain: [0, 10] },
    });
    const zoomed = reduceGraph(panned, { type: 'zoomIn' });
    const middle = (zoomed.viewport.xDomain[0] + zoomed.viewport.xDomain[1]) / 2;
    expect(middle).toBeCloseTo(5, 6);
  });

  it('round-trips in and out, and reset returns to the default window', () => {
    const there = reduceGraph(initialGraphState, { type: 'zoomIn' });
    const back = reduceGraph(there, { type: 'zoomOut' });
    expect(back.viewport.xDomain[0]).toBeCloseTo(DEFAULT_VIEWPORT.xDomain[0], 6);

    const panned = reduceGraph(there, {
      type: 'setViewport',
      viewport: { xDomain: [100, 200], yDomain: [-3, 3] },
    });
    expect(reduceGraph(panned, { type: 'resetView' }).viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it('accepts a window reported back by a pan and reads it out', () => {
    const panned = reduceGraph(initialGraphState, {
      type: 'setViewport',
      viewport: { xDomain: [-1.25, 8], yDomain: [0, 120] },
    });
    expect(windowReadout(panned.viewport)).toBe('−1.3 ≤ x ≤ 8 · 0 ≤ y ≤ 120');
  });

  it('does not accumulate float noise across repeated zooms', () => {
    let state = initialGraphState;
    for (let i = 0; i < 8; i += 1) state = reduceGraph(state, { type: 'zoomOut' });
    for (const bound of [...state.viewport.xDomain, ...state.viewport.yDomain]) {
      expect(String(bound).replace('-', '').replace('.', '').length).toBeLessThanOrEqual(12);
    }
  });
});

describe('graph empty state (MATH2)', () => {
  it('offers the wireframe’s three suggestion chips', () => {
    expect(SUGGESTION_CHIPS).toEqual(['sin(x)', 'x^2 − 2', 'a·x + b']);
  });

  it('a chip typed into the blank tail plots straight away', () => {
    const state = typeIntoTail(initialGraphState, SUGGESTION_CHIPS[0]);
    expect(plottedCurves(graphCells(state.rows)).map((c) => c.fn)).toEqual(['sin(x)']);
  });

  it('the canvas is empty until a row parses', () => {
    expect(plottedCurves(graphCells(initialGraphState.rows))).toEqual([]);
    const typing = typeIntoTail(initialGraphState, 'x^');
    expect(plottedCurves(graphCells(typing.rows))).toEqual([]);
  });
});
