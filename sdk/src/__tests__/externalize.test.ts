import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// End-to-end proof of the PL2 acceptance criterion: a create-plugin-shaped plugin builds
// clean in Vite lib mode with React externalized (no bundled React). We build the
// reference plugin (which IS the create-plugin template rendered) and inspect its bundle.

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const distFile = fileURLToPath(new URL('../../../plugins/example-widget/dist/index.js', import.meta.url));

let code = '';

beforeAll(() => {
  // The gate runs `npm run build` before `npm test`, so dist normally exists already.
  // When the test is run standalone, build on demand (SDK first, then the plugin).
  if (!existsSync(distFile)) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  code = readFileSync(distFile, 'utf8');
}, 180_000);

describe('example-widget Vite lib build', () => {
  it('emits dist/index.js as an ESM module', () => {
    expect(existsSync(distFile)).toBe(true);
    expect(code.length).toBeGreaterThan(0);
    expect(code).toMatch(/export\s*\{|export\s+default/);
  });

  it('sources React from window.AtlasPluginRuntime', () => {
    expect(code).toContain('AtlasPluginRuntime');
    // JSX compiles through the host React's createElement (via the jsx-runtime shim).
    expect(code).toContain('createElement');
  });

  it('does not bundle React (no bare react imports, no React internals)', () => {
    expect(code).not.toContain('__SECRET_INTERNALS');
    expect(code).not.toMatch(/from\s*["']react["']/);
    expect(code).not.toMatch(/from\s*["']react-dom["']/);
    expect(code).not.toMatch(/from\s*["']react\/jsx-runtime["']/);
    expect(code).not.toMatch(/from\s*["']react\/jsx-dev-runtime["']/);
  });

  it('is small — React implementation is absent (size sanity)', () => {
    // The shim + widget are a few KB; a bundled react-dom alone would be ~130KB.
    expect(statSync(distFile).size).toBeLessThan(30_000);
  });
});
