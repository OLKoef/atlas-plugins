/**
 * Disk Manager — the **locked navigation model** (DISK5), as a pure reducer so the wiring
 * is testable without React.
 *
 * The model, per the approved wireframe (DiskManagerApproved.html, resolved open question):
 *  - **Visualize is the persistent shell.** Clicking a treemap node drops into a *scoped*
 *    Triage session; the back action always returns to Visualize.
 *  - **Reorg is a header action** (occasional, not per-folder) reached from Visualize.
 *  - **Session summary auto-appears** when a triage session ends, and is reachable at any
 *    time via the running-tally ("Space freed") pill — without ending the session.
 *
 * DISK6/7/8 build Triage, AI-reorg, and the undo-log summary on top of this; the shape of
 * the transitions is fixed here. DISK8 threads the persisted {@link SessionLog} through the
 * state so the running tally is *derived* from it — undoing one action lowers `freedBytes`.
 */

import type { DiskScope, TreemapNode } from './model';
import {
  emptySessionLog,
  recordAction,
  sessionFreedBytes,
  undoEntry,
} from './sessionModel';
import type { RecordActionInput, SessionLog } from './sessionModel';

export type DiskView = 'visualize' | 'triage' | 'reorg' | 'summary';

/** What a triage session is scoped to — set the moment a node (or the dupe banner) is clicked. */
export interface TriageTarget {
  scope: DiskScope;
  /** display label, e.g. "Downloads" or "Duplicates". */
  label: string;
  /** the scan root / query the triage session will operate on. */
  root: string;
  /** what opened this session. */
  source: 'treemap' | 'duplicates' | 'reorg';
  /** total bytes in scope, for the triage progress readout. */
  bytes: number;
}

export interface DiskManagerState {
  view: DiskView;
  scope: DiskScope;
  /** the active/last scoped triage target (null before any session). */
  triageTarget: TriageTarget | null;
  /** true while a triage session is open (before its summary). */
  sessionActive: boolean;
  /** the persisted per-action undo log (DISK8) — every keep/delete/evict/move this session. */
  log: SessionLog;
  /**
   * running tally of bytes reclaimed this session — drives the pill + summary. DERIVED from
   * {@link log}'s active entries, so undoing a single action lowers it in step.
   */
  freedBytes: number;
}

export const initialDiskManagerState: DiskManagerState = {
  view: 'visualize',
  scope: 'local',
  triageTarget: null,
  sessionActive: false,
  log: emptySessionLog,
  freedBytes: 0,
};

export type DiskAction =
  | { type: 'setScope'; scope: DiskScope }
  | { type: 'selectTarget'; target: TriageTarget }
  | { type: 'openReorg' }
  | { type: 'openSummary' }
  | { type: 'endSession' }
  | { type: 'backToVisualize' }
  /** append an action to the undo log (from a triage swipe / reorg apply). */
  | { type: 'logAction'; input: RecordActionInput }
  /** individually undo one logged action; the derived tally drops it. */
  | { type: 'undoLogEntry'; id: string }
  /** replace the log with the value loaded from `storage.*` on mount. */
  | { type: 'hydrateLog'; log: SessionLog };

/** Turn a clicked treemap node into a scoped triage target. */
export function triageTargetFromNode(node: TreemapNode, scope: DiskScope): TriageTarget {
  return { scope, label: node.name, root: node.key, source: 'treemap', bytes: node.bytes };
}

export function reduceDiskManager(
  state: DiskManagerState,
  action: DiskAction,
): DiskManagerState {
  switch (action.type) {
    case 'setScope':
      // Scope lives in the Visualize shell; changing it never leaves the shell.
      return { ...state, scope: action.scope };

    case 'selectTarget':
      // A node click opens a scoped triage session (Visualize stays the shell underneath).
      return {
        ...state,
        view: 'triage',
        triageTarget: action.target,
        sessionActive: true,
      };

    case 'openReorg':
      // Header action — occasional, not per-folder.
      return { ...state, view: 'reorg' };

    case 'openSummary':
      // Reachable anytime via the running-tally pill; does NOT end the session.
      return { ...state, view: 'summary' };

    case 'endSession':
      // Session summary auto-appears when a triage session ends.
      return { ...state, view: 'summary', sessionActive: false };

    case 'backToVisualize':
      // Return to the persistent shell, keeping the running tally intact.
      return { ...state, view: 'visualize' };

    case 'logAction': {
      const log = recordAction(state.log, action.input);
      return { ...state, log, freedBytes: sessionFreedBytes(log) };
    }

    case 'undoLogEntry': {
      const log = undoEntry(state.log, action.id);
      return { ...state, log, freedBytes: sessionFreedBytes(log) };
    }

    case 'hydrateLog':
      return { ...state, log: action.log, freedBytes: sessionFreedBytes(action.log) };

    default:
      return state;
  }
}
