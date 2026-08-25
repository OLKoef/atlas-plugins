# Documentation log

### 2026-08-25 — MATH8: Publish Math v1 to the catalog

Bumped Math to `1.0.0` and published its `catalog.json` entry beside Disk Manager, produced by
the PL15 pipeline itself and committed in the exact canonical bytes `serializeCatalog` emits so
the `math-v1.0.0` tag-push regeneration is a no-op diff; `package-lock.json` was synced to the
bumped workspace version so the release workflow's `npm ci` resolves it. New tests pack the real
plugin and assert the produced entry is `parseCatalog`-valid with a `sha256` matching the packed
zip, that the zip is the complete flat install dir (`index.js` + `manifest.json` + `styles.css`,
no stray chunk — Math is the first published plugin shipping a large bundled dependency), and
that every committed entry sits at the version its plugin manifest declares. Why: this is the
mechanically-gatable half of shipping Math to the marketplace — the tag push itself, the
release-asset upload, and real install/hot-load QA stay CI + the parked human step, same as
DISK9. Files: plugins/math/manifest.json, plugins/math/package.json, catalog.json,
package-lock.json, scripts/build-catalog.test.mjs, structure.md, documentation.md.

### 2026-08-25 — MATH6: Export + insert-into-note

Copy-as-LaTeX and the notes bridge, everywhere the wireframe shows them. The SDK grew the
MATH7 contract first: `NotesApi` (insert LaTeX at the active note's cursor; attach an image
through the notes image pipeline), deliberately **optional** on `AtlasPluginApi` so a host
older than MATH7 is detectable rather than assumed, plus `notes:insert` in the permission
vocabulary and the Math manifest. On the plugin side, `lib/latex.ts` serializes every subject
(expressions, tape rows, the `bmatrix` family for matrix definitions/results/compute entries,
and the whole graph rail) with golden tests pinning the exact strings a note's KaTeX will
render; `lib/exportModel.ts` describes the topbar export menu as per-tool data (subject ×
copy/insert verb) so it renders and gates uniformly; `lib/notes.ts` is the insert seam
(`hasNotesBridge` narrowing the optional `api.notes`, `makeInsertBridge` wrapping the two
calls, toast copy for the success/fallback/failure results); and `lib/snapshot.ts` captures
the plot as a PNG (`inlineCssVars` bakes the computed theme into standalone SVG markup,
`capturePlotPng` rasterizes at 2×, `null` when there is nothing to capture). Insert actions
render on the topbar, tape rows and matrix result cards but stay disabled with an explanatory
title until the host exposes `api.notes` — that is `dashboard.md`'s MATH7; copy actions work
today. Why: export is what connects the Math tools to the notes vault — LaTeX feeds the
editor's KaTeX and snapshots ride the IMG1 image pipeline — and gating on the bridge's
presence lets this ship before the Dashboard side without a version dance. NOTE: the
implementing session self-committed the feature (dc6ea18) then hit `error_max_turns` before
its docs commit; gate re-verified (build clean, 634/634 tests) and this follow-up records the
docs.
Files: sdk/src/api.ts, sdk/src/manifest.ts, sdk/src/index.ts,
sdk/src/__tests__/manifest.test.ts, plugins/math/manifest.json, plugins/math/src/lib/latex.ts,
plugins/math/src/lib/exportModel.ts, plugins/math/src/lib/notes.ts,
plugins/math/src/lib/snapshot.ts, plugins/math/src/lib/eval.ts, plugins/math/src/lib/matrix.ts,
plugins/math/src/Topbar.tsx, plugins/math/src/Panel.tsx, plugins/math/src/Scientific.tsx,
plugins/math/src/Tape.tsx, plugins/math/src/Matrix*.tsx, plugins/math/src/styles.css,
plugins/math/src/__tests__/{latex,exportModel,notes,snapshot}.test.ts + extended suites,
structure.md, documentation.md.

### 2026-08-25 — MATH5: Matrix — named matrices, editor + compute

Filled the third and last v1 pane with the wireframe's Matrix / Matrix · Empty states: a rail of
named matrices (`A, B, C…`), each its own size, a bracketed grid editor whose row/col steppers
resize in place preserving entries, the four quick-op chips (`det / A⁻¹ / Aᵀ / rank`) and a
free-form compute line (`A × B`, `2A + B`, `det(A)`) sharing one result history, and `→ C` to
save a matrix result as the next matrix. `lib/matrix.ts` holds the values and the ops on the
rule that **cells are text and values are numbers** — a cell mid-edit is `''`, and conversion
happens on the way into a computation, which is where a blank cell becomes a named error rather
than a silent zero; the compute line walks the parsed tree with its own evaluator because
mathjs's `math.add` *broadcasts* (a 2 × 3 plus a 1 × 3 comes back a 2 × 3 instead of refusing),
so shapes are checked at every node — which is also what lets a mismatch say which dimensions
disagree, in the inline error treatment borrowed from the graphing rail. `rank` is ours (mathjs
has none): Gaussian elimination with partial pivoting and a magnitude-scaled tolerance, so
neither a matrix of millionths nor one of millions is misjudged; sizes have **no upper cap**
(the grid scrolls) and rectangular m × n is allowed because products need it. `lib/matrixModel.ts`
is the reducer — the chips write their source into the compute line and submit it, so one
history has one code path, and a failed line shows inline and never enters the history — while
`lib/persist.ts` gains the spec's `matrix` section with the same per-field tolerance and
unknown-key round-tripping as `graphing` and `scientific`. Why: Matrix was the last unbuilt v1
tool, so with it the Math plugin's three panes are all real and the shell's "every tool keeps
its state while hidden" promise is finally paid off on all three. Gate: build clean,
581/581 tests.
Files: plugins/math/src/lib/matrix.ts, plugins/math/src/lib/matrixModel.ts,
plugins/math/src/lib/clipboard.ts, plugins/math/src/lib/persist.ts,
plugins/math/src/lib/expr.ts, plugins/math/src/Matrix.tsx, plugins/math/src/MatrixRail.tsx,
plugins/math/src/MatrixEditor.tsx, plugins/math/src/MatrixResults.tsx,
plugins/math/src/MathShell.tsx, plugins/math/src/ToolPane.tsx, plugins/math/src/Panel.tsx,
plugins/math/src/Tape.tsx, plugins/math/src/styles.css,
plugins/math/src/__tests__/matrix.test.ts, plugins/math/src/__tests__/matrixModel.test.ts,
plugins/math/src/__tests__/matrixTool.test.tsx, plugins/math/src/__tests__/persist.test.ts,
plugins/math/src/__tests__/shell.test.tsx, structure.md, documentation.md.

### 2026-08-25 — MATH4: Scientific — tape + REPL + collapsible keypad

Filled the Scientific pane with the wireframe's card. `lib/eval.ts` is the evaluation model:
DEG is a **scope** of degree-flavoured circular functions handed to one evaluation rather than
engine state, so a mode switch can never rewrite a row that is already printed — each row is
stamped with the mode it was computed under and tagged (`deg` / `rad`) only when an angle
function actually decided the answer. `ans` binds the previous *value*, so `1/3` then `ans*3` is
exactly `1` despite the displayed result being rounded; `stepRecall` walks ↑ / ↓ through the tape
and hands back the line the walk interrupted; failed lines stay on the tape (recallable, so a
typo can be fixed) but never reach `ans` or storage. Everything goes through MATH2's
`parseExpression` whitelist before mathjs sees it, with the keypad's `ln` / `log` renamed to
mathjs's `log` / `log10` in one pass in front of that door. `lib/keypad.ts` holds the two locked
grids as data plus the `2nd` inverse layer (spent by the next press); `lib/sciModel.ts` is the
reducer tying tape, input line, mode and collapse together behind a `hydrated` flag — a restore
landing after the user has committed a row loses, while one landing mid-draft does not, since a
draft is not persisted state. `lib/persist.ts` gains the spec's `scientific` section
(`{ angleMode, keypadCollapsed, tape }`) with the same per-field tolerance and unknown-key
round-tripping as `graphing`, both bounded to `TAPE_LIMIT` rows. Tape-row hover reveals copy /
copy-as-LaTeX (mathjs `toTex`, `\sqrt{2} = 1.4142136`); insert-into-note renders disabled with a
reason until MATH6/MATH7 bridge it. Why: Scientific is the second of the three v1 tools, and the
tape + `ans` + DEG/RAD triangle is what makes it a calculator rather than an input box. Gate:
build clean, 498/498 tests.
Files: plugins/math/src/lib/eval.ts, plugins/math/src/lib/keypad.ts,
plugins/math/src/lib/sciModel.ts, plugins/math/src/lib/persist.ts,
plugins/math/src/Scientific.tsx, plugins/math/src/Tape.tsx, plugins/math/src/Keypad.tsx,
plugins/math/src/MathShell.tsx, plugins/math/src/ToolPane.tsx, plugins/math/src/styles.css,
plugins/math/src/__tests__/eval.test.ts, plugins/math/src/__tests__/sciModel.test.ts,
plugins/math/src/__tests__/scientific.test.tsx, plugins/math/src/__tests__/persist.test.ts,
plugins/math/src/__tests__/shell.test.tsx, structure.md, documentation.md.

### 2026-08-25 — MATH3: Graphing — parameter sliders + trace + persistence

Finished the Graphing tool. `lib/sliders.ts` turns a free constant into a knob: `scanFreeSymbols`
walks the rail (MATH2's `parseExpression` already reported `free` for exactly this) and
`syncSliders` reconciles the list on every text change — existing symbols keep the value and
range the user gave them, new ones get the wireframe's default (−5…5, step 0.1, ▷ animate),
orphans are dropped — so a free symbol is no longer a row error and editing a row never resets a
knob. `railCells` places each slider cell beneath the row that first names its constant, numbered
in the same index gutter; values reach function-plot as each datum's `scope`, so a drag re-samples
the same compiled expression rather than rewriting it. `lib/trace.ts` pins a clicked curve as
`{ rowId, x }` only and re-derives the ordinate per render, which is what makes the point ride
slider drags and row edits and stop drawing while its row is hidden/deleted/unparseable; the
overlay is ours because function-plot's own tip follows the pointer where the wireframe pins on
click. `lib/persist.ts` gains the spec's `graphing` section (`{ exprs, sliders, viewport }`)
parsed totally — every field falls back individually, and unknown keys round-trip both at the top
level and inside the section — with restore gated by a `hydrated` flag (a restore landing after
the first keystroke loses, mirroring the shell's `restored`) and saves debounced so an animating
slider doesn't write the blob per frame. Why: sliders and a live trace are what make the tool
feel like Desmos rather than a plotter, and persistence is what makes the work survive closing
the plugin — the last three items on the Graphing feature list. Gate: build clean, 420/420 tests.
Files: plugins/math/src/lib/sliders.ts, plugins/math/src/lib/trace.ts,
plugins/math/src/lib/graphModel.ts, plugins/math/src/lib/persist.ts,
plugins/math/src/ExpressionRail.tsx, plugins/math/src/GraphCanvas.tsx,
plugins/math/src/Graphing.tsx, plugins/math/src/MathShell.tsx, plugins/math/src/Panel.tsx,
plugins/math/src/styles.css, plugins/math/src/__tests__/sliders.test.ts,
plugins/math/src/__tests__/trace.test.ts, plugins/math/src/__tests__/graphModel.test.ts,
plugins/math/src/__tests__/persist.test.ts, plugins/math/src/__tests__/graphing.test.tsx,
structure.md, documentation.md.

### 2026-08-25 — MATH2: Graphing — expression rail + plot canvas

Filled the Graphing pane per the approved wireframe's fresh design. `lib/expr.ts` carries the
superseded graphing-calculator spec's rules forward: `preprocessExpression` (implicit
multiplication `2x`→`2*x`, `y =` strip) and `parseExpression` against an explicit symbol
whitelist (`ALLOWED_FUNCTIONS`/`ALLOWED_CONSTANTS`, single free variable `x`; `import` /
`createUnit` / assignments blocked) returning typed per-row results so the rail can mark exactly
the broken row. `lib/graphModel.ts` is the rail model outside React — `reduceGraph` keeps an
always-present blank tail cell (typing in it appends the next), per-row color from the locked
6-color `GRAPH_PALETTE`, visibility/delete actions, and error isolation (`graphCells` parses per
row; `plottedCurves` keeps returning the valid ones while a bad row marks only itself), with
`DEFAULT_VIEWPORT`/`ZOOM_STEP`/`windowReadout` backing the zoom stack + readout and
`SUGGESTION_CHIPS` the empty state. `lib/plot.ts` is the lazy dynamic-import seam for
function-plot, which draws the canvas (d3 pan/zoom, unit grid, axis labels); `GraphCanvas.tsx`
overrides the domains function-plot holds for zoom-in/out/reset, and `ExpressionRail.tsx`
renders the hairline rows with index gutter + swatch and hover/selection actions. Why: this is
the plugin's flagship surface, and the contract it settles — model outside React, function-plot
behind a lazy seam — is what MATH3's sliders/trace/persistence build directly on. NOTE: the
implementing session hit `error_max_turns`; the loop's salvage step committed the work
gate-green (2d1c736, verified: build clean, 323/323 tests) and this follow-up commit records
the docs.
Files: plugins/math/src/lib/expr.ts, plugins/math/src/lib/graphModel.ts,
plugins/math/src/lib/plot.ts, plugins/math/src/ExpressionRail.tsx,
plugins/math/src/GraphCanvas.tsx, plugins/math/src/Graphing.tsx, plugins/math/src/ToolPane.tsx,
plugins/math/src/MathShell.tsx, plugins/math/src/styles.css,
plugins/math/src/__tests__/expr.test.ts, plugins/math/src/__tests__/graphModel.test.ts,
plugins/math/src/__tests__/graphing.test.tsx, plugins/math/vite.config.ts,
plugins/math/package.json, package-lock.json, structure.md, documentation.md.

### 2026-08-25 — MATH1: Math plugin scaffold + tool-tab shell

Created `plugins/math` against the PL2 SDK — a `type:"tool"` manifest (id `math`,
`minAtlasApi:1`, permissions `["storage"]`; `notes:insert` waits for MATH6/MATH7) and the tool-tab
shell from `MathPluginApproved.html`: the ∑ brand mark plus segmented tabs for the three live
tools (Graphing / Scientific / Matrix) and the disabled Geometry / 3D "Soon" slots. Retention is
structural in two halves — the shell reducer keys state per tool so a switch never touches another
tool's slice, and every live pane stays **mounted** (hidden, not unmounted) so tool-local state
survives once MATH2–MATH5 fill the panes in; the active tool round-trips through `storage` as
`shell.lastTool`, read-modify-written so it can never drop the tool sections later tickets store
beside it, and a restore that resolves after the user already clicked a tab is ignored. mathjs is
bundled into the plugin zip as the shared engine (hardened at birth: `import` and `createUnit`
disabled, drafts evaluated against a throwaway scope) and drives the input line's live ghost
result; React stays external via `@atlas/plugin-sdk/vite`, asserted on the built bundle. Why: MATH1
is the frame every later MATH ticket fills in, so the tab model, the storage contract and the
bundling decision are settled once, here. Files: plugins/math/manifest.json,
plugins/math/package.json, plugins/math/tsconfig.json, plugins/math/vite.config.ts,
plugins/math/.gitignore, plugins/math/README.md, plugins/math/src/lib/shellModel.ts,
plugins/math/src/lib/persist.ts, plugins/math/src/lib/mathEngine.ts, plugins/math/src/Topbar.tsx,
plugins/math/src/ToolPane.tsx, plugins/math/src/MathShell.tsx, plugins/math/src/Panel.tsx,
plugins/math/src/index.tsx, plugins/math/src/styles.css, plugins/math/src/__tests__/*.ts(x),
package.json, package-lock.json, structure.md, documentation.md.

### 2026-07-08 — DISK9: Publish Disk Manager v1 to the catalog

Bumped Disk Manager to `1.0.0` and published its first `catalog.json` entry, making it the first
real consumer of the PL5 `parseCatalog` acceptance seam and the PL15 release pipeline (both had
only been exercised against fixture zips before). The entry was produced by the pipeline itself
and committed in the exact canonical bytes `serializeCatalog` emits, so the `disk-manager-v1.0.0`
tag-push regeneration is a no-op diff; `package-lock.json` was synced to include the
`plugins/disk-manager` workspace so the release workflow's `npm ci` resolves it. New tests pack
the real plugin and assert the produced entry is `parseCatalog`-valid with a `sha256` matching the
packed zip, and that the committed `catalog.json` is schema-valid and canonical. Why: this is the
mechanically-gatable half of shipping Disk Manager to the marketplace — uploading the release
asset and real install/hot-load/update verification stay the tag-push CI + parked human step.
Files: plugins/disk-manager/manifest.json, plugins/disk-manager/package.json, catalog.json,
package-lock.json, scripts/build-catalog.test.mjs, structure.md, documentation.md.

### 2026-07-08 — DISK8: Disk Manager session tracking + per-action undo log

Added the **Session summary + per-action undo log** on top of the DISK5 navigation shell,
mirroring Atlas's Claude-Connector activity-log pattern. New framework-free `sessionModel.ts`
holds an immutable `SessionLog`: `recordAction` appends one `UndoLogEntry` per resolved
keep/delete/evict/uninstall/reorg, and the running "space freed this session" tally
(`sessionFreedBytes`) plus per-kind counts (`sessionCounts`) are **derived** from the active
(non-undone) entries — so `undoEntry` flipping a single row drops it out of the totals by
construction, with no counter to keep in sync. `planUndo`/`applyUndo` isolate the sole
disk-touching undo (a reorg **reverse-move** replayed via `disk.applyReorgPlan`; trash/redownload
have no primitive, so the plan carries the guidance the UI surfaces), and the log persists
tolerantly through `storage.*` (`load`/`saveSessionLog`) so the tally + undo affordance survive a
reload. The `navigation.ts` reducer threads the log (`logAction`/`undoLogEntry`/`hydrateLog`), the
`Panel` hydrates-on-mount + persists-on-change, `Summary.tsx` renders the freed hero / five-card
grid / newest-first undo-log rows with per-row Undo, and a `tally-pill` on Visualize + Triage
opens the summary anytime. Why: the wireframe's session-summary contract is a reachable running
tally where *individual* actions can be reversed, not just recovered from Trash. Files:
plugins/disk-manager/src/sessionModel.ts, plugins/disk-manager/src/Summary.tsx,
plugins/disk-manager/src/navigation.ts, plugins/disk-manager/src/Panel.tsx,
plugins/disk-manager/src/Visualize.tsx, plugins/disk-manager/src/Triage.tsx,
plugins/disk-manager/src/styles.css, plugins/disk-manager/src/__tests__/session.test.ts,
plugins/disk-manager/src/__tests__/session.test.tsx,
plugins/disk-manager/src/__tests__/navigation.test.ts, structure.md, documentation.md.

### 2026-07-08 — DISK7: Disk Manager AI-assisted reorganization

Added the **review-then-approve** AI-reorg flow on top of the DISK5 navigation shell. The
`ReorgController` batches file metadata through the user-configured model via the DISK10
`ai.chat` bridge (`proposeReorg` → `buildReorgPrompt` → `parseReorgProposal`, tolerant of code
fences and guarding against `..`-traversal / empty / no-op moves), then presents the proposal
as a **tree diff** (proposed vs. current) the user reviews — accept/reject each move, Accept-all
/ Reject-all, and adjust a destination inline. Crucially it **never auto-applies**:
`resolveReorgApply` + `applyReorgDecision` are the single seam that touches disk, and they refuse
to call `disk.applyReorgPlan` (DISK3) unless the review is resolved with explicit `approved:true`
**and** ≥1 accepted move — so no move can fire without approval. A model rejection surfaces as
"can't propose right now," not a crash. Added the `ai:chat` permission the proposal needs. Why:
the wireframe's locked AI-reorg contract is that a plan is proposed and reviewed, and the user —
never the model — decides what moves. Files: plugins/disk-manager/src/reorgModel.ts,
plugins/disk-manager/src/Reorg.tsx, plugins/disk-manager/src/Panel.tsx,
plugins/disk-manager/manifest.json, plugins/disk-manager/src/styles.css,
plugins/disk-manager/src/__tests__/manifest.test.ts,
plugins/disk-manager/src/__tests__/reorg.test.ts,
plugins/disk-manager/src/__tests__/reorg.test.tsx, structure.md.

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
