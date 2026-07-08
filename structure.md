# atlas-plugins — structure

The SDK + individual plugin builds for Atlas's plugin marketplace. This is a separate npm
workspaces monorepo from the main Atlas app, distributed independently of Atlas's own
version via its own catalog pipeline. Keep this file current with what's built and where.

## Layout

```
atlas-plugins/
├── package.json            # workspace root; the build+test gate lives here
├── vitest.config.ts        # single root Vitest run (SDK + scaffolder + scripts + build proof)
├── catalog.json            # committed marketplace catalog Atlas fetches (PL15 regenerates it)
├── sdk/                    # @atlas/plugin-sdk — the typed plugin API + Vite config
├── create-plugin/          # create-atlas-plugin — scaffolder CLI + template
├── plugins/                # authored / built plugins (one dir per plugin id)
│   ├── example-widget/     # reference plugin: the create-plugin template, rendered
│   └── disk-manager/       # DISK5+ Disk Manager (type:"tool") — Visualize screen first
├── scripts/                # release/catalog pipeline (build-catalog.mjs + lib/release.mjs)
├── .github/workflows/      # release-plugin.yml — CI on a `<id>-v<semver>` tag
├── structure.md            # this file
└── documentation.md        # dated change log (newest first)
```

Workspaces: `sdk`, `create-plugin`, `plugins/*`. `dist/`, `dist-artifacts/` (packed plugin
zips), and `node_modules/` are gitignored. `scripts/` is not a workspace — it runs off the
root `node_modules` and imports the built `@atlas/plugin-sdk`.

## Gate

`npm run build && npm test` (defined in the root `package.json`):

- `build` → `tsc` builds `@atlas/plugin-sdk` to `sdk/dist`, then `vite build` builds each
  plugin (`@atlas/plugin-example-widget`, `@atlas/plugin-disk-manager`) to its `dist/index.js`.
- `test` → `vitest run` over `sdk/src/**/*.test.ts`, `create-plugin/**/*.test.mjs`,
  `scripts/**/*.test.mjs`, and `plugins/**/src/**/*.test.{ts,tsx}` (JSX rendered with the
  automatic runtime; node env, no DOM lib).

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
- `src/catalog.ts` — the `Catalog` (`{ plugins }`) file shape + the pure `parseCatalog` /
  `parseCatalogEntry` / `safeParseCatalog` validator (the PL6 acceptance seam), plus the
  pipeline builders `buildCatalogEntry` (manifest + release facts → a self-validated entry),
  `upsertCatalogEntry` (replace-by-id, id-sorted) and `serializeCatalog` (canonical committed
  bytes). Used by the PL15 pipeline and reusable by the PL16 website.
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

### `plugins/disk-manager/` — Disk Manager (`type: "tool"`, DISK5+)

Full-sidebar plugin that visualizes and reclaims disk space. DISK5 ships the scaffold,
manifest, and the **Visualize** screen; DISK6–DISK8 add Triage, AI-reorg, and the
session-summary/undo-log on top of the navigation model established here. Logic is split
from React so it unit-tests in the shared node/vitest run with no new deps:

- `manifest.json` — `type:"tool"`, `minAtlasApi:1`, permissions
  `disk:read`/`disk:trash`/`disk:evict`/`disk:uninstall-app`/`disk:reorg` (DISK4); validated
  by the SDK's `parseManifest` in `src/__tests__/manifest.test.ts`.
- `src/model.ts` — framework-free: `DiskScope` (Local/iCloud/Both), `buildTreemapNodes` +
  `squarify` layout (area exactly proportional to bytes) from the DISK1 `disk.scan`
  aggregates, `buildVisualizeModel`, the iCloud split (Drive = browsable treemap;
  Photos/Mail = aggregate-size-only, `browsable:false`/`swipeable:false`; Backup = read-only
  figure only if available), plus mocked `disk.*` data + `mockDiskApi()` (no live iCloud).
- `src/navigation.ts` — the locked navigation model as a pure reducer (`reduceDiskManager`):
  Visualize is the persistent shell, Reorg is a header action, a treemap node click sets a
  **scoped** `TriageTarget`, and the summary auto-appears at session end / via the
  running-tally pill.
- `src/Visualize.tsx` — presentational Visualize screen; `src/Panel.tsx` — the shell
  (`useReducer` + async `disk.scan`) with Triage/Reorg/Summary placeholders; `src/index.tsx`
  default-exports the `AtlasPlugin` (`{ manifest, Panel }`) and imports `styles.css`
  (scoped under `.atlas-disk-manager`).
- `src/__tests__/` — manifest validation, treemap/layout/scope model, the reducer wiring,
  and a `react-dom/server` render of the scopes + treemap + distinct iCloud aggregates.

## `scripts/` + `.github/` — catalog pipeline (PL15)

On a plugin release tag `<id>-v<semver>` (e.g. `pomodoro-v1.0.0`; app-style `vX.Y.Z` tags
never match), CI publishes the plugin with zero hosting infra — the same model as the
`OLKoef/atlas-releases` download flow.

- `scripts/lib/release.mjs` — pure conventions: `parseReleaseTag` (`<id>-v<semver>` → id +
  version, dashes in both handled), `pluginZipName`, `releaseAssetUrl` (deterministic GitHub
  Release asset URL), `rawRepoFileUrl` (raw default-branch URL for the catalog icon), and the
  `resolveRepoSlug` / `resolveIconRef` / `resolveTag` env resolvers.
- `scripts/build-catalog.mjs` — the network-free core: validates the plugin's manifest against
  the tag, **packs** the installable files (`entry` bundle from `dist/` + `manifest.json` +
  optional `styles`/`icon`) into `dist-artifacts/<id>-v<version>.zip` via `zip`, computes the
  **sha256**, builds the `CatalogEntry` and **upserts** it into `catalog.json`. Flags:
  `--zip` (use a pre-built archive instead of packing), `--skip-catalog` (pack only),
  `--dry-run` (emit the catalog JSON to stdout, persist nothing), `--github-output`.
- `.github/workflows/release-plugin.yml` — the tag-triggered job: build → pack (`--skip-catalog
  --github-output`) → `gh release create` with the zip → regenerate `catalog.json` on the
  default branch (`--zip` the packed archive) and commit it back, with a fetch-rebase retry to
  absorb concurrent-release push races.

`catalog.json` (repo root) is the committed fetch target — `{ "plugins": [ CatalogEntry… ] }`,
id-sorted, starting empty. Each entry shape is guaranteed to satisfy the SDK's `parseCatalog`
(and therefore Dashboard's PL6 parser), and its `sha256` matches the released zip by
construction.

## Authoring a plugin

```sh
npx create-atlas-plugin my-plugin
cd my-plugin && npm install && npm run build   # -> dist/index.js, React externalized
```

`src/index.tsx` default-exports an `AtlasPlugin` (`{ manifest, Widget?, Panel?, onEnable?,
onDisable? }`); `vite.config.ts` is one line: `defineConfig(defineAtlasPluginConfig())`.
