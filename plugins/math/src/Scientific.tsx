/**
 * Math — the Scientific tool (MATH4): history tape, input line with a live ghost result, and
 * the collapsible keypad, in the wireframe's single card.
 *
 * Like Graphing, the tool owns its own reducer (kept alive across tab switches by the pane
 * staying mounted) and two effects around it: **restore once** on mount, and a **debounced
 * save** of the persisted slice. The debounce matters less here than it does for a dragged
 * slider, but a fast typist committing lines still shouldn't rewrite the whole blob per ↵.
 *
 * The keyboard contract is the wireframe's hint line, and it lives on the input rather than
 * the document: `↵` evaluate · `↑` previous expression · `Esc` clear line. Binding it to the
 * field means the plugin never swallows a key the host wanted while the tool merely happens
 * to be open.
 */

import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { StorageApi } from '@atlas/plugin-sdk';
import { Keypad } from './Keypad';
import { Tape } from './Tape';
import { ANGLE_MODES, previewScientific } from './lib/eval';
import { initialSciState, reduceSci } from './lib/sciModel';
import { loadScientific, saveScientific, scientificSnapshot } from './lib/persist';

/** Quiet period after the last change before the tape is written back to storage. */
const SAVE_DEBOUNCE_MS = 400;

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
    </svg>
  );
}

/**
 * Pure-REPL mode's footer: the keypad's shortcuts spelled out where the keypad was, verbatim
 * from the wireframe's collapsed state. Nothing is lost by collapsing — the same keys still
 * work, they are just typed.
 */
export function KeypadHint() {
  return (
    <div className="sci-kbd-hint">
      <span className="kbd">↵</span> evaluate · <span className="kbd">↑</span> previous
      expression · <span className="kbd">Esc</span> clear line · <span className="kbd">ans</span>{' '}
      last result
    </div>
  );
}

export function Scientific({ storage }: { storage?: Pick<StorageApi, 'get' | 'set'> | null }) {
  const [state, dispatch] = useReducer(reduceSci, initialSciState);

  const preview = useMemo(
    () => previewScientific(state.input, { angleMode: state.angleMode, ans: state.ans }),
    [state.input, state.angleMode, state.ans],
  );

  const inputRef = useRef<HTMLInputElement | null>(null);
  const tapeRef = useRef<HTMLDivElement | null>(null);

  /** Keys a newer build wrote inside `scientific`; held so a save from here re-emits them. */
  const extraRef = useRef<Record<string, unknown>>({});

  // 1 · Restore the saved tape once. A missing or malformed section parses to an empty tape,
  // and the reducer drops a restore that lands after the user already committed a line.
  useEffect(() => {
    if (!storage) return;
    let live = true;
    loadScientific(storage)
      .then((saved) => {
        if (!live) return;
        extraRef.current = saved.extra;
        dispatch({
          type: 'hydrate',
          tape: saved.tape,
          angleMode: saved.angleMode,
          keypadCollapsed: saved.keypadCollapsed,
        });
      })
      .catch(() => {
        /* nothing to restore; the tape opens empty. */
      });
    return () => {
      live = false;
    };
  }, [storage]);

  // 2 · Save the persistable slice, debounced. Never before the restore has landed, or the
  // empty initial tape would overwrite the stored one on mount.
  useEffect(() => {
    if (!storage || !state.hydrated) return;
    const timer = setTimeout(() => {
      saveScientific(storage, scientificSnapshot(state, extraRef.current)).catch(() => {
        /* best-effort persistence; a failed flush only costs the restore next time. */
      });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Only the persisted slice should restart the debounce — typing a line must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, state.hydrated, state.tape, state.angleMode, state.keypadCollapsed]);

  // 3 · Keep the newest row in view. The tape bottom-aligns while it is short, so this only
  // does anything once the history has outgrown the card.
  useEffect(() => {
    const tape = tapeRef.current;
    if (tape) tape.scrollTop = tape.scrollHeight;
  }, [state.tape]);

  return (
    <div className="sci-area">
      <div className="sci-card">
        <div className="sci-head">
          <div className="deg-toggle" role="group" aria-label="Angle mode">
            {ANGLE_MODES.map((mode) => (
              <button
                key={mode}
                className={'deg-btn' + (mode === state.angleMode ? ' deg-active' : '')}
                type="button"
                aria-pressed={mode === state.angleMode}
                onClick={() => dispatch({ type: 'setAngleMode', mode })}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            className="sci-clear-btn"
            type="button"
            disabled={state.tape.length === 0}
            onClick={() => dispatch({ type: 'clearTape' })}
          >
            Clear history
          </button>
        </div>

        <Tape rows={state.tape} containerRef={tapeRef} />

        <div className="sci-input-row">
          <span className="sci-prompt" aria-hidden="true">
            ›
          </span>
          <input
            ref={inputRef}
            className="sci-input"
            type="text"
            value={state.input}
            placeholder="Type an expression — ↵ to evaluate"
            aria-label="Scientific input"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => dispatch({ type: 'setInput', src: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                dispatch({ type: 'submit' });
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                dispatch({ type: 'recall', delta: 1 });
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                dispatch({ type: 'recall', delta: -1 });
              } else if (event.key === 'Escape') {
                event.preventDefault();
                dispatch({ type: 'clearInput' });
              }
            }}
          />
          {preview ? <span className="sci-preview">= {preview}</span> : null}
          <button
            className={'kb-toggle' + (state.keypadCollapsed ? '' : ' kb-on')}
            type="button"
            title={state.keypadCollapsed ? 'Show keypad' : 'Hide keypad'}
            aria-pressed={!state.keypadCollapsed}
            onClick={() => {
              dispatch({ type: 'toggleKeypad' });
              inputRef.current?.focus();
            }}
          >
            <KeyboardIcon />
          </button>
        </div>

        {state.keypadCollapsed ? <KeypadHint /> : <Keypad second={state.second} dispatch={dispatch} />}
      </div>
    </div>
  );
}
