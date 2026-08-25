import { describe, expect, it } from 'vitest';
import {
  SLIDER_MAX,
  SLIDER_MIN,
  SLIDER_STEP,
  SLIDER_VALUE,
  advanceSlider,
  createSlider,
  formatSliderRange,
  sanitizeSlider,
  scanFreeSymbols,
  scopeFor,
  sliderFraction,
  sliderScope,
  snapToStep,
  syncSliders,
  valueAtFraction,
} from '../lib/sliders';
import type { SliderState } from '../lib/sliders';

describe('free-symbol scan (MATH3)', () => {
  it('finds the free constant in the wireframe’s row', () => {
    expect(scanFreeSymbols(['a·sin(x)'])).toEqual(['a']);
  });

  it('reports nothing for a fully determined expression', () => {
    expect(scanFreeSymbols(['sin(x)', 'x^2/4 − 2', '2x + 1'])).toEqual([]);
  });

  it('does not make a slider out of the graph variable or a known constant', () => {
    // `x` is the abscissa and `PI`/`E` are whitelisted constants — none of them is a knob.
    expect(scanFreeSymbols(['sin(2·PI·x) + E'])).toEqual([]);
  });

  it('finds several, in first-appearance order across the whole rail', () => {
    expect(scanFreeSymbols(['a·x + b', 'k·x'])).toEqual(['a', 'b', 'k']);
  });

  it('reports a symbol shared by two rows exactly once', () => {
    expect(scanFreeSymbols(['a·sin(x)', 'a·x^2'])).toEqual(['a']);
  });

  it('ignores rows that do not parse — a half-typed row must not flicker a slider', () => {
    expect(scanFreeSymbols(['a·sin(x)', '2x^3 −'])).toEqual(['a']);
    expect(scanFreeSymbols(['import("./evil.js")'])).toEqual([]);
  });

  it('ignores blank rows, including the always-present tail', () => {
    expect(scanFreeSymbols(['', '   '])).toEqual([]);
  });
});

describe('slider creation and sync (MATH3)', () => {
  it('creates the wireframe’s default slider: −5…5, step 0.1', () => {
    expect(createSlider('a')).toEqual({
      symbol: 'a',
      value: SLIDER_VALUE,
      min: SLIDER_MIN,
      max: SLIDER_MAX,
      step: SLIDER_STEP,
    });
    expect([SLIDER_MIN, SLIDER_MAX, SLIDER_STEP]).toEqual([-5, 5, 0.1]);
  });

  it('creates one slider per new symbol, in scan order', () => {
    expect(syncSliders([], ['a', 'b']).map((s) => s.symbol)).toEqual(['a', 'b']);
  });

  it('keeps the value and range of a slider whose symbol is still referenced', () => {
    const dragged: SliderState = { symbol: 'a', value: 2, min: -5, max: 5, step: 0.1 };
    const synced = syncSliders([dragged], ['a', 'b']);
    // Same object, not a re-created default — editing the row must not reset the knob.
    expect(synced[0]).toBe(dragged);
    expect(synced[1].value).toBe(SLIDER_VALUE);
  });

  it('drops the slider of a symbol nothing references any more', () => {
    const before = syncSliders([], ['a', 'b']);
    expect(syncSliders(before, ['b']).map((s) => s.symbol)).toEqual(['b']);
  });

  it('returns the same array when nothing changed', () => {
    const before = syncSliders([], ['a']);
    expect(syncSliders(before, ['a'])).toBe(before);
  });
});

describe('slider scope (MATH3)', () => {
  const sliders = [createSlider('a'), { ...createSlider('b'), value: 2 }];

  it('exposes every slider’s current value to the sampler', () => {
    expect(sliderScope(sliders)).toEqual({ a: 1, b: 2 });
  });

  it('narrows to just the symbols one expression references', () => {
    expect(scopeFor(sliders, ['b'])).toEqual({ b: 2 });
    expect(scopeFor(sliders, [])).toEqual({});
  });

  it('builds a null-prototype scope, so an expression cannot reach Object.prototype', () => {
    expect(Object.getPrototypeOf(sliderScope(sliders))).toBeNull();
  });
});

describe('slider value, track and range caption (MATH3)', () => {
  const slider = createSlider('a');

  it('snaps to a whole number of steps and clamps to the range', () => {
    expect(snapToStep(slider, 2.04)).toBe(2);
    expect(snapToStep(slider, 2.06)).toBe(2.1);
    expect(snapToStep(slider, 99)).toBe(5);
    expect(snapToStep(slider, -99)).toBe(-5);
    expect(snapToStep(slider, Number.NaN)).toBe(slider.value);
  });

  it('does not accumulate float noise across the whole range', () => {
    for (let step = 0; step <= 100; step += 1) {
      const value = snapToStep(slider, -5 + step * 0.1);
      expect(String(value).replace('-', '').replace('.', '').length).toBeLessThanOrEqual(4);
    }
  });

  it('maps value ↔ track fraction both ways', () => {
    expect(sliderFraction({ ...slider, value: 1 })).toBeCloseTo(0.6, 9);
    expect(sliderFraction({ ...slider, value: -5 })).toBe(0);
    expect(sliderFraction({ ...slider, value: 5 })).toBe(1);
    expect(valueAtFraction(slider, 0.7)).toBe(2);
  });

  it('writes the wireframe’s range caption verbatim', () => {
    expect(formatSliderRange(createSlider('a'))).toBe('−5 ≤ a ≤ 5 · step 0.1');
  });
});

describe('▷ animation (MATH3)', () => {
  it('steps forward one step per tick', () => {
    const slider = createSlider('a');
    expect(advanceSlider(slider, 1)).toEqual({ value: 1.1, direction: 1 });
    expect(advanceSlider(slider, -1)).toEqual({ value: 0.9, direction: -1 });
  });

  it('bounces off the top bound instead of stopping or wrapping', () => {
    const atMax = { ...createSlider('a'), value: 5 };
    expect(advanceSlider(atMax, 1)).toEqual({ value: 4.9, direction: -1 });
  });

  it('bounces off the bottom bound too', () => {
    const atMin = { ...createSlider('a'), value: -5 };
    expect(advanceSlider(atMin, -1)).toEqual({ value: -4.9, direction: 1 });
  });

  it('sweeps the whole range and comes back — no drift, no escape', () => {
    let slider = createSlider('a');
    let direction: 1 | -1 = 1;
    const seen: number[] = [];
    for (let tick = 0; tick < 400; tick += 1) {
      const next = advanceSlider(slider, direction);
      slider = { ...slider, value: next.value };
      direction = next.direction;
      seen.push(next.value);
    }
    expect(Math.max(...seen)).toBe(5);
    expect(Math.min(...seen)).toBe(-5);
    expect(seen.every((value) => value >= -5 && value <= 5)).toBe(true);
  });
});

describe('sanitizeSlider — untrusted persisted values (MATH3)', () => {
  it('passes a well-formed saved slider through unchanged', () => {
    const saved = { symbol: 'a', value: 2, min: -5, max: 5, step: 0.1 };
    expect(sanitizeSlider('a', saved)).toEqual(saved);
  });

  it('falls back per field rather than rejecting the slider', () => {
    expect(sanitizeSlider('a', { value: 'two', step: null })).toEqual(createSlider('a'));
    expect(sanitizeSlider('a', 'garbage')).toEqual(createSlider('a'));
    expect(sanitizeSlider('a', { value: Number.POSITIVE_INFINITY }).value).toBe(SLIDER_VALUE);
  });

  it('repairs an inverted or degenerate range', () => {
    expect(sanitizeSlider('a', { min: 5, max: -5 })).toMatchObject({ min: -5, max: 5 });
    expect(sanitizeSlider('a', { min: 3, max: 3 })).toMatchObject({ min: -5, max: 5 });
  });

  it('clamps a value that sits outside its own saved range', () => {
    expect(sanitizeSlider('a', { min: 0, max: 10, value: 42 }).value).toBe(10);
  });

  it('takes the magnitude of a negative or zero step', () => {
    expect(sanitizeSlider('a', { step: -0.5 }).step).toBe(0.5);
    expect(sanitizeSlider('a', { step: 0 }).step).toBe(SLIDER_STEP);
  });
});
