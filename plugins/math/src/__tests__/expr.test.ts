import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CONSTANTS,
  ALLOWED_FUNCTIONS,
  GRAPH_VARIABLE,
  parseExpression,
  preprocessExpression,
  stripLeadingY,
} from '../lib/expr';
import { mathEngine } from '../lib/mathEngine';

/** Narrow to the failure branch so the message can be asserted. */
function failure(src: string): string {
  const result = parseExpression(src);
  expect(result.ok, `expected ${JSON.stringify(src)} to be rejected`).toBe(false);
  return result.ok ? '' : result.message;
}

/** Narrow to the success branch. */
function success(src: string) {
  const result = parseExpression(src);
  expect(result.ok, `expected ${JSON.stringify(src)} to parse`).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe('preprocessExpression — implicit multiplication (MATH2)', () => {
  it('inserts the product the spec names: 2x → 2*x', () => {
    expect(preprocessExpression('2x')).toBe('2*x');
  });

  it('inserts a product before a group and after one', () => {
    expect(preprocessExpression('2(x+1)')).toBe('2*(x+1)');
    expect(preprocessExpression('(x+1)(x-1)')).toBe('(x+1)*(x-1)');
    expect(preprocessExpression('(x+1)x')).toBe('(x+1)*x');
    expect(preprocessExpression('(x+1)2')).toBe('(x+1)*2');
  });

  it('leaves a function call alone — sin(x) is not sin*(x)', () => {
    expect(preprocessExpression('sin(x)')).toBe('sin(x)');
    expect(preprocessExpression('2sin(x)')).toBe('2*sin(x)');
    expect(preprocessExpression('atan2(x,2)')).toBe('atan2(x,2)');
  });

  it('treats a single-letter name before a group as a coefficient, longer ones as calls', () => {
    // Parameters are written `a`, `b`, `k` — so `a(x+1)` is the coefficient idiom…
    expect(preprocessExpression('a(x+1)')).toBe('a*(x+1)');
    expect(preprocessExpression('2a(x+1)')).toBe('2*a*(x+1)');
    // …while anything longer was meant as a function and must stay a call, so the row can
    // say "Unknown function" instead of complaining about an invented variable.
    expect(preprocessExpression('sec(x)')).toBe('sec(x)');
    expect(preprocessExpression('foo(x)')).toBe('foo(x)');
  });

  it('does not split an identifier — `ab` is one symbol, `a b` is a product', () => {
    expect(preprocessExpression('ab')).toBe('ab');
    expect(preprocessExpression('a b')).toBe('a* b');
    expect(preprocessExpression('a·b')).toBe('a*b');
  });

  it('resolves names through its own tables, not Object.prototype', () => {
    // A plain-object lookup would hand back the inherited `constructor` here.
    expect(preprocessExpression('x*constructor')).toBe('x*constructor');
    expect(preprocessExpression('__proto__')).toBe('__proto__');
  });

  it('keeps `^` as written', () => {
    expect(preprocessExpression('x^2')).toBe('x^2');
    expect(preprocessExpression('2x^3')).toBe('2*x^3');
  });

  it('binds an inserted product to the left operand, ahead of the user’s spacing', () => {
    expect(preprocessExpression('2 x')).toBe('2* x');
    expect(preprocessExpression('x^2/4 - 2')).toBe('x^2/4 - 2');
  });

  it('does not split a number in exponent notation', () => {
    expect(preprocessExpression('1e5')).toBe('1e5');
    expect(preprocessExpression('1.5e-3x')).toBe('1.5e-3*x');
  });

  it('folds the wireframe’s glyphs onto real operators', () => {
    expect(preprocessExpression('a·sin(x)')).toBe('a*sin(x)');
    expect(preprocessExpression('x^2/4 − 2')).toBe('x^2/4 - 2');
    expect(preprocessExpression('2 × 3 ÷ 4')).toBe('2 * 3 / 4');
    expect(preprocessExpression('√(2)')).toBe('sqrt(2)');
  });

  it('folds a non-breaking space onto a plain one', () => {
    // Built from its code point on purpose: the literal byte is invisible in a diff and the
    // repo's corruption gate refuses it, which is also why `GLYPHS` spells the key ` `.
    const nbsp = String.fromCharCode(0xa0);
    expect(preprocessExpression(`2${nbsp}x`)).toBe(preprocessExpression('2 x'));
    expect(preprocessExpression(`sin(x)${nbsp}+${nbsp}1`)).toBe('sin(x) + 1');
  });

  it('folds mathjs constant spellings onto the ones the plotter shares', () => {
    expect(preprocessExpression('pi')).toBe('PI');
    expect(preprocessExpression('π')).toBe('PI');
    expect(preprocessExpression('2pi')).toBe('2*PI');
    expect(preprocessExpression('e')).toBe('E');
    // `exp` is its own name, not `e` followed by `xp`.
    expect(preprocessExpression('exp(x)')).toBe('exp(x)');
  });

  it('drops a leading `y =`, which the rail’s first-run placeholder invites', () => {
    expect(stripLeadingY('y = x^2')).toBe('x^2');
    expect(stripLeadingY('y=2x')).toBe('2x');
    expect(preprocessExpression('y = 2x')).toBe('2*x');
    // …but not a comparison, and not a `y` that is part of the expression.
    expect(stripLeadingY('y == x')).toBe('y == x');
    expect(stripLeadingY('x + y')).toBe('x + y');
  });
});

describe('parseExpression — accepting real expressions (MATH2)', () => {
  it('accepts the wireframe’s curves and hands back a plot-ready string', () => {
    expect(success('sin(x)').normalized).toBe('sin(x)');
    expect(success('x^2/4 − 2').normalized).toBe('x^2/4 - 2');
    expect(success('2x').normalized).toBe('2*x');
  });

  it('treats x as bound and reports every other symbol as a free parameter', () => {
    expect(success('sin(x)').free).toEqual([]);
    expect(success('a·x + b').free).toEqual(['a', 'b']);
    // Reported once, however many times it appears.
    expect(success('a*x + a').free).toEqual(['a']);
    expect(GRAPH_VARIABLE).toBe('x');
  });

  it('accepts the shared constants without calling them free', () => {
    expect(success('sin(pi*x)').free).toEqual([]);
    expect(success('e^x').free).toEqual([]);
  });
});

describe('parseExpression — the symbol whitelist (MATH2)', () => {
  it('blocks the two escapes the spec names by name', () => {
    expect(failure('import("./evil.js")')).toContain('“import” is not allowed');
    expect(failure('createUnit("foo")')).toContain('“createUnit” is not allowed');
  });

  it('blocks the rest of the mathjs configuration surface', () => {
    for (const name of ['config', 'evaluate', 'parse', 'compile', 'simplify', 'derivative', 'chain']) {
      expect(failure(`${name}("2+2")`)).toContain(`“${name}” is not allowed`);
    }
  });

  it('blocks assignments, so a persisted row cannot define anything', () => {
    expect(failure('a = 2')).toContain('Assignments are not allowed');
    expect(failure('x^2; x^3')).toBe('Write one expression per row');
  });

  it('blocks property access and indexing', () => {
    expect(failure('x[1]')).toContain('Property access is not allowed');
    expect(failure('{a: 1}.a')).toContain('Property access is not allowed');
    expect(failure('x.constructor')).toBeTruthy();
  });

  it('rejects a call to anything outside the whitelist', () => {
    // `sec` is real mathjs — it is refused because the plotter has no such function.
    expect(failure('sec(x)')).toBe('Unknown function “sec”');
    expect(failure('tau(x)')).toBe('Unknown function “tau”');
    expect(failure('foo(x)')).toBe('Unknown function “foo”');
  });

  it('reports a whitelisted function used as a bare value', () => {
    expect(failure('sin')).toContain('is a function');
  });

  it('reports a syntax error without mathjs’s char offset', () => {
    const message = failure('2x^3 −');
    expect(message).toMatch(/Unexpected end of expression/);
    expect(message).not.toMatch(/char \d+/);
  });

  it('never throws on a half-typed row — a draft in progress is the normal case', () => {
    for (const src of ['', '  ', 'sin(', 'x +', '((', '*', '2..3', 'x^', ')']) {
      expect(() => parseExpression(src), src).not.toThrow();
    }
    for (const src of ['', '  ', 'sin(', 'x +', '((', '*', 'x^', ')']) {
      expect(parseExpression(src).ok, src).toBe(false);
    }
  });
});

describe('the whitelist is the mathjs ∩ plotter intersection (MATH2)', () => {
  // function-plot's sampler compiles against `Object.create(Math)` plus these two, so a name
  // that is only in one vocabulary would validate here and then draw nothing.
  const PLOTTER_EXTRAS = new Set(['factorial', 'nthRoot']);

  it('every allowed function exists in both engines', () => {
    for (const name of ALLOWED_FUNCTIONS) {
      expect(typeof mathEngine.evaluate(name), `mathjs is missing ${name}`).toBe('function');
      expect(
        name in Math || PLOTTER_EXTRAS.has(name),
        `the plotter's namespace is missing ${name}`,
      ).toBe(true);
    }
  });

  it('every allowed constant exists in both engines', () => {
    for (const name of ALLOWED_CONSTANTS) {
      expect(typeof mathEngine.evaluate(name), `mathjs is missing ${name}`).toBe('number');
      expect(name in Math, `the plotter's namespace is missing ${name}`).toBe(true);
      expect(mathEngine.evaluate(name)).toBeCloseTo((Math as unknown as Record<string, number>)[name], 12);
    }
  });

  it('does not allow the escapes it is meant to block', () => {
    for (const blocked of ['import', 'createUnit', 'config', 'evaluate', 'compile']) {
      expect(ALLOWED_FUNCTIONS).not.toContain(blocked);
    }
  });
});
