/**
 * Math — the Graphing tool's rail + viewport model (MATH2, extended by MATH3), as a pure
 * reducer so the whole tool is testable without React or a DOM.
 *
 * Per the approved wireframe's fresh design (hairline rows + index gutter, **not** the
 * retired card-per-row draft):
 *
 *  - a **blank next cell is always present** — "add" is just typing, so the reducer's only
 *    structural invariant is that the last row is blank ({@link ensureBlankTail});
 *  - each row carries one of the shared **6-color graph palette** entries, assigned at
 *    creation so deleting a row never recolours the ones above it;
 *  - **errors are isolated by construction**: {@link graphCells} parses each row on its own
 *    and {@link plottedCurves} filters, so a row that fails to parse marks itself and cannot
 *    take a valid neighbour's curve off the canvas;
 *  - a **free constant auto-creates a slider cell beneath its row** (MATH3) — sliders are not
 *    added, they are a function of the rail's free symbols, so every action that can change a
 *    row's text runs {@link syncSliders} (see `lib/sliders.ts`);
 *  - a **click on a curve pins a trace point** as `{ rowId, x }` only; the ordinate is
 *    re-derived per render (see `lib/trace.ts`) so the pin rides slider drags and edits.
 *
 * `hydrated` mirrors the shell's `restored` flag: plugin storage resolves asynchronously, so
 * a restore that lands *after* the user has started typing must not clobber what they typed.
 */

import { parseExpression } from './expr';
import { advanceSlider, scanFreeSymbols, scopeFor, snapToStep, syncSliders } from './sliders';
import type { SliderDirection, SliderState } from './sliders';
import type { GraphTrace } from './trace';

/** The shared graph palette, in wireframe order; rows cycle through it. */
export const GRAPH_PALETTE = ['blue', 'orange', 'green', 'red', 'purple', 'teal'] as const;
export type GraphColorName = (typeof GRAPH_PALETTE)[number];

/** Narrow an untrusted (persisted) colour name onto the palette. */
export function isGraphColor(value: unknown): value is GraphColorName {
  return typeof value === 'string' && (GRAPH_PALETTE as readonly string[]).includes(value);
}

/** Curves are drawn in CSS vars, so a theme switch recolours them with no redraw of ours. */
export function graphColorVar(color: GraphColorName): string {
  return `var(--graph-${color})`;
}

export interface GraphRow {
  id: string;
  src: string;
  color: GraphColorName;
  visible: boolean;
}

export interface GraphViewport {
  xDomain: readonly [number, number];
  yDomain: readonly [number, number];
}

/** The wireframe's window readout: `−6.7 ≤ x ≤ 6.7 · −4.9 ≤ y ≤ 4.9`. */
export const DEFAULT_VIEWPORT: GraphViewport = {
  xDomain: [-6.7, 6.7],
  yDomain: [-4.9, 4.9],
};

/** Multiplier one press of the zoom stack applies to each domain's width. */
export const ZOOM_STEP = 1.6;

/** Suggestion chips on the empty canvas, verbatim from the wireframe. */
export const SUGGESTION_CHIPS: readonly string[] = ['sin(x)', 'x^2 − 2', 'a·x + b'];

export interface GraphState {
  rows: GraphRow[];
  /** the row whose cell is selected — shows its actions and the accent edge. */
  activeId: string | null;
  viewport: GraphViewport;
  /** monotonic row counter; also drives id and palette assignment (no clock, no RNG). */
  seq: number;
  /** one per free symbol in the rail, reconciled on every text change (MATH3). */
  sliders: SliderState[];
  /** symbols the ▷ button is currently sweeping, with the direction each is travelling. */
  animating: Record<string, SliderDirection>;
  /** the pinned trace point, or null (MATH3). */
  trace: GraphTrace | null;
  /**
   * True once persisted state has been applied — or once the user touched the rail, which
   * makes a late restore moot. Guards the mount-time race the shell's `restored` also guards.
   */
  hydrated: boolean;
}

function makeRow(seq: number, seed?: GraphRowSeed): GraphRow {
  const color = seed?.color;
  const visible = seed?.visible;
  return {
    id: `g${seq}`,
    src: typeof seed?.src === 'string' ? seed.src : '',
    color: isGraphColor(color) ? color : GRAPH_PALETTE[(seq - 1) % GRAPH_PALETTE.length],
    visible: typeof visible === 'boolean' ? visible : true,
  };
}

export function isBlankRow(row: GraphRow): boolean {
  return row.src.trim() === '';
}

/**
 * The one structural invariant: the rail always ends in a blank cell, so typing into it
 * appends the next one. Emptying a row never *removes* it — that stays an explicit delete.
 */
function ensureBlankTail(rows: GraphRow[], seq: number): { rows: GraphRow[]; seq: number } {
  const last = rows[rows.length - 1];
  if (last && isBlankRow(last)) return { rows, seq };
  return { rows: [...rows, makeRow(seq)], seq: seq + 1 };
}

/**
 * Re-derive the slider list (and prune animations for symbols that just vanished) after any
 * change to the rail's text. Cheap enough to run per keystroke: a handful of short rows.
 */
function withSliders(state: GraphState, rows: GraphRow[]): GraphState {
  const sliders = syncSliders(state.sliders, scanFreeSymbols(rows.map((row) => row.src)));
  if (sliders === state.sliders) return { ...state, rows };

  const animating: Record<string, SliderDirection> = {};
  for (const slider of sliders) {
    const direction = state.animating[slider.symbol];
    if (direction) animating[slider.symbol] = direction;
  }
  return { ...state, rows, sliders, animating };
}

export const initialGraphState: GraphState = {
  rows: [makeRow(1)],
  activeId: 'g1',
  viewport: DEFAULT_VIEWPORT,
  seq: 2,
  sliders: [],
  animating: {},
  trace: null,
  hydrated: false,
};

/** One persisted expression row, as `lib/persist.ts` stores it (no runtime id). */
export interface GraphRowSeed {
  src: string;
  color?: unknown;
  visible?: unknown;
}

export type GraphAction =
  /** edit one row's source; typing into the blank tail appends the next blank. */
  | { type: 'editRow'; id: string; src: string }
  | { type: 'deleteRow'; id: string }
  /** the eye action — a hidden row keeps its slot and colour, it just stops plotting. */
  | { type: 'toggleVisible'; id: string }
  | { type: 'selectRow'; id: string | null }
  | { type: 'zoomIn' }
  | { type: 'zoomOut' }
  | { type: 'resetView' }
  /** the canvas reporting back after a pan / wheel-zoom. */
  | { type: 'setViewport'; viewport: GraphViewport }
  /** drag (or arrow-key) on a slider track. */
  | { type: 'setSliderValue'; symbol: string; value: number }
  /** the ▷ button — start or stop sweeping one slider. */
  | { type: 'toggleAnimate'; symbol: string }
  /** one animation frame: advance every sweeping slider by a step, bouncing at the bounds. */
  | { type: 'tickAnimation' }
  /** a click on a curve, resolved to a row + abscissa by `lib/trace.ts`. */
  | { type: 'setTrace'; trace: GraphTrace | null }
  /** apply the state restored from `storage.graphing` on mount. */
  | { type: 'hydrate'; exprs: readonly GraphRowSeed[]; sliders: readonly SliderState[]; viewport: GraphViewport };

/** Trim float noise so panning does not grow endless decimals in the readout. */
function tidy(value: number): number {
  return Number(value.toFixed(6));
}

function scaleDomain(domain: readonly [number, number], factor: number): [number, number] {
  const middle = (domain[0] + domain[1]) / 2;
  const half = ((domain[1] - domain[0]) / 2) * factor;
  return [tidy(middle - half), tidy(middle + half)];
}

function zoom(viewport: GraphViewport, factor: number): GraphViewport {
  return {
    xDomain: scaleDomain(viewport.xDomain, factor),
    yDomain: scaleDomain(viewport.yDomain, factor),
  };
}

export function reduceGraph(state: GraphState, action: GraphAction): GraphState {
  switch (action.type) {
    case 'editRow': {
      if (!state.rows.some((row) => row.id === action.id)) return state;
      const edited = state.rows.map((row) =>
        row.id === action.id ? { ...row, src: action.src } : row,
      );
      const tail = ensureBlankTail(edited, state.seq);
      return { ...withSliders(state, tail.rows), seq: tail.seq, hydrated: true };
    }

    case 'deleteRow': {
      if (!state.rows.some((row) => row.id === action.id)) return state;
      const kept = state.rows.filter((row) => row.id !== action.id);
      const tail = ensureBlankTail(kept, state.seq);
      return {
        ...withSliders(state, tail.rows),
        seq: tail.seq,
        activeId: state.activeId === action.id ? null : state.activeId,
        // The pin belonged to a row that no longer exists — nothing to ride.
        trace: state.trace?.rowId === action.id ? null : state.trace,
        hydrated: true,
      };
    }

    case 'toggleVisible': {
      if (!state.rows.some((row) => row.id === action.id)) return state;
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.id ? { ...row, visible: !row.visible } : row,
        ),
        hydrated: true,
      };
    }

    case 'selectRow':
      if (action.id === state.activeId) return state;
      return { ...state, activeId: action.id };

    case 'zoomIn':
      return { ...state, viewport: zoom(state.viewport, 1 / ZOOM_STEP), hydrated: true };

    case 'zoomOut':
      return { ...state, viewport: zoom(state.viewport, ZOOM_STEP), hydrated: true };

    case 'resetView':
      return { ...state, viewport: DEFAULT_VIEWPORT, hydrated: true };

    case 'setViewport':
      return { ...state, viewport: action.viewport, hydrated: true };

    case 'setSliderValue': {
      const target = state.sliders.find((slider) => slider.symbol === action.symbol);
      if (!target) return state;
      const value = snapToStep(target, action.value);
      if (value === target.value) return state;
      return {
        ...state,
        sliders: state.sliders.map((slider) =>
          slider.symbol === action.symbol ? { ...slider, value } : slider,
        ),
        hydrated: true,
      };
    }

    case 'toggleAnimate': {
      if (!state.sliders.some((slider) => slider.symbol === action.symbol)) return state;
      const animating = { ...state.animating };
      if (animating[action.symbol]) delete animating[action.symbol];
      else animating[action.symbol] = 1;
      return { ...state, animating };
    }

    case 'tickAnimation': {
      const symbols = Object.keys(state.animating);
      if (symbols.length === 0) return state;
      const animating = { ...state.animating };
      const sliders = state.sliders.map((slider) => {
        const direction = animating[slider.symbol];
        if (!direction) return slider;
        const next = advanceSlider(slider, direction);
        animating[slider.symbol] = next.direction;
        return next.value === slider.value ? slider : { ...slider, value: next.value };
      });
      return { ...state, sliders, animating, hydrated: true };
    }

    case 'setTrace':
      return { ...state, trace: action.trace };

    case 'hydrate': {
      // Only the first restore counts; after that the user is driving.
      if (state.hydrated) return state;
      let seq = 1;
      const restored = action.exprs
        .filter((seed) => typeof seed?.src === 'string' && seed.src.trim() !== '')
        .map((seed) => {
          const row = makeRow(seq, seed);
          seq += 1;
          return row;
        });
      const tail = ensureBlankTail(restored, seq);
      // Sync against what the restored rows *actually* reference: a saved slider whose symbol
      // is gone is dropped, and a symbol that never got one still gets its default.
      const sliders = syncSliders(action.sliders, scanFreeSymbols(tail.rows.map((row) => row.src)));
      return {
        ...state,
        rows: tail.rows,
        seq: tail.seq,
        activeId: null,
        viewport: action.viewport,
        sliders,
        animating: {},
        hydrated: true,
      };
    }

    default:
      return state;
  }
}

/** The id of the always-present blank tail — what "Add" focuses and a chip fills in. */
export function blankTailId(state: GraphState): string | null {
  const last = state.rows[state.rows.length - 1];
  return last && isBlankRow(last) ? last.id : null;
}

/** One parsed expression row: the wireframe's swatch/warning gutter and inline error. */
export interface GraphCell {
  row: GraphRow;
  blank: boolean;
  /** the inline parse error for *this row only*, or null. */
  error: string | null;
  /** the plot-ready expression when this row can be drawn, else null. */
  fn: string | null;
  /** free symbols this row introduces — each of them owns a slider cell (MATH3). */
  free: string[];
}

/**
 * Derive the parsed rail. Every row is parsed independently — that independence *is* the
 * error isolation the wireframe's error state shows.
 *
 * A row's free symbols are *not* an error since MATH3: every one of them has a slider, so the
 * row plots at whatever value the slider currently holds.
 */
export function graphCells(rows: readonly GraphRow[]): GraphCell[] {
  return rows.map((row) => {
    if (isBlankRow(row)) return { row, blank: true, error: null, fn: null, free: [] };

    const parsed = parseExpression(row.src);
    if (!parsed.ok) return { row, blank: false, error: parsed.message, fn: null, free: [] };
    return { row, blank: false, error: null, fn: parsed.normalized, free: parsed.free };
  });
}

/**
 * One rendered rail row. Sliders sit *in* the rail rather than beside it, so the wireframe's
 * index gutter numbers them too (`1` expression, `2` its slider, `3` the next expression).
 */
export type RailCell =
  | { kind: 'expr'; index: number; cell: GraphCell }
  | { kind: 'slider'; index: number; slider: SliderState; ownerId: string };

/**
 * Interleave slider cells into the rail: each free symbol's slider appears directly beneath
 * the **first** row that introduces it, and the gutter numbers run through both kinds.
 */
export function railCells(
  cells: readonly GraphCell[],
  sliders: readonly SliderState[],
): RailCell[] {
  const bySymbol = new Map(sliders.map((slider) => [slider.symbol, slider]));
  const placed = new Set<string>();
  const rail: RailCell[] = [];
  let index = 1;

  for (const cell of cells) {
    rail.push({ kind: 'expr', index, cell });
    index += 1;
    for (const symbol of cell.free) {
      const slider = bySymbol.get(symbol);
      if (!slider || placed.has(symbol)) continue;
      placed.add(symbol);
      rail.push({ kind: 'slider', index, slider, ownerId: cell.row.id });
      index += 1;
    }
  }
  return rail;
}

export interface GraphCurve {
  id: string;
  /** the plot-ready expression string function-plot samples. */
  fn: string;
  color: GraphColorName;
  /** slider values this curve's free symbols resolve to, handed to the sampler as `scope`. */
  scope: Record<string, number>;
}

/** The curves the canvas draws: parsed, determinate, and not hidden. */
export function plottedCurves(
  cells: readonly GraphCell[],
  sliders: readonly SliderState[] = [],
): GraphCurve[] {
  const curves: GraphCurve[] = [];
  for (const cell of cells) {
    if (!cell.fn || !cell.row.visible) continue;
    curves.push({
      id: cell.row.id,
      fn: cell.fn,
      color: cell.row.color,
      scope: scopeFor(sliders, cell.free),
    });
  }
  return curves;
}

/** Format one bound with the wireframe's typographic minus and no trailing `.0`. */
function formatBound(value: number): string {
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  return rounded.replace(/\.0$/, '').replace(/^-/, '−');
}

/** The canvas's bottom-left readout: `−6.7 ≤ x ≤ 6.7 · −4.9 ≤ y ≤ 4.9`. */
export function windowReadout(viewport: GraphViewport): string {
  const [x0, x1] = viewport.xDomain;
  const [y0, y1] = viewport.yDomain;
  return (
    `${formatBound(x0)} ≤ x ≤ ${formatBound(x1)} · ` +
    `${formatBound(y0)} ≤ y ≤ ${formatBound(y1)}`
  );
}
