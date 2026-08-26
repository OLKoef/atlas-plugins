import { describe, expect, it } from 'vitest';
import { evaluateCurve, formatTraceLabel, pickTrace, resolveTrace } from '../lib/trace';
import type { GraphCurve } from '../lib/graphModel';

/** The wireframe's canvas: `a·sin(x)` in blue with `a = 2`, `x²/4 − 2` in orange. */
const CURVES: GraphCurve[] = [
  { id: 'g1', fn: 'a*sin(x)', color: 'blue', scope: { a: 2 } },
  { id: 'g2', fn: 'x^2/4 - 2', color: 'orange', scope: {} },
];

const HALF_PI = Math.PI / 2;

describe('evaluateCurve (MATH3)', () => {
  it('samples the same string function-plot draws, at the slider’s value', () => {
    expect(evaluateCurve('a*sin(x)', HALF_PI, { a: 2 })).toBeCloseTo(2, 9);
    expect(evaluateCurve('a*sin(x)', HALF_PI, { a: 3 })).toBeCloseTo(3, 9);
  });

  it('understands the constants the whitelist folds onto the shared spelling', () => {
    expect(evaluateCurve('x + PI', 0, {})).toBeCloseTo(Math.PI, 9);
  });

  it('returns null where a curve has no finite value', () => {
    expect(evaluateCurve('1/x', 0, {})).toBeNull();
    expect(evaluateCurve('sqrt(x)', -1, {})).toBeNull();
  });

  it('returns null rather than throwing on an unbound symbol', () => {
    expect(evaluateCurve('a*sin(x)', 1, {})).toBeNull();
  });
});

describe('pickTrace — clicking a curve pins a point (MATH3)', () => {
  it('pins the curve the click landed on', () => {
    expect(pickTrace(CURVES, { x: HALF_PI, y: 1.95 }, 0.5)).toEqual({ rowId: 'g1', x: HALF_PI });
  });

  it('pins nothing when the click is on empty space', () => {
    expect(pickTrace(CURVES, { x: HALF_PI, y: 4 }, 0.5)).toBeNull();
    expect(pickTrace([], { x: 0, y: 0 }, 0.5)).toBeNull();
  });

  it('picks the nearest curve when two run close together', () => {
    // At x = 0: `a·sin(x)` is 0 and `x²/4 − 2` is −2. A click at −1.8 belongs to the parabola.
    expect(pickTrace(CURVES, { x: 0, y: -1.8 }, 2.5)?.rowId).toBe('g2');
    expect(pickTrace(CURVES, { x: 0, y: 0.2 }, 2.5)?.rowId).toBe('g1');
  });

  it('skips a curve that has no value at the clicked abscissa', () => {
    const pole: GraphCurve[] = [{ id: 'g9', fn: '1/x', color: 'red', scope: {} }];
    expect(pickTrace(pole, { x: 0, y: 0 }, 5)).toBeNull();
  });
});

describe('resolveTrace — the pin rides its curve (MATH3)', () => {
  const pinned = { rowId: 'g1', x: HALF_PI };

  it('re-derives the ordinate from the curve being drawn now', () => {
    expect(resolveTrace(CURVES, pinned)).toMatchObject({ rowId: 'g1', color: 'blue' });
    expect(resolveTrace(CURVES, pinned)?.y).toBeCloseTo(2, 9);
  });

  it('follows a slider drag — same pin, new value', () => {
    const dragged = CURVES.map((curve) =>
      curve.id === 'g1' ? { ...curve, scope: { a: 4 } } : curve,
    );
    expect(resolveTrace(dragged, pinned)?.y).toBeCloseTo(4, 9);
  });

  it('draws nothing while its row is hidden, deleted or unparseable', () => {
    // `plottedCurves` is what drops those rows, so the trace simply stops resolving.
    expect(resolveTrace([CURVES[1]], pinned)).toBeNull();
    expect(resolveTrace(CURVES, null)).toBeNull();
  });

  it('draws nothing where the curve has no value at the pinned abscissa', () => {
    const pole: GraphCurve[] = [{ id: 'g1', fn: '1/x', color: 'blue', scope: {} }];
    expect(resolveTrace(pole, { rowId: 'g1', x: 0 })).toBeNull();
  });
});

describe('formatTraceLabel (MATH3)', () => {
  it('writes the wireframe’s tooltip verbatim', () => {
    expect(formatTraceLabel(HALF_PI, 2)).toBe('(1.571, 2.000)');
  });

  it('uses the typographic minus the window readout also uses', () => {
    expect(formatTraceLabel(-1.5, -0.25)).toBe('(−1.500, −0.250)');
  });

  it('never writes a signed zero', () => {
    expect(formatTraceLabel(-0.0001, 0)).toBe('(0.000, 0.000)');
  });
});
