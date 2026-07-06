# Documentation log

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
