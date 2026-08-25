/**
 * Math — the Graphing tool's parameter sliders (MATH3).
 *
 * The wireframe's rule, verbatim: *"Defining a new constant in an expression (e.g. `a`)
 * auto-creates a slider cell beneath it (default −5…5, step 0.1, ▷ animates)."* So a slider
 * is never *added* — it is a **function of the rail's free symbols**, which is what
 * {@link scanFreeSymbols} + {@link syncSliders} compute together:
 *
 *  - scan every row for symbols that are neither `x` nor a whitelisted constant (MATH2's
 *    `parseExpression` already reports these as `free`, precisely so MATH3 could use them);
 *  - keep the slider of every symbol that is still referenced — **with the value and range
 *    the user gave it** — create a default one for each new symbol, and drop the orphans.
 *
 * Keeping value/range across a re-scan is the whole reason this is a sync rather than a
 * rebuild: editing `a·sin(x)` into `a·cos(x)` re-scans the row on the keystroke, and dragging
 * `a` to 2 must not snap back to the default because the text changed.
 *
 * Everything here is pure and clock-free — {@link advanceSlider} takes one animation tick as
 * an argument rather than reading a timer — so the ▷ sweep is unit-testable and the component
 * only owns the interval.
 */

import { parseExpression } from './expr';

export interface SliderState {
  /** the free symbol this slider binds, e.g. `a`. */
  symbol: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

/** The wireframe's defaults for a freshly auto-created slider: −5…5, step 0.1. */
export const SLIDER_MIN = -5;
export const SLIDER_MAX = 5;
export const SLIDER_STEP = 0.1;
/**
 * Value a new slider opens on. `1` rather than the wireframe's `2` — that screenshot shows a
 * slider already dragged; opening at the multiplicative identity means `a·sin(x)` draws
 * `sin(x)` the instant it is typed instead of jumping when the slider first moves.
 */
export const SLIDER_VALUE = 1;

/** Milliseconds between ▷ animation ticks — a full −5…5 sweep takes about five seconds. */
export const SLIDER_TICK_MS = 50;

/** Direction the ▷ sweep is currently travelling in. */
export type SliderDirection = 1 | -1;

/** Trim the float noise `min + n·step` accumulates (`-5 + 60*0.1` → `1.0000000000000009`). */
function tidy(value: number): number {
  return Number(value.toFixed(6));
}

/** Clamp into the slider's range and land on a whole number of steps from its minimum. */
export function snapToStep(slider: SliderState, value: number): number {
  if (!Number.isFinite(value)) return slider.value;
  const clamped = Math.min(slider.max, Math.max(slider.min, value));
  if (!(slider.step > 0)) return tidy(clamped);
  const steps = Math.round((clamped - slider.min) / slider.step);
  return tidy(Math.min(slider.max, Math.max(slider.min, slider.min + steps * slider.step)));
}

export function createSlider(symbol: string): SliderState {
  return { symbol, value: SLIDER_VALUE, min: SLIDER_MIN, max: SLIDER_MAX, step: SLIDER_STEP };
}

/**
 * Every free symbol in the rail, in first-appearance order — the order the slider cells then
 * appear in beneath their rows.
 *
 * A row that fails to parse contributes nothing: a half-typed `a·si` is a parse error, and
 * flickering a slider for whatever a broken row happens to mention would be worse than
 * waiting for it to parse.
 */
export function scanFreeSymbols(sources: readonly string[]): string[] {
  const found: string[] = [];
  for (const src of sources) {
    const parsed = parseExpression(src);
    if (!parsed.ok) continue;
    for (const symbol of parsed.free) {
      if (!found.includes(symbol)) found.push(symbol);
    }
  }
  return found;
}

/**
 * Reconcile the slider list against the symbols the rail currently references: existing
 * sliders keep their value and range, new symbols get {@link createSlider}, and a symbol no
 * longer mentioned anywhere loses its slider.
 *
 * Returns the *same array* when nothing changed, so the reducer's identity checks (and
 * React's memo deps) do not see a change on every keystroke.
 */
export function syncSliders(
  existing: readonly SliderState[],
  symbols: readonly string[],
): SliderState[] {
  const bySymbol = new Map(existing.map((slider) => [slider.symbol, slider]));
  const next = symbols.map((symbol) => bySymbol.get(symbol) ?? createSlider(symbol));
  const unchanged =
    next.length === existing.length && next.every((slider, at) => slider === existing[at]);
  return unchanged ? (existing as SliderState[]) : next;
}

/** The `{ a: 2 }` map handed to the plotter's sampler (and to the trace evaluator). */
export function sliderScope(sliders: readonly SliderState[]): Record<string, number> {
  const scope: Record<string, number> = Object.create(null);
  for (const slider of sliders) scope[slider.symbol] = slider.value;
  return scope;
}

/** The subset of {@link sliderScope} one expression actually references. */
export function scopeFor(
  sliders: readonly SliderState[],
  symbols: readonly string[],
): Record<string, number> {
  const scope: Record<string, number> = Object.create(null);
  for (const slider of sliders) {
    if (symbols.includes(slider.symbol)) scope[slider.symbol] = slider.value;
  }
  return scope;
}

/** Where the thumb sits, 0…1 — drives `.g-slider-fill` width and `.g-slider-thumb` left. */
export function sliderFraction(slider: SliderState): number {
  const span = slider.max - slider.min;
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, (slider.value - slider.min) / span));
}

/** Map a 0…1 drag position back onto the slider's stepped range. */
export function valueAtFraction(slider: SliderState, fraction: number): number {
  return snapToStep(slider, slider.min + (slider.max - slider.min) * fraction);
}

/** Numbers in the rail read with the typographic minus the rest of the tool uses. */
export function formatSliderNumber(value: number): string {
  return String(tidy(value)).replace(/^-/, '−');
}

/** The wireframe's range caption: `−5 ≤ a ≤ 5 · step 0.1`. */
export function formatSliderRange(slider: SliderState): string {
  return (
    `${formatSliderNumber(slider.min)} ≤ ${slider.symbol} ≤ ${formatSliderNumber(slider.max)}` +
    ` · step ${formatSliderNumber(slider.step)}`
  );
}

/**
 * One ▷ tick: step in `direction`, bouncing off whichever bound it reaches so the sweep
 * ping-pongs rather than stopping or wrapping.
 */
export function advanceSlider(
  slider: SliderState,
  direction: SliderDirection,
): { value: number; direction: SliderDirection } {
  const forward = slider.value + slider.step * direction;
  if (forward <= slider.max && forward >= slider.min) {
    return { value: snapToStep(slider, forward), direction };
  }
  const reversed: SliderDirection = direction === 1 ? -1 : 1;
  return {
    value: snapToStep(slider, slider.value + slider.step * reversed),
    direction: reversed,
  };
}

/**
 * Coerce one untrusted persisted slider. Anything unusable falls back to the default for that
 * field rather than rejecting the slider — a saved graph that lost its `step` should still
 * open with the parameter it was drawn with.
 */
export function sanitizeSlider(symbol: string, raw: unknown): SliderState {
  const base = createSlider(symbol);
  if (typeof raw !== 'object' || raw === null) return base;
  const fields = raw as Record<string, unknown>;

  const number = (key: string, fallback: number): number => {
    const value = fields[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };

  let min = number('min', base.min);
  let max = number('max', base.max);
  if (max < min) [min, max] = [max, min];
  if (max === min) {
    min = base.min;
    max = base.max;
  }
  const step = Math.abs(number('step', base.step)) || base.step;

  const bounded: SliderState = { symbol, value: base.value, min, max, step };
  return { ...bounded, value: snapToStep(bounded, number('value', base.value)) };
}
