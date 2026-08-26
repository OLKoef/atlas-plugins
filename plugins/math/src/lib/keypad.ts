/**
 * Math — the Scientific tool's keypad layout (MATH4), as data.
 *
 * The two grids and their key order are the approved wireframe's, verbatim: a six-column
 * functions pad (`2nd x² xʸ √ π e` / `sin cos tan ln log |x|` / `( ) , ! % ×10ⁿ`) and a
 * five-column numeric pad whose accent ↵ spans the last three rows. Layout stays in CSS —
 * this file only says what each key *is*, so the reducer can be tested without a DOM.
 *
 * Two rules worth stating because they are choices, not accidents:
 *
 *  - **keys append to the end of the line.** Tracking a caret would mean owning the input's
 *    selection state; the wireframe's keypad is a fast-entry aid beside a live text field
 *    that already edits itself, so appending is the honest behaviour rather than a
 *    half-working caret.
 *  - **what a key inserts is what the user would have typed**, glyphs included (`√(`, `×`,
 *    `π`). `lib/expr.ts` folds those onto operators and `lib/eval.ts` renames `ln`/`log`, so
 *    the tape shows `√(2)` while mathjs evaluates `sqrt(2)`.
 */

export type KeyAction = 'insert' | 'backspace' | 'submit' | 'second';

/** The wireframe's key styling classes: plain, digit, accent operator, muted modifier, ↵. */
export type KeyVariant = 'digit' | 'op' | 'mod' | 'enter';

export interface KeypadKey {
  id: string;
  label: string;
  action: KeyAction;
  /** text appended for an `insert` key. */
  insert?: string;
  variant?: KeyVariant;
  /** accessible name, when the label alone is a glyph. */
  title?: string;
  /** what this key becomes while `2nd` is engaged — the standard inverse layer. */
  shift?: { label: string; insert: string; title?: string };
}

/** Functions pad, in wireframe order (6 per row, 3 rows). */
export const FUNCTION_KEYS: readonly KeypadKey[] = [
  { id: 'second', label: '2nd', action: 'second', variant: 'mod', title: 'Second function layer' },
  { id: 'square', label: 'x²', action: 'insert', insert: '^2', shift: { label: 'x³', insert: '^3' } },
  { id: 'power', label: 'xʸ', action: 'insert', insert: '^', shift: { label: 'ʸ√x', insert: 'nthRoot(' } },
  { id: 'sqrt', label: '√', action: 'insert', insert: '√(', shift: { label: '∛', insert: 'cbrt(' } },
  { id: 'pi', label: 'π', action: 'insert', insert: 'π' },
  { id: 'e', label: 'e', action: 'insert', insert: 'e' },

  { id: 'sin', label: 'sin', action: 'insert', insert: 'sin(', shift: { label: 'sin⁻¹', insert: 'asin(' } },
  { id: 'cos', label: 'cos', action: 'insert', insert: 'cos(', shift: { label: 'cos⁻¹', insert: 'acos(' } },
  { id: 'tan', label: 'tan', action: 'insert', insert: 'tan(', shift: { label: 'tan⁻¹', insert: 'atan(' } },
  { id: 'ln', label: 'ln', action: 'insert', insert: 'ln(', shift: { label: 'eˣ', insert: 'exp(' } },
  { id: 'log', label: 'log', action: 'insert', insert: 'log(', shift: { label: '10ˣ', insert: '10^' } },
  { id: 'abs', label: '|x|', action: 'insert', insert: 'abs(', title: 'Absolute value' },

  { id: 'open', label: '(', action: 'insert', insert: '(' },
  { id: 'close', label: ')', action: 'insert', insert: ')' },
  { id: 'comma', label: ',', action: 'insert', insert: ',' },
  { id: 'factorial', label: '!', action: 'insert', insert: '!', title: 'Factorial' },
  { id: 'percent', label: '%', action: 'insert', insert: '%' },
  { id: 'exp10', label: '×10ⁿ', action: 'insert', insert: '×10^', variant: 'mod', title: 'Times ten to the power' },
];

/**
 * Numeric pad, in wireframe DOM order. ↵ is placed by CSS grid (column 5, rows 2–4); the
 * keys after it flow into the cells it leaves free, which is why it sits mid-list here.
 */
export const NUMBER_KEYS: readonly KeypadKey[] = [
  { id: 'digit-7', label: '7', action: 'insert', insert: '7', variant: 'digit' },
  { id: 'digit-8', label: '8', action: 'insert', insert: '8', variant: 'digit' },
  { id: 'digit-9', label: '9', action: 'insert', insert: '9', variant: 'digit' },
  { id: 'divide', label: '÷', action: 'insert', insert: '÷', variant: 'op', title: 'Divide' },
  { id: 'backspace', label: '⌫', action: 'backspace', variant: 'mod', title: 'Backspace' },

  { id: 'digit-4', label: '4', action: 'insert', insert: '4', variant: 'digit' },
  { id: 'digit-5', label: '5', action: 'insert', insert: '5', variant: 'digit' },
  { id: 'digit-6', label: '6', action: 'insert', insert: '6', variant: 'digit' },
  { id: 'multiply', label: '×', action: 'insert', insert: '×', variant: 'op', title: 'Multiply' },
  { id: 'enter', label: '↵', action: 'submit', variant: 'enter', title: 'Evaluate' },

  { id: 'digit-1', label: '1', action: 'insert', insert: '1', variant: 'digit' },
  { id: 'digit-2', label: '2', action: 'insert', insert: '2', variant: 'digit' },
  { id: 'digit-3', label: '3', action: 'insert', insert: '3', variant: 'digit' },
  { id: 'minus', label: '−', action: 'insert', insert: '−', variant: 'op', title: 'Minus' },

  { id: 'digit-0', label: '0', action: 'insert', insert: '0', variant: 'digit' },
  { id: 'point', label: '.', action: 'insert', insert: '.', variant: 'digit' },
  { id: 'ans', label: 'ans', action: 'insert', insert: 'ans', variant: 'mod', title: 'Last result' },
  { id: 'plus', label: '+', action: 'insert', insert: '+', variant: 'op', title: 'Plus' },
];

export const KEYPAD_KEYS: readonly KeypadKey[] = [...FUNCTION_KEYS, ...NUMBER_KEYS];

const KEYS_BY_ID = new Map(KEYPAD_KEYS.map((key) => [key.id, key]));

/** Look up a pressed key by id. Unknown ids resolve to null rather than throwing. */
export function keyById(id: string): KeypadKey | null {
  return KEYS_BY_ID.get(id) ?? null;
}

/** A key as it currently reads — the base key, or its inverse while `2nd` is engaged. */
export interface ResolvedKey {
  label: string;
  action: KeyAction;
  insert: string;
  title?: string;
  /** true when the `2nd` layer supplied this face. */
  shifted: boolean;
}

export function resolveKey(key: KeypadKey, second: boolean): ResolvedKey {
  if (second && key.shift) {
    return {
      label: key.shift.label,
      action: key.action,
      insert: key.shift.insert,
      title: key.shift.title,
      shifted: true,
    };
  }
  return {
    label: key.label,
    action: key.action,
    insert: key.insert ?? '',
    title: key.title,
    shifted: false,
  };
}
