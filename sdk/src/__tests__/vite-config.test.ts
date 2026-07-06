import { describe, it, expect } from 'vitest';
import {
  defineAtlasPluginConfig,
  atlasReactRuntimePlugin,
  ATLAS_RUNTIME_GLOBAL,
} from '../vite.js';

describe('defineAtlasPluginConfig', () => {
  it('produces an ESM library build to index.js', () => {
    const cfg = defineAtlasPluginConfig();
    expect(cfg.build?.lib).toMatchObject({ entry: 'src/index.tsx', formats: ['es'] });
    // fileName is a function that always yields index.js (matches manifest.entry).
    const fileName = (cfg.build?.lib as { fileName: (f: string) => string }).fileName;
    expect(fileName('es')).toBe('index.js');
    expect(cfg.esbuild).toMatchObject({ jsx: 'automatic' });
  });

  it('installs the React-runtime plugin first', () => {
    const cfg = defineAtlasPluginConfig();
    const plugins = (cfg.plugins ?? []) as Array<{ name?: string }>;
    expect(plugins[0]?.name).toBe('atlas-plugin-react-runtime');
  });

  it('honours entry/outDir overrides', () => {
    const cfg = defineAtlasPluginConfig({ entry: 'src/main.tsx', outDir: 'build' });
    expect((cfg.build?.lib as { entry: string }).entry).toBe('src/main.tsx');
    expect(cfg.build?.outDir).toBe('build');
  });
});

describe('atlasReactRuntimePlugin', () => {
  const plugin = atlasReactRuntimePlugin();
  const resolve = plugin.resolveId as (id: string) => string | null;
  const load = plugin.load as (id: string) => { code: string } | null;

  function shimFor(id: string): string {
    const resolved = resolve.call(plugin, id);
    expect(resolved).toBeTruthy();
    const mod = load.call(plugin, resolved as string);
    expect(mod).toBeTruthy();
    return (mod as { code: string }).code;
  }

  it('resolves react/react-dom and the jsx runtimes to virtual shims', () => {
    for (const id of ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime']) {
      expect(resolve.call(plugin, id)).toMatch(/^\0atlas-runtime:/);
    }
    expect(resolve.call(plugin, 'lodash')).toBeNull();
  });

  it('maps react to the host global (no real React implementation)', () => {
    const code = shimFor('react');
    expect(code).toContain(`window.${ATLAS_RUNTIME_GLOBAL}.React`);
    expect(code).toContain('export default __host;');
    // Re-exposes hooks authors import by name.
    expect(code).toContain('export const useState =');
    expect(code).toContain('export const useEffect =');
    // Does not contain React's own implementation internals.
    expect(code).not.toContain('__SECRET_INTERNALS');
  });

  it('reconstructs the jsx runtime from the host createElement', () => {
    const code = shimFor('react/jsx-runtime');
    expect(code).toContain(`window.${ATLAS_RUNTIME_GLOBAL}.React`);
    expect(code).toContain('export function jsx(');
    expect(code).toContain('export const jsxs = jsx;');
    expect(code).toContain('createElement');
  });

  it('maps react-dom/client createRoot to the host ReactDOM', () => {
    const code = shimFor('react-dom/client');
    expect(code).toContain(`window.${ATLAS_RUNTIME_GLOBAL}.ReactDOM`);
    expect(code).toContain('export const createRoot =');
  });
});
