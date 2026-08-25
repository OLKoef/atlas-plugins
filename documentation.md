# Documentation log

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
