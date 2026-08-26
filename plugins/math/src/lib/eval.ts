/**
 * Math — the Scientific tool's evaluation model (MATH4): deg/rad application, `ans`, and the
 * history tape, all outside React so the whole REPL is unit-testable.
 *
 * The spec's shape, verbatim: *"DEG/RAD applied per evaluation and stamped on the tape row;
 * `ans` = last result; ↑ recalls previous expressions."* Three consequences drive this file:
 *
 *  - **the angle mode is an argument, never engine state.** mathjs works in radians and stays
 *    that way; DEG is a *scope* of degree-flavoured circular functions handed to one
 *    evaluation ({@link angleScope}). A mode switch therefore cannot retroactively change a
 *    tape row — every row carries the mode it was computed under, which is what makes the
 *    row's `deg` tag true rather than decorative.
 *  - **`ans` is a value, not a substitution.** It binds in the same scope, so `ans × 4` reads
 *    the previous *result*, not the previous *text* — chaining stays exact even when the
 *    displayed result was rounded to {@link PREVIEW_PRECISION} digits.
 *  - **everything untrusted goes through MATH2's whitelist first.** A tape row is persisted
 *    text, so `parseExpression` refuses `import` / `createUnit` / assignments before mathjs
 *    ever sees it — the Scientific tool adds no evaluation path around that door.
 *
 * The one vocabulary difference from a graph row is calculator spelling: on a keypad `ln` is
 * the natural log and `log` is base 10, while mathjs spells those `log` and `log10`. That
 * rename ({@link applyCalculatorNames}) happens in front of the whitelist, so what the tape
 * *shows* is what the user typed and what mathjs *evaluates* is a whitelisted string.
 */

import { parseExpression, preprocessExpression } from './expr';
import { PREVIEW_PRECISION, mathEngine } from './mathEngine';

/** The two modes of the wireframe's `RAD | DEG` segmented toggle, in its order. */
export const ANGLE_MODES = ['rad', 'deg'] as const;
export type AngleMode = (typeof ANGLE_MODES)[number];

/** The wireframe opens with DEG active. */
export const DEFAULT_ANGLE_MODE: AngleMode = 'deg';

/** Narrow an untrusted (persisted) angle mode. */
export function isAngleMode(value: unknown): value is AngleMode {
  return typeof value === 'string' && (ANGLE_MODES as readonly string[]).includes(value);
}

/** The symbol that resolves to the last result. */
export const ANS_SYMBOL = 'ans';

/**
 * How many rows the tape keeps. The tape is persisted, so it needs a bound — without one a
 * long session grows the plugin's storage blob without limit. Old rows fall off the top,
 * which is also what a paper tape does.
 */
export const TAPE_LIMIT = 200;

/**
 * Calculator spelling → mathjs spelling. `ln` is the natural log and `log` is base 10 on
 * every keypad ever printed; mathjs calls those `log` and `log10`. Applied in one pass over
 * whole identifiers so `log10` maps to itself instead of being renamed twice.
 *
 * A `Map`, not an object literal — a plain object would resolve `constructor` through
 * `Object.prototype` and hand back an inherited value for an identifier a user can type.
 */
const CALCULATOR_NAMES = new Map<string, string>([
  ['ln', 'log'],
  ['log', 'log10'],
]);

const IDENTIFIER_RE = /[A-Za-z_][A-Za-z_0-9]*/g;

/** Rewrite keypad spellings to mathjs ones. Purely textual; validation happens after. */
export function applyCalculatorNames(src: string): string {
  return src.replace(IDENTIFIER_RE, (name) => CALCULATOR_NAMES.get(name) ?? name);
}

/**
 * Functions whose argument (or result) *is* an angle — the only ones DEG/RAD can change.
 * Hyperbolic functions take a real argument, so they are deliberately absent.
 */
export const ANGLE_FUNCTIONS: readonly string[] = [
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
];

const ANGLE_FUNCTION_SET = new Set(ANGLE_FUNCTIONS);

/** True when this (normalized) expression's value depends on the angle mode. */
export function usesAngleFunction(normalized: string): boolean {
  for (const match of normalized.matchAll(IDENTIFIER_RE)) {
    if (ANGLE_FUNCTION_SET.has(match[0])) return true;
  }
  return false;
}

const RAD_PER_DEG = Math.PI / 180;
const DEG_PER_RAD = 180 / Math.PI;

/**
 * The scope that makes one evaluation degree-flavoured: degrees in for the direct circular
 * functions, degrees out for the inverse ones. RAD is the empty scope — mathjs already
 * works in radians, so the default path adds nothing to override.
 */
export function angleScope(mode: AngleMode): Record<string, unknown> {
  if (mode === 'rad') return {};
  return {
    sin: (x: number) => Math.sin(x * RAD_PER_DEG),
    cos: (x: number) => Math.cos(x * RAD_PER_DEG),
    tan: (x: number) => Math.tan(x * RAD_PER_DEG),
    asin: (x: number) => Math.asin(x) * DEG_PER_RAD,
    acos: (x: number) => Math.acos(x) * DEG_PER_RAD,
    atan: (x: number) => Math.atan(x) * DEG_PER_RAD,
    atan2: (y: number, x: number) => Math.atan2(y, x) * DEG_PER_RAD,
  };
}

/** A committed evaluation that produced a value. */
export interface EvalSuccess {
  ok: true;
  /** the raw mathjs value — what `ans` chains from, unrounded. */
  value: unknown;
  /** the value as the tape shows it. */
  result: string;
  /** true when the angle mode decided the answer, so the row earns its mode tag. */
  angular: boolean;
}

/** An evaluation that could not produce one; `message` is what the tape row shows. */
export interface EvalFailure {
  ok: false;
  message: string;
}

export type EvalOutcome = EvalSuccess | EvalFailure;

export interface EvalOptions {
  angleMode: AngleMode;
  /** the previous result `ans` binds to, or null when there is not one yet. */
  ans?: unknown;
}

/** MATH2's refusals are phrased for a graph row; the tape is not a rail. */
function forTheTape(message: string): string {
  return message === 'Write one expression per row'
    ? 'Write one expression at a time'
    : message.replace(/\s+in a graph expression$/, '');
}

function quoted(name: string): string {
  return `“${name}”`;
}

/** mathjs runtime errors, trimmed to one tape-width line. */
function cleanEvalMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const undefinedSymbol = /^Undefined symbol (\S+)/.exec(raw);
  if (undefinedSymbol) return `${quoted(undefinedSymbol[1])} has no value`;
  return raw.replace(/\s*\(char \d+\)\s*$/, '').trim() || 'Could not evaluate that';
}

/**
 * The tape's rendering of a value: {@link PREVIEW_PRECISION} significant digits, with the
 * infinities spelled the way a calculator does. Returns null for NaN — "not a number" is a
 * failed evaluation, not a result worth keeping in history.
 */
export function formatValue(value: unknown): string | null {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return null;
    if (value === Infinity) return '∞';
    if (value === -Infinity) return '−∞';
  }
  return mathEngine.format(value, { precision: PREVIEW_PRECISION });
}

/**
 * Evaluate one input line. Never throws: a bad line is an {@link EvalFailure} carrying the
 * message the tape (or nothing at all, for the ghost preview) will show.
 */
export function evaluateScientific(src: string, options: EvalOptions): EvalOutcome {
  if (src.trim() === '') return { ok: false, message: 'Write an expression' };

  const parsed = parseExpression(applyCalculatorNames(src));
  if (!parsed.ok) return { ok: false, message: forTheTape(parsed.message) };

  const ans = options.ans ?? null;
  const unknown = parsed.free.filter((symbol) => symbol !== ANS_SYMBOL);
  if (unknown.length > 0) return { ok: false, message: `${quoted(unknown[0])} has no value` };
  if (parsed.free.includes(ANS_SYMBOL) && ans === null) {
    return { ok: false, message: 'No result yet for ans' };
  }

  // A fresh scope per evaluation: the angle flavour, plus `ans` only when there is one. The
  // shared engine is never mutated, so switching mode or clearing history leaves no residue.
  const scope: Record<string, unknown> = angleScope(options.angleMode);
  if (ans !== null) scope[ANS_SYMBOL] = ans;

  let value: unknown;
  try {
    value = mathEngine.evaluate(parsed.normalized, scope);
  } catch (error) {
    return { ok: false, message: cleanEvalMessage(error) };
  }

  if (value === undefined || value === null || typeof value === 'function') {
    return { ok: false, message: 'That expression has no value' };
  }

  const result = formatValue(value);
  if (result === null) return { ok: false, message: 'Undefined result' };

  return { ok: true, value, result, angular: usesAngleFunction(parsed.normalized) };
}

/**
 * The live ghost result beside the input line. Silent (null) for anything that does not
 * evaluate — a half-typed line is the normal case while typing, and the tape is where a real
 * error belongs.
 */
export function previewScientific(src: string, options: EvalOptions): string | null {
  const outcome = evaluateScientific(src, options);
  return outcome.ok ? outcome.result : null;
}

/* ------------------------------------------------------------------ *
 * The tape
 * ------------------------------------------------------------------ */

export interface TapeRow {
  id: string;
  /** the line exactly as typed — the tape shows the user's own spelling. */
  src: string;
  /** the formatted result, or (when {@link failed}) the reason it has none. */
  result: string;
  /** the mode this row was evaluated under, stamped at evaluation time. */
  angleMode: AngleMode;
  /** true when that mode actually decided the answer — the row's `deg` / `rad` tag. */
  angular: boolean;
  failed: boolean;
}

/** Build the tape row for a committed line. */
export function makeTapeRow(
  id: string,
  src: string,
  outcome: EvalOutcome,
  angleMode: AngleMode,
): TapeRow {
  if (!outcome.ok) {
    return { id, src, result: outcome.message, angleMode, angular: false, failed: true };
  }
  return { id, src, result: outcome.result, angleMode, angular: outcome.angular, failed: false };
}

/** Append one row, dropping the oldest once the tape is {@link TAPE_LIMIT} long. */
export function appendTapeRow(tape: readonly TapeRow[], row: TapeRow): TapeRow[] {
  const next = [...tape, row];
  return next.length > TAPE_LIMIT ? next.slice(next.length - TAPE_LIMIT) : next;
}

/** One persisted tape row, as `lib/persist.ts` stores it (no runtime id, no flags). */
export interface TapeRowSeed {
  src: string;
  result: string;
  angleMode?: unknown;
}

/**
 * Rebuild a row from storage. Only successful rows are persisted, so a restored row is never
 * an error row; its mode tag is re-derived from the source rather than trusted from disk.
 */
export function hydrateTapeRow(id: string, seed: TapeRowSeed): TapeRow {
  return {
    id,
    src: seed.src,
    result: seed.result,
    angleMode: isAngleMode(seed.angleMode) ? seed.angleMode : DEFAULT_ANGLE_MODE,
    angular: usesAngleFunction(applyCalculatorNames(preprocessExpression(seed.src))),
    failed: false,
  };
}

/**
 * The value `ans` resolves to after a restore: the last successful row's result, read back
 * from the string the tape shows. That is the one place `ans` is the *rounded* value — the
 * unrounded one lived in memory and the spec's data model persists results as text.
 */
export function ansFromTape(tape: readonly TapeRow[]): unknown {
  for (let index = tape.length - 1; index >= 0; index -= 1) {
    const row = tape[index];
    if (row.failed) continue;
    try {
      const value: unknown = mathEngine.evaluate(row.result, {});
      if (value !== undefined && value !== null && typeof value !== 'function') return value;
    } catch {
      // `∞` and friends do not read back as a value; keep looking further up the tape.
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * History recall (↑ / ↓)
 * ------------------------------------------------------------------ */

/**
 * How far back the ↑ key has walked. `index` 0 is the live line, 1 the most recent
 * expression; `stash` holds what the user had typed when they started walking, so ↓ back to
 * the bottom returns it instead of a blank line.
 */
export interface Recall {
  index: number;
  stash: string;
}

export const NO_RECALL: Recall = { index: 0, stash: '' };

/** The expressions ↑ walks, oldest first. Failed rows are included — a typo is worth fixing. */
export function recallSources(tape: readonly TapeRow[]): string[] {
  return tape.map((row) => row.src);
}

/**
 * One press of ↑ (`delta` 1, older) or ↓ (`delta` −1, newer). Returns the line to show and
 * the new walk position; at either end it returns what it was given, so the key is inert
 * rather than destructive.
 */
export function stepRecall(
  sources: readonly string[],
  recall: Recall,
  input: string,
  delta: 1 | -1,
): { input: string; recall: Recall } {
  const next = Math.min(Math.max(recall.index + delta, 0), sources.length);
  if (next === recall.index) return { input, recall };

  // Stepping off the live line is the only moment the draft can be saved.
  const stash = recall.index === 0 ? input : recall.stash;
  if (next === 0) return { input: stash, recall: NO_RECALL };
  return { input: sources[sources.length - next], recall: { index: next, stash } };
}

/* The tape row's TeX action serializes through `lib/latex.ts` (MATH6), which is where every
 * copy-as-LaTeX action in the plugin now lives. */
