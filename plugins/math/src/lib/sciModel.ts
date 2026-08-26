/**
 * Math — the Scientific tool's reducer (MATH4), pure so the whole REPL is testable without
 * React or a DOM.
 *
 * The tool is the wireframe's tape + input line + collapsible keypad in one state:
 *
 *  - **↵ commits a line to the tape**, evaluated under the mode in force at that moment
 *    (`lib/eval.ts`), and the result becomes `ans`. Nothing re-evaluates afterwards: a mode
 *    switch or a later `ans` cannot rewrite a row that is already printed.
 *  - **↑ / ↓ walk the history**, Esc clears the line, and typing ends the walk — the
 *    ordinary REPL contract, kept in `recall` so the input field stays a dumb text box.
 *  - **the keypad is a view of the same line.** A key press appends to `input`, so the
 *    keypad and the keyboard are two ways of writing the same expression rather than two
 *    input models to keep in sync.
 *
 * `hydrated` mirrors the shell's `restored` and the graph's own flag: storage resolves
 * asynchronously, so a restore that lands *after* the user has committed a row, switched
 * mode, or collapsed the keypad must lose. Typing alone does not raise it — a line in
 * progress is untouched by a restore, so there is nothing to protect.
 */

import {
  DEFAULT_ANGLE_MODE,
  NO_RECALL,
  ansFromTape,
  appendTapeRow,
  evaluateScientific,
  hydrateTapeRow,
  makeTapeRow,
  recallSources,
  stepRecall,
} from './eval';
import type { AngleMode, Recall, TapeRow, TapeRowSeed } from './eval';
import { keyById, resolveKey } from './keypad';

export interface SciState {
  tape: TapeRow[];
  /** the input line, exactly as typed (or as the keypad appended it). */
  input: string;
  angleMode: AngleMode;
  keypadCollapsed: boolean;
  /** the last successful result — what `ans` binds to — or null before the first one. */
  ans: unknown;
  recall: Recall;
  /** the `2nd` layer toggle: engaged until the next key press uses it. */
  second: boolean;
  /** monotonic row counter behind the tape's ids (no clock, no RNG). */
  seq: number;
  hydrated: boolean;
}

export const initialSciState: SciState = {
  tape: [],
  input: '',
  angleMode: DEFAULT_ANGLE_MODE,
  keypadCollapsed: false,
  ans: null,
  recall: NO_RECALL,
  second: false,
  seq: 1,
  hydrated: false,
};

export type SciAction =
  /** the user typed — which also ends any ↑ history walk. */
  | { type: 'setInput'; src: string }
  /** ↵ (or the keypad's accent key): evaluate the line onto the tape. */
  | { type: 'submit' }
  /** a keypad button, by id; the `2nd` layer decides which face it currently has. */
  | { type: 'pressKey'; id: string }
  | { type: 'setAngleMode'; mode: AngleMode }
  /** the keyboard toggle in the input row — collapses into pure-REPL mode. */
  | { type: 'toggleKeypad' }
  /** Esc. */
  | { type: 'clearInput' }
  /** the head's "Clear history". */
  | { type: 'clearTape' }
  /** ↑ (`delta` 1) / ↓ (`delta` −1). */
  | { type: 'recall'; delta: 1 | -1 }
  /** apply the state restored from `storage.scientific` on mount. */
  | {
      type: 'hydrate';
      tape: readonly TapeRowSeed[];
      angleMode: AngleMode;
      keypadCollapsed: boolean;
    };

/** Evaluate the current line onto the tape. Shared by ↵ and the keypad's accent key. */
function submit(state: SciState): SciState {
  if (state.input.trim() === '') return state; // ↵ on a blank line is inert.
  const outcome = evaluateScientific(state.input, {
    angleMode: state.angleMode,
    ans: state.ans,
  });
  const row = makeTapeRow(`s${state.seq}`, state.input, outcome, state.angleMode);
  return {
    ...state,
    tape: appendTapeRow(state.tape, row),
    seq: state.seq + 1,
    input: '',
    // A failed line leaves `ans` alone — the last *result* is still the last result.
    ans: outcome.ok ? outcome.value : state.ans,
    recall: NO_RECALL,
    second: false,
    hydrated: true,
  };
}

export function reduceSci(state: SciState, action: SciAction): SciState {
  switch (action.type) {
    case 'setInput':
      if (action.src === state.input) return state;
      return { ...state, input: action.src, recall: NO_RECALL };

    case 'submit':
      return submit(state);

    case 'pressKey': {
      const key = keyById(action.id);
      if (!key) return state;
      const resolved = resolveKey(key, state.second);
      switch (resolved.action) {
        case 'second':
          return { ...state, second: !state.second };
        case 'submit':
          return submit(state);
        case 'backspace':
          if (state.input === '') return state;
          return { ...state, input: state.input.slice(0, -1), recall: NO_RECALL };
        default:
          // Using the 2nd layer spends it, the way a calculator's does.
          return {
            ...state,
            input: state.input + resolved.insert,
            recall: NO_RECALL,
            second: false,
          };
      }
    }

    case 'setAngleMode':
      if (action.mode === state.angleMode) return state;
      return { ...state, angleMode: action.mode, hydrated: true };

    case 'toggleKeypad':
      return { ...state, keypadCollapsed: !state.keypadCollapsed, hydrated: true };

    case 'clearInput':
      if (state.input === '' && state.recall.index === 0 && !state.second) return state;
      return { ...state, input: '', recall: NO_RECALL, second: false };

    case 'clearTape':
      if (state.tape.length === 0) return state;
      // `ans` goes with the tape: there is no last result once the history is gone.
      return { ...state, tape: [], ans: null, recall: NO_RECALL, hydrated: true };

    case 'recall': {
      const stepped = stepRecall(
        recallSources(state.tape),
        state.recall,
        state.input,
        action.delta,
      );
      if (stepped.recall === state.recall && stepped.input === state.input) return state;
      return { ...state, input: stepped.input, recall: stepped.recall };
    }

    case 'hydrate': {
      // Only the first restore counts; after that the user is driving.
      if (state.hydrated) return state;
      const tape: TapeRow[] = [];
      for (const seed of action.tape) {
        if (typeof seed?.src !== 'string' || typeof seed?.result !== 'string') continue;
        tape.push(hydrateTapeRow(`s${tape.length + 1}`, seed));
      }
      return {
        ...state,
        tape,
        seq: tape.length + 1,
        angleMode: action.angleMode,
        keypadCollapsed: action.keypadCollapsed,
        ans: ansFromTape(tape),
        hydrated: true,
      };
    }

    default:
      return state;
  }
}
