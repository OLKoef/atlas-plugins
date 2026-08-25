import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * MATH1 acceptance: the plugin builds clean against the SDK with **React external** while
 * **mathjs bundles into the zip**. The SDK's own externalize test proves the mechanism on the
 * reference plugin; this one proves it holds for the heaviest plugin in the set — the one
 * that actually ships a large dependency alongside the externalized React.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
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
});
