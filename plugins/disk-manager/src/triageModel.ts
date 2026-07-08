/**
 * Disk Manager — the Triage swipe model (DISK6), framework-free.
 *
 * Everything here is pure so it can be unit-tested without a DOM: the triage queue item
 * shape, the reclaim-value sort (largest + least-recently-opened first), the LOCKED
 * three-action definition (Delete-left / Evict-middle / Keep-right, per the approved
 * wireframe — DiskManagerApproved.html), resolving a swipe into the matching DISK4
 * `disk.*` mutation, the app-uninstall confirm gate, and the mocked demo queue used by
 * tests and offline dev (no live iCloud / disk mutations here).
 *
 * The three actions map onto the SDK's {@link DiskApi}:
 *   - Delete  → `disk.deleteToTrash(paths, { confirm: true })`  (recoverable via Trash)
 *   - Evict   → `disk.evict(paths)`                             (iCloud-Drive files only)
 *   - Keep    → no mutation, advance to the next card
 * An app swipes into `disk.uninstallApp(appPath)` instead of a plain delete, gated behind
 * a stronger confirm than a normal swipe.
 */

import type {
  AtlasPluginApi,
  DiskApi,
  IcloudStatus,
  MutationResult,
} from '@atlas/plugin-sdk';
import { PluginPermissionError } from '@atlas/plugin-sdk';

const GB = 1024 ** 3;
const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A leftover Application Support / Caches / Preferences item (DISK3) removed with an app. */
export interface Leftover {
  path: string;
  bytes: number;
}

/** The uninstaller payload for an app card: the bundle plus its surfaced leftovers. */
export interface AppUninstallInfo {
  /** absolute path to the `.app` bundle, passed to `disk.uninstallApp`. */
  appPath: string;
  /** DISK3 leftovers shown to the user before the (stronger) confirm. */
  leftovers: Leftover[];
}

/** One card in a triage session. Mirrors a DISK1 {@link ScannedFile} plus triage metadata. */
export interface TriageItem {
  /** stable key — the file/app path. */
  id: string;
  /** display filename, e.g. `Q3_Report_FINAL_v3.pdf`. */
  name: string;
  /** human-readable kind, e.g. `PDF document`, `Photo`, `Application`. */
  kind: string;
  /** where it lives (shown in the card's Location row). */
  location: string;
  /** size in bytes — the primary reclaim signal + the tally increment. */
  bytes: number;
  /** epoch ms the file was created (card metadata). */
  createdMs: number;
  /** epoch ms the file was last opened; `null` = never opened (strong reclaim signal). */
  lastOpenedMs: number | null;
  /** iCloud status — only `downloaded` files can be evicted. */
  icloud: IcloudStatus;
  /** number of duplicate copies detected in-queue (DISK2), 0 if unique. */
  duplicateCount: number;
  /** present when this card is an app — triggers the uninstaller treatment. */
  app?: AppUninstallInfo;
  /** preview SVG inner markup (mirrors the wireframe's per-kind glyphs). */
  iconPath: string;
}

// ============================================================================
// LOCKED action model — Delete-left / Evict-middle / Keep-right, with the exact arrow
// iconography from the approved wireframe. This order + these arrow directions were
// specifically requested during design review; treat them as locked, not a placeholder.
// ============================================================================

export type TriageActionId = 'delete' | 'evict' | 'keep';

/** Which `disk.*` mutation a swipe maps to; `null` for Keep (advance only). */
export type TriageDiskOp = 'deleteToTrash' | 'evict' | 'uninstallApp' | null;

/** The direction an action's arrow points — fixes the locked iconography. */
export type ArrowDirection = 'left' | 'up' | 'right';

/** SVG geometry for the three locked arrows, copied verbatim from DiskManagerApproved.html. */
export const ARROW_ICONS: Record<
  ArrowDirection,
  { line: [number, number, number, number]; polyline: string }
> = {
  // Delete — left arrow.
  left: { line: [19, 12, 5, 12], polyline: '12 19 5 12 12 5' },
  // Evict — up arrow.
  up: { line: [12, 19, 12, 5], polyline: '5 12 12 5 19 12' },
  // Keep — right arrow.
  right: { line: [5, 12, 19, 12], polyline: '12 5 19 12 12 19' },
};

export interface TriageActionDef {
  id: TriageActionId;
  /** button label; the Evict label is overridden per-item (see {@link evictLabel}). */
  label: string;
  /** css modifier class (`swipe-btn delete` / `evict` / `keep`). */
  className: TriageActionId;
  /** locked arrow direction — must match the wireframe exactly. */
  arrow: ArrowDirection;
  title: string;
}

/**
 * The three triage actions in their LOCKED left→middle→right order. The renderer maps over
 * this array in order, so the button sequence and iconography can never drift.
 */
export const TRIAGE_ACTIONS: readonly TriageActionDef[] = [
  { id: 'delete', label: 'Delete', className: 'delete', arrow: 'left', title: 'Delete → Trash' },
  { id: 'evict', label: 'Evict', className: 'evict', arrow: 'up', title: 'Evict to cloud-only' },
  { id: 'keep', label: 'Keep', className: 'keep', arrow: 'right', title: 'Keep' },
];

/** Only iCloud-Drive files that are currently downloaded locally can be evicted. */
export function canEvict(item: TriageItem): boolean {
  return item.icloud === 'downloaded';
}

/** The Evict button label — full "Evict" when enabled, "Evict (local only)" when disabled. */
export function evictLabel(item: TriageItem): string {
  return canEvict(item) ? 'Evict' : 'Evict (local only)';
}

// ============================================================================
// Reclaim-value ordering — "largest & least-recently-opened first".
// ============================================================================

/**
 * A never-opened file is treated as this stale for reclaim-scoring — long enough that it
 * outranks recently-touched files of the same size, but bounded so it can't dominate a
 * genuinely large file. Chosen (2y) to keep the ordering intuitive and deterministic.
 */
export const NEVER_OPENED_STALENESS_MS = 2 * 365 * DAY_MS;

/** Days since a file was last opened; `null` (never) maps to {@link NEVER_OPENED_STALENESS_MS}. */
export function stalenessDays(item: TriageItem, nowMs: number): number {
  const sinceMs =
    item.lastOpenedMs === null ? NEVER_OPENED_STALENESS_MS : Math.max(0, nowMs - item.lastOpenedMs);
  return sinceMs / DAY_MS;
}

/**
 * Reclaim value blends size with staleness: `bytes × (1 + years-since-opened)`. Bytes are
 * the dominant term (so the biggest wins), but a file untouched for a year counts double,
 * pushing stale space-hogs to the front. Pure + deterministic given `nowMs`.
 */
export function reclaimValue(item: TriageItem, nowMs: number): number {
  const years = stalenessDays(item, nowMs) / 365;
  return item.bytes * (1 + years);
}

/** Sort a triage queue by descending reclaim value (does not mutate the input). */
export function sortByReclaimValue(items: TriageItem[], nowMs: number): TriageItem[] {
  return [...items].sort((a, b) => reclaimValue(b, nowMs) - reclaimValue(a, nowMs));
}

// ============================================================================
// Card display formatters — pure + deterministic (UTC, no locale) for the swipe card.
// ============================================================================

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** `1707696000000` → `Feb 12, 2025` (UTC, so the string is stable across machines). */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** The card's "Last opened" line: `Never`, `Recently`, `8 months ago`, `2 years ago`. */
export function formatLastOpened(item: TriageItem, nowMs: number): string {
  if (item.lastOpenedMs === null) return 'Never';
  const months = Math.round((nowMs - item.lastOpenedMs) / (30 * DAY_MS));
  if (months < 1) return 'Recently';
  if (months >= 24) return `${Math.round(months / 12)} years ago`;
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

// ============================================================================
// Resolving a swipe into a disk.* mutation (+ the app-uninstall confirm gate).
// ============================================================================

/** The outcome of a swipe — which `disk.*` op to run, and whether a confirm still blocks it. */
export interface TriageDecision {
  action: TriageActionId;
  /** which mutation to fire; `null` means advance without touching disk. */
  op: TriageDiskOp;
  /** paths for `deleteToTrash` / `evict`. */
  paths: string[];
  /** app bundle path for `uninstallApp`. */
  appPath?: string;
  /** bytes this action reclaims — feeds the running tally (0 for Keep / blocked). */
  reclaimBytes: number;
  /** true when a stronger-than-a-swipe confirmation is required (app uninstall). */
  requiresConfirm: boolean;
  /** true when the action can't proceed yet (confirm still pending, or evict on a non-iCloud file). */
  blocked: boolean;
  /** why it's blocked / a no-op, when applicable. */
  reason?: string;
}

/** Sum of an app's leftover sizes (added to the app bundle's own bytes when uninstalling). */
export function leftoverBytes(item: TriageItem): number {
  return item.app ? item.app.leftovers.reduce((s, lo) => s + lo.bytes, 0) : 0;
}

/**
 * Resolve a swipe on `item` into a {@link TriageDecision}. Pure — the Panel fires the op via
 * {@link applyTriageDecision} and advances the queue based on the result.
 *
 * Rules:
 *  - Keep never touches disk.
 *  - Evict is only valid for downloaded iCloud files; otherwise it's a blocked no-op (the UI
 *    also disables the button, this guards the logic).
 *  - Delete on an app becomes an uninstall, gated behind `opts.confirmed` (a stronger confirm
 *    than a plain swipe). Delete on any other file is a plain, recoverable trash.
 */
export function resolveTriageAction(
  item: TriageItem,
  action: TriageActionId,
  opts: { confirmed?: boolean } = {},
): TriageDecision {
  const base = { action, paths: [] as string[], reclaimBytes: 0, requiresConfirm: false, blocked: false };

  if (action === 'keep') {
    return { ...base, op: null };
  }

  if (action === 'evict') {
    if (!canEvict(item)) {
      return { ...base, op: null, blocked: true, reason: 'not-icloud' };
    }
    return { ...base, op: 'evict', paths: [item.id], reclaimBytes: item.bytes };
  }

  // action === 'delete'
  if (item.app) {
    const reclaimBytes = item.bytes + leftoverBytes(item);
    if (!opts.confirmed) {
      // The uninstall confirm gate: an app can't be swiped away without an explicit confirm.
      return {
        ...base,
        op: null,
        requiresConfirm: true,
        blocked: true,
        reason: 'uninstall-needs-confirm',
      };
    }
    return {
      ...base,
      op: 'uninstallApp',
      appPath: item.app.appPath,
      paths: [item.app.appPath, ...item.app.leftovers.map((lo) => lo.path)],
      reclaimBytes,
      requiresConfirm: true,
    };
  }

  return { ...base, op: 'deleteToTrash', paths: [item.id], reclaimBytes: item.bytes };
}

/**
 * Fire the mutation a {@link TriageDecision} resolved to against the host `disk` bridge.
 * Returns the {@link MutationResult}, or `null` for a Keep / blocked / disabled decision
 * (no disk call). Delete always passes `confirm: true` (the SDK requires it).
 */
export function applyTriageDecision(
  api: Pick<AtlasPluginApi, 'disk'>,
  decision: TriageDecision,
): Promise<MutationResult | null> {
  switch (decision.op) {
    case 'deleteToTrash':
      return api.disk.deleteToTrash(decision.paths, { confirm: true });
    case 'evict':
      return api.disk.evict(decision.paths);
    case 'uninstallApp':
      return api.disk.uninstallApp(decision.appPath!);
    default:
      return Promise.resolve(null);
  }
}

// ============================================================================
// Mocked triage queue — mirrors DiskManagerApproved.html so the swipe UI works offline.
// In the real host these come from `disk.scan` + `disk.detectDuplicates` / `detectLeftovers`
// (DISK2/DISK3); no live disk access here. Covers a duplicate-flagged local file, an
// evictable iCloud Drive file, a photo, and an app (full uninstaller treatment).
// ============================================================================

/**
 * A fixed "now" reference so the mocked queue's reclaim-value ordering is deterministic
 * offline and in tests (no `Date.now()`). Item `lastOpenedMs` values are relative to this.
 * 2025-07-01T00:00:00Z.
 */
export const TRIAGE_NOW_MS = Date.UTC(2025, 6, 1);

function monthsAgo(months: number): number {
  return TRIAGE_NOW_MS - Math.round(months * 30 * DAY_MS);
}

const FILE_ICON =
  '<path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><polyline points="15 2 15 7 20 7"/>';
const PHOTO_ICON =
  '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>';
const APP_ICON = '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8M12 8v8"/>';

/** The demo triage queue, UNSORTED — callers sort by reclaim value. */
export function mockTriageQueue(): TriageItem[] {
  return [
    {
      id: '~/Downloads/Q3_Report_FINAL_v3.pdf',
      name: 'Q3_Report_FINAL_v3.pdf',
      kind: 'PDF document',
      location: '~/Downloads',
      bytes: 84 * MB,
      createdMs: Date.UTC(2025, 1, 12),
      lastOpenedMs: null, // "Never"
      icloud: 'not-icloud',
      duplicateCount: 3,
      iconPath: FILE_ICON,
    },
    {
      id: '~/Library/Mobile Documents/com~apple~CloudDocs/Documents/Thesis_Chapter2_backup.docx',
      name: 'Thesis_Chapter2_backup.docx',
      kind: 'iCloud Drive file',
      location: '~/Library/Mobile Documents/com~apple~CloudDocs/Documents',
      bytes: 46 * MB,
      createdMs: Date.UTC(2024, 10, 3),
      lastOpenedMs: monthsAgo(8),
      icloud: 'downloaded',
      duplicateCount: 0,
      iconPath: FILE_ICON,
    },
    {
      id: '~/Pictures/2023/IMG_4821.HEIC',
      name: 'IMG_4821.HEIC',
      kind: 'Photo',
      location: '~/Pictures/2023',
      bytes: 12 * MB,
      createdMs: Date.UTC(2023, 5, 18),
      lastOpenedMs: monthsAgo(24),
      icloud: 'not-icloud',
      duplicateCount: 2,
      iconPath: PHOTO_ICON,
    },
    {
      id: '/Applications/Adobe Reader.app',
      name: 'Adobe Reader.app',
      kind: 'Application',
      location: '/Applications',
      bytes: 612 * MB,
      createdMs: Date.UTC(2022, 0, 4),
      lastOpenedMs: monthsAgo(14),
      icloud: 'not-icloud',
      duplicateCount: 0,
      iconPath: APP_ICON,
      app: {
        appPath: '/Applications/Adobe Reader.app',
        leftovers: [
          { path: '~/Library/Application Support/Adobe', bytes: Math.round(1.2 * GB) },
          { path: '~/Library/Caches/com.adobe.reader', bytes: 340 * MB },
          { path: '~/Library/Preferences/com.adobe.reader.plist', bytes: 12 * 1024 },
        ],
      },
    },
  ];
}

/**
 * A succeeding stand-in {@link DiskApi} for offline dev / tests of the triage flow. Unlike
 * the visualize-only `mockDiskApi` (which rejects every mutation), this one resolves the
 * three triage mutations with a plausible {@link MutationResult} so a session can advance
 * and tally. `scan` / `applyReorgPlan` still reject — triage never calls them.
 */
export function mockTriageDiskApi(): DiskApi {
  const notHere = (permission: string) =>
    Promise.reject(
      new PluginPermissionError(permission, `mockTriageDiskApi does not support ${permission}`),
    );
  const result = (
    kind: MutationResult['kind'],
    recovery: MutationResult['recovery'],
    paths: string[],
  ): Promise<MutationResult> =>
    Promise.resolve({
      kind,
      ok: true,
      reclaimedBytes: 0,
      recovery,
      trashed: recovery === 'trash' ? paths : [],
      moves: [],
      skipped: [],
      summary: `${kind} ok (mock)`,
    });
  return {
    scan: () => notHere('disk:read'),
    deleteToTrash: (paths) => result('delete', 'trash', paths),
    evict: (paths) => result('evict', 'redownload', paths),
    uninstallApp: (appPath) => result('uninstall', 'trash', [appPath]),
    applyReorgPlan: () => notHere('disk:reorg'),
  };
}
