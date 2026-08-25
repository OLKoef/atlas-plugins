import { describe, expect, it } from 'vitest';
import {
  ANS_SYMBOL,
  DEFAULT_ANGLE_MODE,
  NO_RECALL,
  TAPE_LIMIT,
  ansFromTape,
  appendTapeRow,
  applyCalculatorNames,
  evaluateScientific,
  formatValue,
  hydrateTapeRow,
  isAngleMode,
  makeTapeRow,
  previewScientific,
  recallSources,
  stepRecall,
  tapeRowLatex,
  usesAngleFunction,
} from '../lib/eval';
import type { TapeRow } from '../lib/eval';

function evalIn(src: string, angleMode: 'deg' | 'rad' = 'rad', ans: unknown = null) {
  return evaluateScientific(src, { angleMode, ans });
}

/** The formatted result, or the failure message — whichever the tape would print. */
function shown(src: string, angleMode: 'deg' | 'rad' = 'rad', ans: unknown = null): string {
  const outcome = evalIn(src, angleMode, ans);
  return outcome.ok ? outcome.result : outcome.message;
}

function row(src: string, angleMode: 'deg' | 'rad' = 'rad', ans: unknown = null): TapeRow {
  return makeTapeRow('s1', src, evalIn(src, angleMode, ans), angleMode);
}

describe('evaluateScientific — the wireframe’s tape (MATH4)', () => {
  it('reproduces the results the wireframe prints', () => {
    // The tape rows drawn in MathPluginApproved.html, evaluated the way the tool would.
    // Digits are MATH1's `PREVIEW_PRECISION` (8 significant), which is where the wireframe's
    // `1.4142136` comes from — its `0.7071068` is the same value one digit shorter.
    expect(shown('√(2)')).toBe('1.4142136');
    expect(shown('sin(45)', 'deg')).toBe('0.70710678');
    expect(shown('ln(e^2)')).toBe('2');
    expect(shown('240/12')).toBe('20');
    expect(shown('12! / 10!')).toBe('132');
    expect(shown('3^4/2')).toBe('40.5');
    expect(shown('ans × 4', 'deg', 132)).toBe('528');
  });

  it('applies the angle mode per evaluation', () => {
    expect(shown('sin(45)', 'deg')).toBe('0.70710678');
    expect(shown('sin(45)', 'rad')).toBe('0.85090352');
    expect(shown('cos(60)', 'deg')).toBe('0.5');
    expect(shown('tan(45)', 'deg')).toBe('1');
    // Radians is mathjs's own footing, so nothing is wrapped there.
    expect(shown('sin(pi/2)', 'rad')).toBe('1');
  });

  it('returns degrees from the inverse trig functions in DEG', () => {
    expect(shown('asin(1)', 'deg')).toBe('90');
    expect(shown('acos(0)', 'deg')).toBe('90');
    expect(shown('atan(1)', 'deg')).toBe('45');
    expect(shown('asin(1)', 'rad')).toBe('1.5707963');
  });

  it('leaves the non-angular functions alone in both modes', () => {
    // A mode toggle must not quietly rescale something that never carried an angle.
    for (const mode of ['deg', 'rad'] as const) {
      expect(shown('sqrt(16)', mode)).toBe('4');
      expect(shown('log10(1000)', mode)).toBe('3');
      expect(shown('sinh(0)', mode)).toBe('0');
    }
  });

  it('chains ans from the previous result, not the previous text', () => {
    const first = evalIn('1/3');
    expect(first.ok && first.result).toBe('0.33333333');
    // The displayed result is rounded; `ans` binds the full value, so ×3 is exactly 1.
    const chained = evalIn('ans*3', 'rad', first.ok ? first.value : null);
    expect(chained.ok && chained.result).toBe('1');
  });

  it('refuses ans before there is a result', () => {
    expect(shown('ans + 1')).toBe('No result yet for ans');
    expect(shown('ans + 1', 'rad', 0)).toBe('1'); // …and 0 is a result, not an absence.
  });

  it('refuses a free symbol with a message naming it', () => {
    expect(shown('2a + 1')).toBe('“a” has no value');
    // `x` is the graph variable MATH2's whitelist binds; the tape has no such variable.
    expect(shown('2x')).toBe('“x” has no value');
  });

  it('keeps MATH2’s whitelist in front of every evaluation', () => {
    expect(shown('import("fs")')).toBe('“import” is not allowed');
    expect(shown('createUnit("z")')).toBe('“createUnit” is not allowed');
    expect(shown('a = 4')).toBe('Assignments are not allowed');
    expect(shown('fn(x) = x')).toBe('Function definitions are not allowed');
    expect(shown('config.number')).toBe('Property access is not allowed');
    expect(shown('1; 2')).toBe('Write one expression at a time');
  });

  it('reports a half-typed line rather than throwing', () => {
    const outcome = evalIn('2 +');
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.message.length).toBeGreaterThan(0);
    expect(shown('')).toBe('Write an expression');
  });
});

describe('calculator spelling', () => {
  it('maps ln to the natural log and log to base 10, in one pass', () => {
    expect(applyCalculatorNames('ln(x) + log(y)')).toBe('log(x) + log10(y)');
    // Already-mathjs spellings survive: `log10` must not be renamed a second time.
    expect(applyCalculatorNames('log10(2) + log2(8)')).toBe('log10(2) + log2(8)');
    expect(shown('ln(e)')).toBe('1');
    expect(shown('log(100)')).toBe('2');
  });

  it('accepts the glyphs the keypad inserts', () => {
    expect(shown('√(9)')).toBe('3');
    expect(shown('2×10^3')).toBe('2000');
    expect(shown('7÷2')).toBe('3.5');
    expect(shown('5−3')).toBe('2');
    expect(shown('π')).toBe('3.1415927');
  });
});

describe('formatValue', () => {
  it('prints the calculator’s infinities and refuses NaN', () => {
    expect(formatValue(Infinity)).toBe('∞');
    expect(formatValue(-Infinity)).toBe('−∞');
    expect(formatValue(NaN)).toBeNull();
    expect(shown('asin(2)', 'deg')).toBe('Undefined result');
  });
});

describe('the angle tag', () => {
  it('marks only the rows whose answer the mode decided', () => {
    expect(usesAngleFunction('sin(45)')).toBe(true);
    expect(usesAngleFunction('atan2(1, 1)')).toBe(true);
    expect(usesAngleFunction('sqrt(2)')).toBe(false);
    // Hyperbolics take a real argument — no angle, no tag.
    expect(usesAngleFunction('sinh(1)')).toBe(false);
    expect(row('sin(45)', 'deg').angular).toBe(true);
    expect(row('√(2)', 'deg').angular).toBe(false);
  });

  it('stamps the mode in force at evaluation time', () => {
    expect(row('sin(45)', 'deg').angleMode).toBe('deg');
    expect(row('sin(45)', 'rad').angleMode).toBe('rad');
  });

  it('narrows an untrusted persisted mode', () => {
    expect(isAngleMode('deg')).toBe(true);
    expect(isAngleMode('grad')).toBe(false);
    expect(isAngleMode(1)).toBe(false);
  });
});

describe('the tape', () => {
  it('records a failed line as a row carrying its reason', () => {
    const failed = row('2 +');
    expect(failed.failed).toBe(true);
    expect(failed.result).toBe(shown('2 +'));
  });

  it('drops the oldest row once the tape is full', () => {
    let tape: TapeRow[] = [];
    for (let index = 0; index < TAPE_LIMIT + 5; index += 1) {
      tape = appendTapeRow(tape, { ...row('1+1'), id: `s${index}` });
    }
    expect(tape).toHaveLength(TAPE_LIMIT);
    expect(tape[0].id).toBe('s5');
    expect(tape[tape.length - 1].id).toBe(`s${TAPE_LIMIT + 4}`);
  });

  it('recovers ans from the last successful row after a restore', () => {
    const tape = [row('240/12'), { ...row('2 +'), id: 's2' }];
    expect(tape[1].failed).toBe(true);
    // The error row is skipped: the last *result* is still the last result.
    expect(ansFromTape(tape)).toBe(20);
    expect(ansFromTape([])).toBeNull();
  });

  it('re-derives a restored row’s angle tag rather than trusting the blob', () => {
    const restored = hydrateTapeRow('s1', { src: 'sin(45)', result: '0.7071068', angleMode: 'deg' });
    expect(restored.angular).toBe(true);
    expect(restored.failed).toBe(false);
    const plain = hydrateTapeRow('s2', { src: '240/12', result: '20', angleMode: 'nonsense' });
    expect(plain.angular).toBe(false);
    expect(plain.angleMode).toBe(DEFAULT_ANGLE_MODE);
  });
});

describe('history recall (↑ / ↓)', () => {
  const sources = ['1+1', 'sin(45)', '12!/10!'];

  it('walks back from the newest expression', () => {
    let state = { input: '', recall: NO_RECALL };
    state = stepRecall(sources, state.recall, state.input, 1);
    expect(state.input).toBe('12!/10!');
    state = stepRecall(sources, state.recall, state.input, 1);
    expect(state.input).toBe('sin(45)');
    state = stepRecall(sources, state.recall, state.input, 1);
    expect(state.input).toBe('1+1');
  });

  it('stops at the oldest instead of clearing the line', () => {
    const walked = stepRecall(sources, { index: 3, stash: '' }, '1+1', 1);
    expect(walked.input).toBe('1+1');
    expect(walked.recall.index).toBe(3);
  });

  it('gives back the line the walk interrupted', () => {
    const up = stepRecall(sources, NO_RECALL, '2*', 1);
    expect(up.input).toBe('12!/10!');
    const down = stepRecall(sources, up.recall, up.input, -1);
    expect(down.input).toBe('2*');
    expect(down.recall).toEqual(NO_RECALL);
  });

  it('is inert on an empty history', () => {
    expect(stepRecall([], NO_RECALL, 'draft', 1)).toEqual({ input: 'draft', recall: NO_RECALL });
  });

  it('recalls failed lines too — a typo is what you want back', () => {
    const tape = [row('2 +'), { ...row('1+1'), id: 's2' }];
    expect(recallSources(tape)).toEqual(['2 +', '1+1']);
  });
});

describe('copy as LaTeX', () => {
  it('serializes a row as expression = result', () => {
    expect(tapeRowLatex(row('√(2)'))).toBe('\\sqrt{2} = 1.4142136');
    expect(tapeRowLatex(row('12! / 10!'))).toBe('\\frac{12!}{10!} = 132');
  });

  it('falls back to the typed text when the line will not parse', () => {
    expect(tapeRowLatex({ ...row('1+1'), src: '2 +(' })).toBe('2 +( = 2');
  });
});

describe('previewScientific — the ghost result', () => {
  it('shows the value a committed line would produce', () => {
    expect(previewScientific('3^4/2', { angleMode: 'deg' })).toBe('40.5');
    expect(previewScientific('sin(45)', { angleMode: 'deg' })).toBe('0.70710678');
  });

  it('stays silent for anything that does not evaluate', () => {
    expect(previewScientific('', { angleMode: 'deg' })).toBeNull();
    expect(previewScientific('2 +', { angleMode: 'deg' })).toBeNull();
    expect(previewScientific(ANS_SYMBOL, { angleMode: 'deg' })).toBeNull();
  });
});
