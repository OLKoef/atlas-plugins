import { describe, it, expect } from 'vitest';
import { ATLAS_PLUGIN_API_VERSION } from '../version.js';
import { isApiCompatible } from '../manifest.js';

describe('ATLAS_PLUGIN_API_VERSION', () => {
  it('is the integer 1 (disk.* + ai.chat shipped additively, no bump)', () => {
    expect(ATLAS_PLUGIN_API_VERSION).toBe(1);
    expect(Number.isInteger(ATLAS_PLUGIN_API_VERSION)).toBe(true);
  });

  it('gates manifests via minAtlasApi against the host version', () => {
    expect(isApiCompatible({ minAtlasApi: 1 })).toBe(true);
    expect(isApiCompatible({ minAtlasApi: ATLAS_PLUGIN_API_VERSION })).toBe(true);
    // A plugin requiring a newer API than the host supports is refused.
    expect(isApiCompatible({ minAtlasApi: ATLAS_PLUGIN_API_VERSION + 1 })).toBe(false);
    // Explicit host version overrides the default.
    expect(isApiCompatible({ minAtlasApi: 2 }, 3)).toBe(true);
    expect(isApiCompatible({ minAtlasApi: 3 }, 2)).toBe(false);
  });
});
