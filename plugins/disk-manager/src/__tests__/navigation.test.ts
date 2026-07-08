import { describe, expect, it } from 'vitest';
import { buildVisualizeModel, mockIcloudDriveScan, mockIcloudExtras, mockLocalScan } from '../model';
import {
  initialDiskManagerState,
  reduceDiskManager,
  triageTargetFromNode,
} from '../navigation';
import type { DiskManagerState } from '../navigation';
import type { RecordActionInput } from '../sessionModel';

function sources() {
  return {
    local: mockLocalScan(),
    icloudDrive: mockIcloudDriveScan(),
    icloudExtras: mockIcloudExtras(),
  };
}

describe('locked navigation model', () => {
  it('starts in the Visualize shell', () => {
    expect(initialDiskManagerState.view).toBe('visualize');
    expect(initialDiskManagerState.sessionActive).toBe(false);
  });

  it('clicking a treemap node sets a SCOPED triage target and opens Triage', () => {
    // Use a real node from the derived model so this mirrors an actual click.
    const model = buildVisualizeModel('local', sources());
    const node = model.layout[0]; // largest node, "Videos"
    const next = reduceDiskManager(initialDiskManagerState, {
      type: 'selectTarget',
      target: triageTargetFromNode(node, 'local'),
    });
    expect(next.view).toBe('triage');
    expect(next.sessionActive).toBe(true);
    expect(next.triageTarget).toEqual({
      scope: 'local',
      label: node.name,
      root: node.key,
      source: 'treemap',
      bytes: node.bytes,
    });
  });

  it('triageTargetFromNode carries the active scope', () => {
    const model = buildVisualizeModel('icloud', sources());
    const t = triageTargetFromNode(model.nodes[0], 'icloud');
    expect(t.scope).toBe('icloud');
    expect(t.source).toBe('treemap');
  });

  it('setScope stays in the shell', () => {
    const next = reduceDiskManager(initialDiskManagerState, { type: 'setScope', scope: 'both' });
    expect(next.scope).toBe('both');
    expect(next.view).toBe('visualize');
  });

  it('Reorg is a header action reachable from Visualize', () => {
    const next = reduceDiskManager(initialDiskManagerState, { type: 'openReorg' });
    expect(next.view).toBe('reorg');
  });

  it('the pill opens the summary anytime WITHOUT ending the session', () => {
    const inSession: DiskManagerState = { ...initialDiskManagerState, sessionActive: true };
    const next = reduceDiskManager(inSession, { type: 'openSummary' });
    expect(next.view).toBe('summary');
    expect(next.sessionActive).toBe(true);
  });

  it('ending a session auto-shows the summary and closes the session', () => {
    const inSession: DiskManagerState = { ...initialDiskManagerState, sessionActive: true };
    const next = reduceDiskManager(inSession, { type: 'endSession' });
    expect(next.view).toBe('summary');
    expect(next.sessionActive).toBe(false);
  });

  it('back returns to the persistent shell but keeps the running tally', () => {
    let s = reduceDiskManager(initialDiskManagerState, {
      type: 'logAction',
      input: freed('delete', 1000),
    });
    s = reduceDiskManager(s, { type: 'openSummary' });
    s = reduceDiskManager(s, { type: 'backToVisualize' });
    expect(s.view).toBe('visualize');
    expect(s.freedBytes).toBe(1000);
  });

  it('logAction accumulates freed bytes; undoing one action lowers the tally (DISK8)', () => {
    let s = reduceDiskManager(initialDiskManagerState, {
      type: 'logAction',
      input: freed('delete', 500),
    });
    s = reduceDiskManager(s, { type: 'logAction', input: freed('evict', 250) });
    expect(s.freedBytes).toBe(750);
    expect(s.log.entries).toHaveLength(2);

    // Undo the first action — the running total drops by exactly that action's bytes.
    s = reduceDiskManager(s, { type: 'undoLogEntry', id: s.log.entries[0].id });
    expect(s.freedBytes).toBe(250);

    // Undoing again is a no-op (idempotent).
    s = reduceDiskManager(s, { type: 'undoLogEntry', id: s.log.entries[0].id });
    expect(s.freedBytes).toBe(250);
  });
});

/** A minimal freed-bytes log input for reducer wiring tests. */
function freed(kind: 'delete' | 'evict', bytes: number): RecordActionInput {
  return {
    kind,
    label: 'x',
    freedBytes: bytes,
    itemCount: 1,
    recovery: kind === 'delete' ? 'trash' : 'redownload',
    paths: ['/x'],
    moves: [],
    atMs: 0,
  };
}
