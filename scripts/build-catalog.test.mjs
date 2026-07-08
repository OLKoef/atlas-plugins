import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCatalog, parseCatalogEntry, serializeCatalog } from '@atlas/plugin-sdk';
import { releaseAssetUrl } from './lib/release.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(repoRoot, 'scripts', 'build-catalog.mjs');
const REPO = 'OLKoef/atlas-plugins';

const tmpDirs = [];
async function tmpRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-catalog-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of tmpDirs) await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(path.join(repoRoot, 'dist-artifacts'), { recursive: true, force: true });
});

// The script imports the built SDK (@atlas/plugin-sdk -> sdk/dist) and the packing tests need
// the plugins' dist bundles. Build whatever is absent so the suite is self-contained even when
// run without the full gate's prior `npm run build`.
beforeAll(() => {
  if (!existsSync(path.join(repoRoot, 'sdk', 'dist', 'index.js'))) {
    execFileSync('npm', ['run', 'build:sdk'], { cwd: repoRoot, stdio: 'inherit' });
  }
  if (!existsSync(path.join(repoRoot, 'plugins', 'disk-manager', 'dist', 'index.js'))) {
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  }
}, 180_000);

/** Run the CLI, returning { stdout, status }. Never throws on non-zero exit. */
function run(args) {
  try {
    const stdout = execFileSync('node', [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, GITHUB_OUTPUT: '' },
      encoding: 'utf8',
    });
    return { stdout, status: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', status: err.status ?? 1 };
  }
}

const hasZip = (() => {
  try {
    execFileSync('zip', ['-h'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('build-catalog.mjs — dry run over a supplied zip (deterministic)', () => {
  it('emits a parseCatalog-valid entry whose sha256 matches the zip', async () => {
    const dir = await tmpRoot();
    const zip = path.join(dir, 'example-widget-v0.1.0.zip');
    await fs.writeFile(zip, 'pretend-zip-bytes\n');
    const expectedSha = createHash('sha256').update(await fs.readFile(zip)).digest('hex');

    const { stdout, status } = run([
      '--tag', 'example-widget-v0.1.0',
      '--zip', zip,
      '--repo', REPO,
      '--dry-run',
    ]);
    expect(status).toBe(0);

    const catalog = parseCatalog(JSON.parse(stdout)); // AC: schema accepted by parseCatalog
    const entry = catalog.plugins.find((p) => p.id === 'example-widget');
    expect(entry).toBeDefined();
    expect(entry.sha256).toBe(expectedSha); // AC: sha256 matches the zip
    expect(entry.version).toBe('0.1.0');
    expect(entry.type).toBe('widget');
    expect(entry.minAtlasApi).toBe(1);
    expect(entry.downloadUrl).toBe(
      releaseAssetUrl(REPO, 'example-widget-v0.1.0', 'example-widget-v0.1.0.zip'),
    );
    // Dry run must not touch the committed catalog.
    expect(existsSync(path.join(repoRoot, 'dist-artifacts'))).toBe(false);
  });

  it('fails when the tag version disagrees with the manifest', async () => {
    const dir = await tmpRoot();
    const zip = path.join(dir, 'x.zip');
    await fs.writeFile(zip, 'x');
    const { status } = run(['--tag', 'example-widget-v9.9.9', '--zip', zip, '--repo', REPO, '--dry-run']);
    expect(status).toBe(1);
  });

  it('fails on an unknown plugin id', async () => {
    const dir = await tmpRoot();
    const zip = path.join(dir, 'x.zip');
    await fs.writeFile(zip, 'x');
    const { status } = run(['--tag', 'no-such-plugin-v1.0.0', '--zip', zip, '--repo', REPO, '--dry-run']);
    expect(status).toBe(1);
  });
});

describe('build-catalog.mjs — packing (real zip)', () => {
  it.skipIf(!hasZip)('packs the plugin and the entry sha256 matches the produced zip', async () => {
    // --skip-catalog --dry-run packs into dist-artifacts and prints the entry JSON.
    const { stdout, status } = run([
      '--tag', 'example-widget-v0.1.0',
      '--repo', REPO,
      '--skip-catalog',
      '--dry-run',
    ]);
    expect(status).toBe(0);
    const entry = JSON.parse(stdout);
    expect(entry.id).toBe('example-widget');

    const zipPath = path.join(repoRoot, 'dist-artifacts', 'example-widget-v0.1.0.zip');
    expect(existsSync(zipPath)).toBe(true);
    const zipSha = createHash('sha256').update(await fs.readFile(zipPath)).digest('hex');
    expect(entry.sha256).toBe(zipSha);
  });
});

describe('build-catalog.mjs — Disk Manager v1 publish (DISK9)', () => {
  // Disk Manager is PL5's first *real* catalog consumer (PL5 shipped tested only against
  // fixture zips). This packs the actual built plugin and asserts the produced entry is the
  // shape parseCatalog accepts, with a sha256 that matches the very zip that was packed.
  it.skipIf(!hasZip)('packs disk-manager@1.0.0 into a parseCatalog-valid entry whose sha256 matches the zip', async () => {
    const { stdout, status } = run([
      '--tag', 'disk-manager-v1.0.0',
      '--repo', REPO,
      '--skip-catalog',
      '--dry-run',
    ]);
    expect(status).toBe(0);

    const entry = parseCatalogEntry(JSON.parse(stdout)); // AC: schema accepted by parseCatalog
    expect(entry.id).toBe('disk-manager');
    expect(entry.name).toBe('Disk Manager');
    expect(entry.version).toBe('1.0.0');
    expect(entry.type).toBe('tool');
    expect(entry.minAtlasApi).toBe(1);
    expect(entry.downloadUrl).toBe(
      releaseAssetUrl(REPO, 'disk-manager-v1.0.0', 'disk-manager-v1.0.0.zip'),
    );

    const zipPath = path.join(repoRoot, 'dist-artifacts', 'disk-manager-v1.0.0.zip');
    expect(existsSync(zipPath)).toBe(true);
    const zipSha = createHash('sha256').update(await fs.readFile(zipPath)).digest('hex');
    expect(entry.sha256).toBe(zipSha); // AC: sha256 matches the published zip
  });

  it('rejects a disk-manager tag whose version disagrees with the bumped manifest', async () => {
    const dir = await tmpRoot();
    const zip = path.join(dir, 'disk-manager-v0.1.0.zip');
    await fs.writeFile(zip, 'stale');
    const { status } = run(['--tag', 'disk-manager-v0.1.0', '--zip', zip, '--repo', REPO, '--dry-run']);
    expect(status).toBe(1);
  });
});

describe('catalog.json — committed fetch target (DISK9)', () => {
  let raw;
  let catalog;
  beforeAll(async () => {
    raw = await fs.readFile(path.join(repoRoot, 'catalog.json'), 'utf8');
    catalog = parseCatalog(JSON.parse(raw)); // must satisfy the SDK/Dashboard parser
  });

  it('publishes a schema-valid disk-manager@1.0.0 entry', () => {
    const entry = catalog.plugins.find((p) => p.id === 'disk-manager');
    expect(entry).toBeDefined();
    expect(entry.name).toBe('Disk Manager');
    expect(entry.version).toBe('1.0.0');
    expect(entry.type).toBe('tool');
    expect(entry.minAtlasApi).toBe(1);
    expect(entry.downloadUrl).toBe(
      releaseAssetUrl(REPO, 'disk-manager-v1.0.0', 'disk-manager-v1.0.0.zip'),
    );
    expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/); // a real digest, not a placeholder
  });

  it('is already in the pipeline\'s canonical form (tag-push regeneration is a no-op diff)', () => {
    expect(raw).toBe(serializeCatalog(catalog));
  });
});

describe('build-catalog.mjs — catalog write + upsert', () => {
  it('writes a valid catalog file and re-running is idempotent', async () => {
    const dir = await tmpRoot();
    const zip = path.join(dir, 'example-widget-v0.1.0.zip');
    await fs.writeFile(zip, 'zip-bytes');
    const out = path.join(dir, 'catalog.json');

    const first = run(['--tag', 'example-widget-v0.1.0', '--zip', zip, '--repo', REPO, '--out', out]);
    expect(first.status).toBe(0);
    const afterFirst = await fs.readFile(out, 'utf8');
    expect(parseCatalog(JSON.parse(afterFirst)).plugins).toHaveLength(1);

    const second = run(['--tag', 'example-widget-v0.1.0', '--zip', zip, '--repo', REPO, '--out', out]);
    expect(second.status).toBe(0);
    expect(await fs.readFile(out, 'utf8')).toBe(afterFirst); // no spurious diff
  });

  it('upserts alongside an existing entry, keeping the list id-sorted', async () => {
    const dir = await tmpRoot();
    const zip = path.join(dir, 'example-widget-v0.1.0.zip');
    await fs.writeFile(zip, 'zip-bytes');
    const out = path.join(dir, 'catalog.json');
    await fs.writeFile(
      out,
      JSON.stringify({
        plugins: [
          {
            id: 'zzz-other',
            name: 'Z',
            version: '1.0.0',
            type: 'tool',
            description: 'other',
            author: 'someone',
            minAtlasApi: 1,
            downloadUrl: 'https://github.com/OLKoef/atlas-plugins/releases/download/zzz-other-v1.0.0/zzz-other-v1.0.0.zip',
            sha256: 'b'.repeat(64),
          },
        ],
      }),
    );

    const { status } = run(['--tag', 'example-widget-v0.1.0', '--zip', zip, '--repo', REPO, '--out', out]);
    expect(status).toBe(0);
    const catalog = parseCatalog(JSON.parse(await fs.readFile(out, 'utf8')));
    expect(catalog.plugins.map((p) => p.id)).toEqual(['example-widget', 'zzz-other']);
  });
});
