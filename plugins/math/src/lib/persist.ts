/**
 * Math — versioned plugin-storage (de)serialization (MATH1).
 *
 * The on-disk shape is the one in the Math spec's data model: a single JSON blob with a
 * `version`, a `shell` section, and one section per tool.
 *
 * ```jsonc
 * { "version": 1,
 *   "shell": { "lastTool": "graphing" },
 *   "graphing": { … }, "scientific": { … }, "matrix": { … } }
 * ```
 *
 * MATH1 only owns `shell.lastTool`. The tool sections belong to MATH2/MATH4/MATH5, so this
 * module round-trips every *other* top-level key verbatim (the spec's "unknown-field
 * tolerance"): writing the shell's last tool must never drop a tool's saved work, and a blob
 * written by a newer plugin build must survive being read and rewritten by an older one.
 */

import type { StorageApi } from '@atlas/plugin-sdk';
import { DEFAULT_TOOL, isLiveTool } from './shellModel';
import type { LiveToolId } from './shellModel';

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
