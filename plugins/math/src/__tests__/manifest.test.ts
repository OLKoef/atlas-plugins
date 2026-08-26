import { describe, expect, it } from 'vitest';
import { isKnownPermission, parseManifest } from '@atlas/plugin-sdk';
import manifest from '../../manifest.json';

/**
 * The manifest must be a valid `type: "tool"` manifest declaring `storage` and — since
 * MATH6's export/insert actions — `notes:insert`, validated through the SDK's own
 * `parseManifest` (the same seam the Dashboard registry uses).
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

  it('declares storage and the MATH6 notes-insert permission', () => {
    const m = parseManifest(manifest);
    expect(m.permissions).toEqual(['storage', 'notes:insert']);
    // Both are vocabulary the SDK knows, so PL11's install UI can name them.
    expect(m.permissions.every((permission) => isKnownPermission(permission))).toBe(true);
  });
});
