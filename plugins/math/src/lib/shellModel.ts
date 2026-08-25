/**
 * Math — the tool-tab shell model (MATH1), as a pure reducer so the wiring is testable
 * without React.
 *
 * Per the approved wireframe (MathPluginApproved.html, "Notes for review"): the topbar tabs
 * switch tools; **every tool keeps its state when hidden**, and the last active tool is
 * restored from plugin storage on reopen. Geometry and 3D are visible-but-disabled roadmap
 * slots — they are listed here so the tab strip renders them, but they can never become the
 * active tool.
 *
 * Retention is structural, in two halves that MATH2/MATH4/MATH5 both rely on:
 *  1. the shell owns a per-tool state slice keyed by tool id, so switching tools never
 *     touches another tool's slice (this file), and
 *  2. every live tool's pane stays *mounted* while hidden, so a tool's own component state
 *     survives a switch too (MathShell.tsx).
 */

/** The three tools that ship in v1. */
export type LiveToolId = 'graphing' | 'scientific' | 'matrix';
/** Roadmap slots — rendered disabled with a "Soon" tag, never activatable. */
export type SoonToolId = 'geometry' | '3d';
export type ToolId = LiveToolId | SoonToolId;

export interface ToolDescriptor {
  id: ToolId;
  label: string;
  status: 'live' | 'soon';
}

/** Tab strip contents, in the locked wireframe order. */
export const TOOLS: readonly ToolDescriptor[] = [
  { id: 'graphing', label: 'Graphing', status: 'live' },
  { id: 'scientific', label: 'Scientific', status: 'live' },
  { id: 'matrix', label: 'Matrix', status: 'live' },
  { id: 'geometry', label: 'Geometry', status: 'soon' },
  { id: '3d', label: '3D', status: 'soon' },
];

export const LIVE_TOOLS: readonly LiveToolId[] = ['graphing', 'scientific', 'matrix'];

/** Opened-for-the-first-time tool (also the fallback for an unreadable `shell.lastTool`). */
export const DEFAULT_TOOL: LiveToolId = 'graphing';

/** Narrow an untrusted value (a persisted `shell.lastTool`) to a live tool id. */
export function isLiveTool(value: unknown): value is LiveToolId {
  return typeof value === 'string' && (LIVE_TOOLS as readonly string[]).includes(value);
}

/**
 * The per-tool state the shell retains while a tool is hidden. MATH1 keeps each tool's
 * *draft input line* — the always-present entry field every tool's wireframe leads with
 * (Graphing's blank next cell, Scientific's `›` input row, Matrix's compute line). MATH2/4/5
 * grow these slices into the tools' real state without changing how retention works.
 */
export type ToolDrafts = Record<LiveToolId, string>;

export interface MathShellState {
  activeTool: LiveToolId;
  /**
   * True once `shell.lastTool` has been consulted — or once the user picked a tool, which
   * makes a late restore moot. Guards the mount-time race where storage resolves *after* a
   * click and would otherwise yank the user back to the stored tool.
   */
  restored: boolean;
  drafts: ToolDrafts;
}

export const initialMathShellState: MathShellState = {
  activeTool: DEFAULT_TOOL,
  restored: false,
  drafts: { graphing: '', scientific: '', matrix: '' },
};

export type MathShellAction =
  /** a tab click; a disabled (`soon`) tool is a no-op. */
  | { type: 'selectTool'; tool: ToolId }
  /** edit one tool's draft input — never touches the other tools' drafts. */
  | { type: 'setDraft'; tool: LiveToolId; src: string }
  /** apply the tool restored from `storage.shell.lastTool` on mount. */
  | { type: 'restoreTool'; tool: LiveToolId };

export function reduceMathShell(
  state: MathShellState,
  action: MathShellAction,
): MathShellState {
  switch (action.type) {
    case 'selectTool': {
      if (!isLiveTool(action.tool)) return state; // Geometry / 3D are disabled slots.
      if (action.tool === state.activeTool && state.restored) return state;
      // A deliberate pick wins over a restore that has not landed yet.
      return { ...state, activeTool: action.tool, restored: true };
    }

    case 'setDraft':
      return {
        ...state,
        drafts: { ...state.drafts, [action.tool]: action.src },
      };

    case 'restoreTool':
      // Only the first restore counts; after that the user is driving.
      if (state.restored) return state;
      return { ...state, activeTool: action.tool, restored: true };

    default:
      return state;
  }
}
