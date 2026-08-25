/**
 * Math — versioned plugin-storage (de)serialization (MATH1, extended by MATH3 / MATH4).
 *
 * The on-disk shape is the one in the Math spec's data model: a single JSON blob with a
 * `version`, a `shell` section, and one section per tool.
 *
 * ```jsonc
 * { "version": 1,
 *   "shell": { "lastTool": "graphing" },
 *   "graphing": { "exprs": [ { "src": "a·sin(x)", "color": "blue", "visible": true } ],
 *     "sliders": [ { "symbol": "a", "value": 2, "min": -5, "max": 5, "step": 0.1 } ],
 *     "viewport": { "xDomain": [-6.7, 6.7], "yDomain": [-4.9, 4.9] } },
 *   "scientific": { "angleMode": "deg", "keypadCollapsed": false,
 *     "tape": [ { "src": "sin(45)", "result": "0.7071068", "angleMode": "deg" } ] },
 *   "matrix": { … } }
 * ```
 *
 * MATH1 owns `shell.lastTool`; MATH3 owns `graphing`; MATH4 owns `scientific`. The remaining
 * tool section belongs to MATH5, so this module round-trips every *other* top-level key
 * verbatim (the spec's "unknown-field tolerance") — and does the same for unknown keys
 * *inside* the sections it does own. Writing one section must never drop another's saved
 * work, and a blob written by a newer plugin build must survive being read and rewritten by
 * an older one.
 *
 * Nothing here trusts what it reads: the blob is user-editable JSON on disk, so every parse
 * is total (never throws, always lands on a usable value) and every expression it restores
 * still goes through `lib/expr.ts`'s whitelist before anything evaluates it.
 */

import type { StorageApi } from '@atlas/plugin-sdk';
import { DEFAULT_TOOL, isLiveTool } from './shellModel';
import type { LiveToolId } from './shellModel';
import { DEFAULT_VIEWPORT, isGraphColor } from './graphModel';
import type { GraphColorName, GraphState, GraphViewport } from './graphModel';
import { sanitizeSlider } from './sliders';
import type { SliderState } from './sliders';
import { DEFAULT_ANGLE_MODE, TAPE_LIMIT, isAngleMode } from './eval';
import type { AngleMode } from './eval';
import type { SciState } from './sciModel';

/** Key inside the plugin's own namespace — Atlas prefixes it with the plugin id. */
export const MATH_STATE_KEY = 'state';

/** Schema version this build writes. */
export const MATH_STATE_VERSION = 1;

export interface PersistedShell {
  lastTool: LiveToolId;
}

export interface PersistedMathState {
  /** the version found on disk (kept as-is, so a newer blob is never downgraded). */
  version: number;
  shell: PersistedShell;
  /**
   * Every top-level section other than `version` / `shell` — the per-tool state written by
   * MATH2–MATH5. Opaque to MATH1 and re-emitted untouched by {@link serializeMathState}.
   */
  sections: Record<string, unknown>;
}

export const emptyMathState: PersistedMathState = {
  version: MATH_STATE_VERSION,
  shell: { lastTool: DEFAULT_TOOL },
  sections: {},
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse an untrusted persisted blob. Never throws: an absent, malformed, or partially
 * written value degrades to {@link emptyMathState} rather than blocking the plugin's mount.
 */
export function parseMathState(raw: unknown): PersistedMathState {
  if (!isPlainObject(raw)) return emptyMathState;

  const shellRaw = isPlainObject(raw.shell) ? raw.shell : {};
  const lastTool = isLiveTool(shellRaw.lastTool) ? shellRaw.lastTool : DEFAULT_TOOL;

  const version =
    typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version >= 1
      ? raw.version
      : MATH_STATE_VERSION;

  const sections: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'version' || key === 'shell') continue;
    sections[key] = value;
  }

  return { version, shell: { lastTool }, sections };
}

/** Flatten back to the on-disk shape, tool sections first so `version`/`shell` always win. */
export function serializeMathState(state: PersistedMathState): Record<string, unknown> {
  return {
    ...state.sections,
    version: state.version,
    shell: { lastTool: state.shell.lastTool },
  };
}

/** Read + parse the persisted blob (tolerant of an absent / bad value). */
export async function loadMathState(
  storage: Pick<StorageApi, 'get'>,
): Promise<PersistedMathState> {
  const raw = await storage.get<unknown>(MATH_STATE_KEY);
  return parseMathState(raw);
}

/**
 * Persist `shell.lastTool` as a read-modify-write, so saving the active tool preserves the
 * tool sections MATH2–MATH5 store beside it.
 */
export async function saveLastTool(
  storage: Pick<StorageApi, 'get' | 'set'>,
  tool: LiveToolId,
): Promise<void> {
  const current = await loadMathState(storage);
  if (current.shell.lastTool === tool) return;
  await storage.set(
    MATH_STATE_KEY,
    serializeMathState({ ...current, shell: { lastTool: tool } }),
  );
}

/** Write one tool section, read-modify-write, leaving every other section untouched. */
export async function saveSection(
  storage: Pick<StorageApi, 'get' | 'set'>,
  name: string,
  value: Record<string, unknown>,
): Promise<void> {
  const current = await loadMathState(storage);
  await storage.set(
    MATH_STATE_KEY,
    serializeMathState({ ...current, sections: { ...current.sections, [name]: value } }),
  );
}

/* ------------------------------------------------------------------ *
 * The `graphing` section (MATH3)
 * ------------------------------------------------------------------ */

export const GRAPHING_SECTION = 'graphing';

/** One saved expression row. Ids are runtime-only, so only the authored text is stored. */
export interface PersistedExpr {
  src: string;
  color: GraphColorName;
  visible: boolean;
}

export interface PersistedGraphing {
  exprs: PersistedExpr[];
  sliders: SliderState[];
  viewport: GraphViewport;
  /** keys inside `graphing` this build does not know — re-emitted untouched. */
  extra: Record<string, unknown>;
}

export const emptyGraphing: PersistedGraphing = {
  exprs: [],
  sliders: [],
  viewport: DEFAULT_VIEWPORT,
  extra: {},
};

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A `[lo, hi]` bound pair, or null when it is missing / degenerate / out of order. */
function parseDomain(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const lo = finiteNumber(raw[0]);
  const hi = finiteNumber(raw[1]);
  if (lo === null || hi === null || !(hi > lo)) return null;
  return [lo, hi];
}

function parseViewport(raw: unknown): GraphViewport {
  if (!isPlainObject(raw)) return DEFAULT_VIEWPORT;
  const xDomain = parseDomain(raw.xDomain);
  const yDomain = parseDomain(raw.yDomain);
  // Half a window is not a window — fall back whole rather than mixing a saved axis with a
  // default one, which would silently distort the aspect the user left the graph at.
  if (!xDomain || !yDomain) return DEFAULT_VIEWPORT;
  return { xDomain, yDomain };
}

function parseExprs(raw: unknown): PersistedExpr[] {
  if (!Array.isArray(raw)) return [];
  const exprs: PersistedExpr[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry) || typeof entry.src !== 'string') continue;
    if (entry.src.trim() === '') continue; // the blank tail is structural, never stored
    exprs.push({
      src: entry.src,
      color: isGraphColor(entry.color) ? entry.color : 'blue',
      visible: entry.visible !== false,
    });
  }
  return exprs;
}

function parseSliders(raw: unknown): SliderState[] {
  if (!Array.isArray(raw)) return [];
  const sliders: SliderState[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isPlainObject(entry) || typeof entry.symbol !== 'string' || entry.symbol === '') continue;
    if (seen.has(entry.symbol)) continue;
    seen.add(entry.symbol);
    sliders.push(sanitizeSlider(entry.symbol, entry));
  }
  return sliders;
}

/** Parse the `graphing` section out of an untrusted blob. Never throws. */
export function parseGraphingSection(raw: unknown): PersistedGraphing {
  if (!isPlainObject(raw)) return emptyGraphing;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'exprs' || key === 'sliders' || key === 'viewport') continue;
    extra[key] = value;
  }
  return {
    exprs: parseExprs(raw.exprs),
    sliders: parseSliders(raw.sliders),
    viewport: parseViewport(raw.viewport),
    extra,
  };
}

/** Flatten back to the on-disk section shape, unknown keys first so ours always win. */
export function serializeGraphingSection(state: PersistedGraphing): Record<string, unknown> {
  return {
    ...state.extra,
    exprs: state.exprs.map((expr) => ({ ...expr })),
    sliders: state.sliders.map((slider) => ({ ...slider })),
    viewport: {
      xDomain: [state.viewport.xDomain[0], state.viewport.xDomain[1]],
      yDomain: [state.viewport.yDomain[0], state.viewport.yDomain[1]],
    },
  };
}

/**
 * The persistable slice of the live graph state: the authored rows (minus the structural
 * blank tail), the sliders with their current values, and the window.
 */
export function graphingSnapshot(
  state: Pick<GraphState, 'rows' | 'sliders' | 'viewport'>,
  extra: Record<string, unknown> = {},
): PersistedGraphing {
  return {
    exprs: state.rows
      .filter((row) => row.src.trim() !== '')
      .map((row) => ({ src: row.src, color: row.color, visible: row.visible })),
    sliders: state.sliders.map((slider) => ({ ...slider })),
    viewport: state.viewport,
    extra,
  };
}

/** Read + parse the `graphing` section (tolerant of an absent / bad value). */
export async function loadGraphing(
  storage: Pick<StorageApi, 'get'>,
): Promise<PersistedGraphing> {
  const state = await loadMathState(storage);
  return parseGraphingSection(state.sections[GRAPHING_SECTION]);
}

/** Persist the `graphing` section without disturbing the shell or the other tools. */
export async function saveGraphing(
  storage: Pick<StorageApi, 'get' | 'set'>,
  graphing: PersistedGraphing,
): Promise<void> {
  await saveSection(storage, GRAPHING_SECTION, serializeGraphingSection(graphing));
}

/* ------------------------------------------------------------------ *
 * The `scientific` section (MATH4)
 * ------------------------------------------------------------------ */

export const SCIENTIFIC_SECTION = 'scientific';

/** One saved tape row — the spec's `{ src, result, angleMode }`, no runtime id. */
export interface PersistedTapeRow {
  src: string;
  result: string;
  angleMode: AngleMode;
}

export interface PersistedScientific {
  angleMode: AngleMode;
  keypadCollapsed: boolean;
  tape: PersistedTapeRow[];
  /** keys inside `scientific` this build does not know — re-emitted untouched. */
  extra: Record<string, unknown>;
}

export const emptyScientific: PersistedScientific = {
  angleMode: DEFAULT_ANGLE_MODE,
  keypadCollapsed: false,
  tape: [],
  extra: {},
};

/**
 * Rows are dropped, never repaired: a row is a *record* of an evaluation, so a half-written
 * one has nothing to fall back to (unlike a slider, whose range can be defaulted). The tape
 * is trimmed to the newest {@link TAPE_LIMIT} rows on the way in as well as on the way out,
 * so a hand-edited blob cannot grow the tape past the bound the live model keeps.
 */
function parseTape(raw: unknown): PersistedTapeRow[] {
  if (!Array.isArray(raw)) return [];
  const tape: PersistedTapeRow[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.src !== 'string' || typeof entry.result !== 'string') continue;
    if (entry.src.trim() === '') continue;
    tape.push({
      src: entry.src,
      result: entry.result,
      angleMode: isAngleMode(entry.angleMode) ? entry.angleMode : DEFAULT_ANGLE_MODE,
    });
  }
  return tape.length > TAPE_LIMIT ? tape.slice(tape.length - TAPE_LIMIT) : tape;
}

/** Parse the `scientific` section out of an untrusted blob. Never throws. */
export function parseScientificSection(raw: unknown): PersistedScientific {
  if (!isPlainObject(raw)) return emptyScientific;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'angleMode' || key === 'keypadCollapsed' || key === 'tape') continue;
    extra[key] = value;
  }
  return {
    angleMode: isAngleMode(raw.angleMode) ? raw.angleMode : DEFAULT_ANGLE_MODE,
    keypadCollapsed: raw.keypadCollapsed === true,
    tape: parseTape(raw.tape),
    extra,
  };
}

/** Flatten back to the on-disk section shape, unknown keys first so ours always win. */
export function serializeScientificSection(
  state: PersistedScientific,
): Record<string, unknown> {
  return {
    ...state.extra,
    angleMode: state.angleMode,
    keypadCollapsed: state.keypadCollapsed,
    tape: state.tape.map((row) => ({ ...row })),
  };
}

/**
 * The persistable slice of the live Scientific state: the mode, the keypad's collapse, and
 * the tape's **successful** rows. A failed row is a response to a line, not a computation —
 * restoring "Unknown function “sec”" as history would be noise, and it is also what keeps
 * the restored `ans` unambiguous (see `ansFromTape`).
 */
export function scientificSnapshot(
  state: Pick<SciState, 'tape' | 'angleMode' | 'keypadCollapsed'>,
  extra: Record<string, unknown> = {},
): PersistedScientific {
  return {
    angleMode: state.angleMode,
    keypadCollapsed: state.keypadCollapsed,
    tape: state.tape
      .filter((row) => !row.failed)
      .map((row) => ({ src: row.src, result: row.result, angleMode: row.angleMode })),
    extra,
  };
}

/** Read + parse the `scientific` section (tolerant of an absent / bad value). */
export async function loadScientific(
  storage: Pick<StorageApi, 'get'>,
): Promise<PersistedScientific> {
  const state = await loadMathState(storage);
  return parseScientificSection(state.sections[SCIENTIFIC_SECTION]);
}

/** Persist the `scientific` section without disturbing the shell or the other tools. */
export async function saveScientific(
  storage: Pick<StorageApi, 'get' | 'set'>,
  scientific: PersistedScientific,
): Promise<void> {
  await saveSection(storage, SCIENTIFIC_SECTION, serializeScientificSection(scientific));
}
