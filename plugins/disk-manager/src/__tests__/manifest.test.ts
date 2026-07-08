import { describe, expect, it } from 'vitest';
import { parseManifest } from '@atlas/plugin-sdk';
import manifest from '../../manifest.json';

/**
 * The manifest must be a valid `type: "tool"` manifest that declares exactly the DISK4 disk
 * permissions plus the DISK7 `ai:chat` (used by the AI-reorg proposal) — validated through
 * the SDK's own `parseManifest` (the same seam the Dashboard registry uses).
 */
describe('disk-manager manifest', () => {
  it('validates against the SDK manifest parser', () => {
    expect(() => parseManifest(manifest)).not.toThrow();
  });

  it('is a tool gated at API v1 with a bundled stylesheet', () => {
    const m = parseManifest(manifest);
    expect(m.id).toBe('disk-manager');
    expect(m.type).toBe('tool');
    expect(m.minAtlasApi).toBe(1);
    expect(m.entry).toBe('index.js');
    expect(m.styles).toBe('styles.css');
  });

  it('declares the five DISK4 disk permissions plus DISK7 ai:chat', () => {
    const m = parseManifest(manifest);
    expect(m.permissions).toEqual([
      'disk:read',
      'disk:trash',
      'disk:evict',
      'disk:uninstall-app',
      'disk:reorg',
      'ai:chat',
    ]);
  });
});
