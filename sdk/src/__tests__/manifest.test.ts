import { describe, it, expect } from 'vitest';
import {
  parseManifest,
  safeParseManifest,
  ManifestError,
  isKnownPermission,
  type PluginManifest,
} from '../manifest.js';

const VALID: PluginManifest = {
  id: 'pomodoro',
  name: 'Pomodoro Timer',
  version: '1.0.0',
  type: 'widget',
  entry: 'index.js',
  styles: 'styles.css',
  minAtlasApi: 1,
  description: 'Focus timer with task binding.',
  icon: 'icon.svg',
  author: 'Atlas',
  homepage: 'https://example.com/plugins/pomodoro',
  permissions: ['tasks:read', 'focus:write', 'storage'],
};

describe('parseManifest — valid', () => {
  it('accepts a fully-specified manifest', () => {
    expect(parseManifest(VALID)).toEqual(VALID);
  });

  it('accepts a minimal manifest and omits absent optionals', () => {
    const min = {
      id: 'a',
      name: 'A',
      version: '0.1.0',
      type: 'tool',
      entry: 'index.js',
      minAtlasApi: 1,
      description: 'x',
      author: 'me',
      permissions: [],
    };
    const parsed = parseManifest(min);
    expect(parsed.styles).toBeUndefined();
    expect(parsed.icon).toBeUndefined();
    expect(parsed.homepage).toBeUndefined();
    expect(parsed.type).toBe('tool');
  });

  it('accepts semver with prerelease/build metadata', () => {
    expect(parseManifest({ ...VALID, version: '2.3.4-beta.1+build.9' }).version).toBe('2.3.4-beta.1+build.9');
  });
});

describe('parseManifest — invalid', () => {
  const cases: Array<[string, unknown]> = [
    ['non-object', 42],
    ['bad id (uppercase)', { ...VALID, id: 'Pomodoro' }],
    ['bad id (leading dash)', { ...VALID, id: '-x' }],
    ['bad id (double dash)', { ...VALID, id: 'a--b' }],
    ['empty name', { ...VALID, name: '' }],
    ['bad semver', { ...VALID, version: '1.0' }],
    ['unknown type', { ...VALID, type: 'gadget' }],
    ['entry traversal', { ...VALID, entry: '../evil.js' }],
    ['absolute entry', { ...VALID, entry: '/etc/passwd' }],
    ['non-integer minAtlasApi', { ...VALID, minAtlasApi: 1.5 }],
    ['zero minAtlasApi', { ...VALID, minAtlasApi: 0 }],
    ['permissions not array', { ...VALID, permissions: 'storage' }],
    ['permissions non-string entry', { ...VALID, permissions: ['storage', 3] }],
  ];

  for (const [label, input] of cases) {
    it(`rejects: ${label}`, () => {
      expect(() => parseManifest(input)).toThrow(ManifestError);
      const safe = safeParseManifest(input);
      expect(safe.ok).toBe(false);
    });
  }

  it('safeParseManifest returns ok on valid input', () => {
    const safe = safeParseManifest(VALID);
    expect(safe.ok).toBe(true);
    if (safe.ok) expect(safe.manifest.id).toBe('pomodoro');
  });
});

describe('isKnownPermission', () => {
  it('knows the disk + core vocabulary', () => {
    for (const p of ['disk:read', 'disk:trash', 'disk:evict', 'disk:uninstall-app', 'disk:reorg', 'ai:chat', 'net', 'storage']) {
      expect(isKnownPermission(p)).toBe(true);
    }
  });
  it('knows the notes-insert permission (MATH6/MATH7)', () => {
    expect(isKnownPermission('notes:insert')).toBe(true);
  });
  it('is permissive: unknown strings are simply not "known"', () => {
    expect(isKnownPermission('future:thing')).toBe(false);
    // ...but they still parse (additive vocabulary).
    expect(safeParseManifest({ ...VALID, permissions: ['future:thing'] }).ok).toBe(true);
  });
});
