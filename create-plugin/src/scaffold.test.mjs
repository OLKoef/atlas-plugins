import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldPlugin, titleCaseFromId } from './scaffold.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const exampleDir = path.join(repoRoot, 'plugins', 'example-widget');

const tmpDirs = [];
async function tmpRoot() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-scaffold-'));
  tmpDirs.push(dir);
  return dir;
}
afterAll(async () => {
  for (const dir of tmpDirs) await fs.rm(dir, { recursive: true, force: true });
});

describe('titleCaseFromId', () => {
  it('turns a kebab id into a display name', () => {
    expect(titleCaseFromId('disk-manager')).toBe('Disk Manager');
    expect(titleCaseFromId('pomodoro')).toBe('Pomodoro');
  });
});

describe('scaffoldPlugin', () => {
  it('renders the template with tokens substituted and no leftovers', async () => {
    const root = await tmpRoot();
    const target = path.join(root, 'my-plugin');
    const written = await scaffoldPlugin({ id: 'my-plugin', targetDir: target });

    expect(written).toContain('manifest.json');
    expect(written).toContain('package.json');
    expect(written).toContain('vite.config.ts');
    expect(written).toContain('.gitignore'); // renamed from template's `gitignore`
    expect(written).toContain(path.join('src', 'index.tsx'));

    const manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'));
    expect(manifest.id).toBe('my-plugin');
    expect(manifest.name).toBe('My Plugin');
    expect(manifest.type).toBe('widget');
    expect(manifest.minAtlasApi).toBe(1);

    const pkg = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@atlas/plugin-my-plugin');

    // No unresolved `{{token}}` remains in any generated file.
    for (const rel of written) {
      const content = await fs.readFile(path.join(target, rel), 'utf8');
      expect(content, `${rel} has an unresolved token`).not.toMatch(/\{\{\w+\}\}/);
    }
  });

  it('rejects an invalid plugin id', async () => {
    const root = await tmpRoot();
    await expect(scaffoldPlugin({ id: 'Bad_Id', targetDir: path.join(root, 'x') })).rejects.toThrow(/kebab-case/);
  });

  it('refuses to write into a non-empty directory without force', async () => {
    const root = await tmpRoot();
    await fs.writeFile(path.join(root, 'keep.txt'), 'x');
    await expect(scaffoldPlugin({ id: 'p', targetDir: root })).rejects.toThrow(/not empty/);
  });

  it('committed plugins/example-widget matches the template render (no drift)', async () => {
    const root = await tmpRoot();
    const target = path.join(root, 'example-widget');
    const written = await scaffoldPlugin({
      id: 'example-widget',
      name: 'Example Widget',
      description: 'Starter widget scaffolded by create-atlas-plugin.',
      author: 'Atlas',
      version: '0.1.0',
      targetDir: target,
    });

    for (const rel of written) {
      const generated = await fs.readFile(path.join(target, rel), 'utf8');
      const committed = await fs.readFile(path.join(exampleDir, rel), 'utf8');
      expect(committed, `plugins/example-widget/${rel} is out of sync with create-plugin/template`).toBe(generated);
    }
  });
});
