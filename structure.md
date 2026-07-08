# atlas-plugins — structure

The SDK + individual plugin builds for Atlas's plugin marketplace. This is a separate npm
workspaces monorepo from the main Atlas app, distributed independently of Atlas's own
version via its own catalog pipeline. Keep this file current with what's built and where.

## Layout

```
atlas-plugins/
├── package.json            # workspace root; the build+test gate lives here
├── vitest.config.ts        # single root Vitest run (SDK + scaffolder + scripts + build proof)
├── catalog.json            # committed marketplace catalog Atlas fetches (PL15 regenerates it; DISK9: disk-manager@1.0.0)
├── sdk/                    # @atlas/plugin-sdk — the typed plugin API + Vite config
├── create-plugin/          # create-atlas-plugin — scaffolder CLI + template
├── plugins/                # authored / built plugins (one dir per plugin id)
│   ├── example-widget/     # reference plugin: the create-plugin template, rendered
│   └── disk-manager/       # DISK5+ Disk Manager (type:"tool") — Visualize + Triage + AI-reorg + Session-summary screens
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
manifest, and the **Visualize** screen; DISK6 adds the **Triage** swipe UI; DISK7 adds the
**AI-reorg review** (propose → tree diff → approve → apply); DISK8 adds the
**Session summary + per-action undo log** on top of the navigation model established here.
Logic is split from React so it unit-tests in the shared node/vitest run with no new deps:

- `manifest.json` — `type:"tool"`, `minAtlasApi:1`, permissions
  `disk:read`/`disk:trash`/`disk:evict`/`disk:uninstall-app`/`disk:reorg` (DISK4) + `ai:chat`
  (DISK7 reorg proposal); validated by the SDK's `parseManifest` in `src/__tests__/manifest.test.ts`.
- `src/model.ts` — framework-free: `DiskScope` (Local/iCloud/Both), `buildTreemapNodes` +
  `squarify` layout (area exactly proportional to bytes) from the DISK1 `disk.scan`
  aggregates, `buildVisualizeModel`, the iCloud split (Drive = browsable treemap;
  Photos/Mail = aggregate-size-only, `browsable:false`/`swipeable:false`; Backup = read-only
  figure only if available), plus mocked `disk.*` data + `mockDiskApi()` (no live iCloud).
- `src/navigation.ts` — the locked navigation model as a pure reducer (`reduceDiskManager`):
  Visualize is the persistent shell, Reorg is a header action, a treemap node click sets a
  **scoped** `TriageTarget`, and the summary auto-appears at session end / via the
  running-tally pill. DISK8 threads the persisted `SessionLog` through the state: `logAction`
  / `undoLogEntry` / `hydrateLog` evolve `log`, and the running-tally `freedBytes` is **derived**
  from it via `sessionFreedBytes`, so undoing one action lowers the tally in step.
- `src/sessionModel.ts` — framework-free session-tracking + per-action undo log (DISK8),
  mirroring Atlas's Claude-Connector activity-log pattern. An immutable `SessionLog` of
  `UndoLogEntry` rows (`recordAction` appends, `undoEntry` flips one `undone`); the running
  tally (`sessionFreedBytes`) and per-kind counts (`sessionCounts`) are **derived** from the
  active (non-undone) entries, so an individual undo drops out of the totals by construction —
  no counter to keep in sync. `triageActionInput` / `reorgActionInput` build entries from
  resolved triage swipes / applied reorgs; `planUndo` + `applyUndo` isolate the sole
  disk-touching undo (a reorg **reverse-move** replayed via `disk.applyReorgPlan` — trash /
  redownload carry no primitive, so the plan surfaces guidance instead, mirroring the
  triage/reorg `resolve*`/`apply*` seam). `serializeSessionLog`/`parseSessionLog` +
  `loadSessionLog`/`saveSessionLog` persist tolerantly through `storage.*` (garbage → a clean
  empty log; `seq` recovered from entry ids so an id is never re-issued).
- `src/triageModel.ts` — framework-free Triage model (DISK6): the **locked** `TRIAGE_ACTIONS`
  (Delete-left / Evict-middle / Keep-right) + `ARROW_ICONS` geometry, `canEvict` (downloaded
  iCloud files only) / `evictLabel`, the reclaim-value ordering (`reclaimValue` =
  bytes × staleness, `sortByReclaimValue` — largest & least-recently-opened first),
  `resolveTriageAction` (swipe → `disk.*` op, with the app **uninstall confirm gate**),
  `applyTriageDecision` (fires `deleteToTrash`/`evict`/`uninstallApp`), plus the mocked demo
  queue + a succeeding `mockTriageDiskApi()`. Named `triageModel.ts` (not `triage.ts`) to
  avoid a case-only clash with `Triage.tsx` on case-insensitive filesystems.
- `src/reorgModel.ts` — framework-free AI-reorg **review-then-approve** model (DISK7):
  `buildReorgPrompt` frames a batch of file metadata for the configured model, `proposeReorg`
  sends it via `ai.chat` (DISK10) and `parseReorgProposal` turns the reply into validated
  moves (tolerant of code fences; drops `..`-traversal / empty / no-op moves into `skipped`);
  the tree-diff review reducer (`buildReorgReview`, `toggleReorgMove`, `setAllReorgMoves`,
  `adjustReorgMove` with the same path guard, `acceptedReorgMoves`); and the **approval gate**
  `resolveReorgApply` (blocks unless `approved:true` **and** ≥1 accepted move) + the sole
  disk-touching `applyReorgDecision` (fires `disk.applyReorgPlan` only when `willApply`). Plus
  the offline mocks (`mockReorgFiles`, `mockReorgProposalJson`, `mockAiReorgApi`,
  `mockUnconfiguredAiApi`). Never auto-applies — mirrors triage's `resolve*`/`apply*` seam.
- `src/Visualize.tsx` / `src/Triage.tsx` / `src/Reorg.tsx` / `src/Summary.tsx` — presentational
  screens; `src/Panel.tsx` — the shell (`useReducer` + async `disk.scan`) whose
  `TriageController` drives the reclaim-sorted queue and logs every resolved swipe, whose
  `ReorgController` batches a proposal via `proposeReorg` on mount, owns the tree-diff review
  state, and applies only the accepted moves through the approval gate (a model rejection
  surfaces as "can't propose right now," not a crash). DISK8: the Panel hydrates the persisted
  log once on mount (`loadSessionLog`) and re-persists it on every change (`saveSessionLog`);
  `Summary.tsx` renders the "freed this session" hero, the five-card action grid (Kept /
  Deleted / Evicted / App removed / Reorganized), and the newest-first undo log (last 20) where
  each row's **Undo** fires `undoLogEntry` immediately (dropping it from the tally) then
  `applyUndo` for the disk reverse. Both Visualize and Triage show the `tally-pill`
  ("Space freed: …", when > 0) that opens the summary anytime without ending the session.
  `src/index.tsx` default-exports the `AtlasPlugin` (`{ manifest, Panel }`) and imports
  `styles.css` (scoped under `.atlas-disk-manager`).
- `src/__tests__/` — manifest validation, treemap/layout/scope model, the reducer wiring, a
  `react-dom/server` render of the scopes + treemap + iCloud aggregates, the Triage logic
  (reclaim ordering, uninstall confirm gate, action→`disk.*` mapping) and its render, plus the
  reorg model (`reorg.test.ts`: parse/guard, `proposeReorg` batching + graceful rejection,
  review reducer, and — the crux — approve-gates-apply / no move fires without approval) and the
  Reorg screen render (`reorg.test.tsx`: tree diff, apply disabled at 0 accepted, loading/error).
  DISK8 adds the session model (`session.test.ts`: record/undo, triage+reorg → entry mapping,
  and — the acceptance crux — the running tally sums active entries while undoing one action
  removes exactly its bytes, per-kind counts drop undone entries, `planUndo`/`applyUndo` fire a
  disk reverse only for reorg, and tolerant persistence round-trips) and the Summary render
  (`session.test.tsx`: hero total, stat grid, per-row Undo, undone rows, empty state).

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
id-sorted. Each entry shape is guaranteed to satisfy the SDK's `parseCatalog` (and therefore
Dashboard's PL6 parser), and its `sha256` matches the released zip by construction.

**DISK9 — Disk Manager v1 published.** `catalog.json` now carries its first real entry,
`disk-manager@1.0.0` (bumped from the 0.1.0 dev version): Disk Manager is PL5/PL15's first real
consumer (both had only been exercised against fixture zips). The entry was generated by the
pipeline itself and committed in the exact canonical bytes `serializeCatalog` emits, so the
`disk-manager-v1.0.0` tag-push regeneration is a no-op diff (asserted by a test), and
`package-lock.json` was synced to include the `plugins/disk-manager` workspace so the release
workflow's `npm ci` resolves it. The catalog + pipeline correctness is gated in
`scripts/build-catalog.test.mjs` (packs the real plugin, asserts the entry is parseCatalog-valid
with a `sha256` matching the packed zip; asserts the committed `catalog.json` is schema-valid and
canonical). Uploading the release asset and the real install / hot-load / update verification
remain the tag-push CI + parked human step, out of this ticket's mechanically-gatable scope.

## Authoring a plugin

```sh
npx create-atlas-plugin my-plugin
cd my-plugin && npm install && npm run build   # -> dist/index.js, React externalized
```

`src/index.tsx` default-exports an `AtlasPlugin` (`{ manifest, Widget?, Panel?, onEnable?,
onDisable? }`); `vite.config.ts` is one line: `defineConfig(defineAtlasPluginConfig())`.
