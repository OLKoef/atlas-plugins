/**
 * Disk Manager — Visualize model (DISK5), framework-free.
 *
 * Everything here is pure so it can be unit-tested without a DOM: turning a DISK1
 * {@link DiskScanResult} into treemap nodes, laying them out (a squarified slice/dice
 * that mirrors the approved wireframe), the iCloud split (Drive is browsable, Photos/Mail
 * are aggregate-size-only, Backup is a read-only figure only if available), and the mocked
 * `disk.*` data used by tests and offline dev (no live iCloud/LM Studio calls).
 */

import type {
  AtlasPluginApi,
  DiskApi,
  DiskScanResult,
  FileCategory,
  FolderAggregate,
} from '@atlas/plugin-sdk';
import { PluginPermissionError } from '@atlas/plugin-sdk';

/** The three scan scopes offered by the Visualize scope selector. */
export type DiskScope = 'local' | 'icloud' | 'both';

export const DISK_SCOPES: readonly DiskScope[] = ['local', 'icloud', 'both'];

export const SCOPE_LABELS: Record<DiskScope, string> = {
  local: 'Local',
  icloud: 'iCloud',
  both: 'Both',
};

const GB = 1024 ** 3;

/**
 * Category-tint palette — same tint family/naming the design tokens use
 * (`--tint-indigo` … `--tint-red`, DiskManagerApproved.html). Treemap folder nodes cycle
 * through it by descending-size rank.
 */
export const TREEMAP_PALETTE: readonly string[] = [
  'var(--tint-indigo)',
  'var(--tint-purple)',
  'var(--tint-mint)',
  'var(--tint-teal)',
  'var(--tint-orange)',
  '#565B6B',
  'var(--tint-pink)',
  'var(--tint-red)',
];

/** Stable color per file-type category (used when the treemap is grouped by type). */
export const CATEGORY_COLORS: Record<FileCategory, string> = {
  video: 'var(--tint-indigo)',
  app: 'var(--tint-purple)',
  image: 'var(--tint-mint)',
  code: 'var(--tint-teal)',
  archive: 'var(--tint-orange)',
  document: '#565B6B',
  audio: 'var(--tint-red)',
  other: 'var(--tint-pink)',
};

/** Which dimension the treemap groups by. */
export type TreemapDimension = 'folder' | 'type';

/** A single treemap cell before layout. `bytes` drives its area. */
export interface TreemapNode {
  /** stable key (folder name or category). */
  key: string;
  name: string;
  bytes: number;
  count: number;
  color: string;
  /** which aggregate produced this node. */
  dimension: TreemapDimension;
  /** file-type category, when `dimension === 'type'`. */
  category?: FileCategory;
}

/** A treemap node placed into the layout box, in **percent** units (0–100). */
export interface TreemapRect extends TreemapNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * An iCloud store shown as an aggregate figure only — Photos, Mail. Deliberately NOT
 * browsable and NOT swipeable (the design draws these distinct from the treemap: a lock
 * glyph, no hover affordance, an explanatory caption).
 */
export interface IcloudAggregate {
  key: string;
  name: string;
  bytes: number;
  count?: number;
  browsable: false;
  swipeable: false;
  note: string;
}

/** iCloud Backup — a read-only figure only when the host can report it. */
export interface IcloudBackup {
  bytes: number | null;
  browsable: false;
  swipeable: false;
}

/** The non-browsable iCloud extras rendered beside the treemap for iCloud/Both scopes. */
export interface IcloudExtras {
  aggregates: IcloudAggregate[];
  backup: IcloudBackup;
}

/** Raw scan inputs the Panel gathers once, then re-slices per scope. */
export interface VisualizeSources {
  local: DiskScanResult;
  icloudDrive: DiskScanResult;
  icloudExtras: IcloudExtras;
}

/** The fully-derived view-model the Visualize screen renders. */
export interface VisualizeModel {
  scope: DiskScope;
  nodes: TreemapNode[];
  layout: TreemapRect[];
  legend: TreemapNode[];
  reclaimTargets: TreemapNode[];
  /** present for `icloud` / `both`; `null` for `local`. */
  icloud: IcloudExtras | null;
}

/** Human-readable size, matching the wireframe (`62.1 GB`, `84 MB`, `12 KB`). */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const kb = bytes / 1024;
  return `${kb >= 1 ? Math.round(kb) : bytes} KB`;
}

/** Build treemap nodes from a scan's folder or type aggregates, sorted largest-first. */
export function buildTreemapNodes(
  scan: DiskScanResult,
  dimension: TreemapDimension = 'folder',
): TreemapNode[] {
  const raw: TreemapNode[] =
    dimension === 'type'
      ? scan.byType.map((t) => ({
          key: t.category,
          name: categoryLabel(t.category),
          bytes: t.size,
          count: t.count,
          color: CATEGORY_COLORS[t.category],
          dimension: 'type' as const,
          category: t.category,
        }))
      : scan.byFolder.map((f: FolderAggregate) => ({
          key: f.name,
          name: f.name,
          bytes: f.size,
          count: f.count,
          color: '',
          dimension: 'folder' as const,
        }));

  const sorted = [...raw].sort((a, b) => b.bytes - a.bytes);
  // Folder nodes have no intrinsic color — assign by rank so the largest is the most
  // saturated tint (matches the wireframe's ordering).
  if (dimension === 'folder') {
    sorted.forEach((n, i) => {
      n.color = TREEMAP_PALETTE[i % TREEMAP_PALETTE.length];
    });
  }
  return sorted;
}

function categoryLabel(category: FileCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Squarified slice/dice treemap — the largest remaining node takes a slab off the longer
 * edge of the remaining box, then we recurse on the rest. Returns rectangles in percent so
 * the renderer can position them with `%` CSS. Pure and deterministic.
 */
export function squarify(
  nodes: TreemapNode[],
  x = 0,
  y = 0,
  w = 100,
  h = 100,
): TreemapRect[] {
  const out: TreemapRect[] = [];
  place(nodes, x, y, w, h);
  return out;

  function place(items: TreemapNode[], px: number, py: number, pw: number, ph: number): void {
    if (items.length === 0) return;
    if (items.length === 1) {
      out.push({ ...items[0], x: px, y: py, w: pw, h: ph });
      return;
    }
    const sum = items.reduce((s, d) => s + d.bytes, 0);
    const first = items[0];
    const rest = items.slice(1);
    const frac = sum === 0 ? 1 / items.length : first.bytes / sum;
    if (pw >= ph) {
      const fw = pw * frac;
      out.push({ ...first, x: px, y: py, w: fw, h: ph });
      place(rest, px + fw, py, pw - fw, ph);
    } else {
      const fh = ph * frac;
      out.push({ ...first, x: px, y: py, w: pw, h: fh });
      place(rest, px, py + fh, pw, ph - fh);
    }
  }
}

/** Top-N nodes by size — feeds the "Top reclaim targets" side list. */
export function topReclaimTargets(nodes: TreemapNode[], n = 6): TreemapNode[] {
  return [...nodes].sort((a, b) => b.bytes - a.bytes).slice(0, n);
}

/** Collapse an entire scan into one aggregate node (used for the "iCloud Drive" slab in Both). */
export function aggregateScan(
  scan: DiskScanResult,
  name: string,
  color: string,
): TreemapNode {
  const bytes = scan.byFolder.reduce((s, f) => s + f.size, 0);
  const count = scan.byFolder.reduce((s, f) => s + f.count, 0);
  return { key: name, name, bytes, count, color, dimension: 'folder' };
}

/**
 * Derive the full Visualize view-model for a scope. Local = local folders only; iCloud =
 * the browsable iCloud Drive folders (+ the aggregate-only extras beside them); Both =
 * local folders plus a single collapsed iCloud Drive slab (+ the extras).
 */
export function buildVisualizeModel(
  scope: DiskScope,
  sources: VisualizeSources,
): VisualizeModel {
  let nodes: TreemapNode[];
  let icloud: IcloudExtras | null;

  if (scope === 'local') {
    nodes = buildTreemapNodes(sources.local);
    icloud = null;
  } else if (scope === 'icloud') {
    nodes = buildTreemapNodes(sources.icloudDrive);
    icloud = sources.icloudExtras;
  } else {
    const local = buildTreemapNodes(sources.local);
    const drive = aggregateScan(sources.icloudDrive, 'iCloud Drive', 'var(--tint-teal)');
    nodes = [...local, drive].sort((a, b) => b.bytes - a.bytes);
    icloud = sources.icloudExtras;
  }

  return {
    scope,
    nodes,
    layout: squarify(nodes),
    legend: nodes,
    reclaimTargets: topReclaimTargets(nodes),
    icloud,
  };
}

// ============================================================================
// Mocked disk.* data — mirrors DiskManagerApproved.html so Visualize renders the same
// picture offline. In the real host these come from `api.disk.scan(...)` (Drive folders)
// and a host storage-report bridge (Photos/Mail/Backup aggregates); no live iCloud here.
// ============================================================================

/** Scan roots the Panel asks the host to walk. */
export const LOCAL_ROOT = '~';
export const ICLOUD_DRIVE_ROOT = '~/Library/Mobile Documents/com~apple~CloudDocs';

function folder(name: string, gb: number, count: number): FolderAggregate {
  return { name, size: Math.round(gb * GB), count };
}

function typeAgg(category: FileCategory, gb: number, count: number) {
  return { category, size: Math.round(gb * GB), count };
}

export function mockLocalScan(): DiskScanResult {
  return {
    files: [],
    byFolder: [
      folder('Videos', 62.1, 214),
      folder('Applications', 54.8, 186),
      folder('Photos Library', 41.3, 28410),
      folder('Xcode / Developer', 38.6, 5120),
      folder('Downloads', 27.2, 238),
      folder('Documents', 14.9, 1840),
      folder('Desktop', 9.4, 62),
      folder('Music', 6.1, 940),
    ],
    byType: [
      typeAgg('video', 65.0, 320),
      typeAgg('app', 55.0, 200),
      typeAgg('image', 50.0, 30120),
      typeAgg('code', 39.0, 5200),
      typeAgg('document', 15.0, 2100),
      typeAgg('archive', 12.0, 410),
      typeAgg('audio', 6.1, 950),
      typeAgg('other', 8.0, 520),
    ],
  };
}

export function mockIcloudDriveScan(): DiskScanResult {
  return {
    files: [],
    byFolder: [
      folder('iCloud Drive — Documents', 18.2, 940),
      folder('Desktop & Documents sync', 9.7, 412),
      folder('App data (Numbers/Pages)', 4.1, 88),
      folder('Shared', 2.3, 51),
    ],
    byType: [
      typeAgg('document', 24.0, 1100),
      typeAgg('image', 6.0, 260),
      typeAgg('archive', 3.0, 90),
      typeAgg('other', 1.3, 41),
    ],
  };
}

/**
 * The aggregate-only iCloud extras. Backup is reported as unavailable (`bytes: null`) —
 * the design draws it as an "out of scope" line; a host that can surface the figure would
 * pass a number instead.
 */
export function mockIcloudExtras(): IcloudExtras {
  return {
    aggregates: [
      {
        key: 'photos',
        name: 'Photos',
        bytes: Math.round(86.2 * GB),
        count: 42318,
        browsable: false,
        swipeable: false,
        note: "matches Apple's Storage bar · not browsable in Atlas",
      },
      {
        key: 'mail',
        name: 'Mail',
        bytes: Math.round(3.8 * GB),
        browsable: false,
        swipeable: false,
        note: 'Aggregate size only · not browsable in Atlas',
      },
    ],
    backup: { bytes: null, browsable: false, swipeable: false },
  };
}

/** A small mocked duplicate summary for the Visualize dupe banner (full detection is later). */
export interface DuplicateSummary {
  files: number;
  reclaimableBytes: number;
}

export function mockDuplicateSummary(): DuplicateSummary {
  return { files: 312, reclaimableBytes: Math.round(4.2 * GB) };
}

/**
 * A stand-in {@link DiskApi} for tests and offline dev. `scan` returns the mocked datasets
 * keyed by root; the mutating methods reject with {@link PluginPermissionError} shape-alikes
 * so nothing here can touch a real disk. Not wired into the host — the host injects the real
 * `disk` bridge.
 */
export function mockDiskApi(): DiskApi {
  const notHere = (permission: string) =>
    Promise.reject(
      new PluginPermissionError(
        permission,
        `mockDiskApi does not perform mutations (${permission})`,
      ),
    );
  return {
    scan: (root: string) =>
      Promise.resolve(
        root === ICLOUD_DRIVE_ROOT ? mockIcloudDriveScan() : mockLocalScan(),
      ),
    deleteToTrash: () => notHere('disk:trash'),
    evict: () => notHere('disk:evict'),
    uninstallApp: () => notHere('disk:uninstall-app'),
    applyReorgPlan: () => notHere('disk:reorg'),
  };
}

/**
 * Gather the raw scans + iCloud extras once. Uses the host `disk.scan` (both roots) and the
 * mocked iCloud aggregates (no host storage-report API in v1). Safe to call with
 * {@link mockDiskApi} in tests / offline.
 */
export async function loadVisualizeSources(
  api: Pick<AtlasPluginApi, 'disk'>,
): Promise<VisualizeSources> {
  const [local, icloudDrive] = await Promise.all([
    api.disk.scan(LOCAL_ROOT),
    api.disk.scan(ICLOUD_DRIVE_ROOT),
  ]);
  return { local, icloudDrive, icloudExtras: mockIcloudExtras() };
}
