import { describe, it, expect } from 'vitest';
import {
  parseCatalog,
  parseCatalogEntry,
  safeParseCatalog,
  buildCatalogEntry,
  upsertCatalogEntry,
  serializeCatalog,
  CatalogError,
  EMPTY_CATALOG,
  type Catalog,
} from '../catalog.js';
import type { CatalogEntry } from '../plugin.js';
import type { PluginManifest } from '../manifest.js';

const SHA = 'a'.repeat(64);

const ENTRY: CatalogEntry = {
  id: 'pomodoro',
  name: 'Pomodoro Timer',
  version: '1.0.0',
  type: 'widget',
  description: 'Focus timer task binding.',
  author: 'Atlas',
  icon: 'https://raw.githubusercontent.com/OLKoef/atlas-plugins/main/plugins/pomodoro/icon.svg',
  homepage: 'https://example.com/plugins/pomodoro',
  minAtlasApi: 1,
  downloadUrl: 'https://github.com/OLKoef/atlas-plugins/releases/download/pomodoro-v1.0.0/pomodoro-v1.0.0.zip',
  sha256: SHA,
};

const MANIFEST: PluginManifest = {
  id: 'pomodoro',
  name: 'Pomodoro Timer',
  version: '1.0.0',
  type: 'widget',
  entry: 'index.js',
  minAtlasApi: 1,
  description: 'Focus timer task binding.',
  icon: 'icon.svg',
  author: 'Atlas',
  homepage: 'https://example.com/plugins/pomodoro',
  permissions: ['tasks:read', 'focus:write'],
};

describe('parseCatalogEntry — valid', () => {
  it('accepts a fully-specified entry', () => {
    expect(parseCatalogEntry(ENTRY)).toEqual(ENTRY);
  });

  it('drops absent optionals', () => {
    const min = { ...ENTRY };
    delete (min as Partial<CatalogEntry>).icon;
    delete (min as Partial<CatalogEntry>).homepage;
    const parsed = parseCatalogEntry(min);
    expect(parsed.icon).toBeUndefined();
    expect(parsed.homepage).toBeUndefined();
    expect(parsed.screenshots).toBeUndefined();
  });
});

describe('parseCatalogEntry — invalid', () => {
  const cases: Array<[string, unknown]> = [
    ['non-object', 42],
    ['bad id', { ...ENTRY, id: 'Bad_Id' }],
    ['bad version', { ...ENTRY, version: '1.0' }],
    ['bad type', { ...ENTRY, type: 'plugin' }],
    ['zero minAtlasApi', { ...ENTRY, minAtlasApi: 0 }],
    ['non-integer minAtlasApi', { ...ENTRY, minAtlasApi: 1.5 }],
    ['relative downloadUrl', { ...ENTRY, downloadUrl: '/releases/x.zip' }],
    ['non-http downloadUrl', { ...ENTRY, downloadUrl: 'ftp://x/y.zip' }],
    ['short sha256', { ...ENTRY, sha256: 'abc' }],
    ['uppercase sha256', { ...ENTRY, sha256: 'A'.repeat(64) }],
    ['non-url icon', { ...ENTRY, icon: 'icon.svg' }],
    ['screenshots not urls', { ...ENTRY, screenshots: ['not a url'] }],
  ];
  it.each(cases)('rejects %s', (_label, value) => {
    expect(() => parseCatalogEntry(value)).toThrow(CatalogError);
  });
});

describe('parseCatalog', () => {
  it('accepts a wrapped list', () => {
    expect(parseCatalog({ plugins: [ENTRY] })).toEqual({ plugins: [ENTRY] });
  });

  it('accepts the empty catalog', () => {
    expect(parseCatalog(EMPTY_CATALOG)).toEqual({ plugins: [] });
  });

  it('rejects a bare array (must be wrapped)', () => {
    expect(() => parseCatalog([ENTRY])).toThrow(CatalogError);
  });

  it('rejects duplicate ids', () => {
    expect(() => parseCatalog({ plugins: [ENTRY, { ...ENTRY, version: '2.0.0' }] })).toThrow(/duplicate/);
  });

  it('safeParseCatalog reports errors without throwing', () => {
    expect(safeParseCatalog(EMPTY_CATALOG).ok).toBe(true);
    const bad = safeParseCatalog({ plugins: [{ id: 'x' }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/name/);
  });
});

describe('buildCatalogEntry', () => {
  it('maps manifest + release facts to a parseable entry', () => {
    const entry = buildCatalogEntry(MANIFEST, {
      downloadUrl: ENTRY.downloadUrl,
      sha256: SHA,
      icon: ENTRY.icon,
    });
    expect(entry).toEqual(ENTRY);
    // A built entry is guaranteed to satisfy parseCatalog.
    expect(parseCatalog({ plugins: [entry] }).plugins[0]).toEqual(entry);
  });

  it('omits icon when the plugin ships none', () => {
    const noIcon: PluginManifest = { ...MANIFEST };
    delete (noIcon as Partial<PluginManifest>).icon;
    delete (noIcon as Partial<PluginManifest>).homepage;
    const entry = buildCatalogEntry(noIcon, { downloadUrl: ENTRY.downloadUrl, sha256: SHA });
    expect(entry.icon).toBeUndefined();
    expect(entry.homepage).toBeUndefined();
  });
});

describe('upsertCatalogEntry', () => {
  it('inserts a new entry and keeps the list id-sorted', () => {
    const other: CatalogEntry = { ...ENTRY, id: 'zzz-widget', name: 'Z' };
    const first: CatalogEntry = { ...ENTRY, id: 'aaa-widget', name: 'A' };
    let cat: Catalog = EMPTY_CATALOG;
    cat = upsertCatalogEntry(cat, other);
    cat = upsertCatalogEntry(cat, first);
    expect(cat.plugins.map((p) => p.id)).toEqual(['aaa-widget', 'zzz-widget']);
  });

  it('replaces an existing entry by id (re-release overwrites)', () => {
    const cat = upsertCatalogEntry({ plugins: [ENTRY] }, { ...ENTRY, version: '2.0.0', sha256: 'b'.repeat(64) });
    expect(cat.plugins).toHaveLength(1);
    expect(cat.plugins[0].version).toBe('2.0.0');
  });

  it('does not mutate the input catalog', () => {
    const input: Catalog = { plugins: [ENTRY] };
    upsertCatalogEntry(input, { ...ENTRY, id: 'other' });
    expect(input.plugins).toHaveLength(1);
  });
});

describe('serializeCatalog', () => {
  it('produces id-sorted, 2-space, newline-terminated JSON', () => {
    const cat: Catalog = { plugins: [{ ...ENTRY, id: 'b-plugin' }, { ...ENTRY, id: 'a-plugin' }] };
    const text = serializeCatalog(cat);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('  "plugins": [');
    const reparsed = parseCatalog(JSON.parse(text));
    expect(reparsed.plugins.map((p) => p.id)).toEqual(['a-plugin', 'b-plugin']);
  });

  it('is stable: serialize is idempotent (no spurious diffs)', () => {
    const once = serializeCatalog({ plugins: [ENTRY] });
    const twice = serializeCatalog(parseCatalog(JSON.parse(once)));
    expect(twice).toBe(once);
  });
});
