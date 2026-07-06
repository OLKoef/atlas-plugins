import { ATLAS_PLUGIN_API_VERSION } from './version.js';

/**
 * Primary surface a plugin declares. `type` is the *primary* surface + catalog tag; a
 * module may still export both `Widget` and `Panel`, in which case the runtime uses both
 * (implementation.md §2 amendment, Habit Tracker spec).
 */
export type PluginType = 'widget' | 'tool' | 'connector';

export const PLUGIN_TYPES: readonly PluginType[] = ['widget', 'tool', 'connector'];

/**
 * Permission vocabulary declared in a manifest. Declared now, enforced later for the
 * built-in trusted tier; the `disk:*` and `ai:chat` permissions are already enforced by
 * the V0.5.1 backend (a visualise-only plugin can never delete). Unknown strings are
 * permitted so the vocabulary can grow additively without breaking older manifests.
 */
export type PluginPermission =
  | 'storage'
  | 'net'
  | 'tasks:read'
  | 'focus:write'
  | 'disk:read'
  | 'disk:trash'
  | 'disk:evict'
  | 'disk:uninstall-app'
  | 'disk:reorg'
  | 'ai:chat'
  // Allow forward-compatible permission strings without losing autocomplete on the known set.
  | (string & {});

export const KNOWN_PERMISSIONS: readonly string[] = [
  'storage',
  'net',
  'tasks:read',
  'focus:write',
  'disk:read',
  'disk:trash',
  'disk:evict',
  'disk:uninstall-app',
  'disk:reorg',
  'ai:chat',
];

/**
 * `manifest.json` shape (v1). Mirrors the Dashboard-side `src/shared/plugins.ts` (PL1);
 * implementation.md is the source of truth for this repo since it cannot read Dashboard's
 * TypeScript directly.
 */
export interface PluginManifest {
  /** unique, kebab-case; namespaces storage + widget ids. */
  id: string;
  name: string;
  /** semver. */
  version: string;
  type: PluginType;
  /** entry bundle filename, relative to the plugin dir (e.g. "index.js"). */
  entry: string;
  /** optional stylesheet filename (e.g. "styles.css"). */
  styles?: string;
  /** integer API-version gate; refused if greater than the host's supported version. */
  minAtlasApi: number;
  description: string;
  /** optional icon filename (e.g. "icon.svg"). */
  icon?: string;
  author: string;
  homepage?: string;
  /** declared permissions (declared now, enforced per the tier). */
  permissions: PluginPermission[];
}

/** Thrown by {@link parseManifest} when a manifest fails validation. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Pragmatic semver: MAJOR.MINOR.PATCH with optional -prerelease and +build.
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ManifestError(`manifest.${key} must be a non-empty string`);
  }
  return v;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ManifestError(`manifest.${key} must be a non-empty string when present`);
  }
  return v;
}

/** Reject path-traversal / absolute paths in bundle-relative filename fields. */
function assertSafeRelativePath(value: string, key: string): void {
  if (value.startsWith('/') || value.includes('..') || value.includes('\\') || value.includes('\0')) {
    throw new ManifestError(`manifest.${key} must be a plain relative filename (no "..", no absolute path)`);
  }
}

/**
 * Validate an untrusted value into a {@link PluginManifest}. Pure and dependency-free
 * (same seam as the Dashboard registry). Throws {@link ManifestError} on any problem.
 */
export function parseManifest(input: unknown): PluginManifest {
  if (!isPlainObject(input)) {
    throw new ManifestError('manifest must be a JSON object');
  }

  const id = requireString(input, 'id');
  if (!ID_RE.test(id) || id.length > 64) {
    throw new ManifestError(`manifest.id must be kebab-case ([a-z0-9] and single dashes), got ${JSON.stringify(id)}`);
  }

  const name = requireString(input, 'name');

  const version = requireString(input, 'version');
  if (!SEMVER_RE.test(version)) {
    throw new ManifestError(`manifest.version must be semver (MAJOR.MINOR.PATCH), got ${JSON.stringify(version)}`);
  }

  const type = requireString(input, 'type');
  if (!PLUGIN_TYPES.includes(type as PluginType)) {
    throw new ManifestError(`manifest.type must be one of ${PLUGIN_TYPES.join(' | ')}, got ${JSON.stringify(type)}`);
  }

  const entry = requireString(input, 'entry');
  assertSafeRelativePath(entry, 'entry');

  const styles = optionalString(input, 'styles');
  if (styles) assertSafeRelativePath(styles, 'styles');
  const icon = optionalString(input, 'icon');
  if (icon) assertSafeRelativePath(icon, 'icon');

  const minAtlasApiRaw = input.minAtlasApi;
  if (typeof minAtlasApiRaw !== 'number' || !Number.isInteger(minAtlasApiRaw) || minAtlasApiRaw < 1) {
    throw new ManifestError('manifest.minAtlasApi must be a positive integer');
  }

  const description = requireString(input, 'description');
  const author = requireString(input, 'author');
  const homepage = optionalString(input, 'homepage');

  const permsRaw = input.permissions;
  if (!Array.isArray(permsRaw) || !permsRaw.every((p) => typeof p === 'string')) {
    throw new ManifestError('manifest.permissions must be an array of strings');
  }

  return {
    id,
    name,
    version,
    type: type as PluginType,
    entry,
    ...(styles ? { styles } : {}),
    minAtlasApi: minAtlasApiRaw,
    description,
    ...(icon ? { icon } : {}),
    author,
    ...(homepage ? { homepage } : {}),
    permissions: permsRaw as PluginPermission[],
  };
}

export type SafeParseResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; error: string };

/** Non-throwing variant of {@link parseManifest}. */
export function safeParseManifest(input: unknown): SafeParseResult {
  try {
    return { ok: true, manifest: parseManifest(input) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * True when a manifest's `minAtlasApi` gate is satisfied by the given host API version
 * (defaults to this SDK's {@link ATLAS_PLUGIN_API_VERSION}).
 */
export function isApiCompatible(
  manifest: Pick<PluginManifest, 'minAtlasApi'>,
  hostApiVersion: number = ATLAS_PLUGIN_API_VERSION,
): boolean {
  return manifest.minAtlasApi <= hostApiVersion;
}

/** True when `value` is one of the SDK's known permission strings. */
export function isKnownPermission(value: string): boolean {
  return KNOWN_PERMISSIONS.includes(value);
}
