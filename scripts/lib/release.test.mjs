import { describe, it, expect } from 'vitest';
import {
  parseReleaseTag,
  pluginZipName,
  releaseAssetUrl,
  rawRepoFileUrl,
  resolveRepoSlug,
  resolveIconRef,
  resolveTag,
  DEFAULT_REPO_SLUG,
  DEFAULT_ICON_REF,
} from './release.mjs';

describe('parseReleaseTag', () => {
  it('splits <id>-v<semver>', () => {
    expect(parseReleaseTag('pomodoro-v1.0.0')).toEqual({ id: 'pomodoro', version: '1.0.0' });
  });
  it('keeps dashes in the id', () => {
    expect(parseReleaseTag('disk-manager-v1.2.0')).toEqual({ id: 'disk-manager', version: '1.2.0' });
  });
  it('handles a prerelease/build semver (dashes in the version)', () => {
    expect(parseReleaseTag('x-v1.0.0-beta.1')).toEqual({ id: 'x', version: '1.0.0-beta.1' });
    expect(parseReleaseTag('x-v2.3.4-beta.1+build.9')).toEqual({ id: 'x', version: '2.3.4-beta.1+build.9' });
  });
  it.each([
    ['no -v', 'pomodoro-1.0.0'],
    ['empty', ''],
    ['no version', 'pomodoro-v'],
    ['uppercase id', 'Pomodoro-v1.0.0'],
    ['partial semver', 'x-v1.0'],
  ])('rejects %s', (_label, tag) => {
    expect(() => parseReleaseTag(tag)).toThrow();
  });
});

describe('URL + name conventions', () => {
  it('builds the zip asset name', () => {
    expect(pluginZipName('pomodoro', '1.0.0')).toBe('pomodoro-v1.0.0.zip');
  });
  it('builds the release asset URL', () => {
    expect(releaseAssetUrl('OLKoef/atlas-plugins', 'pomodoro-v1.0.0', 'pomodoro-v1.0.0.zip')).toBe(
      'https://github.com/OLKoef/atlas-plugins/releases/download/pomodoro-v1.0.0/pomodoro-v1.0.0.zip',
    );
  });
  it('builds the raw repo file URL for the catalog icon', () => {
    expect(rawRepoFileUrl('OLKoef/atlas-plugins', 'main', 'pomodoro', 'icon.svg')).toBe(
      'https://raw.githubusercontent.com/OLKoef/atlas-plugins/main/plugins/pomodoro/icon.svg',
    );
  });
});

describe('resolvers', () => {
  it('resolveRepoSlug: override > env > default', () => {
    expect(resolveRepoSlug({}, 'a/b')).toBe('a/b');
    expect(resolveRepoSlug({ GITHUB_REPOSITORY: 'c/d' })).toBe('c/d');
    expect(resolveRepoSlug({})).toBe(DEFAULT_REPO_SLUG);
  });
  it('resolveIconRef: override > env > default', () => {
    expect(resolveIconRef({}, 'release')).toBe('release');
    expect(resolveIconRef({ CATALOG_ICON_REF: 'dev' })).toBe('dev');
    expect(resolveIconRef({})).toBe(DEFAULT_ICON_REF);
  });
  it('resolveTag: arg > GITHUB_REF_NAME > GITHUB_REF', () => {
    expect(resolveTag({}, 'a-v1.0.0')).toBe('a-v1.0.0');
    expect(resolveTag({ GITHUB_REF_NAME: 'b-v1.0.0' })).toBe('b-v1.0.0');
    expect(resolveTag({ GITHUB_REF: 'refs/tags/c-v1.0.0' })).toBe('c-v1.0.0');
    expect(() => resolveTag({})).toThrow();
  });
});
