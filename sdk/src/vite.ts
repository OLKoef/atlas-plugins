import type { Plugin, UserConfig } from 'vite';

/**
 * `@atlas/plugin-sdk/vite` — the Vite library-mode build config every Atlas plugin uses.
 *
 * A plugin bundle must **not** ship its own React (two Reacts = broken hooks). Atlas
 * installs `window.AtlasPluginRuntime = { React, ReactDOM, apiVersion }` before importing
 * any plugin, and this config rewrites every `react` / `react-dom` / JSX-runtime import to
 * read from that global. The result is an ESM bundle (`index.js`) that Atlas loads via
 * `import()` over the `atlas-plugin://` protocol, containing zero bundled React.
 *
 * Plugin authors just do `export default defineConfig(defineAtlasPluginConfig())` and
 * never think about externals.
 */

/** Name of the global Atlas installs on `window` before importing a plugin bundle. */
export const ATLAS_RUNTIME_GLOBAL = 'AtlasPluginRuntime';

// Public named exports we re-expose from the host's single React instance. Covers the
// React 18 public surface; unknown members resolve to `undefined` rather than erroring.
const REACT_NAMED_EXPORTS = [
  'Children', 'Component', 'Fragment', 'Profiler', 'PureComponent', 'StrictMode',
  'Suspense', 'cloneElement', 'createContext', 'createElement', 'createRef', 'forwardRef',
  'isValidElement', 'lazy', 'memo', 'startTransition', 'useCallback', 'useContext',
  'useDebugValue', 'useDeferredValue', 'useEffect', 'useId', 'useImperativeHandle',
  'useInsertionEffect', 'useLayoutEffect', 'useMemo', 'useReducer', 'useRef', 'useState',
  'useSyncExternalStore', 'useTransition', 'version',
];
const REACT_DOM_NAMED_EXPORTS = [
  'createPortal', 'flushSync', 'findDOMNode', 'unstable_batchedUpdates', 'version',
];
const REACT_DOM_CLIENT_NAMED_EXPORTS = ['createRoot', 'hydrateRoot'];

/** Build an ESM shim module that re-exports a runtime member off the Atlas global. */
function runtimeShim(globalMember: string, names: string[], withDefault: boolean): string {
  const guard =
    `const __host = typeof window !== 'undefined' && window.${ATLAS_RUNTIME_GLOBAL}` +
    ` && window.${ATLAS_RUNTIME_GLOBAL}.${globalMember};\n` +
    `if (!__host) throw new Error('[atlas-plugin] window.${ATLAS_RUNTIME_GLOBAL}.${globalMember}` +
    ` is unavailable — is this bundle running inside Atlas?');`;
  const lines = [guard];
  if (withDefault) lines.push('export default __host;');
  for (const name of names) lines.push(`export const ${name} = __host[${JSON.stringify(name)}];`);
  return lines.join('\n');
}

// The automatic JSX runtime (`react/jsx-runtime`) is a *separate* entry from `react` and
// is not present on `window.AtlasPluginRuntime.React`, so we reconstruct jsx/jsxs/jsxDEV
// from the host's `React.createElement`. `createElement` reads `key` back out of props, so
// passing `key` through props is faithful to the real automatic runtime.
const JSX_RUNTIME_SHIM = [
  `const __React = typeof window !== 'undefined' && window.${ATLAS_RUNTIME_GLOBAL}` +
    ` && window.${ATLAS_RUNTIME_GLOBAL}.React;`,
  `if (!__React) throw new Error('[atlas-plugin] window.${ATLAS_RUNTIME_GLOBAL}.React` +
    ` is unavailable — is this bundle running inside Atlas?');`,
  'export const Fragment = __React.Fragment;',
  'export function jsx(type, config, maybeKey) {',
  '  return __React.createElement(type, maybeKey === undefined ? config : Object.assign({}, config, { key: maybeKey }));',
  '}',
  'export const jsxs = jsx;',
  'export function jsxDEV(type, config, maybeKey) {',
  '  return __React.createElement(type, maybeKey === undefined ? config : Object.assign({}, config, { key: maybeKey }));',
  '}',
].join('\n');

/**
 * Vite/Rollup plugin that resolves `react`, `react-dom`, `react-dom/client`,
 * `react/jsx-runtime` and `react/jsx-dev-runtime` to tiny shim modules reading from
 * `window.AtlasPluginRuntime`. React's implementation never enters the module graph.
 */
export function atlasReactRuntimePlugin(): Plugin {
  const modules: Record<string, string> = {
    react: runtimeShim('React', REACT_NAMED_EXPORTS, true),
    'react-dom': runtimeShim('ReactDOM', REACT_DOM_NAMED_EXPORTS, true),
    'react-dom/client': runtimeShim('ReactDOM', REACT_DOM_CLIENT_NAMED_EXPORTS, false),
    'react/jsx-runtime': JSX_RUNTIME_SHIM,
    'react/jsx-dev-runtime': JSX_RUNTIME_SHIM,
  };
  const PREFIX = '\0atlas-runtime:';
  return {
    name: 'atlas-plugin-react-runtime',
    enforce: 'pre',
    resolveId(id) {
      return Object.prototype.hasOwnProperty.call(modules, id) ? PREFIX + id : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      return { code: modules[id.slice(PREFIX.length)], moduleSideEffects: false };
    },
  };
}

export interface AtlasPluginConfigOptions {
  /** entry module; defaults to `src/index.tsx`. */
  entry?: string;
  /** output dir; defaults to `dist`. */
  outDir?: string;
  /** emitted stylesheet filename; defaults to `styles.css`. */
  cssFileName?: string;
  /** extra Vite plugins to run after the React-runtime plugin. */
  plugins?: Plugin[];
  /** overrides merged over the default `build` block. */
  build?: UserConfig['build'];
}

/**
 * Produce the Vite config for an Atlas plugin: ESM library build to `index.js`, JSX via
 * the automatic runtime, React sourced from the Atlas host (never bundled).
 */
export function defineAtlasPluginConfig(options: AtlasPluginConfigOptions = {}): UserConfig {
  const entry = options.entry ?? 'src/index.tsx';
  const cssFileName = options.cssFileName ?? 'styles.css';
  return {
    plugins: [atlasReactRuntimePlugin(), ...(options.plugins ?? [])],
    esbuild: { jsx: 'automatic' },
    build: {
      outDir: options.outDir ?? 'dist',
      target: 'es2020',
      minify: false,
      cssCodeSplit: false,
      emptyOutDir: true,
      lib: {
        entry,
        formats: ['es'],
        fileName: () => 'index.js',
      },
      rollupOptions: {
        output: {
          assetFileNames: (asset) =>
            asset.name && /\.css$/.test(asset.name) ? cssFileName : (asset.name ?? 'asset-[hash][extname]'),
        },
      },
      ...(options.build ?? {}),
    },
  };
}
