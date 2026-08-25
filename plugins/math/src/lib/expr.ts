/**
 * Math — graph-expression preprocessing + the mathjs symbol whitelist (MATH2).
 *
 * Carried over verbatim in intent from the superseded graphing-calculator spec: rewrite what
 * a student types (`2x`, `x^2 − 2`, `a·sin(x)`) into something both engines accept, then
 * **validate it against a whitelist** so a persisted expression can never execute a config
 * change. `import`, `createUnit` and assignments are refused here, in front of the parser,
 * rather than relied on being disabled downstream (`lib/mathEngine.ts` hardens the instance
 * too — belt and braces, since a graph row is the one place untrusted text is *stored*).
 *
 * ## Two engines, one string
 *
 * A graph row is checked by **mathjs** (this file) but drawn by **function-plot**, whose
 * sampler compiles against a namespace that is essentially `Object.create(Math)` plus
 * `factorial` / `nthRoot`. Those two vocabularies overlap but do not match: mathjs knows
 * `sec`/`tau`, `Math` does not; `Math` knows `PI`, mathjs spells it `pi`.
 *
 * So {@link ALLOWED_FUNCTIONS} is deliberately the **intersection** — anything that passes
 * validation here is guaranteed to plot — and {@link SYMBOL_ALIASES} folds the mathjs
 * spellings onto the shared ones (`pi` → `PI`). `expr.test.ts` asserts the intersection
 * property against both vocabularies, so widening the list can't silently ship a symbol that
 * validates but draws nothing.
 */

import { mathEngine } from './mathEngine';

/** The independent variable a `y = f(x)` row is written in terms of. */
export const GRAPH_VARIABLE = 'x';

/**
 * Constants a row may reference. Uppercase because that is the spelling the plotter's
 * `Math`-derived namespace uses; mathjs accepts them as aliases of `pi` / `e`.
 */
export const ALLOWED_CONSTANTS: readonly string[] = ['PI', 'E'];

/**
 * Functions a row may call — the mathjs ∩ plotter intersection (see the module note). Adding
 * a name here means asserting it exists in *both* engines; `expr.test.ts` enforces that.
 */
export const ALLOWED_FUNCTIONS: readonly string[] = [
  'abs', 'sign', 'sqrt', 'cbrt', 'nthRoot', 'factorial',
  'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'pow', 'hypot',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'ceil', 'floor', 'round', 'min', 'max',
];

/**
 * Names that get a pointed message instead of the generic "unknown function" one. Every one
 * of them is *already* refused by not being on {@link ALLOWED_FUNCTIONS} — this list only
 * decides what the row says, and documents the specific escapes the spec calls out.
 */
const BLOCKED_NAMES: readonly string[] = [
  'import', 'createUnit', 'config', 'evaluate', 'parse', 'compile', 'chain',
  'simplify', 'derivative', 'help', 'typed', 'unit', 'createFunction',
];

/**
 * mathjs spellings folded onto the ones both engines share.
 *
 * A `Map`, not an object literal — and the same for every table below that is keyed by user
 * input. A plain object resolves `constructor` / `__proto__` through `Object.prototype` and
 * hands back an inherited value instead of a miss, which is exactly the sort of surprise a
 * whitelist exists to keep out of a persisted expression.
 */
const SYMBOL_ALIASES = new Map<string, string>([
  ['pi', 'PI'],
  ['e', 'E'],
]);

/** Single characters the wireframe (and any paste from a textbook) uses for real operators. */
const GLYPHS = new Map<string, string>(Object.entries({
  '·': '*', // · middle dot
  '∙': '*', // ∙ bullet operator
  '⋅': '*', // ⋅ dot operator
  '×': '*', // × multiplication sign
  '÷': '/', // ÷ division sign
  '−': '-', // − minus sign
  '–': '-', // – en dash
  '—': '-', // — em dash
  'π': 'pi', // π
  '√': 'sqrt', // √
  '\u00A0': ' ', // non-breaking space, escaped so the literal byte stays out of the file
}));

const ALLOWED_FUNCTION_SET = new Set(ALLOWED_FUNCTIONS);
const ALLOWED_CONSTANT_SET = new Set(ALLOWED_CONSTANTS);
const BLOCKED_NAME_SET = new Set(BLOCKED_NAMES);

/** A row that parsed and passed the whitelist. */
export interface ParsedExpression {
  ok: true;
  /** the rewritten, plot-ready source handed to function-plot. */
  normalized: string;
  /**
   * Whitelisted symbols that are neither {@link GRAPH_VARIABLE} nor a known constant — i.e.
   * undetermined parameters. MATH2 treats these as an error row; MATH3 turns them into
   * sliders, which is why they are reported rather than rejected here.
   */
  free: string[];
}

/** A row that could not be parsed, or that reached for something it may not have. */
export interface ExpressionError {
  ok: false;
  message: string;
}

export type ExpressionResult = ParsedExpression | ExpressionError;

/* ------------------------------------------------------------------ *
 * Preprocessing
 * ------------------------------------------------------------------ */

/** Drop a leading `y =` — the rail's first-run placeholder invites writing one. */
export function stripLeadingY(src: string): string {
  return src.replace(/^\s*y\s*=\s*(?!=)/, '');
}

function replaceGlyphs(src: string): string {
  let out = '';
  for (const ch of src) out += GLYPHS.get(ch) ?? ch;
  return out;
}

type TokenKind = 'number' | 'name' | 'space' | 'other';
interface Token {
  kind: TokenKind;
  text: string;
}

const NUMBER_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME_RE = /^[A-Za-z_][A-Za-z_0-9]*/;
const SPACE_RE = /^\s+/;

/** Split into numbers / identifiers / whitespace / single characters. */
function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let rest = src;
  while (rest.length > 0) {
    const space = SPACE_RE.exec(rest);
    if (space) {
      tokens.push({ kind: 'space', text: space[0] });
      rest = rest.slice(space[0].length);
      continue;
    }
    const num = NUMBER_RE.exec(rest);
    if (num) {
      tokens.push({ kind: 'number', text: num[0] });
      rest = rest.slice(num[0].length);
      continue;
    }
    const name = NAME_RE.exec(rest);
    if (name) {
      tokens.push({ kind: 'name', text: name[0] });
      rest = rest.slice(name[0].length);
      continue;
    }
    tokens.push({ kind: 'other', text: rest[0] });
    rest = rest.slice(1);
  }
  return tokens;
}

/** True when a `*` belongs between two adjacent significant tokens. */
function needsProduct(left: Token, right: Token): boolean {
  const opensGroup = right.kind === 'other' && right.text === '(';
  const startsValue = right.kind === 'number' || right.kind === 'name' || opensGroup;
  if (!startsValue) return false;

  if (left.kind === 'number') return true; // 2x · 2(x+1) · 2sin(x)
  if (left.kind === 'other' && left.text === ')') return true; // (x+1)(x−1) · (x+1)x
  if (left.kind !== 'name') return false;

  if (!opensGroup) return true; // a b · a2 — a name beside a value is a product

  // A name immediately before `(` is a call unless it is a *single letter*: parameters are
  // written `a`, `b`, `k`, so `a(x+1)` is the coefficient idiom, while anything longer was
  // meant as a function — and saying `Unknown function “sec”` beats silently rewriting it
  // into `sec*(x)` and then complaining about an unknown variable. Every whitelisted and
  // blocked name is at least three characters, so this never swallows a real call.
  return left.text.length === 1;
}

/**
 * The spec's implicit-multiplication rewrite (`2x` → `2*x`), plus glyph folding and the
 * mathjs → shared-namespace symbol aliases. Purely textual: whether the result *means*
 * anything is {@link parseExpression}'s question.
 */
export function preprocessExpression(src: string): string {
  const tokens = tokenize(replaceGlyphs(stripLeadingY(src)));
  let out = '';
  let pendingSpace = '';
  let previous: Token | null = null;
  for (const token of tokens) {
    if (token.kind === 'space') {
      pendingSpace += token.text;
      continue;
    }
    // An inserted `*` binds to the token on its left, ahead of any spacing the user typed,
    // so `2 x` reads as `2* x` rather than `2 *x`.
    if (previous && needsProduct(previous, token)) out += '*';
    out += pendingSpace;
    pendingSpace = '';
    out += token.kind === 'name' ? (SYMBOL_ALIASES.get(token.text) ?? token.text) : token.text;
    previous = token;
  }
  return out + pendingSpace;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/** mathjs appends ` (char 7)` to its parse errors; the rail has no room for it. */
function cleanParseMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s*\(char \d+\)\s*$/, '').trim() || 'Could not parse this expression';
}

function quoted(name: string): string {
  return `“${name}”`;
}

/** The minimum of a mathjs AST node this walk needs; the published types are wider. */
interface WalkNode {
  type: string;
  name?: string;
  fn?: WalkNode;
}

/** Node kinds that could reach past plain arithmetic; refused with their own message. */
const REFUSED_NODES = new Map<string, string>([
  ['AssignmentNode', 'Assignments are not allowed in a graph expression'],
  ['FunctionAssignmentNode', 'Function definitions are not allowed in a graph expression'],
  ['AccessorNode', 'Property access is not allowed in a graph expression'],
  ['IndexNode', 'Indexing is not allowed in a graph expression'],
  ['ObjectNode', 'Objects are not allowed in a graph expression'],
  ['BlockNode', 'Write one expression per row'],
]);

/**
 * Parse a rail row and check every symbol it names against the whitelist.
 *
 * Returns the plot-ready string plus the row's free parameters on success; on failure, the
 * one-line message the row shows inline. Never throws — a half-typed row is the normal case.
 */
export function parseExpression(src: string): ExpressionResult {
  const normalized = preprocessExpression(src);
  if (normalized.trim() === '') return { ok: false, message: 'Write an expression in terms of x' };

  let root;
  try {
    root = mathEngine.parse(normalized);
  } catch (error) {
    return { ok: false, message: cleanParseMessage(error) };
  }

  const callees = new Set<unknown>();
  const free: string[] = [];
  let failure: string | null = null;

  root.traverse((raw) => {
    if (failure) return;
    const node = raw as unknown as WalkNode;

    const refused = REFUSED_NODES.get(node.type);
    if (refused) {
      failure = refused;
      return;
    }

    if (node.type === 'FunctionNode') {
      const callee = node.fn;
      // Pre-order traversal reaches the FunctionNode before its own `fn` child, so marking
      // the callee here keeps it from being counted again as a bare symbol below.
      callees.add(callee);
      const name = callee?.name;
      if (typeof name !== 'string') {
        failure = 'Only named functions can be called here';
      } else if (BLOCKED_NAME_SET.has(name)) {
        failure = `${quoted(name)} is not allowed in a graph expression`;
      } else if (!ALLOWED_FUNCTION_SET.has(name)) {
        failure = `Unknown function ${quoted(name)}`;
      }
      return;
    }

    if (node.type === 'SymbolNode' && !callees.has(node)) {
      const name = node.name ?? '';
      if (BLOCKED_NAME_SET.has(name)) {
        failure = `${quoted(name)} is not allowed in a graph expression`;
      } else if (ALLOWED_FUNCTION_SET.has(name)) {
        failure = `${quoted(name)} is a function — call it like ${name}(x)`;
      } else if (name !== GRAPH_VARIABLE && !ALLOWED_CONSTANT_SET.has(name) && !free.includes(name)) {
        free.push(name);
      }
    }
  });

  if (failure) return { ok: false, message: failure };
  return { ok: true, normalized, free };
}
