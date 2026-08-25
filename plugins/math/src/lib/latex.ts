/**
 * Math — LaTeX serialization for every copy/insert action in the plugin (MATH6).
 *
 * The spec's `lib/latex.ts`: *"LaTeX serialization (expressions, results, matrices as
 * `bmatrix`). Tests: golden strings."* MATH4 and MATH5 each grew the sliver they needed
 * (a tape row, a result card) inside their own model files; this is the one place that
 * knows TeX, and those two now import from here.
 *
 * Three rules hold for everything below:
 *
 *  - **mathjs serializes the expressions.** `parse(…).toTex()` is the whole engine, applied
 *    to the *preprocessed* source (so `2x` and `×` become real products) but never to the
 *    calculator rename — a copied `ln(e^2)` should read `\ln`, not mathjs's `log`.
 *  - **serialization never fails.** A half-typed line has no parse tree, and a copy action
 *    that refuses is worse than one that hands back the text the user typed. Every entry
 *    point falls back to its own source.
 *  - **the output is bare LaTeX** — no `$…$`. The notes bridge owns the note format and
 *    wraps what it is given (`NotesApi.insertLatex`), and the clipboard should carry
 *    something that pastes into any TeX context, not just Atlas's.
 */

import { preprocessExpression } from './expr';
import { mathEngine } from './mathEngine';
import { formatNumber } from './matrix';
import type { MatrixDef, MatrixResult } from './matrix';
import type { TapeRow } from './eval';

/** Single characters a textbook (or this plugin) prints for a minus sign. */
const MINUS_GLYPHS = /[−–—]/g;

/** LaTeX's own row separator, spelled once — `\\` in the output, `\\\\` in a JS string. */
const ROW_BREAK = ' \\\\ ';

/**
 * A formatted number as LaTeX. Our own rendering uses the typographic minus and the infinity
 * glyph; TeX wants `-` and `\infty`.
 */
export function numberLatex(text: string): string {
  if (text === '∞') return '\\infty';
  if (text === '−∞') return '-\\infty';
  return text.replace(MINUS_GLYPHS, '-');
}

/**
 * The typed expression as LaTeX. Built from the preprocessed source so implicit products and
 * `×` survive; an unparseable line falls back to its own text.
 *
 * Trimmed, because mathjs pads some symbols with a leading space (`a\cdot x` comes back as
 * ` a\cdot x`). Interior spacing is left alone — TeX ignores it, and rewriting it would be
 * this file second-guessing the serializer.
 */
export function expressionLatex(src: string): string {
  try {
    return mathEngine.parse(preprocessExpression(src)).toTex().trim();
  } catch {
    return src;
  }
}

/** A tape row as LaTeX: `\sqrt{2} = 1.4142136`. */
export function tapeRowLatex(row: TapeRow): string {
  return `${expressionLatex(row.src)} = ${numberLatex(row.result)}`;
}

/**
 * A whole tape as one aligned block — each row's `=` lines up under the one above, which is
 * what makes a pasted history read as a worked calculation rather than a list.
 */
export function tapeLatex(rows: readonly TapeRow[]): string {
  const lines = rows
    .filter((row) => !row.failed)
    .map((row) => `${expressionLatex(row.src)} &= ${numberLatex(row.result)}`);
  if (lines.length === 0) return '';
  return `\\begin{aligned}${lines.join(ROW_BREAK)}\\end{aligned}`;
}

/** A block of cells (numbers or already-formatted text) as the spec's `bmatrix`. */
export function bmatrix(cells: readonly (readonly string[])[]): string {
  const body = cells.map((row) => row.map(numberLatex).join(' & ')).join(ROW_BREAK);
  return `\\begin{bmatrix}${body}\\end{bmatrix}`;
}

/** A numeric grid as a `bmatrix`, each cell through the tool's own number formatting. */
export function matrixLatex(cells: readonly (readonly number[])[]): string {
  return bmatrix(cells.map((row) => row.map(formatNumber)));
}

/**
 * A named matrix from the rail as `A = \begin{bmatrix}…`. Cells are serialized as **typed**,
 * not as parsed numbers: a matrix mid-edit still copies, and a blank cell stays visibly blank
 * instead of turning into a zero the user never entered.
 */
export function matrixDefLatex(def: MatrixDef): string {
  const cells = Array.from({ length: def.rows }, (_unused, r) =>
    Array.from({ length: def.cols }, (_unusedToo, c) => (def.cells[r]?.[c] ?? '').trim()),
  );
  return `${def.name} = ${bmatrix(cells)}`;
}

/** A compute result as LaTeX: a bare number, or the spec's `bmatrix`. */
export function matrixResultLatex(result: MatrixResult): string {
  if (result.kind === 'scalar') return numberLatex(formatNumber(result.value));
  return matrixLatex(result.cells);
}

/** A result card as LaTeX: `A \cdot B = \begin{bmatrix}…`. */
export function computeEntryLatex(entry: { src: string; result: MatrixResult }): string {
  return `${expressionLatex(entry.src)} = ${matrixResultLatex(entry.result)}`;
}

/**
 * One graph row as LaTeX. A rail row is a curve, so a bare expression is serialized as the
 * equation it draws (`y = …`); a row that already states its own relation keeps it, since
 * `y = y = …` would be nonsense.
 */
export function graphRowLatex(src: string): string {
  const latex = expressionLatex(src);
  return /=/.test(latex) ? latex : `y = ${latex}`;
}

/** The whole rail as one aligned block, blank rows dropped. */
export function graphRailLatex(sources: readonly string[]): string {
  const lines = sources
    .filter((src) => src.trim() !== '')
    .map((src) => graphRowLatex(src).replace(/^y = /, 'y &= '));
  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0].replace('&=', '=');
  return `\\begin{aligned}${lines.join(ROW_BREAK)}\\end{aligned}`;
}
