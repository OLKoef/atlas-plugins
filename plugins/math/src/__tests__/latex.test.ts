import { describe, expect, it } from 'vitest';
import {
  bmatrix,
  computeEntryLatex,
  expressionLatex,
  graphRailLatex,
  graphRowLatex,
  matrixDefLatex,
  matrixLatex,
  matrixResultLatex,
  numberLatex,
  tapeLatex,
  tapeRowLatex,
} from '../lib/latex';
import { makeTapeRow, evaluateScientific } from '../lib/eval';
import type { TapeRow } from '../lib/eval';
import type { MatrixDef } from '../lib/matrix';

/**
 * MATH6's golden strings. Every copy-as-LaTeX and insert-into-note action in the plugin ends
 * up in one of these, so what they lock down is what lands in a note (and in KaTeX).
 */

/** A committed tape row, evaluated the way the Scientific tool commits one. */
function row(src: string, angleMode: 'deg' | 'rad' = 'rad'): TapeRow {
  return makeTapeRow('t1', src, evaluateScientific(src, { angleMode }), angleMode);
}

function fixture(name: string, cells: string[][]): MatrixDef {
  return { id: `m-${name}`, name, rows: cells.length, cols: cells[0].length, cells };
}

describe('numbers', () => {
  it('spells our typographic minus and infinities the way TeX does', () => {
    expect(numberLatex('8')).toBe('8');
    expect(numberLatex('−2.5')).toBe('-2.5');
    expect(numberLatex('∞')).toBe('\\infty');
    expect(numberLatex('−∞')).toBe('-\\infty');
  });
});

describe('expressions', () => {
  it('serializes through mathjs, preprocessing included', () => {
    expect(expressionLatex('√(2)')).toBe('\\sqrt{2}');
    expect(expressionLatex('12! / 10!')).toBe('\\frac{12!}{10!}');
    // MATH2's preprocessing first: implicit products and the typographic × are real operators.
    expect(expressionLatex('2x')).toBe('2\\cdot x');
    // mathjs pads a bare symbol with a leading space; the ends are trimmed, the inside is not.
    expect(expressionLatex('a·sin(x)')).toBe('a\\cdot\\sin\\left( x\\right)');
    expect(expressionLatex('A × B')).toBe('\\mathrm{A}\\cdot\\mathrm{B}');
  });

  it('falls back to the typed text rather than failing a copy', () => {
    expect(expressionLatex('2 +(')).toBe('2 +(');
  });
});

describe('tape rows', () => {
  it('serializes a row as expression = result', () => {
    expect(tapeRowLatex(row('√(2)'))).toBe('\\sqrt{2} = 1.4142136');
    expect(tapeRowLatex(row('12! / 10!'))).toBe('\\frac{12!}{10!} = 132');
  });

  it('falls back to the typed text when the line will not parse', () => {
    expect(tapeRowLatex({ ...row('1+1'), src: '2 +(' })).toBe('2 +( = 2');
  });

  it('serializes a whole tape as one aligned block, failed rows dropped', () => {
    const tape = [row('1+1'), { ...row('2 +'), id: 't2' }, { ...row('3^2'), id: 't3' }];
    expect(tapeLatex(tape)).toBe('\\begin{aligned}1+1 &= 2 \\\\ {3}^{2} &= 9\\end{aligned}');
  });

  it('has nothing to serialize when every row failed', () => {
    expect(tapeLatex([row('2 +')])).toBe('');
  });
});

describe('matrices — the spec’s bmatrix', () => {
  it('serializes a numeric grid, minus signs converted', () => {
    expect(matrixLatex([[1, -2], [3, 4]])).toBe(
      '\\begin{bmatrix}1 & -2 \\\\ 3 & 4\\end{bmatrix}',
    );
  });

  it('serializes a rectangular grid row by row', () => {
    expect(bmatrix([['1', '2', '3'], ['4', '5', '6']])).toBe(
      '\\begin{bmatrix}1 & 2 & 3 \\\\ 4 & 5 & 6\\end{bmatrix}',
    );
  });

  it('names a rail matrix and serializes it as typed', () => {
    expect(matrixDefLatex(fixture('A', [['2', '1'], ['−1', '3']]))).toBe(
      'A = \\begin{bmatrix}2 & 1 \\\\ -1 & 3\\end{bmatrix}',
    );
  });

  it('leaves a cell mid-edit blank instead of inventing a zero', () => {
    expect(matrixDefLatex(fixture('B', [['1', ''], ['3', '4']]))).toBe(
      'B = \\begin{bmatrix}1 &  \\\\ 3 & 4\\end{bmatrix}',
    );
  });

  it('serializes a result — a bare number, or the bmatrix', () => {
    expect(matrixResultLatex({ kind: 'scalar', value: 8 })).toBe('8');
    expect(matrixResultLatex({ kind: 'scalar', value: -0.5 })).toBe('-0.5');
    expect(
      matrixResultLatex({ kind: 'matrix', rows: 2, cols: 2, cells: [[1, -2], [3, 4]] }),
    ).toBe('\\begin{bmatrix}1 & -2 \\\\ 3 & 4\\end{bmatrix}');
  });

  it('serializes a result card as expression = result', () => {
    expect(
      computeEntryLatex({
        src: 'A × B',
        result: { kind: 'matrix', rows: 1, cols: 2, cells: [[2, 5]] },
      }),
    ).toBe('\\mathrm{A}\\cdot\\mathrm{B} = \\begin{bmatrix}2 & 5\\end{bmatrix}');
    expect(computeEntryLatex({ src: 'det(A)', result: { kind: 'scalar', value: 8 } })).toBe(
      '\\det\\left(\\mathrm{A}\\right) = 8',
    );
  });
});

describe('graph rows', () => {
  it('serializes a bare expression as the curve it draws', () => {
    expect(graphRowLatex('sin(x)')).toBe('y = \\sin\\left( x\\right)');
    expect(graphRowLatex('x^2 − 2')).toBe('y = { x}^{2}-2');
    // MATH2's preprocessing already drops a written `y =`, so it is not written twice.
    expect(graphRowLatex('y = 2x')).toBe('y = 2\\cdot x');
  });

  it('leaves a row that states its own relation alone', () => {
    // An implicit equation does not parse (it is on the roadmap, not in v1), so the row falls
    // back to its own text — and prefixing `y = ` to that would be nonsense.
    expect(graphRowLatex('x^2 + y^2 = 4')).toBe('x^2 + y^2 = 4');
  });

  it('serializes one row plainly and several as an aligned block, blanks dropped', () => {
    expect(graphRailLatex(['sin(x)'])).toBe('y = \\sin\\left( x\\right)');
    expect(graphRailLatex(['sin(x)', '   ', 'x^2 − 2'])).toBe(
      '\\begin{aligned}y &= \\sin\\left( x\\right) \\\\ y &= { x}^{2}-2\\end{aligned}',
    );
    expect(graphRailLatex(['', '  '])).toBe('');
  });
});
