import { describe, expect, it } from 'vitest';
import {
  MIN_DIM,
  QUICK_OPS,
  computeMatrix,
  createMatrix,
  determinantOf,
  inverseOf,
  matrixFromResult,
  matrixRank,
  matrixValueOf,
  nextMatrixName,
  normalizeDim,
  parseCellText,
  resizeCells,
  resizeMatrix,
  resultLatex,
  resultText,
  setMatrixCell,
  transposeCells,
} from '../lib/matrix';
import type { MatrixDef, MatrixResult } from '../lib/matrix';

/** A named matrix straight from numbers, the way the wireframe's `A` is drawn. */
function fixture(name: string, cells: number[][]): MatrixDef {
  return {
    id: `m-${name}`,
    name,
    rows: cells.length,
    cols: cells[0].length,
    cells: cells.map((row) => row.map((value) => String(value))),
  };
}

/** The wireframe's own `A` (det 8), and a `B` sized to multiply with it. */
const A = fixture('A', [
  [2, 1, 0],
  [1, 3, -1],
  [0, -1, 2],
]);
const B = fixture('B', [
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 0],
]);

/** Run a compute line that is expected to succeed. */
function ran(src: string, matrices: MatrixDef[] = [A, B]): MatrixResult {
  const outcome = computeMatrix(src, matrices);
  if (!outcome.ok) throw new Error(`expected “${src}” to compute, got: ${outcome.message}`);
  return outcome.result;
}

function cellsOf(result: MatrixResult): number[][] {
  if (result.kind !== 'matrix') throw new Error('expected a matrix result');
  return result.cells;
}

function scalarOf(result: MatrixResult): number {
  if (result.kind !== 'scalar') throw new Error('expected a scalar result');
  return result.value;
}

describe('matrix cells and sizes (MATH5)', () => {
  it('reads a cell as a number, typographic minus signs included', () => {
    expect(parseCellText('3')).toBe(3);
    expect(parseCellText(' -2.5 ')).toBe(-2.5);
    expect(parseCellText('−1')).toBe(-1); // U+2212, what the wireframe prints
    expect(parseCellText('1e3')).toBe(1000);
  });

  it('refuses anything that is not a plain number', () => {
    for (const text of ['', '   ', 'x', '1/2', '2+2', 'NaN', 'Infinity', '1,5']) {
      expect(parseCellText(text)).toBeNull();
    }
  });

  it('clamps an untrusted dimension to at least the floor', () => {
    expect(normalizeDim(4)).toBe(4);
    expect(normalizeDim(0)).toBe(MIN_DIM);
    expect(normalizeDim(-7)).toBe(MIN_DIM);
    expect(normalizeDim(2.9)).toBe(2);
    expect(normalizeDim('nonsense', 3)).toBe(3);
  });

  it('names matrices A, B, C… and reuses a name once it is freed', () => {
    expect(nextMatrixName([])).toBe('A');
    expect(nextMatrixName(['A', 'B'])).toBe('C');
    // Deleting B must not leave the rail naming its next matrix D.
    expect(nextMatrixName(['A', 'C'])).toBe('B');
  });

  it('rolls past Z rather than running out of names', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    expect(nextMatrixName(alphabet)).toBe('A2');
    expect(nextMatrixName([...alphabet, 'A2'])).toBe('B2');
  });
});

describe('resize preserves entries (MATH5)', () => {
  it('keeps every entry that still fits when growing', () => {
    const grown = resizeMatrix(A, 4, 4);
    expect(grown.rows).toBe(4);
    expect(grown.cols).toBe(4);
    expect(grown.cells[0]).toEqual(['2', '1', '0', '0']);
    expect(grown.cells[3]).toEqual(['0', '0', '0', '0']);
  });

  it('round-trips: grow then shrink is the matrix you started with', () => {
    const there = resizeMatrix(A, 6, 5);
    const back = resizeMatrix(there, A.rows, A.cols);
    expect(back.cells).toEqual(A.cells);
    expect(back.rows).toBe(A.rows);
    expect(back.cols).toBe(A.cols);
  });

  it('resizes rectangular in both directions, independently', () => {
    const wide = resizeMatrix(A, 2, 5);
    expect(wide.cells).toEqual([
      ['2', '1', '0', '0', '0'],
      ['1', '3', '-1', '0', '0'],
    ]);
    expect(resizeCells(wide.cells, 2, 3)).toEqual([
      ['2', '1', '0'],
      ['1', '3', '-1'],
    ]);
  });

  it('never shrinks below the floor, and a no-op resize keeps the same object', () => {
    expect(resizeMatrix(A, 0, 0).rows).toBe(MIN_DIM);
    expect(resizeMatrix(A, A.rows, A.cols)).toBe(A);
  });

  it('edits one cell and ignores an out-of-range one', () => {
    const edited = setMatrixCell(A, 1, 1, '9');
    expect(edited.cells[1][1]).toBe('9');
    expect(edited.cells[0]).toEqual(A.cells[0]);
    expect(setMatrixCell(A, 9, 9, '1')).toBe(A);
  });

  it('creates a zero-filled matrix at the asked size', () => {
    expect(createMatrix('m1', 'A', 2, 3).cells).toEqual([
      ['0', '0', '0'],
      ['0', '0', '0'],
    ]);
  });
});

describe('matrix values (MATH5)', () => {
  it('converts a whole matrix to numbers', () => {
    const value = matrixValueOf(A);
    expect(value.ok).toBe(true);
    if (value.ok) expect(value.value.cells[1]).toEqual([1, 3, -1]);
  });

  it('names the cell that has no number instead of reading it as zero', () => {
    const blank = matrixValueOf(setMatrixCell(A, 1, 2, ''));
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.message).toBe('A has an empty cell at row 2, column 3');

    const typo = matrixValueOf(setMatrixCell(A, 0, 0, '2x'));
    expect(typo.ok).toBe(false);
    if (!typo.ok) expect(typo.message).toBe('A has a non-numeric cell at row 1, column 1');
  });
});

describe('ops on known matrices (MATH5)', () => {
  it('computes the determinant the wireframe prints', () => {
    expect(
      determinantOf([
        [2, 1, 0],
        [1, 3, -1],
        [0, -1, 2],
      ]),
    ).toBe(8);
    expect(scalarOf(ran('det(A)'))).toBe(8);
  });

  it('computes an inverse, and refuses a singular matrix', () => {
    expect(
      inverseOf([
        [2, 1],
        [1, 1],
      ]),
    ).toEqual([
      [1, -1],
      [-1, 2],
    ]);
    expect(
      inverseOf([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull();
  });

  it('A × A⁻¹ is the identity', () => {
    const cells = cellsOf(ran('A × inv(A)'));
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) expect(cells[r][c]).toBeCloseTo(r === c ? 1 : 0, 10);
    }
  });

  it('transposes, rectangular included', () => {
    expect(
      transposeCells([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
    expect(cellsOf(ran('transpose(A)'))[0]).toEqual([2, 1, 0]);
  });

  it('computes rank, including a rank-deficient and a rectangular matrix', () => {
    expect(
      matrixRank([
        [2, 1, 0],
        [1, 3, -1],
        [0, -1, 2],
      ]),
    ).toBe(3);
    // Third row is the sum of the first two — rank 2, not 3.
    expect(
      matrixRank([
        [1, 2, 3],
        [4, 5, 6],
        [5, 7, 9],
      ]),
    ).toBe(2);
    expect(
      matrixRank([
        [1, 2, 3],
        [2, 4, 6],
      ]),
    ).toBe(1);
    expect(matrixRank([[0, 0], [0, 0]])).toBe(0);
    expect(
      matrixRank([
        [1, 0, 0],
        [0, 1, 0],
      ]),
    ).toBe(2);
  });

  it('keeps rank honest at either end of the scale', () => {
    // A fixed epsilon would call the first rank-zero and the second full-rank.
    expect(
      matrixRank([
        [1e-9, 0],
        [0, 1e-9],
      ]),
    ).toBe(2);
    expect(
      matrixRank([
        [1e9, 2e9],
        [2e9, 4e9],
      ]),
    ).toBe(1);
  });
});

describe('the compute line (MATH5)', () => {
  it('multiplies two matrices', () => {
    expect(cellsOf(ran('A × B'))).toEqual([
      [2, 1, 3],
      [0, 2, 4],
      [2, 1, -1],
    ]);
  });

  it('reads the wireframe’s `2A + B` — implicit multiplication and all', () => {
    expect(cellsOf(ran('2A + B'))).toEqual([
      [5, 2, 1],
      [2, 7, -1],
      [1, -1, 4],
    ]);
  });

  it('subtracts, divides by a scalar, and negates', () => {
    expect(cellsOf(ran('A − A'))).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(cellsOf(ran('B / 2'))[0]).toEqual([0.5, 0, 0.5]);
    // Joined, because a negated 0 is −0 and only its sign would differ.
    expect(cellsOf(ran('-B'))[0].join(',')).toBe('-1,0,-1');
  });

  it('raises a square matrix to a whole power, negative meaning the inverse', () => {
    expect(cellsOf(ran('A^2'))).toEqual([
      [5, 5, -1],
      [5, 11, -5],
      [-1, -5, 5],
    ]);
    expect(cellsOf(ran('A^0'))).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(cellsOf(ran('A^-1'))[0][0]).toBeCloseTo(0.625, 10);
  });

  it('evaluates plain arithmetic and the parenthesised case', () => {
    expect(scalarOf(ran('2 + 3 × 4'))).toBe(14);
    expect(cellsOf(ran('(A + B) × B'))[0]).toEqual([4, 2, 4]);
    expect(scalarOf(ran('rank(A)'))).toBe(3);
  });

  it('runs the quick-op chips through the same door as a typed line', () => {
    for (const op of QUICK_OPS) expect(computeMatrix(op.source('A'), [A]).ok).toBe(true);
    expect(QUICK_OPS.map((op) => op.label('A'))).toEqual(['det(A)', 'A⁻¹', 'Aᵀ', 'rank']);
  });
});

describe('dimension-mismatch errors (MATH5)', () => {
  const wide = fixture('C', [
    [1, 2, 3],
    [4, 5, 6],
  ]);
  const small = fixture('D', [
    [1, 2],
    [3, 4],
  ]);

  function messageFor(src: string): string {
    const outcome = computeMatrix(src, [A, B, wide, small]);
    expect(outcome.ok).toBe(false);
    return outcome.ok ? '' : outcome.message;
  }

  it('refuses a product whose inner dimensions disagree, and says which', () => {
    expect(messageFor('C × D')).toBe(
      "Cannot multiply a 2 × 3 by a 2 × 2 — the first matrix's columns (3) must match the second's rows (2)",
    );
  });

  it('refuses an element-wise op on different shapes — never broadcasts', () => {
    // mathjs's own `add` broadcasts a 1 × 3 across a 2 × 3 and hands back an answer.
    const row = fixture('E', [[1, 1, 1]]);
    const outcome = computeMatrix('C + E', [wide, row]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toBe(
        'Cannot add a 2 × 3 to a 1 × 3 — both matrices must have the same size',
      );
    }
    expect(messageFor('C - D')).toBe(
      'Cannot subtract a 2 × 2 from a 2 × 3 — both matrices must have the same size',
    );
  });

  it('refuses a determinant, an inverse or a power of a non-square matrix', () => {
    expect(messageFor('det(C)')).toBe('det needs a square matrix — this one is 2 × 3');
    expect(messageFor('inv(C)')).toBe('inv needs a square matrix — this one is 2 × 3');
    expect(messageFor('C^2')).toBe('Only a square matrix has powers — this one is 2 × 3');
  });

  it('refuses to mix a number and a matrix additively', () => {
    expect(messageFor('A + 1')).toBe('Cannot add a 3 × 3 matrix to a number');
    expect(messageFor('1 - A')).toBe('Cannot subtract a 3 × 3 matrix from a number');
  });

  it('refuses to divide by a matrix, or by zero', () => {
    expect(messageFor('A / B')).toBe('Cannot divide by a matrix — multiply by inv(…) instead');
    expect(messageFor('A / 0')).toBe('Cannot divide by zero');
  });

  it('reports a singular matrix rather than an inverse that does not exist', () => {
    const singular = fixture('S', [
      [1, 2],
      [2, 4],
    ]);
    const outcome = computeMatrix('inv(S)', [singular]);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toBe('That matrix is singular — it has no inverse');
  });

  it('reports an unreadable cell in a matrix the line names — and only then', () => {
    const broken = setMatrixCell(A, 0, 1, '');
    const named = computeMatrix('det(A)', [broken, B]);
    expect(named.ok).toBe(false);
    if (!named.ok) expect(named.message).toBe('A has an empty cell at row 1, column 2');
    // B is fine, and A's blank cell is not B's problem.
    expect(computeMatrix('det(B)', [broken, B]).ok).toBe(true);
  });

  it('names an unknown matrix, an unknown function, and an empty line', () => {
    expect(messageFor('A × Z')).toBe('“Z” is not a matrix');
    expect(messageFor('trace(A)')).toBe('Unknown function “trace”');
    expect(messageFor('   ')).toBe('Write a matrix expression');
    expect(messageFor('A ×')).toBeTruthy();
  });

  it('refuses the same escapes a graph row does', () => {
    expect(messageFor('A = 3')).toBe('Assignments are not allowed');
    expect(messageFor('import("x")')).toBe('“import” is not allowed here');
    expect(messageFor('A[1]')).toMatch(/is not allowed$/);
    expect(messageFor('det')).toBe('“det” is a function — call it like det(A)');
  });
});

describe('results (MATH5)', () => {
  it('renders a scalar and a matrix as copyable text', () => {
    expect(resultText({ kind: 'scalar', value: 8 })).toBe('8');
    expect(
      resultText({ kind: 'matrix', rows: 2, cols: 2, cells: [[1, 2], [3, 4]] }),
    ).toBe('1\t2\n3\t4');
  });

  it('serializes a matrix result as a LaTeX bmatrix', () => {
    expect(resultLatex({ kind: 'matrix', rows: 2, cols: 2, cells: [[1, -2], [3, 4]] })).toBe(
      '\\begin{bmatrix}1 & -2 \\\\ 3 & 4\\end{bmatrix}',
    );
    expect(resultLatex({ kind: 'scalar', value: 8 })).toBe('8');
  });

  it('saves a result as a new matrix, cells and size intact', () => {
    const result = ran('A × B');
    if (result.kind !== 'matrix') throw new Error('expected a matrix result');
    const saved = matrixFromResult('m9', 'C', result);
    expect(saved.name).toBe('C');
    expect(saved.rows).toBe(3);
    expect(saved.cols).toBe(3);
    expect(saved.cells[0]).toEqual(['2', '1', '3']);
    // …and the saved matrix computes like any other.
    expect(scalarOf(ran('rank(C)', [saved]))).toBe(3);
  });
});
