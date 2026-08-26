/**
 * Math — the Matrix tool's values, ops and compute line (MATH5), outside React so every
 * number this tool prints is unit-testable.
 *
 * The spec's shape: *"named matrices (`A, B, C…`), each its own size — 2 × 2 up to any n × n,
 * no cap; rectangular m × n allowed; steppers resize in place preserving existing entries;
 * quick-op chips `det / A⁻¹ / Aᵀ / rank` and a free-form compute line sharing one result
 * history; `→ C` saves a result as a new matrix; dimension-mismatch errors reuse the inline
 * error treatment."* Four decisions follow from that:
 *
 *  - **cells are text, values are numbers.** The editor is a grid of `<input>`s, so a cell
 *    mid-edit is `''` or `-` — states no `number` can hold. The live model keeps what was
 *    typed and {@link matrixValueOf} converts on the way into a computation, which is also
 *    where a blank cell becomes a named error instead of a silent zero.
 *  - **the compute line has its own evaluator.** mathjs is the arithmetic, but not the
 *    *shape* rules: `math.add` **broadcasts**, so a 2 × 3 plus a 1 × 3 quietly returns a
 *    2 × 3 instead of refusing. For a matrix calculator that is a wrong answer, not a
 *    convenience — so {@link computeMatrix} walks the parsed tree itself, checks both
 *    operands' dimensions at every node, and only then calls mathjs for the numbers. It is
 *    also what lets a mismatch say *which* dimensions disagree.
 *  - **the four chips are compute-line sources.** A chip runs `det(A)` / `inv(A)` /
 *    `transpose(A)` / `rank(A)` through the same door as a typed line, which is what makes
 *    "sharing one result history" true by construction rather than by wiring.
 *  - **nothing evaluates that MATH2's whitelist would refuse.** Matrices are persisted, so a
 *    stored expression is untrusted text: the same refused node kinds and blocked names as a
 *    graph row (`lib/expr.ts`), plus a vocabulary of exactly the matrix functions below.
 *
 * There is deliberately **no upper bound on n**: the editor grid scrolls instead.
 */

import { isBlockedName, preprocessExpression, refusedNodeMessage } from './expr';
import { PREVIEW_PRECISION, mathEngine } from './mathEngine';

/**
 * The smallest a stepper goes. The wireframe's copy says "from 2 × 2 up", which is the
 * smallest matrix worth *creating* — but a product needs row and column vectors, so the
 * floor for a resize is 1, not 2.
 */
export const MIN_DIM = 1;

/** The new-matrix flow's presets, in wireframe order; the custom `n × n…` field has no cap. */
export const NEW_MATRIX_SIZES: readonly number[] = [2, 3, 4];

/** The preset the wireframe opens with pre-selected. */
export const DEFAULT_NEW_SIZE = 3;

/** A named matrix in the rail. `cells` is what was typed, row-major. */
export interface MatrixDef {
  id: string;
  name: string;
  rows: number;
  cols: number;
  cells: string[][];
}

/** A matrix as numbers — what an op actually consumes. */
export interface MatrixValue {
  rows: number;
  cols: number;
  cells: number[][];
}

/** The result of one compute line: a number (det, rank) or a matrix. */
export type MatrixResult =
  | { kind: 'scalar'; value: number }
  | { kind: 'matrix'; rows: number; cols: number; cells: number[][] };

export type ComputeOutcome =
  | { ok: true; result: MatrixResult }
  | { ok: false; message: string };

/* ------------------------------------------------------------------ *
 * Dimensions, cells, names
 * ------------------------------------------------------------------ */

/** Clamp an untrusted dimension (a persisted value, or a typed custom size) to a usable one. */
export function normalizeDim(value: unknown, fallback = DEFAULT_NEW_SIZE): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_DIM, Math.floor(n));
}

/** A fresh `rows × cols` block of cells, zero-filled the way the wireframe's grid opens. */
export function makeCells(rows: number, cols: number, fill = '0'): string[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

/**
 * Re-shape a block of cells, **preserving every entry that still fits**. Growing pads with
 * zeroes; shrinking drops the outside — so grow-then-shrink round-trips back to the original,
 * which is the property that makes a stepper safe to hold down.
 */
export function resizeCells(
  cells: readonly (readonly string[])[],
  rows: number,
  cols: number,
  fill = '0',
): string[][] {
  return Array.from({ length: rows }, (_unused, r) =>
    Array.from({ length: cols }, (_unusedToo, c) => cells[r]?.[c] ?? fill),
  );
}

export function createMatrix(id: string, name: string, rows: number, cols: number): MatrixDef {
  const r = normalizeDim(rows);
  const c = normalizeDim(cols);
  return { id, name, rows: r, cols: c, cells: makeCells(r, c) };
}

/** The stepper's resize: in place, entries preserved (see {@link resizeCells}). */
export function resizeMatrix(def: MatrixDef, rows: number, cols: number): MatrixDef {
  const r = normalizeDim(rows, def.rows);
  const c = normalizeDim(cols, def.cols);
  if (r === def.rows && c === def.cols) return def;
  return { ...def, rows: r, cols: c, cells: resizeCells(def.cells, r, c) };
}

/** One cell edit. Out-of-range coordinates are ignored rather than growing the grid. */
export function setMatrixCell(def: MatrixDef, row: number, col: number, text: string): MatrixDef {
  if (row < 0 || row >= def.rows || col < 0 || col >= def.cols) return def;
  if (def.cells[row]?.[col] === text) return def;
  const cells = def.cells.map((line, r) =>
    r === row ? line.map((cell, c) => (c === col ? text : cell)) : line,
  );
  return { ...def, cells };
}

/** The rail's `3 × 3` dimension caption. */
export function matrixLabel(rows: number, cols: number): string {
  return `${rows} × ${cols}`;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The next free name: `A`…`Z`, then `A2`…`Z2`, and so on. Names are *reused* once freed —
 * deleting `B` makes the next matrix `B` again — so the rail never drifts into `A, C, G`.
 */
export function nextMatrixName(taken: readonly string[]): string {
  const used = new Set(taken);
  for (let round = 1; ; round += 1) {
    const suffix = round === 1 ? '' : String(round);
    for (const letter of LETTERS) {
      const name = letter + suffix;
      if (!used.has(name)) return name;
    }
  }
}

/** Single characters a textbook (or the wireframe) uses for a minus sign. */
const MINUS_GLYPHS = /[−–—]/g;

/**
 * One cell's number, or null when the text is not one. Accepts the typographic minus signs a
 * paste can carry; rejects everything else — a cell is a number, not an expression.
 */
export function parseCellText(text: string): number | null {
  const trimmed = text.replace(MINUS_GLYPHS, '-').trim();
  if (trimmed === '') return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** The tool's number rendering — the same {@link PREVIEW_PRECISION} the tape uses. */
export function formatNumber(value: number): string {
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '−∞';
  if (Number.isNaN(value)) return 'NaN';
  return mathEngine.format(value, { precision: PREVIEW_PRECISION });
}

/** Cells as text, for an editor grid built from a computed (or persisted) result. */
export function cellsToText(cells: readonly (readonly number[])[]): string[][] {
  return cells.map((row) => row.map((value) => formatNumber(value)));
}

/**
 * A named matrix's numeric value, or the reason it has none. A blank or non-numeric cell is
 * reported with its 1-based coordinates — silently reading it as zero would hand back an
 * answer to a question the user did not ask.
 */
export function matrixValueOf(
  def: MatrixDef,
): { ok: true; value: MatrixValue } | { ok: false; message: string } {
  const cells: number[][] = [];
  for (let r = 0; r < def.rows; r += 1) {
    const row: number[] = [];
    for (let c = 0; c < def.cols; c += 1) {
      const value = parseCellText(def.cells[r]?.[c] ?? '');
      if (value === null) {
        const where = `row ${r + 1}, column ${c + 1}`;
        const text = (def.cells[r]?.[c] ?? '').trim();
        return {
          ok: false,
          message:
            text === ''
              ? `${def.name} has an empty cell at ${where}`
              : `${def.name} has a non-numeric cell at ${where}`,
        };
      }
      row.push(value);
    }
    cells.push(row);
  }
  return { ok: true, value: { rows: def.rows, cols: def.cols, cells } };
}

/* ------------------------------------------------------------------ *
 * Ops
 * ------------------------------------------------------------------ */

export function isSquare(value: MatrixValue): boolean {
  return value.rows === value.cols;
}

/** `Aᵀ` — total, and the one op with no precondition at all. */
export function transposeCells(cells: readonly (readonly number[])[]): number[][] {
  const rows = cells.length;
  const cols = rows === 0 ? 0 : cells[0].length;
  return Array.from({ length: cols }, (_unused, c) =>
    Array.from({ length: rows }, (_unusedToo, r) => cells[r][c]),
  );
}

/** `det(A)` via mathjs's LU decomposition. Precondition: square (the caller checks). */
export function determinantOf(cells: readonly (readonly number[])[]): number {
  return mathEngine.det(cells.map((row) => row.slice()));
}

/**
 * `A⁻¹`, or null when the matrix is singular. Square is the caller's precondition; mathjs
 * refuses a zero determinant, and that refusal is the only way singularity is detected —
 * comparing `det` to 0 ourselves would need a tolerance mathjs already picks better.
 */
export function inverseOf(cells: readonly (readonly number[])[]): number[][] | null {
  try {
    return mathEngine.inv(cells.map((row) => row.slice())) as number[][];
  } catch {
    return null;
  }
}

/**
 * `rank(A)` — Gaussian elimination with partial pivoting, because mathjs has no `rank`.
 *
 * The pivot tolerance is scaled by the largest magnitude in the matrix: a fixed epsilon calls
 * a matrix of millions full-rank when it isn't, and one of millionths rank-zero when it isn't.
 */
export function matrixRank(cells: readonly (readonly number[])[]): number {
  const rows = cells.length;
  const cols = rows === 0 ? 0 : cells[0].length;
  if (rows === 0 || cols === 0) return 0;

  const work = cells.map((row) => row.slice());
  let scale = 0;
  for (const row of work) for (const value of row) scale = Math.max(scale, Math.abs(value));
  const epsilon = 1e-10 * Math.max(1, scale);

  let rank = 0;
  for (let col = 0; col < cols && rank < rows; col += 1) {
    let pivot = rank;
    for (let r = rank + 1; r < rows; r += 1) {
      if (Math.abs(work[r][col]) > Math.abs(work[pivot][col])) pivot = r;
    }
    if (Math.abs(work[pivot][col]) <= epsilon) continue;

    const swap = work[rank];
    work[rank] = work[pivot];
    work[pivot] = swap;

    for (let r = rank + 1; r < rows; r += 1) {
      const factor = work[r][col] / work[rank][col];
      if (factor === 0) continue;
      for (let c = col; c < cols; c += 1) work[r][c] -= factor * work[rank][c];
    }
    rank += 1;
  }
  return rank;
}

/* ------------------------------------------------------------------ *
 * The compute line
 * ------------------------------------------------------------------ */

/** The quick-op chips, in the wireframe's locked order — label, and the source they run. */
export interface QuickOp {
  id: string;
  /** the chip's face; `{name}` stands in for the active matrix. */
  label: (name: string) => string;
  title: string;
  source: (name: string) => string;
}

export const QUICK_OPS: readonly QuickOp[] = [
  {
    id: 'det',
    label: (name) => `det(${name})`,
    title: 'Determinant',
    source: (name) => `det(${name})`,
  },
  { id: 'inv', label: (name) => `${name}⁻¹`, title: 'Inverse', source: (name) => `inv(${name})` },
  {
    id: 'transpose',
    label: (name) => `${name}ᵀ`,
    title: 'Transpose',
    source: (name) => `transpose(${name})`,
  },
  { id: 'rank', label: () => 'rank', title: 'Rank', source: (name) => `rank(${name})` },
];

/** The compute line's whole function vocabulary — the four chips, and nothing else. */
export const MATRIX_FUNCTIONS: readonly string[] = ['det', 'inv', 'transpose', 'rank'];

const MATRIX_FUNCTION_SET = new Set(MATRIX_FUNCTIONS);

/** Scalars the line may name; `lib/expr.ts` has already folded `pi` → `PI`. */
const CONSTANTS = new Map<string, number>([
  ['PI', Math.PI],
  ['E', Math.E],
]);

/** A value flowing through the evaluator: a bare number or a matrix. */
type Operand = { kind: 'scalar'; value: number } | { kind: 'matrix'; value: MatrixValue };

/** Refusals raised from inside the recursive walk and caught at the door. */
class ComputeError extends Error {}

function fail(message: string): never {
  throw new ComputeError(message);
}

/** MATH2's refusals are phrased for a graph row; this is a compute line. */
function forTheComputeLine(message: string): string {
  return message === 'Write one expression per row'
    ? 'Write one expression at a time'
    : message.replace(/\s+in a graph expression$/, '');
}

function quoted(name: string): string {
  return `“${name}”`;
}

function shape(value: MatrixValue): string {
  return matrixLabel(value.rows, value.cols);
}

function describe(operand: Operand): string {
  return operand.kind === 'scalar' ? 'a number' : `a ${shape(operand.value)} matrix`;
}

/** The minimum of a mathjs AST node this evaluator reads; the published types are wider. */
interface EvalNode {
  type: string;
  op?: string;
  fn?: EvalNode;
  name?: string;
  value?: unknown;
  args?: EvalNode[];
  content?: EvalNode;
}

function scalar(value: number): Operand {
  return { kind: 'scalar', value };
}

function matrix(cells: number[][]): Operand {
  return {
    kind: 'matrix',
    value: { rows: cells.length, cols: cells[0]?.length ?? 0, cells },
  };
}

/**
 * Element-wise `+` / `−`, written out rather than delegated to `math.add`, which
 * **broadcasts**: a 2 × 3 plus a 1 × 3 comes back a 2 × 3 instead of refusing.
 */
function combine(left: MatrixValue, right: MatrixValue, op: '+' | '-'): Operand {
  if (left.rows !== right.rows || left.cols !== right.cols) {
    const detail =
      op === '+'
        ? `Cannot add a ${shape(left)} to a ${shape(right)}`
        : `Cannot subtract a ${shape(right)} from a ${shape(left)}`;
    fail(`${detail} — both matrices must have the same size`);
  }
  return matrix(
    left.cells.map((row, r) =>
      row.map((value, c) => (op === '+' ? value + right.cells[r][c] : value - right.cells[r][c])),
    ),
  );
}

function scaled(value: MatrixValue, factor: number): Operand {
  return matrix(value.cells.map((row) => row.map((cell) => cell * factor)));
}

function product(left: MatrixValue, right: MatrixValue): Operand {
  if (left.cols !== right.rows) {
    fail(
      `Cannot multiply a ${shape(left)} by a ${shape(right)} — the first matrix's columns ` +
        `(${left.cols}) must match the second's rows (${right.rows})`,
    );
  }
  const cells = mathEngine.multiply(
    left.cells.map((row) => row.slice()),
    right.cells.map((row) => row.slice()),
  ) as number[][];
  return matrix(cells);
}

function identity(size: number): number[][] {
  return Array.from({ length: size }, (_unused, r) =>
    Array.from({ length: size }, (_unusedToo, c) => (r === c ? 1 : 0)),
  );
}

/** `A^k` for a whole `k`; a negative exponent inverts first, the way `A⁻¹` is written. */
function power(base: MatrixValue, exponent: number): Operand {
  if (!Number.isInteger(exponent)) fail('A matrix power must be a whole number');
  if (!isSquare(base)) fail(`Only a square matrix has powers — this one is ${shape(base)}`);

  let cells = base.cells.map((row) => row.slice());
  if (exponent < 0) {
    const inverted = inverseOf(cells);
    if (!inverted) fail('That matrix is singular — it has no inverse');
    cells = inverted;
  }

  let result = identity(base.rows);
  for (let step = 0; step < Math.abs(exponent); step += 1) {
    result = mathEngine.multiply(result, cells) as number[][];
  }
  return matrix(result);
}

function callFunction(name: string, args: Operand[]): Operand {
  if (args.length !== 1) fail(`${name} takes one matrix`);
  const argument = args[0];
  if (argument.kind !== 'matrix') fail(`${name} needs a matrix, not a number`);
  const value = argument.value;

  switch (name) {
    case 'det':
      if (!isSquare(value)) fail(`det needs a square matrix — this one is ${shape(value)}`);
      return scalar(determinantOf(value.cells));
    case 'inv': {
      if (!isSquare(value)) fail(`inv needs a square matrix — this one is ${shape(value)}`);
      const inverted = inverseOf(value.cells);
      if (!inverted) fail('That matrix is singular — it has no inverse');
      return matrix(inverted);
    }
    case 'transpose':
      return matrix(transposeCells(value.cells));
    default:
      return scalar(matrixRank(value.cells));
  }
}

function evaluateNode(node: EvalNode, scope: Map<string, MatrixValue>): Operand {
  const refused = refusedNodeMessage(node.type);
  if (refused) fail(forTheComputeLine(refused));

  switch (node.type) {
    case 'ParenthesisNode':
      return evaluateNode(node.content as EvalNode, scope);

    case 'ConstantNode': {
      if (typeof node.value !== 'number' || !Number.isFinite(node.value)) {
        fail('Only numbers and matrices can be combined here');
      }
      return scalar(node.value);
    }

    case 'SymbolNode': {
      const name = node.name ?? '';
      if (isBlockedName(name)) fail(`${quoted(name)} is not allowed here`);
      const bound = scope.get(name);
      if (bound) return { kind: 'matrix', value: bound };
      const constant = CONSTANTS.get(name);
      if (constant !== undefined) return scalar(constant);
      if (MATRIX_FUNCTION_SET.has(name)) fail(`${quoted(name)} is a function — call it like ${name}(A)`);
      return fail(`${quoted(name)} is not a matrix`);
    }

    case 'FunctionNode': {
      const name = node.fn?.name ?? '';
      if (isBlockedName(name)) fail(`${quoted(name)} is not allowed here`);
      if (!MATRIX_FUNCTION_SET.has(name)) fail(`Unknown function ${quoted(name)}`);
      const args = (node.args ?? []).map((argument) => evaluateNode(argument, scope));
      return callFunction(name, args);
    }

    case 'OperatorNode': {
      const args = (node.args ?? []).map((argument) => evaluateNode(argument, scope));
      const op = node.op ?? '';

      if (args.length === 1) {
        if (op !== '-' && op !== '+') fail(`Cannot use ${quoted(op)} here`);
        const only = args[0];
        if (op === '+') return only;
        return only.kind === 'scalar' ? scalar(-only.value) : scaled(only.value, -1);
      }
      if (args.length !== 2) fail('Could not read this expression');

      const [left, right] = args;
      switch (op) {
        case '+':
        case '-': {
          if (left.kind === 'scalar' && right.kind === 'scalar') {
            return scalar(op === '+' ? left.value + right.value : left.value - right.value);
          }
          if (left.kind === 'matrix' && right.kind === 'matrix') {
            return combine(left.value, right.value, op);
          }
          // A number and a matrix have nothing to add: `A + 1` almost always means `A + 1·I`,
          // and guessing which the user meant is worse than saying they must write it.
          return fail(
            op === '+'
              ? `Cannot add ${describe(left)} to ${describe(right)}`
              : `Cannot subtract ${describe(right)} from ${describe(left)}`,
          );
        }

        case '*':
          if (left.kind === 'scalar' && right.kind === 'scalar') {
            return scalar(left.value * right.value);
          }
          if (left.kind === 'scalar' && right.kind === 'matrix') {
            return scaled(right.value, left.value);
          }
          if (left.kind === 'matrix' && right.kind === 'scalar') {
            return scaled(left.value, right.value);
          }
          return product(
            (left as { value: MatrixValue }).value,
            (right as { value: MatrixValue }).value,
          );

        case '/':
          if (right.kind === 'matrix') {
            fail('Cannot divide by a matrix — multiply by inv(…) instead');
          }
          if (right.value === 0) fail('Cannot divide by zero');
          if (left.kind === 'scalar') return scalar(left.value / right.value);
          return scaled(left.value, 1 / right.value);

        case '^':
          if (right.kind === 'matrix') fail('An exponent must be a number');
          if (left.kind === 'scalar') return scalar(left.value ** right.value);
          return power(left.value, right.value);

        default:
          return fail(`Cannot use ${quoted(op)} here`);
      }
    }

    default:
      return fail('Could not read this expression');
  }
}

/** mathjs appends ` (char 7)` to its parse errors; the compute row has no space for it. */
function cleanParseMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s*\(char \d+\)\s*$/, '').trim() || 'Could not read this expression';
}

/**
 * Evaluate one compute line (or a chip's source) against the rail.
 *
 * Never throws: everything that can go wrong — a parse error, an unknown name, a blank cell,
 * a dimension mismatch — comes back as the one-line message the inline error shows.
 */
export function computeMatrix(src: string, matrices: readonly MatrixDef[]): ComputeOutcome {
  const normalized = preprocessExpression(src);
  if (normalized.trim() === '') return { ok: false, message: 'Write a matrix expression' };

  let root;
  try {
    root = mathEngine.parse(normalized);
  } catch (error) {
    return { ok: false, message: cleanParseMessage(error) };
  }

  // Only the matrices this line actually names are converted: a blank cell in an untouched
  // matrix elsewhere in the rail is not this line's problem.
  const named = new Set<string>();
  root.traverse((raw) => {
    const node = raw as unknown as EvalNode;
    if (node.type === 'SymbolNode' && typeof node.name === 'string') named.add(node.name);
  });

  const scope = new Map<string, MatrixValue>();
  for (const def of matrices) {
    if (!named.has(def.name)) continue;
    const value = matrixValueOf(def);
    if (!value.ok) return { ok: false, message: value.message };
    scope.set(def.name, value.value);
  }

  try {
    const operand = evaluateNode(root as unknown as EvalNode, scope);
    if (operand.kind === 'scalar') {
      if (!Number.isFinite(operand.value)) return { ok: false, message: 'Undefined result' };
      return { ok: true, result: { kind: 'scalar', value: operand.value } };
    }
    return {
      ok: true,
      result: {
        kind: 'matrix',
        rows: operand.value.rows,
        cols: operand.value.cols,
        cells: operand.value.cells,
      },
    };
  } catch (error) {
    if (error instanceof ComputeError) return { ok: false, message: error.message };
    // A mathjs op that got past our shape checks anyway — report it, never crash the pane.
    return { ok: false, message: cleanParseMessage(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

/** The result as one line of text — what the copy action puts on the clipboard. */
export function resultText(result: MatrixResult): string {
  if (result.kind === 'scalar') return formatNumber(result.value);
  return result.cells.map((row) => row.map((value) => formatNumber(value)).join('\t')).join('\n');
}

/* A result's LaTeX (`matrixResultLatex`) lives in `lib/latex.ts` (MATH6) with the rest of the
 * plugin's TeX serialization — this file owns the numbers, not their notation. */

/**
 * A result that `→ C` can save. Only a matrix result becomes a matrix — the wireframe puts
 * the action on the matrix card and not on the scalar one, and a 1 × 1 rail entry holding a
 * determinant would be a worse way to keep a number than the history row it is already in.
 */
export function isSavableResult(result: MatrixResult): result is Extract<
  MatrixResult,
  { kind: 'matrix' }
> {
  return result.kind === 'matrix';
}

/** `→ C`: the new matrix a saved result becomes, named for the first free slot. */
export function matrixFromResult(
  id: string,
  name: string,
  result: Extract<MatrixResult, { kind: 'matrix' }>,
): MatrixDef {
  return {
    id,
    name,
    rows: result.rows,
    cols: result.cols,
    cells: cellsToText(result.cells),
  };
}
