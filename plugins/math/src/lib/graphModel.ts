/**
 * Math — the Graphing tool's rail + viewport model (MATH2), as a pure reducer so the whole
 * tool is testable without React or a DOM.
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
 *    take a valid neighbour's curve off the canvas.
 *
 * Sliders for free parameters, the pinned trace point, and persistence of any of this are
 * MATH3 — hence `free` symbols surface as an error row here rather than as a slider.
 */

import { parseExpression } from './expr';

/** The shared graph palette, in wireframe order; rows cycle through it. */
export const GRAPH_PALETTE = ['blue', 'orange', 'green', 'red', 'purple', 'teal'] as const;
export type GraphColorName = (typeof GRAPH_PALETTE)[number];

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
}

function makeRow(seq: number): GraphRow {
  return {
    id: `g${seq}`,
    src: '',
    color: GRAPH_PALETTE[(seq - 1) % GRAPH_PALETTE.length],
    visible: true,
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

export const initialGraphState: GraphState = {
  rows: [makeRow(1)],
  activeId: 'g1',
  viewport: DEFAULT_VIEWPORT,
  seq: 2,
};

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
  | { type: 'setViewport'; viewport: GraphViewport };

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
      return { ...state, rows: tail.rows, seq: tail.seq };
    }

    case 'deleteRow': {
      if (!state.rows.some((row) => row.id === action.id)) return state;
      const kept = state.rows.filter((row) => row.id !== action.id);
      const tail = ensureBlankTail(kept, state.seq);
      return {
        ...state,
        rows: tail.rows,
        seq: tail.seq,
        activeId: state.activeId === action.id ? null : state.activeId,
      };
    }

    case 'toggleVisible': {
      if (!state.rows.some((row) => row.id === action.id)) return state;
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.id ? { ...row, visible: !row.visible } : row,
        ),
      };
    }

    case 'selectRow':
      if (action.id === state.activeId) return state;
      return { ...state, activeId: action.id };

    case 'zoomIn':
      return { ...state, viewport: zoom(state.viewport, 1 / ZOOM_STEP) };

    case 'zoomOut':
      return { ...state, viewport: zoom(state.viewport, ZOOM_STEP) };

    case 'resetView':
      return { ...state, viewport: DEFAULT_VIEWPORT };

    case 'setViewport':
      return { ...state, viewport: action.viewport };

    default:
      return state;
  }
}

/** The id of the always-present blank tail — what "Add" focuses and a chip fills in. */
export function blankTailId(state: GraphState): string | null {
  const last = state.rows[state.rows.length - 1];
  return last && isBlankRow(last) ? last.id : null;
}

/** One rendered rail row: the wireframe's index gutter, swatch/warning, and inline error. */
export interface GraphCell {
  row: GraphRow;
  /** 1-based position in the rail — the index gutter, blank tail included. */
  index: number;
  blank: boolean;
  /** the inline parse error for *this row only*, or null. */
  error: string | null;
  /** the plot-ready expression when this row can be drawn, else null. */
  fn: string | null;
}

function describeFree(free: string[]): string {
  const named = free.map((symbol) => `“${symbol}”`).join(', ');
  return free.length === 1 ? `Unknown variable ${named}` : `Unknown variables ${named}`;
}

/**
 * Derive the rail. Every row is parsed independently — that independence *is* the error
 * isolation the wireframe's error state shows.
 */
export function graphCells(rows: readonly GraphRow[]): GraphCell[] {
  return rows.map((row, position) => {
    const index = position + 1;
    if (isBlankRow(row)) return { row, index, blank: true, error: null, fn: null };

    const parsed = parseExpression(row.src);
    if (!parsed.ok) return { row, index, blank: false, error: parsed.message, fn: null };
    // Undetermined parameters can't be sampled yet; MATH3 replaces this with a slider cell.
    if (parsed.free.length > 0) {
      return { row, index, blank: false, error: describeFree(parsed.free), fn: null };
    }
    return { row, index, blank: false, error: null, fn: parsed.normalized };
  });
}

export interface GraphCurve {
  id: string;
  /** the plot-ready expression string function-plot samples. */
  fn: string;
  color: GraphColorName;
}

/** The curves the canvas draws: parsed, determinate, and not hidden. */
export function plottedCurves(cells: readonly GraphCell[]): GraphCurve[] {
  const curves: GraphCurve[] = [];
  for (const cell of cells) {
    if (cell.fn && cell.row.visible) curves.push({ id: cell.row.id, fn: cell.fn, color: cell.row.color });
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
