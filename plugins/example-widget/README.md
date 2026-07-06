# Example Widget

An Atlas marketplace plugin, scaffolded with `create-atlas-plugin`.

## Develop

```sh
npm install
npm run build      # Vite library build -> dist/index.js (React is externalized)
npm run typecheck
```

The build emits `dist/index.js` (ESM). React and ReactDOM are **not** bundled — Atlas
provides its own instance at runtime via `window.AtlasPluginRuntime`, wired up by
`@atlas/plugin-sdk/vite`.

## Structure

- `manifest.json` — plugin id, version, type, permissions (see `PluginManifest`).
- `src/index.tsx` — default-exports an `AtlasPlugin` (`{ manifest, Widget?, Panel?, ... }`).
- `vite.config.ts` — one line: `defineConfig(defineAtlasPluginConfig())`.

Bump `permissions` in `manifest.json` as you use gated APIs (`storage`, `net`, `disk:*`,
`ai:chat`). Ship the built `dist/` as the plugin bundle.
