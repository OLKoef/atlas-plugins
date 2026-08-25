import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOL,
  LIVE_TOOLS,
  TOOLS,
  initialMathShellState,
  isLiveTool,
  reduceMathShell,
} from '../lib/shellModel';
import type { MathShellState, ToolId } from '../lib/shellModel';

/** Tab click — takes a plain string so the disabled slots can be exercised too. */
function select(state: MathShellState, tool: string): MathShellState {
  return reduceMathShell(state, { type: 'selectTool', tool: tool as ToolId });
}

describe('math tool tabs (MATH1)', () => {
  it('lists 3 live tools + 2 disabled roadmap slots in the wireframe order', () => {
    expect(TOOLS.map((t) => t.id)).toEqual([
      'graphing',
      'scientific',
      'matrix',
      'geometry',
      '3d',
    ]);
    expect(TOOLS.filter((t) => t.status === 'live').map((t) => t.label)).toEqual([
      'Graphing',
      'Scientific',
      'Matrix',
    ]);
    expect(TOOLS.filter((t) => t.status === 'soon').map((t) => t.label)).toEqual([
      'Geometry',
      '3D',
    ]);
    expect(LIVE_TOOLS).toEqual(['graphing', 'scientific', 'matrix']);
  });

  it('opens on Graphing', () => {
    expect(DEFAULT_TOOL).toBe('graphing');
    expect(initialMathShellState.activeTool).toBe('graphing');
  });

  it('narrows only live tool ids', () => {
    expect(isLiveTool('matrix')).toBe(true);
    expect(isLiveTool('geometry')).toBe(false);
    expect(isLiveTool('3d')).toBe(false);
    expect(isLiveTool('nope')).toBe(false);
    expect(isLiveTool(undefined)).toBe(false);
  });
});

describe('reduceMathShell — switching tools', () => {
  it('activates a live tool', () => {
    const next = select(initialMathShellState, 'matrix');
    expect(next.activeTool).toBe('matrix');
  });

  it('ignores the disabled Geometry / 3D slots', () => {
    const geometry = select(initialMathShellState, 'geometry');
    expect(geometry).toBe(initialMathShellState);
    const threeD = select(initialMathShellState, '3d');
    expect(threeD).toBe(initialMathShellState);
  });
});

describe('reduceMathShell — per-tool state retention while hidden', () => {
  it('keeps every tool’s draft when another tool is shown', () => {
    let state = initialMathShellState;
    state = reduceMathShell(state, { type: 'setDraft', tool: 'graphing', src: 'a·sin(x)' });
    state = select(state, 'scientific');
    state = reduceMathShell(state, { type: 'setDraft', tool: 'scientific', src: '3^4/2' });
    state = select(state, 'matrix');
    state = reduceMathShell(state, { type: 'setDraft', tool: 'matrix', src: 'A × B' });

    // Back to the first tool — nothing was reset by the round trip.
    state = select(state, 'graphing');
    expect(state.activeTool).toBe('graphing');
    expect(state.drafts).toEqual({
      graphing: 'a·sin(x)',
      scientific: '3^4/2',
      matrix: 'A × B',
    });
  });

  it('edits one tool’s draft without touching the others', () => {
    const seeded = reduceMathShell(
      reduceMathShell(initialMathShellState, {
        type: 'setDraft',
        tool: 'graphing',
        src: 'x^2',
      }),
      { type: 'setDraft', tool: 'matrix', src: 'det(A)' },
    );
    const next = reduceMathShell(seeded, {
      type: 'setDraft',
      tool: 'scientific',
      src: 'sin(45)',
    });
    expect(next.drafts.graphing).toBe('x^2');
    expect(next.drafts.matrix).toBe('det(A)');
    expect(next.drafts.scientific).toBe('sin(45)');
  });
});

describe('reduceMathShell — last-tool restore', () => {
  it('applies the restored tool on mount', () => {
    const next = reduceMathShell(initialMathShellState, {
      type: 'restoreTool',
      tool: 'scientific',
    });
    expect(next.activeTool).toBe('scientific');
    expect(next.restored).toBe(true);
  });

  it('only restores once', () => {
    const restored = reduceMathShell(initialMathShellState, {
      type: 'restoreTool',
      tool: 'scientific',
    });
    const again = reduceMathShell(restored, { type: 'restoreTool', tool: 'matrix' });
    expect(again).toBe(restored);
    expect(again.activeTool).toBe('scientific');
  });

  it('does not yank the user back when storage resolves after a click', () => {
    // The mount-time race: the user picks Matrix before `shell.lastTool` has loaded.
    const picked = select(initialMathShellState, 'matrix');
    expect(picked.restored).toBe(true);
    const late = reduceMathShell(picked, { type: 'restoreTool', tool: 'scientific' });
    expect(late.activeTool).toBe('matrix');
  });
});
