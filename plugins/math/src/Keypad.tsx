/**
 * Math — the Scientific tool's keypad (MATH4): the functions grid + the numeric grid with
 * the accent ↵, straight out of `MathPluginApproved.html`'s `.keypad`.
 *
 * Purely presentational — the layout is `lib/keypad.ts`'s tables and the effect of a press is
 * the reducer's, so this file only renders faces and forwards ids. Two details that are not
 * decoration: a press is prevented from stealing focus (`onMouseDown`), so the caret stays in
 * the input line where the next keystroke belongs, and `2nd` reports itself with
 * `aria-pressed` because its state changes what every other key on the pad *means*.
 */

import { FUNCTION_KEYS, NUMBER_KEYS, resolveKey } from './lib/keypad';
import type { KeypadKey } from './lib/keypad';
import type { SciAction } from './lib/sciModel';

export function Keypad({
  second,
  dispatch,
}: {
  /** true while the `2nd` layer is engaged — every shiftable key shows its inverse face. */
  second: boolean;
  dispatch(action: SciAction): void;
}) {
  return (
    <div className="keypad">
      <div className="keypad-fns">
        {FUNCTION_KEYS.map((key) => (
          <Key key={key.id} keyDef={key} second={second} dispatch={dispatch} />
        ))}
      </div>
      <div className="keypad-nums">
        {NUMBER_KEYS.map((key) => (
          <Key key={key.id} keyDef={key} second={second} dispatch={dispatch} />
        ))}
      </div>
    </div>
  );
}

function Key({
  keyDef,
  second,
  dispatch,
}: {
  keyDef: KeypadKey;
  second: boolean;
  dispatch(action: SciAction): void;
}) {
  const face = resolveKey(keyDef, second);
  const variant = keyDef.variant ? ` key-${keyDef.variant}` : '';
  const engaged = keyDef.action === 'second' && second;
  return (
    <button
      className={'key' + variant + (engaged || face.shifted ? ' key-shifted' : '')}
      type="button"
      title={face.title ?? face.label}
      aria-pressed={keyDef.action === 'second' ? second : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => dispatch({ type: 'pressKey', id: keyDef.id })}
    >
      {face.label}
    </button>
  );
}
