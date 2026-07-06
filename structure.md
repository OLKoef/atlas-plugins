# atlas-plugins — structure

The SDK + individual plugin builds for Atlas's plugin marketplace. This is a separate npm
workspaces monorepo from the main Atlas app, distributed independently of Atlas's own
version via its own catalog pipeline. Keep this file current with what's built and where.

## Layout

```
atlas-plugins/
├── package.json            # workspace root; the build+test gate lives here
├── vitest.config.ts        # single root Vitest run (SDK + scaffolder + build proof)
├── sdk/                    # @atlas/plugin-sdk — the typed plugin API + Vite config
├── create-plugin/          # create-atlas-plugin — scaffolder CLI + template
├── plugins/                # authored / built plugins (one dir per plugin id)
│   └── example-widget/     # reference plugin: the create-plugin template, rendered
├── structure.md            # this file
└── documentation.md        # dated change log (newest first)
```

Workspaces: `sdk`, `create-plugin`, `plugins/*`. `dist/` and `node_modules/` are gitignored.

## Gate

`npm run build && npm test` (defined in the root `package.json`):

- `build` → `tsc` builds `@atlas/plugin-sdk` to `sdk/dist`, then `vite build` builds
  `@atlas/plugin-example-widget` to `plugins/example-widget/dist/index.js`.
- `test` → `vitest run` over `sdk/src/**/*.test.ts` and `create-plugin/**/*.test.mjs`.

## `sdk/` — `@atlas/plugin-sdk`

The plugin API surface, mirroring the Dashboard-side `src/shared/plugins.ts` (PL1).
implementation.md is this repo's source of truth (it cannot read Dashboard's TypeScript).

- `src/version.ts` — `ATLAS_PLUGIN_API_VERSION` (integer `1`; `disk.*` + `ai.chat` shipped
  additively in V0.5.1 and did not bump it).
- `src/manifest.ts` — `PluginManifest`, `PluginType`, permission vocabulary, and the pure
  `parseManifest` / `safeParseManifest` validator (id charset, semver, type enum, entry
  traversal guard, `minAtlasApi`), plus `isApiCompatible` / `isKnownPermission`.
- `src/api.ts` — `AtlasPluginApi` bridge (`tasks`, `subjects`, `events`, `focus`,
  `storage`, `ui`, `net`, `settings`, `disk`, `ai`) and its read-model types.
- `src/disk.ts` — Disk Manager backend (`disk.*`, DISK1–DISK4) + `ai.chat` (DISK10) types,
  and `PluginPermissionError`.
- `src/plugin.ts` — the `AtlasPlugin` entry contract, `AtlasPluginRuntime` (the
  `window.AtlasPluginRuntime` global), and `InstalledPlugin` / `CatalogEntry`.
- `src/index.ts` — public barrel (`.` export → types + validator + version).
- `src/vite.ts` — the `@atlas/plugin-sdk/vite` subpath: `defineAtlasPluginConfig()` and
  `atlasReactRuntimePlugin()`. Emits an ESM library build to `index.js` and rewrites
  `react` / `react-dom` / `react/jsx-runtime` imports to read from
  `window.AtlasPluginRuntime`, so bundles never ship React (the singleton fix).
- `src/__tests__/` — `manifest`, `version`, `vite-config` (shim shape) and `externalize`
  (builds the example plugin and asserts no bundled React).

Package exports: `.` → `dist/index.js` (types + runtime helpers), `./vite` →
`dist/vite.js` (the build config; kept off the main entry so importing types never pulls
Vite into a plugin's graph).

## `create-plugin/` — `create-atlas-plugin`

- `index.mjs` — the `create-atlas-plugin <id>` CLI (dependency-free Node).
- `src/scaffold.mjs` — the pure `scaffoldPlugin()` used by the CLI and tests.
- `src/scaffold.test.mjs` — scaffolder tests, incl. a drift check asserting
  `plugins/example-widget` equals the template rendered.
- `template/` — tokenized (`{{id}}`, `{{name}}`, …) plugin skeleton: `manifest.json`,
  `package.json`, `tsconfig.json`, `vite.config.ts`, `src/index.tsx`, `README.md`,
  `gitignore` (written as `.gitignore`).

## `plugins/`

One directory per plugin id. `example-widget` is the reference render of the template and
the build-gate proof. Real marketplace plugins (e.g. Disk Manager, DISK5+) land here as
SDK-authored, Vite-built bundles.

## Authoring a plugin

```sh
npx create-atlas-plugin my-plugin
cd my-plugin && npm install && npm run build   # -> dist/index.js, React externalized
```

`src/index.tsx` default-exports an `AtlasPlugin` (`{ manifest, Widget?, Panel?, onEnable?,
onDisable? }`); `vite.config.ts` is one line: `defineConfig(defineAtlasPluginConfig())`.
