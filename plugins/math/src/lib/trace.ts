/**
 * Math — the Graphing canvas's pinned trace point (MATH3).
 *
 * Wireframe: *"Clicking a curve pins a trace point with coordinates."* The pin stores only
 * **which row and which x** ({@link GraphTrace}); the y is re-derived on every render by
 * {@link resolveTrace}. That is what makes the trace follow its curve for free — drag the `a`
 * slider and the dot rides `a·sin(x)` up and down, edit the row and it lands on the new
 * curve, hide or delete the row and it simply stops resolving.
 *
 * Sampling is mathjs's, not function-plot's: the plotter's sampler is wired to its own
 * scales and only yields the polyline it drew. Since `lib/expr.ts` deliberately whitelists
 * the **intersection** of the two vocabularies, evaluating the same normalized string here
 * gives the same value the drawn curve passes through.
 */

import { mathEngine } from './mathEngine';
import type { GraphCurve } from './graphModel';

/** What a pinned trace stores: a row and an abscissa. Everything else is derived. */
export interface GraphTrace {
  rowId: string;
  x: number;
}

export interface ResolvedTrace {
  rowId: string;
  x: number;
  y: number;
  /** the owning row's palette colour, so the dot matches its curve. */
  color: GraphCurve['color'];
}

/** mathjs compiles are not free and a drag re-evaluates on every frame; cache by source. */
const compiled = new Map<string, { evaluate(scope: Record<string, number>): unknown }>();

function compile(fn: string) {
  let entry = compiled.get(fn);
  if (!entry) {
    entry = mathEngine.compile(fn);
    compiled.set(fn, entry);
  }
  return entry;
}

/**
 * Evaluate a plot-ready expression at `x`. Returns null wherever the curve has no finite
 * value — a pole, a gap, a domain edge — which is also "there is nothing here to pin".
 */
export function evaluateCurve(
  fn: string,
  x: number,
  scope: Record<string, number> = {},
): number | null {
  try {
    // A fresh scope object per call: the compiled expression can assign into it (it cannot —
    // `lib/expr.ts` refuses assignments — but the shared engine must not be reachable either).
    const value = compile(fn).evaluate({ ...scope, x });
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Which curve a click at `(x, y)` lands on — the closest one whose value at that abscissa is
 * within `tolerance` (data units, converted from a pixel radius by the caller, since only the
 * canvas knows the current scale). Null when the click was on empty space.
 */
export function pickTrace(
  curves: readonly GraphCurve[],
  at: { x: number; y: number },
  tolerance: number,
): GraphTrace | null {
  let best: GraphTrace | null = null;
  let bestDistance = Infinity;
  for (const curve of curves) {
    const y = evaluateCurve(curve.fn, at.x, curve.scope);
    if (y === null) continue;
    const distance = Math.abs(y - at.y);
    if (distance <= tolerance && distance < bestDistance) {
      bestDistance = distance;
      best = { rowId: curve.id, x: at.x };
    }
  }
  return best;
}

/**
 * Resolve a pinned trace against the curves being drawn *now*. Null whenever the row it
 * points at is no longer plotted (deleted, hidden, mid-edit, or newly unparseable) — the pin
 * survives, it just draws nothing until its curve comes back.
 */
export function resolveTrace(
  curves: readonly GraphCurve[],
  trace: GraphTrace | null,
): ResolvedTrace | null {
  if (!trace) return null;
  const curve = curves.find((candidate) => candidate.id === trace.rowId);
  if (!curve) return null;
  const y = evaluateCurve(curve.fn, trace.x, curve.scope);
  if (y === null) return null;
  return { rowId: curve.id, x: trace.x, y, color: curve.color };
}

/** Decimals the wireframe's tooltip shows: `(1.571, 2.000)`. */
export const TRACE_PRECISION = 3;

/** The coordinate tooltip's label, with the typographic minus the readout also uses. */
export function formatTraceLabel(x: number, y: number): string {
  const part = (value: number) => {
    const fixed = value.toFixed(TRACE_PRECISION);
    // `-0.0001` rounds to `-0.000`; a signed zero reads as a bug in a coordinate readout.
    return (Number(fixed) === 0 ? fixed.replace(/^-/, '') : fixed).replace(/^-/, '−');
  };
  return `(${part(x)}, ${part(y)})`;
}
