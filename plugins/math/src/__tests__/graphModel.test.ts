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
  railCells,
  reduceGraph,
  windowReadout,
} from '../lib/graphModel';
import type { GraphState } from '../lib/graphModel';
import { evaluateCurve, resolveTrace } from '../lib/trace';

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
    const state = errorState();
    expect(railCells(graphCells(state.rows), state.sliders).map((cell) => cell.index)).toEqual([
      1, 2, 3,
    ]);
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

/* ================================================================== *
 * MATH3 — parameter sliders, trace, hydration
 * ================================================================== */

const curvesOf = (state: GraphState) => plottedCurves(graphCells(state.rows), state.sliders);
const rail = (state: GraphState) => railCells(graphCells(state.rows), state.sliders);

describe('parameter sliders — a free constant creates one (MATH3)', () => {
  it('auto-creates a default slider for the constant the row names', () => {
    const state = typeIntoTail(initialGraphState, 'a·sin(x)');
    expect(state.sliders).toEqual([
      { symbol: 'a', value: 1, min: -5, max: 5, step: 0.1 },
    ]);
  });

  it('plots the row rather than erroring on it — the constant is no longer unknown', () => {
    const state = typeIntoTail(initialGraphState, 'a·sin(x)');
    const cell = graphCells(state.rows)[0];
    expect(cell.error).toBeNull();
    expect(cell.fn).toBe('a*sin(x)');
    expect(cell.free).toEqual(['a']);
  });

  it('places the slider cell directly beneath its row, numbered in the same gutter', () => {
    // The wireframe's default state: 1 · a·sin(x), 2 · slider a, 3 · x²/4 − 2, 4 · blank.
    let state = typeIntoTail(initialGraphState, 'a·sin(x)');
    state = typeIntoTail(state, 'x^2/4 − 2');
    const cells = rail(state);
    expect(cells.map((cell) => cell.kind)).toEqual(['expr', 'slider', 'expr', 'expr']);
    expect(cells.map((cell) => cell.index)).toEqual([1, 2, 3, 4]);
    expect(cells[1]).toMatchObject({ kind: 'slider', ownerId: state.rows[0].id });
  });

  it('gives a constant shared by two rows a single slider, under the first of them', () => {
    let state = typeIntoTail(initialGraphState, 'a·sin(x)');
    state = typeIntoTail(state, 'a·x^2');
    expect(state.sliders.map((s) => s.symbol)).toEqual(['a']);
    const cells = rail(state);
    expect(cells.map((cell) => cell.kind)).toEqual(['expr', 'slider', 'expr', 'expr']);
  });

  it('creates one slider per constant, in the order they are written', () => {
    const state = typeIntoTail(initialGraphState, SUGGESTION_CHIPS[2]); // `a·x + b`
    expect(state.sliders.map((s) => s.symbol)).toEqual(['a', 'b']);
    expect(rail(state).map((cell) => cell.kind)).toEqual(['expr', 'slider', 'slider', 'expr']);
  });

  it('keeps the value the user dragged to when the row is edited around it', () => {
    let state = typeIntoTail(initialGraphState, 'a·sin(x)');
    state = reduceGraph(state, { type: 'setSliderValue', symbol: 'a', value: 2 });
    state = reduceGraph(state, { type: 'editRow', id: state.rows[0].id, src: 'a·cos(x)' });
    expect(state.sliders[0]).toMatchObject({ symbol: 'a', value: 2 });
  });

  it('drops the slider once nothing references its constant', () => {
    let state = typeIntoTail(initialGraphState, 'a·sin(x)');
    expect(state.sliders).toHaveLength(1);
    state = reduceGraph(state, { type: 'editRow', id: state.rows[0].id, src: 'sin(x)' });
    expect(state.sliders).toEqual([]);
    expect(rail(state).map((cell) => cell.kind)).toEqual(['expr', 'expr']);
  });

  it('drops the slider when the row that named the constant is deleted', () => {
    const state = typeIntoTail(initialGraphState, 'a·sin(x)');
    const deleted = reduceGraph(state, { type: 'deleteRow', id: state.rows[0].id });
    expect(deleted.sliders).toEqual([]);
  });

  it('ignores a value aimed at a slider that does not exist', () => {
    const state = typeIntoTail(initialGraphState, 'a·sin(x)');
    expect(reduceGraph(state, { type: 'setSliderValue', symbol: 'q', value: 3 })).toBe(state);
  });
});

describe('slider value → re-plot wiring (MATH3)', () => {
  function withParameter(): GraphState {
    return typeIntoTail(initialGraphState, 'a·sin(x)');
  }

  it('hands the sampler the slider’s value as the curve’s scope', () => {
    const state = withParameter();
    expect(curvesOf(state)).toEqual([
      { id: state.rows[0].id, fn: 'a*sin(x)', color: 'blue', scope: { a: 1 } },
    ]);
  });

  it('a drag changes the scope, never the expression — the same fn re-samples', () => {
    const before = curvesOf(withParameter())[0];
    const after = curvesOf(
      reduceGraph(withParameter(), { type: 'setSliderValue', symbol: 'a', value: 2 }),
    )[0];
    expect(after.fn).toBe(before.fn);
    expect(after.scope).toEqual({ a: 2 });
  });

  it('moves the drawn curve — the scope is what the value actually does', () => {
    const at = (state: GraphState) =>
      evaluateCurve(curvesOf(state)[0].fn, Math.PI / 2, curvesOf(state)[0].scope);
    expect(at(withParameter())).toBeCloseTo(1, 9);
    const dragged = reduceGraph(withParameter(), { type: 'setSliderValue', symbol: 'a', value: 2 });
    expect(at(dragged)).toBeCloseTo(2, 9);
  });

  it('narrows each curve’s scope to the constants it actually references', () => {
    let state = typeIntoTail(initialGraphState, 'a·sin(x)');
    state = typeIntoTail(state, 'k·x');
    expect(curvesOf(state).map((curve) => curve.scope)).toEqual([{ a: 1 }, { k: 1 }]);
  });

  it('snaps a dragged value onto the slider’s step and range', () => {
    const state = reduceGraph(withParameter(), { type: 'setSliderValue', symbol: 'a', value: 2.04 });
    expect(state.sliders[0].value).toBe(2);
    const clamped = reduceGraph(state, { type: 'setSliderValue', symbol: 'a', value: 99 });
    expect(clamped.sliders[0].value).toBe(5);
  });

  it('is a no-op when the value snaps back to where it already was', () => {
    const state = withParameter();
    expect(reduceGraph(state, { type: 'setSliderValue', symbol: 'a', value: 1.02 })).toBe(state);
  });
});

describe('▷ slider animation (MATH3)', () => {
  const started = () =>
    reduceGraph(typeIntoTail(initialGraphState, 'a·sin(x)'), {
      type: 'toggleAnimate',
      symbol: 'a',
    });

  it('starts and stops the sweep for one slider', () => {
    const running = started();
    expect(running.animating).toEqual({ a: 1 });
    expect(reduceGraph(running, { type: 'toggleAnimate', symbol: 'a' }).animating).toEqual({});
  });

  it('advances only the sweeping sliders, one step per tick', () => {
    let state = started();
    state = reduceGraph(state, { type: 'editRow', id: state.rows[1].id, src: 'k·x' });
    const ticked = reduceGraph(state, { type: 'tickAnimation' });
    expect(ticked.sliders.map((s) => s.value)).toEqual([1.1, 1]);
  });

  it('bounces at the bound rather than running off the end', () => {
    let state = reduceGraph(started(), { type: 'setSliderValue', symbol: 'a', value: 5 });
    state = reduceGraph(state, { type: 'tickAnimation' });
    expect(state.sliders[0].value).toBe(4.9);
    expect(state.animating).toEqual({ a: -1 });
  });

  it('does nothing when no slider is sweeping', () => {
    const idle = typeIntoTail(initialGraphState, 'a·sin(x)');
    expect(reduceGraph(idle, { type: 'tickAnimation' })).toBe(idle);
  });

  it('stops sweeping a constant that the rail no longer names', () => {
    const running = started();
    const edited = reduceGraph(running, { type: 'editRow', id: running.rows[0].id, src: 'sin(x)' });
    expect(edited.animating).toEqual({});
  });

  it('ignores ▷ for a slider that does not exist', () => {
    expect(reduceGraph(initialGraphState, { type: 'toggleAnimate', symbol: 'a' })).toBe(
      initialGraphState,
    );
  });
});

describe('pinned trace point (MATH3)', () => {
  function pinned(): GraphState {
    const state = typeIntoTail(initialGraphState, 'a·sin(x)');
    return reduceGraph(state, {
      type: 'setTrace',
      trace: { rowId: state.rows[0].id, x: Math.PI / 2 },
    });
  }

  it('pins a row and an abscissa — the ordinate is never stored', () => {
    const state = pinned();
    expect(state.trace).toEqual({ rowId: state.rows[0].id, x: Math.PI / 2 });
    expect(resolveTrace(curvesOf(state), state.trace)?.y).toBeCloseTo(1, 9);
  });

  it('rides the curve when the slider moves', () => {
    const dragged = reduceGraph(pinned(), { type: 'setSliderValue', symbol: 'a', value: 3 });
    expect(resolveTrace(curvesOf(dragged), dragged.trace)?.y).toBeCloseTo(3, 9);
  });

  it('keeps the pin but draws nothing while its row is hidden', () => {
    const state = pinned();
    const hidden = reduceGraph(state, { type: 'toggleVisible', id: state.rows[0].id });
    expect(hidden.trace).toEqual(state.trace);
    expect(resolveTrace(curvesOf(hidden), hidden.trace)).toBeNull();
  });

  it('survives a pan or zoom — it lives in data space, not pixels', () => {
    const zoomed = reduceGraph(pinned(), { type: 'zoomIn' });
    expect(zoomed.trace).toEqual(pinned().trace);
  });

  it('is cleared when the row it belongs to is deleted', () => {
    const state = pinned();
    expect(reduceGraph(state, { type: 'deleteRow', id: state.rows[0].id }).trace).toBeNull();
  });

  it('is cleared by a click on empty space', () => {
    expect(reduceGraph(pinned(), { type: 'setTrace', trace: null }).trace).toBeNull();
  });
});

describe('hydrating the saved graph (MATH3)', () => {
  const SAVED = {
    exprs: [
      { src: 'a·sin(x)', color: 'orange', visible: true },
      { src: 'x^2/4 − 2', color: 'green', visible: false },
    ],
    sliders: [{ symbol: 'a', value: 2, min: -5, max: 5, step: 0.1 }],
    viewport: { xDomain: [-10, 10] as [number, number], yDomain: [-4, 4] as [number, number] },
  };

  const hydrated = () => reduceGraph(initialGraphState, { type: 'hydrate', ...SAVED });

  it('restores the rows with their colours and visibility, plus a blank tail', () => {
    const state = hydrated();
    expect(state.rows.map((row) => row.src)).toEqual(['a·sin(x)', 'x^2/4 − 2', '']);
    // Saved rows keep the colour they were drawn in; the fresh blank tail takes the palette
    // entry for its position, exactly as it would in a rail that was never persisted.
    expect(state.rows.map((row) => row.color)).toEqual(['orange', 'green', 'green']);
    expect(state.rows.map((row) => row.visible)).toEqual([true, false, true]);
    expect(blankTailId(state)).toBe(state.rows[2].id);
  });

  it('restores the window and the slider the user left it at', () => {
    const state = hydrated();
    expect(state.viewport).toEqual(SAVED.viewport);
    expect(state.sliders).toEqual(SAVED.sliders);
    expect(curvesOf(state)[0].scope).toEqual({ a: 2 });
  });

  it('re-syncs sliders against what the restored rows really reference', () => {
    const state = reduceGraph(initialGraphState, {
      type: 'hydrate',
      exprs: [{ src: 'b·x' }],
      // `a` is stale (nothing names it) and `b` was never saved — one is dropped, one created.
      sliders: [{ symbol: 'a', value: 4, min: -5, max: 5, step: 0.1 }],
      viewport: DEFAULT_VIEWPORT,
    });
    expect(state.sliders).toEqual([{ symbol: 'b', value: 1, min: -5, max: 5, step: 0.1 }]);
  });

  it('opens on the blank first row when there is nothing saved', () => {
    const state = reduceGraph(initialGraphState, {
      type: 'hydrate',
      exprs: [],
      sliders: [],
      viewport: DEFAULT_VIEWPORT,
    });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].src).toBe('');
  });

  it('loses to the user — a restore that lands after the first keystroke is dropped', () => {
    // Storage is async; the rail must not be yanked out from under someone already typing.
    const typing = typeIntoTail(initialGraphState, 'sin(x)');
    const late = reduceGraph(typing, { type: 'hydrate', ...SAVED });
    expect(late).toBe(typing);
  });

  it('only ever restores once', () => {
    const state = hydrated();
    expect(reduceGraph(state, { type: 'hydrate', ...SAVED, exprs: [{ src: 'cos(x)' }] })).toBe(
      state,
    );
  });
});
