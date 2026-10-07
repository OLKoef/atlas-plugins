import { PLUGIN_TYPES, type PluginManifest, type PluginPermission, type PluginType } from './manifest.js';
import type { CatalogEntry } from './plugin.js';

/**
 * The committed `catalog.json` shape the PL15 pipeline regenerates and Atlas fetches from
 * this repo's default branch (PL6 catalog fetch; same zero-infra model as the
 * `OLKoef/atlas-releases` download flow). Wrapped in an object rather than a bare array so
 * top-level metadata can be added later without breaking older parsers.
 */
export interface Catalog {
  plugins: CatalogEntry[];
}

/** An empty catalog — the initial committed state before any plugin release tag. */
export const EMPTY_CATALOG: Catalog = { plugins: [] };

/** Thrown by {@link parseCatalog} / {@link parseCatalogEntry} on validation failure. */
export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

// Kept self-contained (same style as manifest.ts) so the validator carries no private deps.
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new CatalogError(`catalog entry ${key} must be a non-empty string`);
  }
  return v;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.trim() === '') {
    throw new CatalogError(`catalog entry ${key} must be a non-empty string when present`);
  }
  return v;
}

/** Require an `http(s)://` URL string (icons/zips are fetched over the network). */
function requireHttpUrl(value: string, key: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CatalogError(`catalog entry ${key} must be an absolute URL, got ${JSON.stringify(value)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CatalogError(`catalog entry ${key} must be an http(s) URL, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Validate an untrusted value into a {@link CatalogEntry}. Pure and dependency-free — the
 * same acceptance seam the Dashboard registry applies to fetched catalog rows (PL6). Throws
 * {@link CatalogError} on any problem.
 */
export function parseCatalogEntry(input: unknown): CatalogEntry {
  if (!isPlainObject(input)) {
    throw new CatalogError('catalog entry must be a JSON object');
  }

  const id = requireString(input, 'id');
  if (!ID_RE.test(id) || id.length > 64) {
    throw new CatalogError(`catalog entry id must be kebab-case, got ${JSON.stringify(id)}`);
  }

  const name = requireString(input, 'name');

  const version = requireString(input, 'version');
  if (!SEMVER_RE.test(version)) {
    throw new CatalogError(`catalog entry version must be semver, got ${JSON.stringify(version)}`);
  }

  const type = requireString(input, 'type');
  if (!PLUGIN_TYPES.includes(type as PluginType)) {
    throw new CatalogError(`catalog entry type must be one of ${PLUGIN_TYPES.join(' | ')}, got ${JSON.stringify(type)}`);
  }

  const description = requireString(input, 'description');
  const author = requireString(input, 'author');

  const minAtlasApi = input.minAtlasApi;
  if (typeof minAtlasApi !== 'number' || !Number.isInteger(minAtlasApi) || minAtlasApi < 1) {
    throw new CatalogError('catalog entry minAtlasApi must be a positive integer');
  }

  const permissionsRaw = input.permissions;
  if (
    permissionsRaw !== undefined &&
    (!Array.isArray(permissionsRaw) || !permissionsRaw.every((p) => typeof p === 'string' && p.trim() !== ''))
  ) {
    throw new CatalogError('catalog entry permissions must be an array of non-empty strings');
  }
  const permissions = permissionsRaw as PluginPermission[] | undefined;

  const downloadUrl = requireHttpUrl(requireString(input, 'downloadUrl'), 'downloadUrl');

  const sha256 = requireString(input, 'sha256');
  if (!SHA256_RE.test(sha256)) {
    throw new CatalogError('catalog entry sha256 must be a 64-char lowercase hex digest');
  }

  const icon = optionalString(input, 'icon');
  if (icon) requireHttpUrl(icon, 'icon');
  const homepage = optionalString(input, 'homepage');
  if (homepage) requireHttpUrl(homepage, 'homepage');

  const screenshotsRaw = input.screenshots;
  let screenshots: string[] | undefined;
  if (screenshotsRaw !== undefined) {
    if (!Array.isArray(screenshotsRaw) || !screenshotsRaw.every((s) => typeof s === 'string' && s.trim() !== '')) {
      throw new CatalogError('catalog entry screenshots must be an array of non-empty strings');
    }
    screenshotsRaw.forEach((s, i) => requireHttpUrl(s, `screenshots[${i}]`));
    screenshots = screenshotsRaw as string[];
  }

  return {
    id,
    name,
    version,
    type: type as PluginType,
    description,
    author,
    ...(icon ? { icon } : {}),
    ...(homepage ? { homepage } : {}),
    minAtlasApi,
    ...(permissions ? { permissions: [...permissions] } : {}),
    downloadUrl,
    sha256,
    ...(screenshots ? { screenshots } : {}),
  };
}

/**
 * Validate an untrusted value into a {@link Catalog}: an object with a `plugins` array of
 * valid, id-unique entries. Throws {@link CatalogError} on any problem.
 */
export function parseCatalog(input: unknown): Catalog {
  if (!isPlainObject(input)) {
    throw new CatalogError('catalog must be a JSON object');
  }
  if (!Array.isArray(input.plugins)) {
    throw new CatalogError('catalog.plugins must be an array');
  }
  const plugins = input.plugins.map(parseCatalogEntry);
  const seen = new Set<string>();
  for (const entry of plugins) {
    if (seen.has(entry.id)) {
      throw new CatalogError(`catalog has duplicate entry for id ${JSON.stringify(entry.id)}`);
    }
    seen.add(entry.id);
  }
  return { plugins };
}

export type SafeParseCatalogResult =
  | { ok: true; catalog: Catalog }
  | { ok: false; error: string };

/** Non-throwing variant of {@link parseCatalog}. */
export function safeParseCatalog(input: unknown): SafeParseCatalogResult {
  try {
    return { ok: true, catalog: parseCatalog(input) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Facts the release pipeline resolves for a plugin and feeds into its catalog entry. */
export interface ReleaseFacts {
  /** URL of the release zip asset. */
  downloadUrl: string;
  /** sha256 of the release zip, lowercase hex. */
  sha256: string;
  /** resolved icon URL (from `manifest.icon`), if the plugin ships one. */
  icon?: string;
  /** resolved screenshot URLs, if any. */
  screenshots?: string[];
}

/**
 * Build the {@link CatalogEntry} for a released plugin from its validated manifest and the
 * pipeline-resolved release facts (zip URL + sha256 + icon URL). The result is re-validated
 * through {@link parseCatalogEntry}, so a built entry is guaranteed to satisfy
 * {@link parseCatalog} (the PL15 acceptance criterion).
 */
export function buildCatalogEntry(manifest: PluginManifest, release: ReleaseFacts): CatalogEntry {
  return parseCatalogEntry({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    type: manifest.type,
    description: manifest.description,
    author: manifest.author,
    ...(release.icon ? { icon: release.icon } : {}),
    ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
    minAtlasApi: manifest.minAtlasApi,
    // As declared, in order, so the Plugins page can list them before install (CAT2).
    permissions: manifest.permissions,
    downloadUrl: release.downloadUrl,
    sha256: release.sha256,
    ...(release.screenshots && release.screenshots.length ? { screenshots: release.screenshots } : {}),
  });
}

function byId(a: CatalogEntry, b: CatalogEntry): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Insert or replace an entry by id, returning a new id-sorted catalog (a tag re-release of
 * an existing plugin overwrites its row). Input is left unmutated.
 */
export function upsertCatalogEntry(catalog: Catalog, entry: CatalogEntry): Catalog {
  const parsed = parseCatalogEntry(entry);
  const plugins = catalog.plugins.filter((p) => p.id !== parsed.id).concat(parsed).sort(byId);
  return { plugins };
}

/**
 * Serialize a catalog to the exact bytes the pipeline commits: validated, id-sorted, 2-space
 * indented, trailing newline — so regenerating an unchanged catalog is a no-op diff.
 */
export function serializeCatalog(catalog: Catalog): string {
  const validated = parseCatalog(catalog);
  const sorted: Catalog = { plugins: [...validated.plugins].sort(byId) };
  return JSON.stringify(sorted, null, 2) + '\n';
}
