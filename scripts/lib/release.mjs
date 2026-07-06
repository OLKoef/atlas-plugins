// Pure helpers for the PL15 catalog pipeline: release-tag parsing and the deterministic
// URL/name conventions that tie a tag to its GitHub Release asset and raw repo files.
// No I/O — the file-touching orchestration lives in scripts/build-catalog.mjs.

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Default repo slug, overridden by `GITHUB_REPOSITORY` in CI. Mirrors OLKoef/atlas-releases. */
export const DEFAULT_REPO_SLUG = 'OLKoef/atlas-plugins';
/** Branch the committed catalog.json + icons are served from (Atlas fetches raw from here). */
export const DEFAULT_ICON_REF = 'main';

/**
 * Split a release tag `<id>-v<semver>` into its plugin id and version. `id` is kebab-case and
 * may contain dashes; the `-v` before a valid semver is the anchor. Throws on a malformed tag.
 *
 *   parseReleaseTag('pomodoro-v1.0.0')       -> { id: 'pomodoro',     version: '1.0.0' }
 *   parseReleaseTag('disk-manager-v1.2.0')   -> { id: 'disk-manager', version: '1.2.0' }
 *   parseReleaseTag('x-v1.0.0-beta.1')       -> { id: 'x',            version: '1.0.0-beta.1' }
 */
export function parseReleaseTag(tag) {
  if (typeof tag !== 'string' || tag.trim() === '') {
    throw new Error('release tag must be a non-empty string');
  }
  // Try every `-v` boundary from the right; accept the first split whose halves are a valid
  // id and semver. Right-to-left so a version-internal `-v...` never wins over the real one.
  for (let i = tag.lastIndexOf('-v'); i >= 0; i = tag.lastIndexOf('-v', i - 1)) {
    const id = tag.slice(0, i);
    const version = tag.slice(i + 2);
    if (ID_RE.test(id) && id.length <= 64 && SEMVER_RE.test(version)) {
      return { id, version };
    }
  }
  throw new Error(`release tag ${JSON.stringify(tag)} must look like "<id>-v<semver>" (e.g. pomodoro-v1.0.0)`);
}

/** The zip asset filename for a release: `<id>-v<version>.zip` (equals `<tag>.zip`). */
export function pluginZipName(id, version) {
  return `${id}-v${version}.zip`;
}

/** The GitHub Release asset download URL — deterministic from the tag + asset name. */
export function releaseAssetUrl(repoSlug, tag, assetName) {
  return `https://github.com/${repoSlug}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

/**
 * Raw URL for a plugin file committed under `plugins/<id>/` on the given ref. Used for the
 * catalog icon URL, which must be fetchable before install (the zip isn't unpacked yet).
 */
export function rawRepoFileUrl(repoSlug, ref, id, file) {
  return `https://raw.githubusercontent.com/${repoSlug}/${ref}/plugins/${id}/${file}`;
}

/** Resolve the repo slug from an explicit override, then `GITHUB_REPOSITORY`, then the default. */
export function resolveRepoSlug(env = {}, override) {
  return override || env.GITHUB_REPOSITORY || DEFAULT_REPO_SLUG;
}

/** Resolve the icon/default-branch ref from an override, then env, then the default. */
export function resolveIconRef(env = {}, override) {
  return override || env.CATALOG_ICON_REF || DEFAULT_ICON_REF;
}

/**
 * Resolve the release tag from an explicit arg, then GitHub Actions' `GITHUB_REF_NAME`, then
 * `GITHUB_REF` (`refs/tags/<tag>`). Throws if none is set.
 */
export function resolveTag(env = {}, override) {
  if (override) return override;
  if (env.GITHUB_REF_NAME) return env.GITHUB_REF_NAME;
  if (typeof env.GITHUB_REF === 'string' && env.GITHUB_REF.startsWith('refs/tags/')) {
    return env.GITHUB_REF.slice('refs/tags/'.length);
  }
  throw new Error('no release tag: pass --tag, or set GITHUB_REF_NAME / GITHUB_REF');
}
