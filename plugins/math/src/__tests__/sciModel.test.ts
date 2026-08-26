import { describe, expect, it } from 'vitest';
import { initialSciState, reduceSci } from '../lib/sciModel';
import type { SciAction, SciState } from '../lib/sciModel';
import { FUNCTION_KEYS, KEYPAD_KEYS, NUMBER_KEYS, keyById, resolveKey } from '../lib/keypad';
import { TAPE_LIMIT } from '../lib/eval';

function run(state: SciState, ...actions: SciAction[]): SciState {
  return actions.reduce(reduceSci, state);
}

/** Type a line and commit it, the way ↵ does. */
function enter(state: SciState, src: string): SciState {
  return run(state, { type: 'setInput', src }, { type: 'submit' });
}

function press(state: SciState, ...ids: string[]): SciState {
  return run(state, ...ids.map((id): SciAction => ({ type: 'pressKey', id })));
}

const last = (state: SciState) => state.tape[state.tape.length - 1];

describe('the tape (MATH4)', () => {
  it('commits a line as expr → result and clears the input', () => {
    const state = enter(initialSciState, '240/12');
    expect(state.tape).toHaveLength(1);
    expect(last(state).src).toBe('240/12');
    expect(last(state).result).toBe('20');
    expect(state.input).toBe('');
  });

  it('ignores ↵ on a blank line', () => {
    const typed = run(initialSciState, { type: 'setInput', src: '   ' });
    expect(reduceSci(typed, { type: 'submit' })).toBe(typed);
    expect(reduceSci(initialSciState, { type: 'submit' })).toBe(initialSciState);
  });

  it('stamps each row with the mode in force when it was evaluated', () => {
    let state = enter(initialSciState, 'sin(45)'); // DEG by default, per the wireframe.
    state = run(state, { type: 'setAngleMode', mode: 'rad' });
    state = enter(state, 'sin(45)');

    expect(state.tape.map((row) => row.angleMode)).toEqual(['deg', 'rad']);
    expect(state.tape.map((row) => row.result)).toEqual(['0.70710678', '0.85090352']);
    // The crux: switching mode does not rewrite what is already printed.
    expect(state.tape[0].result).toBe('0.70710678');
  });

  it('chains ans through the tape', () => {
    let state = enter(initialSciState, '12! / 10!');
    expect(last(state).result).toBe('132');
    state = enter(state, 'ans × 4');
    expect(last(state).result).toBe('528');
    state = enter(state, 'ans/2');
    expect(last(state).result).toBe('264');
  });

  it('keeps ans pointing at the last *successful* result', () => {
    let state = enter(initialSciState, '2+2');
    state = enter(state, '2 +'); // a typo lands on the tape…
    expect(last(state).failed).toBe(true);
    state = enter(state, 'ans*10'); // …and leaves `ans` where it was.
    expect(last(state).result).toBe('40');
  });

  it('clears the history and ans together', () => {
    let state = enter(initialSciState, '2+2');
    state = run(state, { type: 'clearTape' });
    expect(state.tape).toEqual([]);
    expect(state.ans).toBeNull();
    state = enter(state, 'ans');
    expect(last(state).result).toBe('No result yet for ans');
  });

  it('bounds the tape so a long session cannot grow without limit', () => {
    let state = initialSciState;
    for (let index = 0; index < TAPE_LIMIT + 3; index += 1) state = enter(state, `${index}+0`);
    expect(state.tape).toHaveLength(TAPE_LIMIT);
    expect(state.tape[0].src).toBe('3+0');
  });
});

describe('history recall + Esc', () => {
  function withHistory(): SciState {
    return ['1+1', 'sin(45)', '12!/10!'].reduce(enter, initialSciState);
  }

  it('↑ walks back through previous expressions', () => {
    let state = withHistory();
    state = run(state, { type: 'recall', delta: 1 });
    expect(state.input).toBe('12!/10!');
    state = run(state, { type: 'recall', delta: 1 });
    expect(state.input).toBe('sin(45)');
    state = run(state, { type: 'recall', delta: -1 });
    expect(state.input).toBe('12!/10!');
  });

  it('typing ends the walk, so the next ↑ starts from the newest again', () => {
    let state = run(withHistory(), { type: 'recall', delta: 1 });
    state = run(state, { type: 'setInput', src: '5*' });
    expect(state.recall.index).toBe(0);
    state = run(state, { type: 'recall', delta: 1 });
    expect(state.input).toBe('12!/10!');
    // …and ↓ hands back the interrupted line.
    expect(run(state, { type: 'recall', delta: -1 }).input).toBe('5*');
  });

  it('Esc clears the line and the walk', () => {
    let state = run(withHistory(), { type: 'recall', delta: 1 });
    state = run(state, { type: 'clearInput' });
    expect(state.input).toBe('');
    expect(state.recall.index).toBe(0);
    // The tape is history, not a draft — Esc must not touch it.
    expect(state.tape).toHaveLength(3);
  });

  it('re-committing a recalled line evaluates it again', () => {
    let state = enter(initialSciState, '2+2');
    state = run(state, { type: 'recall', delta: 1 }, { type: 'submit' });
    expect(state.tape.map((row) => row.result)).toEqual(['4', '4']);
  });
});

describe('the keypad', () => {
  it('appends what the user would have typed', () => {
    const state = press(initialSciState, 'digit-2', 'multiply', 'sin', 'digit-4', 'digit-5', 'close');
    expect(state.input).toBe('2×sin(45)');
    expect(reduceSci(state, { type: 'submit' }).tape[0].result).toBe('1.4142136');
  });

  it('evaluates through the accent ↵ key exactly as ↵ does', () => {
    const typed = enter(initialSciState, '7÷2');
    const tapped = press(run(initialSciState, { type: 'setInput', src: '7÷2' }), 'enter');
    expect(tapped.tape[0].result).toBe(typed.tape[0].result);
    expect(tapped.input).toBe('');
  });

  it('backspaces one character and no further than empty', () => {
    let state = press(initialSciState, 'digit-1', 'digit-2', 'backspace');
    expect(state.input).toBe('1');
    state = press(state, 'backspace', 'backspace');
    expect(state.input).toBe('');
  });

  it('inserts ans from the pad', () => {
    let state = enter(initialSciState, '2+2');
    state = press(state, 'ans', 'plus', 'digit-1');
    expect(state.input).toBe('ans+1');
    expect(reduceSci(state, { type: 'submit' }).tape[1].result).toBe('5');
  });

  it('2nd swaps the shiftable faces and is spent by the next press', () => {
    const base = resolveKey(keyById('sin')!, false);
    const shifted = resolveKey(keyById('sin')!, true);
    expect(base.insert).toBe('sin(');
    expect(shifted.insert).toBe('asin(');
    expect(shifted.label).toBe('sin⁻¹');

    let state = press(initialSciState, 'second');
    expect(state.second).toBe(true);
    state = press(state, 'sin');
    expect(state.input).toBe('asin(');
    expect(state.second).toBe(false); // one shifted press, then back to the base layer.
    state = press(state, 'digit-1', 'close');
    expect(reduceSci(state, { type: 'submit' }).tape[0].result).toBe('90'); // DEG.
  });

  it('leaves a key with no inverse alone while 2nd is engaged', () => {
    const state = press(initialSciState, 'second', 'digit-7');
    expect(state.input).toBe('7');
  });

  it('ignores an unknown key id', () => {
    expect(reduceSci(initialSciState, { type: 'pressKey', id: 'nope' })).toBe(initialSciState);
  });

  it('lays out the wireframe’s two grids, in order', () => {
    expect(FUNCTION_KEYS.map((key) => key.label)).toEqual([
      '2nd', 'x²', 'xʸ', '√', 'π', 'e',
      'sin', 'cos', 'tan', 'ln', 'log', '|x|',
      '(', ')', ',', '!', '%', '×10ⁿ',
    ]);
    expect(NUMBER_KEYS.map((key) => key.label)).toEqual([
      '7', '8', '9', '÷', '⌫',
      '4', '5', '6', '×', '↵',
      '1', '2', '3', '−',
      '0', '.', 'ans', '+',
    ]);
  });

  it('every key does something the reducer understands', () => {
    for (const key of KEYPAD_KEYS) {
      expect(keyById(key.id)).toBe(key);
      if (key.action === 'insert') expect(key.insert).toBeTruthy();
    }
    // Ids are unique — a duplicate would silently shadow a key in the lookup.
    expect(new Set(KEYPAD_KEYS.map((key) => key.id)).size).toBe(KEYPAD_KEYS.length);
  });
});

describe('keypad collapse + restore', () => {
  it('toggles into pure-REPL mode and back', () => {
    expect(initialSciState.keypadCollapsed).toBe(false);
    const collapsed = run(initialSciState, { type: 'toggleKeypad' });
    expect(collapsed.keypadCollapsed).toBe(true);
    expect(run(collapsed, { type: 'toggleKeypad' }).keypadCollapsed).toBe(false);
  });

  it('restores the tape, the mode and the collapse once', () => {
    const state = run(initialSciState, {
      type: 'hydrate',
      tape: [{ src: 'sin(45)', result: '0.70710678', angleMode: 'deg' }],
      angleMode: 'rad',
      keypadCollapsed: true,
    });
    expect(state.tape).toHaveLength(1);
    expect(state.tape[0].angular).toBe(true);
    expect(state.angleMode).toBe('rad');
    expect(state.keypadCollapsed).toBe(true);
    // `ans` comes back with the tape, so chaining survives a reopen.
    expect(state.ans).toBe(0.70710678);
    expect(enter(state, 'ans*2').tape[1].result).toBe('1.4142136');
  });

  it('drops a restore that lands after the user has committed a line', () => {
    // Storage is async: a late restore must never eat what the user already computed.
    const typed = enter(initialSciState, '2+2');
    const late = run(typed, {
      type: 'hydrate',
      tape: [{ src: 'sin(45)', result: '0.70710678', angleMode: 'deg' }],
      angleMode: 'rad',
      keypadCollapsed: true,
    });
    expect(late).toBe(typed);
  });

  it('lets a restore land while a line is only half-typed', () => {
    // A draft is not persisted state, so there is nothing for the restore to clobber.
    const typing = run(initialSciState, { type: 'setInput', src: '2+' });
    const restored = run(typing, {
      type: 'hydrate',
      tape: [{ src: '1+1', result: '2', angleMode: 'deg' }],
      angleMode: 'deg',
      keypadCollapsed: false,
    });
    expect(restored.tape).toHaveLength(1);
    expect(restored.input).toBe('2+');
  });

  it('skips malformed rows in a restored tape', () => {
    const state = run(initialSciState, {
      type: 'hydrate',
      tape: [
        { src: '1+1', result: '2', angleMode: 'deg' },
        { src: 'broken' } as never,
        { result: '9' } as never,
      ],
      angleMode: 'deg',
      keypadCollapsed: false,
    });
    expect(state.tape.map((row) => row.src)).toEqual(['1+1']);
    expect(state.seq).toBe(2);
  });
});
