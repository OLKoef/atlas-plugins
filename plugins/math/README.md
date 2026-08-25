# Math

An Atlas marketplace plugin (`type: "tool"`) — a Desmos/GeoGebra-inspired math suite with
three tools behind one set of topbar tabs: **Graphing**, **Scientific** and **Matrix**.
Geometry and 3D are visible-but-disabled roadmap slots. Built against `@atlas/plugin-sdk`.

## Develop

```sh
npm install
npm run build      # Vite library build -> dist/index.js (+ dist/styles.css)
npm run typecheck
```

## What's here (MATH1)

This ticket ships the plugin scaffold, the manifest, and the **tool-tab shell** — the frame
every later MATH ticket fills in.

- `manifest.json` — `type: "tool"`, id `math`, `minAtlasApi: 1`, permissions `["storage"]`.
  `notes:insert` is added by MATH6, once MATH7 defines it on the Dashboard side.
- `src/lib/shellModel.ts` — the tab strip (3 live tools + 2 disabled "Soon" slots) and the
  shell reducer: switching tools, per-tool state retention, and the last-tool restore
  (including the mount-time race where storage resolves *after* the user clicks a tab).
- `src/lib/persist.ts` — versioned `storage` (de)serialization of the spec's single JSON
  blob. MATH1 owns `shell.lastTool` only and round-trips every other top-level section
  verbatim, so saving the active tool can never drop MATH2–MATH5's saved work.
- `src/lib/mathEngine.ts` — the shared mathjs instance, hardened at birth (`import` and
  `createUnit` disabled), plus the input line's live ghost result. MATH2 layers the spec's
  `lib/expr.ts` preprocessing + symbol whitelist on top.
- `src/Topbar.tsx` / `src/ToolPane.tsx` / `src/MathShell.tsx` — the presentational shell,
  ported from `MathPluginApproved.html`. Every live tool's pane stays **mounted** while
  hidden (`hidden` attribute, not unmount), so tool-local state survives a switch.
- `src/Panel.tsx` — the stateful panel: restores `shell.lastTool` on mount and writes it
  back on every switch.
- `src/index.tsx` — default-exports the `AtlasPlugin` (`{ manifest, Panel }`) and pulls in
  `styles.css`.

The topbar's right-hand actions (insert-into-note / copy-as-LaTeX, plugin settings) are not
rendered yet — the insert action is MATH6/MATH7's `notes:insert` bridge.

## Bundling

**mathjs** is bundled *into the plugin zip* — it is the shared engine behind all three tools.
**function-plot** joins it in MATH2, lazy-loaded with the Graphing tool. React and ReactDOM
are **not** bundled: Atlas provides its own instance at runtime via
`window.AtlasPluginRuntime`, wired up by `@atlas/plugin-sdk/vite`. Ship the built `dist/`.
