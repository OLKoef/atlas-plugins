/**
 * Disk Manager — session tracking + per-action undo log (DISK8), framework-free.
 *
 * Mirrors the Claude Connector's activity-log pattern already in Atlas: a running
 * "space freed this session" tally, per-action counts (kept / deleted / evicted /
 * app-removed / reorganized), and a log of every keep/delete/evict/uninstall/move where an
 * **individual** action can be undone (not just recovered from Trash). The whole log is
 * persisted through the plugin's `storage.*`, so the tally + the undo affordance survive a
 * reload.
 *
 * Everything here is pure so it can be unit-tested without a DOM or a live host:
 *   - {@link recordAction} / {@link undoEntry} evolve an immutable {@link SessionLog}.
 *   - the running total ({@link sessionFreedBytes}) + per-kind counts ({@link sessionCounts})
 *     are *derived* from the active (non-undone) entries, so undoing one action drops out of
 *     the tally by construction — no separate counter to keep in sync.
 *   - {@link planUndo} / {@link applyUndo} isolate the sole disk-touching undo: a reorg
 *     reverse-move replayed through the existing `disk.applyReorgPlan`. Trash and re-download
 *     have no API primitive, so the plan just carries the guidance the UI surfaces (mirroring
 *     the triage/reorg `resolve*` / `apply*` seam — the model never touches disk on its own).
 *   - {@link serializeSessionLog} / {@link parseSessionLog} + {@link loadSessionLog} /
 *     {@link saveSessionLog} wrap `storage.*` tolerantly (garbage → a clean empty log).
 */

import type {
  AtlasPluginApi,
  MutationResult,
  RecoveryStrategy,
  ReorgMove,
  ReorgScope,
  StorageApi,
} from '@atlas/plugin-sdk';
import type { TriageDecision, TriageItem } from './triageModel';

// ============================================================================
// Log entry + session shapes.
// ============================================================================

/** What a single logged action was. `uninstall` is a delete of an app bundle + leftovers. */
export type SessionActionKind = 'keep' | 'delete' | 'evict' | 'uninstall' | 'reorg';

/** The five kinds, in the stat-grid's locked wireframe order (Kept first). */
export const SESSION_ACTION_KINDS: readonly SessionActionKind[] = [
  'keep',
  'delete',
  'evict',
  'uninstall',
  'reorg',
];

/**
 * One row in the undo log — a single keep/delete/evict/uninstall/reorg the user performed.
 * `undone` flips true when its individual undo runs; derived totals then drop it.
 */
export interface UndoLogEntry {
  /** stable id (`act-<seq>`); the undo button targets this. */
  id: string;
  kind: SessionActionKind;
  /** primary display name — the file/app name, or `"23 files"` for a reorg batch. */
  label: string;
  /** bytes this action freed (0 for keep / a pure reorg); feeds the running tally. */
  freedBytes: number;
  /** how many underlying items this action touched; feeds the per-kind count. */
  itemCount: number;
  /** how the action could be reversed — straight from the {@link MutationResult}'s recovery. */
  recovery: RecoveryStrategy;
  /** paths this action touched (restore-from-Trash / re-download targets). */
  paths: string[];
  /** the moves a reorg made, kept so undo can replay them reversed. */
  moves: ReorgMove[];
  /** epoch ms the action happened (injected by the caller — deterministic in tests). */
  atMs: number;
  /** true once this single action has been individually undone. */
  undone: boolean;
}

/** The persisted session log: the ordered entries plus a monotonic id counter. */
export interface SessionLog {
  entries: UndoLogEntry[];
  /** last-issued sequence number, so ids stay stable without `Date.now()` / randomness. */
  seq: number;
}

export const emptySessionLog: SessionLog = { entries: [], seq: 0 };

// ============================================================================
// Recording an action.
// ============================================================================

/** The fields needed to append a log entry — everything but the derived id + `undone`. */
export interface RecordActionInput {
  kind: SessionActionKind;
  label: string;
  freedBytes: number;
  itemCount: number;
  recovery: RecoveryStrategy;
  paths: string[];
  moves: ReorgMove[];
  atMs: number;
}

/** Append an entry to the log, returning a new {@link SessionLog} (never mutates the input). */
export function recordAction(log: SessionLog, input: RecordActionInput): SessionLog {
  const seq = log.seq + 1;
  const entry: UndoLogEntry = {
    id: `act-${seq}`,
    kind: input.kind,
    label: input.label,
    freedBytes: Math.max(0, input.freedBytes),
    itemCount: Math.max(0, Math.round(input.itemCount)),
    recovery: input.recovery,
    paths: [...input.paths],
    moves: input.moves.map((m) => ({ ...m })),
    atMs: input.atMs,
    undone: false,
  };
  return { entries: [...log.entries, entry], seq };
}

/** The recovery strategy a resolved triage op maps to (per the SDK's documented mapping). */
function triageRecovery(decision: TriageDecision): RecoveryStrategy {
  switch (decision.op) {
    case 'deleteToTrash':
    case 'uninstallApp':
      return 'trash';
    case 'evict':
      return 'redownload';
    default:
      return 'none';
  }
}

/**
 * Build a {@link RecordActionInput} from a resolved-and-applied triage swipe. A Keep logs an
 * entry too (freedBytes 0) so the "Kept" count is real; a blocked decision should not be
 * recorded (the caller no-ops it before advancing).
 */
export function triageActionInput(
  item: TriageItem,
  decision: TriageDecision,
  atMs: number,
): RecordActionInput {
  const kind: SessionActionKind =
    decision.action === 'keep'
      ? 'keep'
      : decision.op === 'uninstallApp'
        ? 'uninstall'
        : decision.action; // 'delete' | 'evict'
  return {
    kind,
    label: item.name,
    freedBytes: decision.reclaimBytes,
    itemCount: 1,
    recovery: triageRecovery(decision),
    paths: decision.paths,
    moves: [],
    atMs,
  };
}

/** Build a {@link RecordActionInput} from an applied reorg's {@link MutationResult}. */
export function reorgActionInput(result: MutationResult, atMs: number): RecordActionInput {
  const n = result.moves.length;
  return {
    kind: 'reorg',
    label: `${n} file${n === 1 ? '' : 's'}`,
    freedBytes: result.reclaimedBytes,
    itemCount: n,
    recovery: result.recovery,
    paths: result.moves.map((m) => m.to),
    moves: result.moves,
    atMs,
  };
}

// ============================================================================
// Undo (model-level) + derived selectors.
// ============================================================================

/**
 * Mark a single entry undone. Idempotent: undoing a missing or already-undone entry returns
 * the same log unchanged. Reversing the *disk* effect is {@link applyUndo}'s job — this only
 * flips the flag, which is what drops the entry from the running total + counts.
 */
export function undoEntry(log: SessionLog, id: string): SessionLog {
  let changed = false;
  const entries = log.entries.map((e) => {
    if (e.id === id && !e.undone) {
      changed = true;
      return { ...e, undone: true };
    }
    return e;
  });
  return changed ? { ...log, entries } : log;
}

/** The entries that still count — everything not individually undone. */
export function activeEntries(log: SessionLog): UndoLogEntry[] {
  return log.entries.filter((e) => !e.undone);
}

/** Running "space freed this session" — sum of active entries' freed bytes. */
export function sessionFreedBytes(log: SessionLog): number {
  return activeEntries(log).reduce((sum, e) => sum + e.freedBytes, 0);
}

/** Per-kind counts (summing `itemCount`), so a reorg of 23 files reads as `reorg: 23`. */
export function sessionCounts(log: SessionLog): Record<SessionActionKind, number> {
  const counts: Record<SessionActionKind, number> = {
    keep: 0,
    delete: 0,
    evict: 0,
    uninstall: 0,
    reorg: 0,
  };
  for (const e of activeEntries(log)) counts[e.kind] += e.itemCount;
  return counts;
}

/** Total number of individual actions recorded (including undone ones) — the log length. */
export function totalActions(log: SessionLog): number {
  return log.entries.length;
}

/** The log newest-first, capped to `n` (default 20) — the "Undo log — last 20" list. */
export function recentEntries(log: SessionLog, n = 20): UndoLogEntry[] {
  const out: UndoLogEntry[] = [];
  for (let i = log.entries.length - 1; i >= 0 && out.length < n; i--) {
    out.push(log.entries[i]);
  }
  return out;
}

// ============================================================================
// Undo plan — the one disk-touching undo (reorg reverse) isolated behind a seam.
// ============================================================================

/** Human copy for each recovery strategy, surfaced when the user undoes an action. */
export const UNDO_STRATEGY_LABEL: Record<RecoveryStrategy, string> = {
  trash: 'Restored from Trash',
  redownload: 'Re-downloading from iCloud',
  'reverse-move': 'Moved files back',
  none: 'Removed from log',
};

/** Swap every move's `from`/`to` so a reorg can be replayed in reverse. */
export function reverseReorgMoves(moves: ReorgMove[]): ReorgMove[] {
  return moves.map((m) => ({ from: m.to, to: m.from }));
}

/** How a single entry's undo is carried out — a disk op for reorg, guidance otherwise. */
export interface UndoPlan {
  entryId: string;
  strategy: RecoveryStrategy;
  /** reversed moves to replay via `disk.applyReorgPlan` (only for `reverse-move`). */
  moves: ReorgMove[];
  /** true when there is an actual disk op to fire; false = model-only + user guidance. */
  disk: boolean;
  /** what the undo will do, shown in a toast. */
  message: string;
}

/**
 * Resolve the undo for one entry. Only a reorg (`reverse-move`) has an API primitive to
 * physically reverse it (replaying the swapped moves); trash / redownload / keep carry no
 * disk op — the model flips the entry and the UI tells the user how to finish (recover from
 * Trash, re-download). Pure — {@link applyUndo} is the only thing that touches disk.
 */
export function planUndo(entry: UndoLogEntry): UndoPlan {
  const disk = entry.recovery === 'reverse-move' && entry.moves.length > 0;
  return {
    entryId: entry.id,
    strategy: entry.recovery,
    moves: disk ? reverseReorgMoves(entry.moves) : [],
    disk,
    message: UNDO_STRATEGY_LABEL[entry.recovery],
  };
}

/**
 * Fire the disk op an {@link UndoPlan} resolved to. Returns the {@link MutationResult}, or
 * `null` for a model-only plan (no disk call) — mirroring {@link applyTriageDecision}'s and
 * {@link applyReorgDecision}'s "returns null when there's nothing to run" contract.
 */
export function applyUndo(
  api: Pick<AtlasPluginApi, 'disk'>,
  plan: UndoPlan,
  scope: ReorgScope,
): Promise<MutationResult | null> {
  if (!plan.disk) return Promise.resolve(null);
  return api.disk.applyReorgPlan(plan.moves, scope);
}

// ============================================================================
// Display helpers — deterministic (UTC, no locale) for the undo-log rows.
// ============================================================================

/** `HH:MM` (UTC) — stable across machines, for the log-time column. */
export function formatLogTime(atMs: number): string {
  const d = new Date(atMs);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** The row's leading verb, e.g. `Deleted`, `Evicted`, `Reorganized`. */
export function entryVerb(entry: UndoLogEntry): string {
  switch (entry.kind) {
    case 'delete':
      return 'Deleted';
    case 'uninstall':
      return 'Removed';
    case 'evict':
      return 'Evicted';
    case 'reorg':
      return 'Reorganized';
    default:
      return 'Kept';
  }
}

/** css modifier + tag copy for a log row — matches the locked wireframe classes exactly. */
export interface LogRowStyle {
  /** border-left accent class on `.log-row` (`''` for keep). */
  rowClass: '' | 'del' | 'evict' | 'reorg';
  /** pill color class on `.log-tag`. */
  tagClass: 'keep' | 'del' | 'evict' | 'reorg';
  /** short pill label. */
  tagText: 'keep' | 'del' | 'evict' | 'reorg';
}

export function logRowStyle(kind: SessionActionKind): LogRowStyle {
  switch (kind) {
    // An app uninstall reads as a delete row (per the wireframe's Adobe Reader example).
    case 'delete':
    case 'uninstall':
      return { rowClass: 'del', tagClass: 'del', tagText: 'del' };
    case 'evict':
      return { rowClass: 'evict', tagClass: 'evict', tagText: 'evict' };
    case 'reorg':
      return { rowClass: 'reorg', tagClass: 'reorg', tagText: 'reorg' };
    default:
      return { rowClass: '', tagClass: 'keep', tagText: 'keep' };
  }
}

// ============================================================================
// Persistence — tolerant serialize / parse + storage.* load / save.
// ============================================================================

/** Namespaced (by Atlas) storage key the session log lives under. */
export const SESSION_LOG_KEY = 'session-log';

export function serializeSessionLog(log: SessionLog): string {
  return JSON.stringify(log);
}

const RECOVERY_STRATEGIES: readonly RecoveryStrategy[] = [
  'trash',
  'redownload',
  'reverse-move',
  'none',
];

function isRecovery(v: unknown): v is RecoveryStrategy {
  return typeof v === 'string' && (RECOVERY_STRATEGIES as readonly string[]).includes(v);
}

function isMove(v: unknown): v is ReorgMove {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as ReorgMove).from === 'string' &&
    typeof (v as ReorgMove).to === 'string'
  );
}

/** Coerce one stored value into a valid {@link UndoLogEntry}, or drop it (`null`). */
function coerceEntry(v: unknown): UndoLogEntry | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  if (typeof e.id !== 'string') return null;
  if (!(SESSION_ACTION_KINDS as readonly string[]).includes(e.kind as string)) return null;
  return {
    id: e.id,
    kind: e.kind as SessionActionKind,
    label: typeof e.label === 'string' ? e.label : '',
    freedBytes: typeof e.freedBytes === 'number' ? Math.max(0, e.freedBytes) : 0,
    itemCount: typeof e.itemCount === 'number' ? Math.max(0, Math.round(e.itemCount)) : 0,
    recovery: isRecovery(e.recovery) ? e.recovery : 'none',
    paths: Array.isArray(e.paths) ? e.paths.filter((p): p is string => typeof p === 'string') : [],
    moves: Array.isArray(e.moves) ? e.moves.filter(isMove) : [],
    atMs: typeof e.atMs === 'number' ? e.atMs : 0,
    undone: e.undone === true,
  };
}

/**
 * Parse a stored value (string JSON, a plain object, or garbage) into a {@link SessionLog}.
 * Any malformed shape falls back to a clean empty log; `seq` is recovered from the entry ids
 * so a truncated `seq` can never re-issue an existing id.
 */
export function parseSessionLog(raw: unknown): SessionLog {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { entries: [], seq: 0 };
    }
  }
  if (!obj || typeof obj !== 'object') return { entries: [], seq: 0 };
  const rec = obj as { entries?: unknown; seq?: unknown };
  const entries = Array.isArray(rec.entries)
    ? rec.entries.map(coerceEntry).filter((e): e is UndoLogEntry => e !== null)
    : [];
  const maxSeq = entries.reduce((m, e) => {
    const n = Number(e.id.replace(/^act-/, ''));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  const seq = typeof rec.seq === 'number' && rec.seq > maxSeq ? Math.round(rec.seq) : maxSeq;
  return { entries, seq };
}

/** Read + parse the persisted log via `storage.get` (tolerant of an absent / bad value). */
export async function loadSessionLog(storage: Pick<StorageApi, 'get'>): Promise<SessionLog> {
  const raw = await storage.get<unknown>(SESSION_LOG_KEY);
  return parseSessionLog(raw);
}

/** Persist the log via `storage.set` (the host serializes + debounce-flushes to disk). */
export async function saveSessionLog(
  storage: Pick<StorageApi, 'set'>,
  log: SessionLog,
): Promise<void> {
  await storage.set(SESSION_LOG_KEY, log);
}
