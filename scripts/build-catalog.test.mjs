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
  const built = (id) => existsSync(path.join(repoRoot, 'plugins', id, 'dist', 'index.js'));
  if (!['disk-manager', 'math'].every(built)) {
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

const has = (bin, args) => {
  try {
    execFileSync(bin, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const hasZip = has('zip', ['-h']);
const hasUnzip = has('unzip', ['-v']);

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

  it('carries the manifest\'s permissions, as declared and in order (CAT2)', async () => {
    const dir = await tmpRoot();
    const zip = path.join(dir, 'math-v1.0.0.zip');
    await fs.writeFile(zip, 'pretend-zip-bytes\n');
    const { stdout, status } = run(['--tag', 'math-v1.0.0', '--zip', zip, '--repo', REPO, '--dry-run']);
    expect(status).toBe(0);

    const manifest = JSON.parse(
      await fs.readFile(path.join(repoRoot, 'plugins', 'math', 'manifest.json'), 'utf8'),
    );
    const entry = parseCatalog(JSON.parse(stdout)).plugins.find((p) => p.id === 'math');
    expect(entry.permissions).toEqual(manifest.permissions);
    expect(entry.permissions).toEqual(['storage', 'notes:insert']);
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

describe('build-catalog.mjs — Math v1 publish (MATH8)', () => {
  // Math is the first published plugin that ships a large bundled dependency (mathjs +
  // function-plot), so beyond the entry shape this asserts the zip the release uploads is
  // the *complete* installable dir — a missing sibling chunk would only show up at install.
  it.skipIf(!hasZip)('packs math@1.0.0 into a parseCatalog-valid entry whose sha256 matches the zip', async () => {
    const { stdout, status } = run([
      '--tag', 'math-v1.0.0',
      '--repo', REPO,
      '--skip-catalog',
      '--dry-run',
    ]);
    expect(status).toBe(0);

    const entry = parseCatalogEntry(JSON.parse(stdout)); // AC: schema accepted by parseCatalog
    expect(entry.id).toBe('math');
    expect(entry.name).toBe('Math');
    expect(entry.version).toBe('1.0.0');
    expect(entry.type).toBe('tool');
    expect(entry.minAtlasApi).toBe(1);
    expect(entry.downloadUrl).toBe(releaseAssetUrl(REPO, 'math-v1.0.0', 'math-v1.0.0.zip'));

    const zipPath = path.join(repoRoot, 'dist-artifacts', 'math-v1.0.0.zip');
    expect(existsSync(zipPath)).toBe(true);
    const zipSha = createHash('sha256').update(await fs.readFile(zipPath)).digest('hex');
    expect(entry.sha256).toBe(zipSha); // AC: sha256 matches the published zip
  });

  it.skipIf(!hasZip || !hasUnzip)('ships a flat, complete plugin dir — manifest + entry + styles, no stray chunk', () => {
    const { status } = run(['--tag', 'math-v1.0.0', '--repo', REPO, '--skip-catalog', '--dry-run']);
    expect(status).toBe(0);

    const zipPath = path.join(repoRoot, 'dist-artifacts', 'math-v1.0.0.zip');
    const names = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)
      .sort();
    // Exactly what manifest.entry/styles declare — the installer unpacks this dir verbatim.
    expect(names).toEqual(['index.js', 'manifest.json', 'styles.css']);
  });

  it('rejects a math tag whose version disagrees with the bumped manifest', async () => {
    const dir = await tmpRoot();
    const zip = path.join(dir, 'math-v0.1.0.zip');
    await fs.writeFile(zip, 'stale');
    const { status } = run(['--tag', 'math-v0.1.0', '--zip', zip, '--repo', REPO, '--dry-run']);
    expect(status).toBe(1);
  });
});

describe('catalog.json — committed fetch target (DISK9, MATH8)', () => {
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

  it('publishes a schema-valid math@1.0.0 entry', () => {
    const entry = catalog.plugins.find((p) => p.id === 'math');
    expect(entry).toBeDefined();
    expect(entry.name).toBe('Math');
    expect(entry.version).toBe('1.0.0');
    expect(entry.type).toBe('tool');
    expect(entry.minAtlasApi).toBe(1);
    expect(entry.downloadUrl).toBe(releaseAssetUrl(REPO, 'math-v1.0.0', 'math-v1.0.0.zip'));
    expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/); // a real digest, not a placeholder
  });

  it('keeps every entry at the version its plugin manifest declares', async () => {
    for (const entry of catalog.plugins) {
      const manifest = JSON.parse(
        await fs.readFile(path.join(repoRoot, 'plugins', entry.id, 'manifest.json'), 'utf8'),
      );
      expect(`${entry.id}@${entry.version}`).toBe(`${manifest.id}@${manifest.version}`);
    }
  });

  it('lists every entry\'s permissions exactly as its plugin manifest declares them (CAT2)', async () => {
    for (const entry of catalog.plugins) {
      const manifest = JSON.parse(
        await fs.readFile(path.join(repoRoot, 'plugins', entry.id, 'manifest.json'), 'utf8'),
      );
      expect(entry.permissions, entry.id).toEqual(manifest.permissions);
    }
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
