# Disk Manager

An Atlas marketplace plugin (`type: "tool"`) that surfaces what is using disk space across
**Local**, **iCloud**, or **Both**, then lets you reclaim it. Built against `@atlas/plugin-sdk`.

## Develop

```sh
npm install
npm run build      # Vite library build -> dist/index.js (+ dist/styles.css), React externalized
npm run typecheck
```

## What's here (DISK5)

This ticket ships the plugin scaffold, manifest, and the **Visualize** screen — the
persistent shell of the plugin. Later DISK tickets build Triage (DISK6), AI-reorg
(DISK7), and the Session summary / undo log (DISK8) on top of the navigation model
established here.

- `manifest.json` — `type: "tool"`, `minAtlasApi: 1`, and the DISK4 permissions
  (`disk:read`, `disk:trash`, `disk:evict`, `disk:uninstall-app`, `disk:reorg`).
- `src/model.ts` — framework-free: disk scopes, treemap-node building + a squarified
  layout, the iCloud split (Drive = browsable, Photos/Mail = aggregate-only, Backup =
  read-only figure if available), and mocked `disk.*` data + a mock `DiskApi` for tests
  and offline dev (no live iCloud calls).
- `src/navigation.ts` — the **locked navigation model** as a pure reducer: Visualize is
  the persistent shell, Reorg is a header action, a triage session starts when a treemap
  node is clicked (setting a *scoped* triage target), and the Session summary auto-appears
  at session end and is reachable anytime via the running-tally pill.
- `src/Visualize.tsx` — the presentational Visualize screen (scope selector, treemap +
  legend, iCloud aggregate cards, top reclaim targets, duplicate banner, tally pill).
- `src/Panel.tsx` — the stateful shell that loads `disk.scan` results, holds the
  navigation state, and renders Visualize (Triage / Reorg / Summary are placeholders
  pending DISK6–DISK8).
- `src/index.tsx` — default-exports the `AtlasPlugin` (`{ manifest, Panel }`) and pulls in
  `styles.css`.

React and ReactDOM are **not** bundled — Atlas provides its own instance at runtime via
`window.AtlasPluginRuntime`, wired up by `@atlas/plugin-sdk/vite`. Ship the built `dist/`.
