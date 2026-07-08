import { describe, expect, it } from 'vitest';
import {
  ICLOUD_DRIVE_ROOT,
  LOCAL_ROOT,
  buildTreemapNodes,
  buildVisualizeModel,
  formatBytes,
  loadVisualizeSources,
  mockDiskApi,
  mockIcloudDriveScan,
  mockIcloudExtras,
  mockLocalScan,
  squarify,
  topReclaimTargets,
} from '../model';

const GB = 1024 ** 3;

function sources() {
  return {
    local: mockLocalScan(),
    icloudDrive: mockIcloudDriveScan(),
    icloudExtras: mockIcloudExtras(),
  };
}

describe('formatBytes', () => {
  it('renders GB / MB / KB the way the wireframe does', () => {
    expect(formatBytes(Math.round(62.1 * GB))).toBe('62.1 GB');
    expect(formatBytes(84 * 1024 * 1024)).toBe('84 MB');
    expect(formatBytes(46 * 1024 * 1024)).toBe('46 MB');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
  });
});

describe('buildTreemapNodes', () => {
  it('sorts folders largest-first and assigns a color per rank', () => {
    const nodes = buildTreemapNodes(mockLocalScan(), 'folder');
    expect(nodes).toHaveLength(8);
    expect(nodes[0].name).toBe('Videos');
    expect(nodes[nodes.length - 1].name).toBe('Music');
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1].bytes).toBeGreaterThanOrEqual(nodes[i].bytes);
    }
    expect(nodes.every((n) => n.color !== '')).toBe(true);
  });

  it('can group by file-type category with stable colors', () => {
    const nodes = buildTreemapNodes(mockLocalScan(), 'type');
    expect(nodes.every((n) => n.dimension === 'type' && n.category)).toBe(true);
    expect(nodes[0].bytes).toBeGreaterThanOrEqual(nodes[1].bytes);
  });
});

describe('squarify', () => {
  it('partitions the box with area exactly proportional to bytes', () => {
    const nodes = buildTreemapNodes(mockLocalScan());
    const rects = squarify(nodes);
    const totalBytes = nodes.reduce((s, n) => s + n.bytes, 0);
    const totalArea = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(totalArea).toBeCloseTo(100 * 100, 3);
    for (const r of rects) {
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.w * r.h).toBeCloseTo((r.bytes / totalBytes) * 100 * 100, 2);
    }
  });

  it('keeps one node per input node', () => {
    const nodes = buildTreemapNodes(mockLocalScan());
    expect(squarify(nodes)).toHaveLength(nodes.length);
  });
});

describe('topReclaimTargets', () => {
  it('returns the biggest N by size', () => {
    const nodes = buildTreemapNodes(mockLocalScan());
    const top = topReclaimTargets(nodes, 3);
    expect(top.map((n) => n.name)).toEqual(['Videos', 'Applications', 'Photos Library']);
  });
});

describe('buildVisualizeModel', () => {
  it('local scope: local folders only, no iCloud extras', () => {
    const model = buildVisualizeModel('local', sources());
    expect(model.icloud).toBeNull();
    expect(model.nodes.map((n) => n.name)).toContain('Downloads');
    expect(model.nodes.some((n) => n.name === 'iCloud Drive')).toBe(false);
    expect(model.layout).toHaveLength(model.nodes.length);
  });

  it('icloud scope: browsable Drive folders + aggregate-only extras', () => {
    const model = buildVisualizeModel('icloud', sources());
    expect(model.icloud).not.toBeNull();
    expect(model.nodes.map((n) => n.name)).toContain('iCloud Drive — Documents');
    // Photos/Mail are aggregate-only: not browsable, not swipeable.
    for (const agg of model.icloud!.aggregates) {
      expect(agg.browsable).toBe(false);
      expect(agg.swipeable).toBe(false);
    }
    expect(model.icloud!.aggregates.map((a) => a.name)).toEqual(['Photos', 'Mail']);
    // Backup reported as unavailable → a read-only "out of scope" figure.
    expect(model.icloud!.backup.bytes).toBeNull();
  });

  it('both scope: local folders plus a single collapsed iCloud Drive slab', () => {
    const model = buildVisualizeModel('both', sources());
    const drive = model.nodes.find((n) => n.name === 'iCloud Drive');
    expect(drive).toBeDefined();
    // The slab equals the sum of the Drive folders.
    const driveSum = mockIcloudDriveScan().byFolder.reduce((s, f) => s + f.size, 0);
    expect(drive!.bytes).toBe(driveSum);
    expect(model.icloud).not.toBeNull();
  });
});

describe('mockDiskApi + loadVisualizeSources', () => {
  it('scan routes local vs iCloud Drive roots to the right dataset', async () => {
    const api = mockDiskApi();
    const local = await api.scan(LOCAL_ROOT);
    const drive = await api.scan(ICLOUD_DRIVE_ROOT);
    expect(local.byFolder[0].name).toBe('Videos');
    expect(drive.byFolder[0].name).toBe('iCloud Drive — Documents');
  });

  it('mutating methods reject (visualize-only never touches disk)', async () => {
    const api = mockDiskApi();
    await expect(api.deleteToTrash([], { confirm: true })).rejects.toMatchObject({
      permission: 'disk:trash',
    });
  });

  it('gathers both scans + iCloud extras', async () => {
    const s = await loadVisualizeSources({ disk: mockDiskApi() });
    expect(s.local.byFolder.length).toBeGreaterThan(0);
    expect(s.icloudDrive.byFolder.length).toBeGreaterThan(0);
    expect(s.icloudExtras.aggregates).toHaveLength(2);
  });
});
