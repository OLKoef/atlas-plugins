import { describe, expect, it, vi } from 'vitest';
import type { DiskApi } from '@atlas/plugin-sdk';
import {
  ARROW_ICONS,
  TRIAGE_ACTIONS,
  TRIAGE_NOW_MS,
  applyTriageDecision,
  canEvict,
  evictLabel,
  formatLastOpened,
  leftoverBytes,
  mockTriageDiskApi,
  mockTriageQueue,
  reclaimValue,
  resolveTriageAction,
  sortByReclaimValue,
} from '../triageModel';
import type { TriageItem } from '../triageModel';

const MB = 1024 * 1024;

function makeItem(over: Partial<TriageItem> = {}): TriageItem {
  return {
    id: '/x/file',
    name: 'file',
    kind: 'file',
    location: '/x',
    bytes: 10 * MB,
    createdMs: 0,
    lastOpenedMs: TRIAGE_NOW_MS,
    icloud: 'not-icloud',
    duplicateCount: 0,
    iconPath: '',
    ...over,
  };
}

// ------------------------------------------------------------------
// Locked action model (Delete-left / Evict-middle / Keep-right).
// ------------------------------------------------------------------
describe('locked triage action model', () => {
  it('is exactly Delete → Evict → Keep, left → up → right', () => {
    expect(TRIAGE_ACTIONS.map((a) => a.id)).toEqual(['delete', 'evict', 'keep']);
    expect(TRIAGE_ACTIONS.map((a) => a.arrow)).toEqual(['left', 'up', 'right']);
    expect(TRIAGE_ACTIONS.map((a) => a.className)).toEqual(['delete', 'evict', 'keep']);
  });

  it('pins the arrow SVG geometry to the approved wireframe', () => {
    // Delete = left arrow, Evict = up arrow, Keep = right arrow.
    expect(ARROW_ICONS.left).toEqual({ line: [19, 12, 5, 12], polyline: '12 19 5 12 12 5' });
    expect(ARROW_ICONS.up).toEqual({ line: [12, 19, 12, 5], polyline: '5 12 12 5 19 12' });
    expect(ARROW_ICONS.right).toEqual({ line: [5, 12, 19, 12], polyline: '12 5 19 12 12 19' });
  });
});

// ------------------------------------------------------------------
// Evict eligibility — iCloud-Drive (downloaded) files only.
// ------------------------------------------------------------------
describe('canEvict / evictLabel', () => {
  it('only a downloaded iCloud file can be evicted', () => {
    expect(canEvict(makeItem({ icloud: 'downloaded' }))).toBe(true);
    expect(canEvict(makeItem({ icloud: 'not-icloud' }))).toBe(false);
    expect(canEvict(makeItem({ icloud: 'evicted' }))).toBe(false);
  });

  it('labels the button "Evict" when enabled, "Evict (local only)" when not', () => {
    expect(evictLabel(makeItem({ icloud: 'downloaded' }))).toBe('Evict');
    expect(evictLabel(makeItem({ icloud: 'not-icloud' }))).toBe('Evict (local only)');
  });
});

// ------------------------------------------------------------------
// Reclaim-value ordering — largest & least-recently-opened first.
// ------------------------------------------------------------------
describe('reclaim-value ordering', () => {
  it('ranks a larger file ahead of a smaller one at equal staleness', () => {
    const big = makeItem({ id: 'big', bytes: 100 * MB, lastOpenedMs: TRIAGE_NOW_MS });
    const small = makeItem({ id: 'small', bytes: 10 * MB, lastOpenedMs: TRIAGE_NOW_MS });
    expect(reclaimValue(big, TRIAGE_NOW_MS)).toBeGreaterThan(reclaimValue(small, TRIAGE_NOW_MS));
  });

  it('ranks a staler file ahead of a fresher one at equal size', () => {
    const year = 365 * 24 * 60 * 60 * 1000;
    const stale = makeItem({ id: 'stale', lastOpenedMs: TRIAGE_NOW_MS - 2 * year });
    const fresh = makeItem({ id: 'fresh', lastOpenedMs: TRIAGE_NOW_MS });
    expect(reclaimValue(stale, TRIAGE_NOW_MS)).toBeGreaterThan(reclaimValue(fresh, TRIAGE_NOW_MS));
  });

  it('treats a never-opened file as strongly stale', () => {
    const never = makeItem({ id: 'never', lastOpenedMs: null });
    const fresh = makeItem({ id: 'fresh', lastOpenedMs: TRIAGE_NOW_MS });
    expect(reclaimValue(never, TRIAGE_NOW_MS)).toBeGreaterThan(reclaimValue(fresh, TRIAGE_NOW_MS));
  });

  it('sorts the demo queue: biggest-stale app, then never-opened PDF, docx, photo', () => {
    const sorted = sortByReclaimValue(mockTriageQueue(), TRIAGE_NOW_MS);
    expect(sorted.map((i) => i.name)).toEqual([
      'Adobe Reader.app',
      'Q3_Report_FINAL_v3.pdf',
      'Thesis_Chapter2_backup.docx',
      'IMG_4821.HEIC',
    ]);
  });

  it('does not mutate the input array', () => {
    const q = mockTriageQueue();
    const before = q.map((i) => i.id);
    sortByReclaimValue(q, TRIAGE_NOW_MS);
    expect(q.map((i) => i.id)).toEqual(before);
  });
});

// ------------------------------------------------------------------
// Resolving a swipe into a disk.* op (+ the uninstall confirm gate).
// ------------------------------------------------------------------
describe('resolveTriageAction', () => {
  it('Keep never touches disk', () => {
    const d = resolveTriageAction(makeItem(), 'keep');
    expect(d.op).toBeNull();
    expect(d.blocked).toBe(false);
    expect(d.reclaimBytes).toBe(0);
  });

  it('Delete on a plain file → recoverable deleteToTrash (no extra confirm)', () => {
    const item = makeItem({ id: '~/Downloads/a.pdf', bytes: 84 * MB });
    const d = resolveTriageAction(item, 'delete');
    expect(d.op).toBe('deleteToTrash');
    expect(d.paths).toEqual(['~/Downloads/a.pdf']);
    expect(d.requiresConfirm).toBe(false);
    expect(d.blocked).toBe(false);
    expect(d.reclaimBytes).toBe(84 * MB);
  });

  it('Evict on a downloaded iCloud file → evict', () => {
    const item = makeItem({ id: '~/cloud/a.docx', bytes: 46 * MB, icloud: 'downloaded' });
    const d = resolveTriageAction(item, 'evict');
    expect(d.op).toBe('evict');
    expect(d.paths).toEqual(['~/cloud/a.docx']);
    expect(d.reclaimBytes).toBe(46 * MB);
  });

  it('Evict on a non-iCloud file is a blocked no-op', () => {
    const d = resolveTriageAction(makeItem({ icloud: 'not-icloud' }), 'evict');
    expect(d.op).toBeNull();
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe('not-icloud');
    expect(d.reclaimBytes).toBe(0);
  });
});

describe('uninstall confirm gate', () => {
  const app = makeItem({
    id: '/Applications/Foo.app',
    name: 'Foo.app',
    kind: 'Application',
    bytes: 600 * MB,
    app: {
      appPath: '/Applications/Foo.app',
      leftovers: [
        { path: '~/Library/Application Support/Foo', bytes: 100 * MB },
        { path: '~/Library/Caches/foo', bytes: 40 * MB },
      ],
    },
  });

  it('an app swipe is BLOCKED until confirmed — a stronger confirm than a plain swipe', () => {
    const d = resolveTriageAction(app, 'delete', { confirmed: false });
    expect(d.op).toBeNull();
    expect(d.blocked).toBe(true);
    expect(d.requiresConfirm).toBe(true);
    expect(d.reason).toBe('uninstall-needs-confirm');
    expect(d.reclaimBytes).toBe(0);
  });

  it('once confirmed, an app swipe → uninstallApp with the bundle + leftover paths', () => {
    const d = resolveTriageAction(app, 'delete', { confirmed: true });
    expect(d.op).toBe('uninstallApp');
    expect(d.appPath).toBe('/Applications/Foo.app');
    expect(d.paths).toEqual([
      '/Applications/Foo.app',
      '~/Library/Application Support/Foo',
      '~/Library/Caches/foo',
    ]);
    expect(d.requiresConfirm).toBe(true);
    expect(d.blocked).toBe(false);
    // Reclaim tally = app bundle + all leftovers.
    expect(d.reclaimBytes).toBe(600 * MB + leftoverBytes(app));
    expect(leftoverBytes(app)).toBe(140 * MB);
  });
});

// ------------------------------------------------------------------
// Firing the resolved op against the disk bridge.
// ------------------------------------------------------------------
describe('applyTriageDecision', () => {
  function spyDisk() {
    const deleteToTrash = vi.fn().mockResolvedValue({ kind: 'delete', ok: true });
    const evict = vi.fn().mockResolvedValue({ kind: 'evict', ok: true });
    const uninstallApp = vi.fn().mockResolvedValue({ kind: 'uninstall', ok: true });
    const disk = {
      scan: vi.fn(),
      deleteToTrash,
      evict,
      uninstallApp,
      applyReorgPlan: vi.fn(),
    } as unknown as DiskApi;
    return { disk, deleteToTrash, evict, uninstallApp };
  }

  it('Delete → disk.deleteToTrash(paths, { confirm: true })', async () => {
    const s = spyDisk();
    await applyTriageDecision({ disk: s.disk }, resolveTriageAction(makeItem({ id: 'p' }), 'delete'));
    expect(s.deleteToTrash).toHaveBeenCalledWith(['p'], { confirm: true });
    expect(s.evict).not.toHaveBeenCalled();
    expect(s.uninstallApp).not.toHaveBeenCalled();
  });

  it('Evict → disk.evict(paths)', async () => {
    const s = spyDisk();
    const item = makeItem({ id: 'c', icloud: 'downloaded' });
    await applyTriageDecision({ disk: s.disk }, resolveTriageAction(item, 'evict'));
    expect(s.evict).toHaveBeenCalledWith(['c']);
    expect(s.deleteToTrash).not.toHaveBeenCalled();
  });

  it('confirmed app Delete → disk.uninstallApp(appPath)', async () => {
    const s = spyDisk();
    const app = makeItem({
      id: '/Applications/Foo.app',
      app: { appPath: '/Applications/Foo.app', leftovers: [] },
    });
    await applyTriageDecision({ disk: s.disk }, resolveTriageAction(app, 'delete', { confirmed: true }));
    expect(s.uninstallApp).toHaveBeenCalledWith('/Applications/Foo.app');
    expect(s.deleteToTrash).not.toHaveBeenCalled();
  });

  it('Keep (and any blocked decision) fires no disk call and resolves null', async () => {
    const s = spyDisk();
    const kept = await applyTriageDecision({ disk: s.disk }, resolveTriageAction(makeItem(), 'keep'));
    const blocked = await applyTriageDecision(
      { disk: s.disk },
      resolveTriageAction(makeItem({ icloud: 'not-icloud' }), 'evict'),
    );
    expect(kept).toBeNull();
    expect(blocked).toBeNull();
    expect(s.deleteToTrash).not.toHaveBeenCalled();
    expect(s.evict).not.toHaveBeenCalled();
    expect(s.uninstallApp).not.toHaveBeenCalled();
  });
});

describe('mockTriageDiskApi', () => {
  it('resolves the three triage mutations (so a session can advance offline)', async () => {
    const api = mockTriageDiskApi();
    expect((await api.deleteToTrash(['a'], { confirm: true })).ok).toBe(true);
    expect((await api.evict(['b'])).ok).toBe(true);
    expect((await api.uninstallApp('/Applications/Foo.app')).kind).toBe('uninstall');
  });
});

describe('formatLastOpened', () => {
  it('renders Never / months / years the way the card does', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(formatLastOpened(makeItem({ lastOpenedMs: null }), TRIAGE_NOW_MS)).toBe('Never');
    expect(formatLastOpened(makeItem({ lastOpenedMs: TRIAGE_NOW_MS - 240 * day }), TRIAGE_NOW_MS)).toBe(
      '8 months ago',
    );
    expect(formatLastOpened(makeItem({ lastOpenedMs: TRIAGE_NOW_MS - 720 * day }), TRIAGE_NOW_MS)).toBe(
      '2 years ago',
    );
  });
});
