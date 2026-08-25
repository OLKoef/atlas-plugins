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
│   ├── disk-manager/       # DISK5+ Disk Manager (type:"tool") — Visualize + Triage + AI-reorg + Session-summary screens
│   └── math/               # MATH1+ Math (type:"tool") — tool-tab shell over Graphing (rail + canvas + sliders/trace) / Scientific (tape + REPL + keypad) / Matrix
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
  plugin (`@atlas/plugin-example-widget`, `@atlas/plugin-disk-manager`, `@atlas/plugin-math`)
  to its `dist/index.js`.
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
the build-gate proof. Real marketplace plugins (Disk Manager DISK5+, Math MATH1+) land here
as SDK-authored, Vite-built bundles. A plugin may bundle its own heavyweight dependencies
(Math ships mathjs); only React is ever external.

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

### `plugins/math/` — Math (`type: "tool"`, MATH1+)

Full-sidebar plugin: a Desmos/GeoGebra-inspired suite where **one** plugin hosts three tools
behind topbar tabs. MATH1 ships the scaffold, manifest, and the **tool-tab shell**; MATH2/3
complete Graphing (rail + canvas, then sliders / trace / persistence); MATH4 completes
Scientific (tape + REPL + collapsible keypad); MATH5 Matrix, MATH6 export/insert (needs the
Dashboard-side MATH7 `notes:insert` bridge). Same split as Disk Manager — logic outside React,
so it unit-tests in the shared node/vitest run.

- `manifest.json` — `type:"tool"`, id `math`, `minAtlasApi:1`, permissions `["storage"]`
  (`notes:insert` is added by MATH6); validated by the SDK's `parseManifest` in
  `src/__tests__/manifest.test.ts`.
- `src/lib/shellModel.ts` — the tab strip and the shell reducer. `TOOLS` is the locked
  wireframe order: three `live` tools (Graphing / Scientific / Matrix) plus the `soon` slots
  Geometry and 3D, which render disabled and can never become active (`selectTool` on one is
  a no-op). `reduceMathShell` holds a **per-tool state slice** (`drafts`) so switching tools
  never touches another tool's state, and gates the last-tool restore behind a `restored`
  flag — a `restoreTool` that lands *after* the user clicked a tab is ignored, so storage
  can't yank them back on mount.
- `src/lib/persist.ts` — versioned `storage` (de)serialization of the spec's single JSON blob
  (`{ version, shell, graphing, scientific, matrix }`). MATH1 owns `shell.lastTool`:
  `parseMathState` collects every *other* top-level key into `sections` and
  `serializeMathState` re-emits them verbatim, so `saveLastTool`'s read-modify-write can
  never drop MATH2–MATH5's saved work (and a blob from a newer build survives an older one
  rewriting it). Garbage / absent values degrade to the default tool rather than throwing.
  MATH3 adds the **`graphing` section** — `parseGraphingSection` / `serializeGraphingSection`
  for `{ exprs, sliders, viewport }` (the spec's shape: `src`/`color`/`visible` per row, no
  runtime ids), `graphingSnapshot` for the persistable slice of live state, and
  `loadGraphing` / `saveGraphing` on top of the generic `saveSection` read-modify-write. Every
  field falls back individually (an out-of-palette colour, an inverted slider range, a
  half-written viewport) instead of rejecting the row, and unknown keys *inside* `graphing`
  round-trip the same way the unknown top-level sections do. MATH4 adds the **`scientific`
  section** the same way — `parseScientificSection` / `serializeScientificSection` /
  `scientificSnapshot` / `loadScientific` / `saveScientific` for
  `{ angleMode, keypadCollapsed, tape }`. A tape row is a *record*, so unlike a slider it is
  dropped rather than repaired when half-written, the snapshot omits failed rows (a refusal is
  a response to a line, not history), and both ends trim to `TAPE_LIMIT` so a hand-edited blob
  cannot grow the tape past the live model's bound.
- `src/lib/mathEngine.ts` — the shared **mathjs** instance (bundled into the plugin zip; it
  backs all three tools), hardened at birth with `import` and `createUnit` disabled so a
  persisted expression can't reconfigure mathjs. `previewExpression` is the wireframe's live
  ghost result for an input line: evaluated against a throwaway scope, and silent (`null`)
  for an empty line, a half-typed expression, a free variable, or a blocked call. MATH2 adds
  the spec's `lib/expr.ts` preprocessing + symbol whitelist on top.
- `src/lib/expr.ts` — MATH2, the expression front door: `preprocessExpression` (implicit
  multiplication `2x`→`2*x`, `y =` strip via `stripLeadingY`) and `parseExpression` against an
  explicit whitelist (`ALLOWED_FUNCTIONS`/`ALLOWED_CONSTANTS`, single free variable `x`;
  `import`/`createUnit`/assignments blocked), returning a typed
  `ParsedExpression | ExpressionError` so the rail can mark exactly the broken row.
- `src/lib/graphModel.ts` — MATH2/MATH3, the rail model outside React: `reduceGraph` keeps an
  always-present blank tail row (typing in it appends the next), per-row visibility/color from
  the locked 6-color `GRAPH_PALETTE`, and error isolation — `graphCells` parses per row and
  `plottedCurves` keeps returning the valid curves while a bad row marks only its own cell.
  `DEFAULT_VIEWPORT`/`ZOOM_STEP`/`windowReadout` back the zoom stack + window readout;
  `SUGGESTION_CHIPS` is the empty-state trio. MATH3 folds in the three state slices the tool
  was missing: **sliders** (every text change re-runs the free-symbol sync, so a free constant
  is a plotted parameter rather than a row error), the **`{ rowId, x }` trace pin**, and a
  `hydrate` action gated by a `hydrated` flag — the same "a late restore loses to the user"
  rule the shell's `restored` enforces. `railCells` interleaves slider cells beneath the row
  that first names each constant and numbers both kinds in one gutter sequence;
  `plottedCurves` attaches each curve's `scope` (only the constants it references).
- `src/lib/sliders.ts` — MATH3, the parameter-slider model: `scanFreeSymbols` (rail-wide, in
  first-appearance order; rows that don't parse contribute nothing) plus `syncSliders`, which
  **keeps the value and range of any symbol still referenced**, creates the wireframe's default
  for a new one (−5…5, step 0.1, opening at 1) and drops orphans — so editing a row never
  resets a knob. Also the stepped/clamped `snapToStep` + `valueAtFraction` the track drags
  through, `sliderScope`/`scopeFor` for the sampler, `formatSliderRange` (`−5 ≤ a ≤ 5 · step
  0.1`), the clock-free `advanceSlider` ping-pong one ▷ tick at a time, and `sanitizeSlider`
  for untrusted persisted values.
- `src/lib/trace.ts` — MATH3, the pinned trace: `evaluateCurve` samples the *same* normalized
  string function-plot draws (safe because `lib/expr.ts` whitelists the intersection of the two
  engines' vocabularies), `pickTrace` resolves a click in data space to the nearest curve
  within a tolerance, and `resolveTrace` re-derives the ordinate per render — which is what
  makes the pin ride slider drags and row edits, and simply stop drawing while its row is
  hidden, deleted or unparseable. `formatTraceLabel` is the `(1.571, 2.000)` tooltip.
- `src/lib/plot.ts` — `loadFunctionPlot`, the lazy dynamic-import seam for function-plot
  (bundled into the zip but only loaded when the Graphing canvas first renders).
- `src/lib/eval.ts` — MATH4, the Scientific evaluation model. **DEG is a scope, not engine
  state**: `angleScope('deg')` hands one evaluation degree-flavoured circular functions (the
  hyperbolics carry no angle, so they are deliberately absent), which is what makes a tape row's
  stamped mode true rather than decorative — switching mode cannot retroactively change a
  printed row. `evaluateScientific` runs everything through MATH2's `parseExpression` first
  (`applyCalculatorNames` renames the keypad's `ln`/`log` to mathjs's `log`/`log10` in one pass
  in front of it, so the tape shows what was typed while mathjs evaluates a whitelisted string),
  names an unresolvable symbol instead of throwing, and never mutates the shared engine.
  `ans` binds the previous **value**, so chaining stays exact past the 8-digit display; the tape
  helpers (`makeTapeRow`, `appendTapeRow` with `TAPE_LIMIT`, `hydrateTapeRow`, `ansFromTape`)
  and the ↑/↓ walk (`stepRecall`, which stashes and returns the interrupted line) live here too,
  plus `tapeRowLatex` for the row's TeX action. `previewScientific` is the input line's ghost —
  the same evaluation, silent on failure.
- `src/lib/keypad.ts` — MATH4, the two locked grids as data (`FUNCTION_KEYS` / `NUMBER_KEYS`,
  wireframe order; ↵'s span is CSS's) plus `resolveKey`'s `2nd` inverse layer. Keys insert what
  the user would have typed, glyphs included (`√(`, `×`, `π`) — `lib/expr.ts` folds those — and
  append at the end of the line rather than tracking a caret the text field already owns.
- `src/lib/sciModel.ts` — MATH4, the Scientific reducer: ↵ commits the line under the mode in
  force and makes the result `ans` (a failed line lands on the tape but leaves `ans` alone),
  "Clear history" drops `ans` with the tape, the keypad writes into the same `input`, and
  `hydrate` is gated by `hydrated` — raised by committing / mode-switching / collapsing, but
  **not** by typing, since a draft is not persisted state for a restore to clobber.
- `src/ExpressionRail.tsx` / `src/GraphCanvas.tsx` / `src/Graphing.tsx` — the Graphing
  surfaces: the wireframe's fresh rail (hairline rows, index gutter + swatch, actions on
  hover/selection, inline error message) and the canvas — function-plot draws pan/zoom, unit
  grid and axis labels; the zoom-in/out/reset stack overrides the domains function-plot holds,
  with the window readout + suggestion chips overlaid. MATH3 adds the **slider cell** (▷/‖,
  `a = 2`, range caption, and a real `<input type="range">` under the painted fill/thumb so the
  drag gets keyboard stepping and pointer capture for free) and the **trace overlay** — ours,
  not function-plot's, whose tip follows the pointer where the wireframe pins on click; the
  click hit-tests against the library's own reported pointer position and d3 scales rather than
  a re-derivation of its margins. Slider values reach the sampler as each datum's `scope`, so a
  drag re-samples the same compiled expression instead of rewriting it. `Graphing.tsx` owns the
  three effects around all of it: restore-once, a debounced save (an animating slider must not
  write the blob per frame), and the ▷ interval that dispatches `tickAnimation`.
- `src/Scientific.tsx` / `src/Tape.tsx` / `src/Keypad.tsx` — the Scientific surfaces: the
  wireframe's `.sci-card` (RAD|DEG toggle + "Clear history" head, tape, `›` input row with the
  ghost result and the keyboard toggle, keypad) and, when collapsed, `KeypadHint` — pure-REPL
  mode's footer spelling the same shortcuts out. `Tape.tsx` shows the mode tag only on rows an
  angle function decided, keeps a failed line as a row carrying its reason, and reveals
  copy / copy-as-LaTeX on hover with **insert-into-note disabled** (real action, unbridged until
  MATH6/MATH7 — a disabled control with a reason says that where a missing one looks like a
  gap); the copy confirmation is local component state, so the tool needs no `ui` API. Keypad
  presses `preventDefault` on mousedown so the caret never leaves the input line.
  `Scientific.tsx` owns the reducer plus restore-once, a debounced save, and the scroll-to-newest
  effect, and binds `↵` / `↑` / `↓` / `Esc` **on the input** rather than the document, so the
  plugin never swallows a key the host wanted.
- `src/Topbar.tsx` / `src/ToolPane.tsx` / `src/MathShell.tsx` — the presentational shell
  ported from `MathPluginApproved.html` (`.plugin-topbar`, `.tool-tabs`, `.soon-tag`): ∑ brand
  mark, ARIA tablist, one pane per live tool. **All three panes render on every pass** — the
  inactive ones carry `hidden` rather than unmounting — which is what makes "each tool keeps
  its state while hidden" hold for tool-local state, now cashed in by Graphing's rail (MATH2)
  and Scientific's tape (MATH4); only Matrix still renders the MATH1 placeholder body, until
  MATH5. The topbar's right-hand insert/settings actions are deliberately not rendered yet
  (MATH6/MATH7). `MathShell` also passes `storage` through to the tools that persist their own
  section (MATH3: Graphing, MATH4: Scientific), which stays optional — without the permission
  the tools still work, they just start empty.
- `src/Panel.tsx` — the stateful panel: restores `shell.lastTool` once on mount and writes it
  back on each switch (never before the restore lands, or the default would clobber storage).
  `src/index.tsx` default-exports the `AtlasPlugin` (`{ manifest, Panel }`) and imports
  `styles.css` (scoped under `.atlas-math`, Deep Focus tokens + the 6-color graph palette).
- `src/__tests__/` — manifest validation; the shell reducer (tab inventory, disabled slots are
  inert, and the two acceptance cruxes: every tool's draft survives a full switch round-trip,
  and the last-tool restore applies once but loses to a user pick); tolerant persistence
  (round-trip, unknown-section forward-compat, `saveLastTool` preserving other tools'
  sections); the mathjs preview + engine hardening; a `react-dom/server` render of the shell
  (3 live tabs + 2 disabled "Soon" slots, exactly one active, hidden-not-unmounted panes);
  and `bundle.test.ts`, which asserts the built `dist/index.js` externalizes React while
  bundling mathjs. MATH2 adds `expr.test.ts` (preprocessing rewrites + whitelist blocks),
  `graphModel.test.ts` (blank-tail append-on-type, hide/delete, error isolation,
  viewport zoom/readout), and `graphing.test.tsx` (rendered rail + canvas shell: the error row
  marked, valid curves still plotted, empty-state chips). MATH3 adds `sliders.test.ts`
  (free-symbol scan, default creation, sync keeping dragged values and dropping orphans, step
  snapping, the ▷ ping-pong sweep, and per-field repair of untrusted persisted sliders) and
  `trace.test.ts` (sampling, nearest-curve pick, the pin following a slider drag), extends
  `graphModel.test.ts` with the slider→scope→re-plot path, the trace lifecycle and hydration,
  extends `persist.test.ts` with the `graphing` section (section round-trip, unknown-key
  forward-compat at both levels, and a full state → disk → state round-trip that re-plots
  identically), and extends `graphing.test.tsx` with the rendered slider cell. MATH4 adds
  `eval.test.ts` (the wireframe's own tape rows reproduced; trig in both modes incl. degrees out
  of the inverse functions and non-angular functions left alone; `ans` chaining exact past the
  displayed rounding and refused before the first result; the whitelist still in front of every
  evaluation; the `ln`/`log` rename in one pass; recall walking, stopping and restoring the
  interrupted line; LaTeX golden strings), `sciModel.test.ts` (the two acceptance cruxes — a
  mode switch never rewrites a printed row, and a late restore loses to a committed line but not
  to a half-typed one — plus keypad presses, `2nd` spent by the next key, the tape bound, and
  clear-history taking `ans` with it), `scientific.test.tsx` (the rendered card, DEG active,
  keypad up vs. the collapsed hint, the tag on only the angular row, a failed row with no
  actions, insert-into-note disabled), and extends `persist.test.ts` with the `scientific`
  section (row dropping, mode narrowing, the trim, and a state → disk → state round-trip that
  keeps chaining) and `shell.test.tsx` with the shipped pane.

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
