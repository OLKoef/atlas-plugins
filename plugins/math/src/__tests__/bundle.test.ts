import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * MATH1 acceptance: the plugin builds clean against the SDK with **React external** while
 * **mathjs bundles into the zip**. The SDK's own externalize test proves the mechanism on the
 * reference plugin; this one proves it holds for the heaviest plugin in the set — the one
 * that actually ships a large dependency alongside the externalized React.
 *
 * MATH2 adds function-plot — bundled too — and with it the constraint that makes the plugin
 * installable at all: an installed plugin dir is **flat and entry-only**, so the build has to
 * emit a single `dist/index.js` rather than the code-split chunks a dynamic import would
 * otherwise produce (see `vite.config.ts` / `lib/plot.ts`).
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const distDir = fileURLToPath(new URL('../../dist/', import.meta.url));
const distFile = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

let code = '';

beforeAll(() => {
  // The gate runs `npm run build` before `npm test`, so dist normally exists already.
  if (!existsSync(distFile)) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
  code = readFileSync(distFile, 'utf8');
}, 180_000);

describe('math Vite lib build', () => {
  it('emits dist/index.js as an ESM module', () => {
    expect(existsSync(distFile)).toBe(true);
    expect(code).toMatch(/export\s*\{|export\s+default/);
  });

  it('sources React from window.AtlasPluginRuntime', () => {
    expect(code).toContain('AtlasPluginRuntime');
    expect(code).toContain('createElement');
  });

  it('does not bundle React (no bare react imports, no React internals)', () => {
    expect(code).not.toContain('__SECRET_INTERNALS');
    expect(code).not.toMatch(/from\s*["']react["']/);
    expect(code).not.toMatch(/from\s*["']react-dom["']/);
    expect(code).not.toMatch(/from\s*["']react\/jsx-runtime["']/);
    expect(code).not.toMatch(/from\s*["']react\/jsx-dev-runtime["']/);
  });

  it('bundles mathjs into the plugin zip rather than externalizing it', () => {
    expect(code).not.toMatch(/from\s*["']mathjs["']/);
    // mathjs's own source is present — the hardened instance overrides these two by name.
    expect(code).toContain('createUnit');
    expect(code).toContain('is disabled in the Atlas Math plugin');
  });

  it('bundles function-plot (and its d3 dependencies) too', () => {
    expect(code).not.toMatch(/from\s*["']function-plot["']/);
    expect(code).not.toMatch(/from\s*["']d3-[a-z]+["']/);
    // function-plot registers its graph types on load; d3-zoom drives pan/zoom.
    expect(code).toContain('registerGraphType');
    expect(code).toContain('polyline');
  });

  it('emits a single self-contained entry — an installed plugin dir is flat', () => {
    // `scripts/build-catalog.mjs` stages exactly `manifest.entry` + manifest + styles/icon,
    // so a sibling chunk emitted beside index.js would never reach the zip and the entry
    // would resolve against a file that is not there.
    const scripts = readdirSync(distDir).filter((name) => name.endsWith('.js'));
    expect(scripts).toEqual(['index.js']);
    expect(code).not.toMatch(/\bimport\s*\(\s*["']\.\//);
  });
});
