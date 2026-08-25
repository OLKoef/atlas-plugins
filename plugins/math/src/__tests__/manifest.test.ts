import { describe, expect, it } from 'vitest';
import { parseManifest } from '@atlas/plugin-sdk';
import manifest from '../../manifest.json';

/**
 * The manifest must be a valid `type: "tool"` manifest declaring exactly `storage` for now —
 * validated through the SDK's own `parseManifest` (the same seam the Dashboard registry
 * uses). `notes:insert` is added by MATH6 once MATH7 defines it Dashboard-side.
 */
describe('math manifest', () => {
  it('validates against the SDK manifest parser', () => {
    expect(() => parseManifest(manifest)).not.toThrow();
  });

  it('is the `math` tool, gated at API v1, with a bundled stylesheet', () => {
    const m = parseManifest(manifest);
    expect(m.id).toBe('math');
    expect(m.name).toBe('Math');
    expect(m.type).toBe('tool');
    expect(m.minAtlasApi).toBe(1);
    expect(m.entry).toBe('index.js');
    expect(m.styles).toBe('styles.css');
  });

  it('declares storage only — notes:insert lands with MATH6', () => {
    const m = parseManifest(manifest);
    expect(m.permissions).toEqual(['storage']);
  });
});
