import { describe, expect, it } from 'vitest';
import { mathEngine, previewExpression } from '../lib/mathEngine';

/**
 * mathjs is the shared engine behind all three tools and ships inside the plugin bundle.
 * MATH1 only exercises it through the input line's live ghost preview; MATH2/MATH4/MATH5
 * build the real evaluation paths on the same instance.
 */
describe('previewExpression — the live ghost result', () => {
  it('evaluates the wireframe’s example expressions', () => {
    expect(previewExpression('3^4/2')).toBe('40.5');
    expect(previewExpression('sqrt(2)')).toBe('1.4142136');
    // mathjs spells the natural log `log`; mapping the keypad's `ln` key onto it is MATH4's
    // job, so the raw engine has nothing to show for `ln(…)` yet.
    expect(previewExpression('log(e^2)')).toBe('2');
    expect(previewExpression('ln(e^2)')).toBe(null);
  });

  it('shows nothing for an empty or whitespace-only line', () => {
    expect(previewExpression('')).toBe(null);
    expect(previewExpression('   ')).toBe(null);
  });

  it('stays silent on a half-typed expression instead of erroring', () => {
    expect(previewExpression('sin(')).toBe(null);
    expect(previewExpression('2 +')).toBe(null);
  });

  it('shows nothing for an expression with a free variable', () => {
    // A graphing draft like `a·sin(x)` has no single value — MATH2 plots it instead.
    expect(previewExpression('a * sin(x)')).toBe(null);
  });

  it('previews a function definition as nothing', () => {
    expect(previewExpression('f(x) = x^2')).toBe(null);
  });
});

describe('shared engine hardening', () => {
  it('blocks import and createUnit', () => {
    expect(() => mathEngine.evaluate('import({})')).toThrow(/disabled/);
    expect(() => mathEngine.evaluate('createUnit("mycoin")')).toThrow(/disabled/);
    // …and through the preview path they are simply silent.
    expect(previewExpression('import({})')).toBe(null);
    expect(previewExpression('createUnit("mycoin")')).toBe(null);
  });

  it('evaluates a draft assignment against a throwaway scope', () => {
    previewExpression('leaked = 99');
    // The symbol must not have escaped into the shared engine.
    expect(previewExpression('leaked')).toBe(null);
  });
});
