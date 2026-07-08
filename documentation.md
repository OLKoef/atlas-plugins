# Documentation log

### 2026-07-08 — DISK6: Disk Manager Triage swipe UI

Built the Tinder-style triage screen on top of the DISK5 navigation shell: one reclaim-sorted
card at a time (preview + metadata) with the **locked** three actions — **Delete-left**
(left-arrow → `disk.deleteToTrash`, recoverable), **Evict-middle** (up-arrow → `disk.evict`,
iCloud-downloaded files only; disabled + "Evict (local only)" otherwise), **Keep-right**
(right-arrow, advance only) — wired to the DISK4 `disk.*` mutation API. Apps get the full
uninstaller treatment: their DISK3 leftovers (Application Support/Caches/Preferences) are
surfaced with a confirm gate that keeps Delete disabled until checked (stronger than a plain
swipe); DISK2 duplicates are pre-flagged in-queue; the queue is sorted by reclaim value
(bytes × staleness — largest & least-recently-opened first). Logic (`triageModel.ts`) is split
from the presentational `Triage.tsx` and the `Panel.tsx` `TriageController` so the ordering,
the confirm gate, and each action's `disk.*` mapping unit-test with no new deps. Why: DISK6 is
the reclaim workflow the Visualize treemap clicks into — the first place the plugin actually
mutates disk — and it locks the button order/iconography the design review fixed.
Files: `plugins/disk-manager/src/triageModel.ts`, `src/Triage.tsx`, `src/Panel.tsx`,
`src/styles.css`, `src/__tests__/triage.test.ts`, `src/__tests__/triage.test.tsx`,
`structure.md`, `documentation.md`.

### 2026-07-08 — DISK5: Disk Manager scaffold + manifest + Visualize screen

Added `plugins/disk-manager`, a `type:"tool"` plugin built against the PL2 SDK: a manifest
(`minAtlasApi:1` + the DISK4 `disk:read`/`disk:trash`/`disk:evict`/`disk:uninstall-app`/`disk:reorg`
permissions) and the **Visualize** screen per `DiskManagerApproved.html` — a Local/iCloud/Both
scope selector, a squarified treemap built from the DISK1 `disk.scan` aggregates, the iCloud split
(Drive browsable vs Photos/Mail aggregate-size-only/not-swipeable vs Backup read-only figure), and
a node click that opens a *scoped* triage target. The logic (scopes/treemap/layout in `model.ts`,
the locked navigation model as a reducer in `navigation.ts`) is split from React so it unit-tests
in the existing node/vitest run with no new deps; `Visualize.tsx`/`Panel.tsx` render it, with
Triage/Reorg/Summary left as placeholders for DISK6–DISK8. Why: DISK5 is the first real
marketplace plugin the SDK scaffolds for and establishes the Disk Manager's persistent-shell
navigation the later DISK tickets build on. Wired the root `build` and the vitest `include` to
cover `plugins/**`.
Files: `plugins/disk-manager/**` (manifest, package/tsconfig/vite config, `src/model.ts`,
`src/navigation.ts`, `src/Visualize.tsx`, `src/Panel.tsx`, `src/index.tsx`, `src/styles.css`,
`src/__tests__/*`), `package.json`, `vitest.config.ts`, `structure.md`, `documentation.md`.

### 2026-07-06 — PL15: catalog build/publish pipeline (CI)

Added the release-tag → marketplace-catalog pipeline. The SDK gained a `catalog.ts` module
(`Catalog` shape + `parseCatalog`/`parseCatalogEntry` validator + pure `buildCatalogEntry` /
`upsertCatalogEntry` / `serializeCatalog`), and `scripts/` gained `build-catalog.mjs` (packs
the plugin zip, computes sha256, upserts the entry into `catalog.json`; supports
`--dry-run`/`--skip-catalog`/`--github-output`) plus `lib/release.mjs` (tag parsing + the
deterministic GitHub Release / raw-icon URL conventions). `.github/workflows/release-plugin.yml`
runs it on a `<id>-v<semver>` tag — build, zip, attach to a GitHub Release, then regenerate and
commit `catalog.json` on the default branch. Why: this makes each new plugin just "a folder +
a release tag" and lets Atlas fetch a committed `catalog.json` with no hosting infra, the same
zero-infra model as the app's `atlas-releases` flow; built entries are re-validated so they are
guaranteed to satisfy Dashboard's PL6 `parseCatalog` and their sha256 matches the zip.
Files: `sdk/src/catalog.ts`, `sdk/src/index.ts`, `sdk/src/__tests__/catalog.test.ts`,
`scripts/lib/release.mjs`, `scripts/lib/release.test.mjs`, `scripts/build-catalog.mjs`,
`scripts/build-catalog.test.mjs`, `.github/workflows/release-plugin.yml`, `catalog.json`,
`package.json`, `vitest.config.ts`, `.gitignore`, `structure.md`, `documentation.md`.

### 2026-07-06 — PL2: atlas-plugins monorepo + SDK scaffold

Stood up the real `plugins/<id>/` + `sdk/` layout, replacing the placeholder no-op gate.
Added `@atlas/plugin-sdk` (plugin API types mirroring Dashboard's `shared/plugins.ts`,
`ATLAS_PLUGIN_API_VERSION=1`, a pure `parseManifest` validator, and a
`@atlas/plugin-sdk/vite` library-mode build config that externalizes React to
`window.AtlasPluginRuntime`), the `create-atlas-plugin` scaffolder + template, and a
reference `plugins/example-widget` that builds to a 2.57 kB bundle with no bundled React.
Why: the SDK is now a real consumer (Disk Manager, DISK5+, is the marketplace plugin it
scaffolds for), and this ticket establishes the repo's `npm run build && npm test` gate.
Files: `package.json`, `vitest.config.ts`, `.gitignore`, `sdk/**`, `create-plugin/**`,
`plugins/example-widget/**`, `structure.md`, `documentation.md`, `README.md`.
