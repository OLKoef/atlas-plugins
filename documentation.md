# Documentation log

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
