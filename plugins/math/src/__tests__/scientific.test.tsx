import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeypadHint, Scientific } from '../Scientific';
import { Keypad } from '../Keypad';
import { Tape } from '../Tape';
import { initialSciState, reduceSci } from '../lib/sciModel';
import type { SciAction, SciState } from '../lib/sciModel';

const noop = () => {};

function run(state: SciState, ...actions: SciAction[]): SciState {
  return actions.reduce(reduceSci, state);
}

function enter(state: SciState, src: string): SciState {
  return run(state, { type: 'setInput', src }, { type: 'submit' });
}

/** The wireframe's tape: a plain row, a DEG-tagged trig row, and one failed line. */
function tapeState(): SciState {
  let state = enter(initialSciState, '√(2)');
  state = enter(state, 'sin(45)');
  state = enter(state, '2 +');
  return state;
}

function renderTape(state: SciState) {
  return renderToStaticMarkup(<Tape rows={state.tape} />);
}

describe('Scientific card (MATH4)', () => {
  it('renders the wireframe’s card: mode toggle, tape, input line, keypad', () => {
    const html = renderToStaticMarkup(<Scientific />);
    expect(html).toContain('class="sci-card"');
    expect(html).toContain('class="tape"');
    expect(html).toContain('class="sci-input-row"');
    expect(html).toContain('class="keypad"');
    expect(html).toContain('Type an expression — ↵ to evaluate');
  });

  it('opens on DEG, with RAD offered beside it', () => {
    const html = renderToStaticMarkup(<Scientific />);
    expect(html).toContain('>RAD<');
    expect(html).toContain('>DEG<');
    // Exactly one of the two reads as active.
    expect(html.match(/deg-btn deg-active/g)).toHaveLength(1);
    const at = html.indexOf('>DEG<');
    expect(html.slice(html.lastIndexOf('<button', at), at)).toContain('deg-active');
  });

  it('shows the keypad toggle lit while the keypad is up, and no hint line', () => {
    const html = renderToStaticMarkup(<Scientific />);
    expect(html).toContain('kb-toggle kb-on');
    expect(html).toContain('title="Hide keypad"');
    expect(html).not.toContain('sci-kbd-hint');
  });

  it('spells the shortcuts out in pure-REPL mode', () => {
    // The collapsed state's footer — the keys still work, they are just typed now.
    const html = renderToStaticMarkup(<KeypadHint />);
    expect(html).toContain('class="sci-kbd-hint"');
    expect(html.match(/class="kbd"/g)).toHaveLength(4);
    expect(html).toContain('evaluate');
    expect(html).toContain('previous');
    expect(html).toContain('clear line');
    expect(html).toContain('last result');
  });

  it('disables Clear history until there is history', () => {
    expect(renderToStaticMarkup(<Scientific />)).toContain('sci-clear-btn" type="button" disabled');
  });
});

describe('the tape rows', () => {
  it('renders each committed line as expr → result', () => {
    const html = renderTape(tapeState());
    expect(html.match(/class="tape-row/g)).toHaveLength(3);
    expect(html).toContain('<span class="tape-expr">√(2)</span>');
    expect(html).toContain('>1.4142136</span>');
    expect(html).toContain('<span class="tape-expr">sin(45)</span>');
  });

  it('tags only the row whose answer the angle mode decided', () => {
    const html = renderTape(tapeState());
    expect(html.match(/class="tape-unit-tag"/g)).toHaveLength(1);
    expect(html).toContain('<span class="tape-unit-tag">deg</span>');
  });

  it('keeps a failed line as a row carrying its reason, with no actions to offer', () => {
    const html = renderTape(tapeState());
    expect(html).toContain('tape-row tape-row-failed');
    expect(html).toContain('tape-result tape-result-failed');
    // Two successful rows → two action clusters; the failed one has none.
    expect(html.match(/class="tape-actions"/g)).toHaveLength(2);
  });

  it('offers copy / copy-as-LaTeX on hover, with insert-into-note disabled until MATH6', () => {
    const html = renderTape(enter(initialSciState, '√(2)'));
    expect(html).toContain('title="Copy result"');
    expect(html).toContain('title="Copy as LaTeX"');
    const insert = html.indexOf('title="Insert into note');
    expect(insert).toBeGreaterThan(-1);
    expect(html.slice(html.lastIndexOf('<button', insert), insert)).toContain('disabled');
  });

  it('renders nothing at all before the first evaluation', () => {
    expect(renderTape(initialSciState)).not.toContain('tape-row');
  });
});

describe('the keypad', () => {
  it('renders both of the wireframe’s grids with the accent ↵', () => {
    const html = renderToStaticMarkup(<Keypad second={false} dispatch={noop} />);
    expect(html).toContain('class="keypad-fns"');
    expect(html).toContain('class="keypad-nums"');
    expect(html).toContain('key key-enter');
    // 18 function keys + 18 numeric keys, every one a real button.
    expect(html.match(/class="key[ "]/g)).toHaveLength(36);
  });

  it('shows the base faces until 2nd is engaged, then the inverses', () => {
    const base = renderToStaticMarkup(<Keypad second={false} dispatch={noop} />);
    expect(base).toContain('>sin<');
    expect(base).not.toContain('sin⁻¹');

    const shifted = renderToStaticMarkup(<Keypad second dispatch={noop} />);
    expect(shifted).toContain('sin⁻¹');
    expect(shifted).toContain('cos⁻¹');
    expect(shifted).toContain('∛');
    // Keys with no inverse keep their face…
    expect(shifted).toContain('>7<');
    expect(shifted).toContain('>π<');
    // …and the 2nd toggle itself reads as pressed.
    expect(shifted).toContain('aria-pressed="true"');
  });
});
