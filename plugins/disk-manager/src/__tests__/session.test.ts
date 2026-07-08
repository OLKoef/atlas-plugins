import { describe, expect, it, vi } from 'vitest';
import type { DiskApi, MutationResult, ReorgMove, StorageApi } from '@atlas/plugin-sdk';
import {
  SESSION_LOG_KEY,
  applyUndo,
  emptySessionLog,
  entryVerb,
  formatLogTime,
  loadSessionLog,
  logRowStyle,
  parseSessionLog,
  planUndo,
  recentEntries,
  recordAction,
  reorgActionInput,
  reverseReorgMoves,
  saveSessionLog,
  serializeSessionLog,
  sessionCounts,
  sessionFreedBytes,
  triageActionInput,
  undoEntry,
} from '../sessionModel';
import type { RecordActionInput } from '../sessionModel';
import { mockTriageDiskApi, mockTriageQueue, resolveTriageAction } from '../triageModel';
import type { TriageItem } from '../triageModel';

const MB = 1024 * 1024;

function makeInput(over: Partial<RecordActionInput> = {}): RecordActionInput {
  return {
    kind: 'delete',
    label: 'file',
    freedBytes: 10 * MB,
    itemCount: 1,
    recovery: 'trash',
    paths: ['/x/file'],
    moves: [],
    atMs: 0,
    ...over,
  };
}

/** The mock queue, keyed by triage kind, so tests read against realistic items. */
function queueItem(kind: 'pdf' | 'icloud' | 'photo' | 'app'): TriageItem {
  const q = mockTriageQueue();
  const byKind: Record<typeof kind, TriageItem> = {
    pdf: q[0],
    icloud: q[1],
    photo: q[2],
    app: q[3],
  };
  return byKind[kind];
}

// ------------------------------------------------------------------
// recordAction — append with stable ids, immutably.
// ------------------------------------------------------------------
describe('recordAction', () => {
  it('appends an entry with a stable id and bumps the seq', () => {
    const a = recordAction(emptySessionLog, makeInput());
    const b = recordAction(a, makeInput({ kind: 'evict', recovery: 'redownload' }));
    expect(a.entries).toHaveLength(1);
    expect(b.entries).toHaveLength(2);
    expect(b.entries.map((e) => e.id)).toEqual(['act-1', 'act-2']);
    expect(b.seq).toBe(2);
  });

  it('never mutates the input log', () => {
    const next = recordAction(emptySessionLog, makeInput());
    expect(emptySessionLog.entries).toHaveLength(0);
    expect(next).not.toBe(emptySessionLog);
  });

  it('clamps negative bytes and rounds itemCount', () => {
    const log = recordAction(emptySessionLog, makeInput({ freedBytes: -5, itemCount: 2.7 }));
    expect(log.entries[0].freedBytes).toBe(0);
    expect(log.entries[0].itemCount).toBe(3);
  });
});

// ------------------------------------------------------------------
// Adapters — triage decision / reorg result → a log input.
// ------------------------------------------------------------------
describe('triageActionInput', () => {
  it('maps a plain delete to a trash-recoverable entry', () => {
    const item = queueItem('pdf');
    const input = triageActionInput(item, resolveTriageAction(item, 'delete'), 0);
    expect(input.kind).toBe('delete');
    expect(input.recovery).toBe('trash');
    expect(input.freedBytes).toBe(item.bytes);
    expect(input.label).toBe(item.name);
  });

  it('maps an evict to a redownload-recoverable entry', () => {
    const item = queueItem('icloud');
    const input = triageActionInput(item, resolveTriageAction(item, 'evict'), 0);
    expect(input.kind).toBe('evict');
    expect(input.recovery).toBe('redownload');
    expect(input.freedBytes).toBe(item.bytes);
  });

  it('maps a keep to a zero-freed, no-recovery entry', () => {
    const item = queueItem('photo');
    const input = triageActionInput(item, resolveTriageAction(item, 'keep'), 0);
    expect(input.kind).toBe('keep');
    expect(input.recovery).toBe('none');
    expect(input.freedBytes).toBe(0);
  });

  it('maps a confirmed app delete to an `uninstall` entry with leftovers folded in', () => {
    const item = queueItem('app');
    const decision = resolveTriageAction(item, 'delete', { confirmed: true });
    const input = triageActionInput(item, decision, 0);
    expect(input.kind).toBe('uninstall');
    expect(input.recovery).toBe('trash');
    // reclaim = bundle + leftovers, so more than the bundle's own bytes.
    expect(input.freedBytes).toBeGreaterThan(item.bytes);
  });
});

describe('reorgActionInput', () => {
  const result: MutationResult = {
    kind: 'reorg',
    ok: true,
    reclaimedBytes: 0,
    recovery: 'reverse-move',
    trashed: [],
    moves: [
      { from: 'Downloads/a', to: 'Docs/a' },
      { from: 'Downloads/b', to: 'Docs/b' },
    ],
    skipped: [],
    summary: 'moved 2',
  };

  it('records one entry carrying every move, counted by file', () => {
    const input = reorgActionInput(result, 0);
    expect(input.kind).toBe('reorg');
    expect(input.recovery).toBe('reverse-move');
    expect(input.itemCount).toBe(2);
    expect(input.label).toBe('2 files');
    expect(input.moves).toHaveLength(2);
  });

  it('singularizes the label for a one-file reorg', () => {
    const input = reorgActionInput({ ...result, moves: [{ from: 'a', to: 'b' }] }, 0);
    expect(input.label).toBe('1 file');
  });
});

// ------------------------------------------------------------------
// The core AC: apply actions, undo one, reflect in the running total + counts.
// ------------------------------------------------------------------
describe('running tally + per-action undo (DISK8 acceptance)', () => {
  it('sums freed bytes across active entries', () => {
    let log = recordAction(emptySessionLog, makeInput({ freedBytes: 84 * MB }));
    log = recordAction(log, makeInput({ kind: 'evict', recovery: 'redownload', freedBytes: 46 * MB }));
    log = recordAction(log, makeInput({ kind: 'keep', recovery: 'none', freedBytes: 0 }));
    expect(sessionFreedBytes(log)).toBe(130 * MB);
  });

  it('undoing one action removes exactly its bytes from the total', () => {
    let log = recordAction(emptySessionLog, makeInput({ freedBytes: 84 * MB }));
    log = recordAction(log, makeInput({ kind: 'evict', recovery: 'redownload', freedBytes: 46 * MB }));
    expect(sessionFreedBytes(log)).toBe(130 * MB);

    log = undoEntry(log, 'act-1'); // undo the 84 MB delete
    expect(sessionFreedBytes(log)).toBe(46 * MB);
    expect(log.entries[0].undone).toBe(true);
  });

  it('undoing is idempotent and safe on a missing id', () => {
    let log = recordAction(emptySessionLog, makeInput({ freedBytes: 20 * MB }));
    log = undoEntry(log, 'act-1');
    const again = undoEntry(log, 'act-1');
    expect(again).toBe(log); // no change → same reference
    expect(undoEntry(log, 'act-404')).toBe(log);
    expect(sessionFreedBytes(log)).toBe(0);
  });

  it('per-kind counts sum itemCount and drop undone entries', () => {
    let log = recordAction(emptySessionLog, makeInput({ kind: 'delete' }));
    log = recordAction(log, makeInput({ kind: 'delete' }));
    log = recordAction(log, makeInput({ kind: 'evict', recovery: 'redownload' }));
    log = recordAction(log, makeInput({ kind: 'keep', recovery: 'none', freedBytes: 0 }));
    log = recordAction(log, makeInput({ kind: 'reorg', recovery: 'reverse-move', itemCount: 23 }));

    expect(sessionCounts(log)).toEqual({ keep: 1, delete: 2, evict: 1, uninstall: 0, reorg: 23 });

    log = undoEntry(log, 'act-1'); // undo one delete
    expect(sessionCounts(log).delete).toBe(1);
  });

  it('recentEntries is newest-first and capped', () => {
    let log = emptySessionLog;
    for (let i = 0; i < 25; i++) log = recordAction(log, makeInput({ label: `f${i}` }));
    const recent = recentEntries(log, 20);
    expect(recent).toHaveLength(20);
    expect(recent[0].label).toBe('f24');
    expect(recent[19].label).toBe('f5');
  });
});

// ------------------------------------------------------------------
// Undo plan — the sole disk-touching undo (reorg reverse-move) behind a seam.
// ------------------------------------------------------------------
describe('planUndo / applyUndo', () => {
  it('reverses a reorg by swapping every move', () => {
    const moves: ReorgMove[] = [{ from: 'a', to: 'b' }];
    expect(reverseReorgMoves(moves)).toEqual([{ from: 'b', to: 'a' }]);
  });

  it('a reorg entry plans a disk reverse-move', () => {
    const log = recordAction(emptySessionLog, {
      ...makeInput({ kind: 'reorg', recovery: 'reverse-move' }),
      moves: [{ from: 'Downloads/a', to: 'Docs/a' }],
    });
    const plan = planUndo(log.entries[0]);
    expect(plan.disk).toBe(true);
    expect(plan.strategy).toBe('reverse-move');
    expect(plan.moves).toEqual([{ from: 'Docs/a', to: 'Downloads/a' }]);
  });

  it('a delete / evict / keep entry plans no disk op, just guidance', () => {
    for (const recovery of ['trash', 'redownload', 'none'] as const) {
      const log = recordAction(emptySessionLog, makeInput({ recovery }));
      const plan = planUndo(log.entries[0]);
      expect(plan.disk).toBe(false);
      expect(plan.moves).toHaveLength(0);
      expect(plan.message.length).toBeGreaterThan(0);
    }
  });

  it('applyUndo fires applyReorgPlan only for a disk plan', async () => {
    // mockTriageDiskApi rejects applyReorgPlan (triage never reorgs), so stub a succeeding one.
    const disk: DiskApi = {
      ...mockTriageDiskApi(),
      applyReorgPlan: vi.fn(() =>
        Promise.resolve({
          kind: 'reorg',
          ok: true,
          reclaimedBytes: 0,
          recovery: 'none',
          trashed: [],
          moves: [],
          skipped: [],
          summary: 'reversed',
        } satisfies MutationResult),
      ),
    };

    const reorgLog = recordAction(emptySessionLog, {
      ...makeInput({ kind: 'reorg', recovery: 'reverse-move' }),
      moves: [{ from: 'Downloads/a', to: 'Docs/a' }],
    });
    const reorgPlan = planUndo(reorgLog.entries[0]);
    const scope = { sourceRoot: 'Downloads', home: true };
    await applyUndo({ disk }, reorgPlan, scope);
    expect(disk.applyReorgPlan).toHaveBeenCalledWith(
      [{ from: 'Docs/a', to: 'Downloads/a' }],
      scope,
    );

    const trashLog = recordAction(emptySessionLog, makeInput({ recovery: 'trash' }));
    const trashPlan = planUndo(trashLog.entries[0]);
    const result = await applyUndo({ disk }, trashPlan, scope);
    expect(result).toBeNull();
    expect(disk.applyReorgPlan).toHaveBeenCalledTimes(1); // not called again for the trash undo
  });
});

// ------------------------------------------------------------------
// Display helpers.
// ------------------------------------------------------------------
describe('display helpers', () => {
  it('formats the log time as UTC HH:MM', () => {
    expect(formatLogTime(Date.UTC(2025, 6, 1, 14, 32))).toBe('14:32');
    expect(formatLogTime(Date.UTC(2025, 6, 1, 4, 5))).toBe('04:05');
  });

  it('gives each kind a verb', () => {
    expect(entryVerb({ kind: 'delete' } as never)).toBe('Deleted');
    expect(entryVerb({ kind: 'uninstall' } as never)).toBe('Removed');
    expect(entryVerb({ kind: 'evict' } as never)).toBe('Evicted');
    expect(entryVerb({ kind: 'reorg' } as never)).toBe('Reorganized');
    expect(entryVerb({ kind: 'keep' } as never)).toBe('Kept');
  });

  it('styles an app uninstall as a delete row, per the locked wireframe', () => {
    expect(logRowStyle('uninstall')).toEqual({ rowClass: 'del', tagClass: 'del', tagText: 'del' });
    expect(logRowStyle('evict').rowClass).toBe('evict');
    expect(logRowStyle('reorg').tagClass).toBe('reorg');
    expect(logRowStyle('keep').rowClass).toBe('');
  });
});

// ------------------------------------------------------------------
// Persistence — tolerant serialize/parse + storage.* roundtrip.
// ------------------------------------------------------------------
describe('persistence', () => {
  it('roundtrips a log through serialize → parse', () => {
    let log = recordAction(emptySessionLog, makeInput());
    log = recordAction(log, makeInput({ kind: 'evict', recovery: 'redownload' }));
    log = undoEntry(log, 'act-1');
    const parsed = parseSessionLog(serializeSessionLog(log));
    expect(parsed).toEqual(log);
  });

  it('falls back to an empty log on garbage', () => {
    expect(parseSessionLog('not json{')).toEqual({ entries: [], seq: 0 });
    expect(parseSessionLog(null)).toEqual({ entries: [], seq: 0 });
    expect(parseSessionLog(42)).toEqual({ entries: [], seq: 0 });
    expect(parseSessionLog({ entries: 'nope' })).toEqual({ entries: [], seq: 0 });
  });

  it('drops malformed entries and recovers seq from surviving ids', () => {
    const parsed = parseSessionLog({
      entries: [
        { id: 'act-3', kind: 'delete', freedBytes: 5, recovery: 'trash' },
        { id: 'act-9', kind: 'bogus-kind' }, // unknown kind → dropped
        { kind: 'delete' }, // no id → dropped
      ],
      seq: 1, // stale seq lower than a surviving id
    });
    expect(parsed.entries.map((e) => e.id)).toEqual(['act-3']);
    expect(parsed.seq).toBe(3); // recovered from act-3, never re-issuing an existing id
  });

  it('loads + saves through a storage.* stub under the namespaced key', async () => {
    const store = new Map<string, unknown>();
    const storage: StorageApi = {
      get: <T = unknown>(key: string): Promise<T | null> =>
        Promise.resolve((store.get(key) ?? null) as T | null),
      set: vi.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      delete: vi.fn((key: string) => {
        store.delete(key);
        return Promise.resolve();
      }),
    };

    expect(await loadSessionLog(storage)).toEqual(emptySessionLog);

    const log = recordAction(emptySessionLog, makeInput({ freedBytes: 84 * MB }));
    await saveSessionLog(storage, log);
    expect(storage.set).toHaveBeenCalledWith(SESSION_LOG_KEY, log);

    const reloaded = await loadSessionLog(storage);
    expect(reloaded).toEqual(log);
    expect(sessionFreedBytes(reloaded)).toBe(84 * MB);
  });
});
