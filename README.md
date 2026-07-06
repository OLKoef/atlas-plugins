# atlas-plugins

SDK + individual plugin builds for Atlas's plugin marketplace, distributed independently of
Atlas's own app version (see `../docs/plugins/implementation.md` PL2/PL15, and
`../LOOPING/backlogs/atlas-plugins.md` for the build queue).

An npm workspaces monorepo:

- **`sdk/`** — [`@atlas/plugin-sdk`](./sdk): the typed plugin API (`AtlasPluginApi`,
  `PluginManifest`, `disk.*` / `ai.chat`, `ATLAS_PLUGIN_API_VERSION`) and the
  `@atlas/plugin-sdk/vite` library-mode build config that externalizes React to the host's
  `window.AtlasPluginRuntime`.
- **`create-plugin/`** — [`create-atlas-plugin`](./create-plugin): scaffolder CLI + template.
- **`plugins/<id>/`** — authored / built plugins; `example-widget` is the reference render
  of the scaffold template.

See [`structure.md`](./structure.md) for the full layout and [`documentation.md`](./documentation.md)
for the change log.

## Develop

```sh
npm install
npm run build      # tsc builds the SDK, Vite lib-builds plugins (React externalized)
npm test           # vitest: SDK + scaffolder + React-externalization proof
```

The gate is `npm run build && npm test`.

## Author a plugin

```sh
npx create-atlas-plugin my-plugin
cd my-plugin && npm install && npm run build   # -> dist/index.js (no bundled React)
```
