#!/usr/bin/env node
// PL15 catalog pipeline orchestrator.
//
// Given a release tag `<id>-v<semver>`, this:
//   1. reads + validates the plugin's manifest,
//   2. packs the distributable files into `<dist-dir>/<id>-v<version>.zip` (unless --zip
//      points at an already-built archive),
//   3. computes the zip's sha256,
//   4. builds the CatalogEntry (deterministic release-asset URL + raw icon URL),
//   5. upserts it into the committed catalog.json and rewrites the file.
//
// Uploading the zip to a GitHub Release and committing catalog.json are the workflow's job
// (see .github/workflows/release-plugin.yml); this script is the testable, network-free core.
//
// Usage:
//   node scripts/build-catalog.mjs [--tag <id>-v<ver>] [--zip <path>] [--repo owner/name]
//        [--icon-ref <ref>] [--out catalog.json] [--dist-dir dist-artifacts]
//        [--plugins-dir plugins] [--skip-catalog] [--dry-run] [--github-output]
//
// In --dry-run, the resulting catalog JSON is written to stdout and nothing is persisted.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseManifest,
  buildCatalogEntry,
  upsertCatalogEntry,
  parseCatalog,
  serializeCatalog,
  EMPTY_CATALOG,
} from '@atlas/plugin-sdk';

import {
  parseReleaseTag,
  pluginZipName,
  releaseAssetUrl,
  rawRepoFileUrl,
  resolveRepoSlug,
  resolveIconRef,
  resolveTag,
} from './lib/release.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

function parseArgs(argv) {
  const opts = {
    out: 'catalog.json',
    distDir: 'dist-artifacts',
    pluginsDir: 'plugins',
    skipCatalog: false,
    dryRun: false,
    githubOutput: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '--tag': opts.tag = val(); break;
      case '--zip': opts.zip = val(); break;
      case '--repo': opts.repo = val(); break;
      case '--icon-ref': opts.iconRef = val(); break;
      case '--out': opts.out = val(); break;
      case '--dist-dir': opts.distDir = val(); break;
      case '--plugins-dir': opts.pluginsDir = val(); break;
      case '--skip-catalog': opts.skipCatalog = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--github-output': opts.githubOutput = true; break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new Error(`unknown argument: ${a}`);
    }
  }
  return opts;
}

/** Streaming-friendly sha256 of a file, lowercase hex. */
async function sha256File(file) {
  const buf = await fs.readFile(file);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Stage the files that belong in an installed plugin dir (flat: entry bundle + manifest +
 * optional styles/icon), then zip them to `zipPath`. Returns the list of staged filenames.
 */
async function packPlugin({ pluginDir, manifest, zipPath }) {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-pack-'));
  const staged = [];
  try {
    // The built bundle lives in dist/; everything else (manifest, icon) is a repo file.
    const entrySrc = path.join(pluginDir, 'dist', manifest.entry);
    if (!existsSync(entrySrc)) {
      throw new Error(`built entry not found: ${path.relative(repoRoot, entrySrc)} — run "npm run build" first`);
    }
    await fs.copyFile(entrySrc, path.join(staging, manifest.entry));
    staged.push(manifest.entry);

    await fs.copyFile(path.join(pluginDir, 'manifest.json'), path.join(staging, 'manifest.json'));
    staged.push('manifest.json');

    // styles may be a vite output (dist/) or an authored file; icon is an authored asset.
    for (const file of [manifest.styles, manifest.icon].filter(Boolean)) {
      const fromDist = path.join(pluginDir, 'dist', file);
      const fromRoot = path.join(pluginDir, file);
      const src = existsSync(fromDist) ? fromDist : fromRoot;
      if (!existsSync(src)) {
        throw new Error(`declared asset "${file}" not found under ${path.relative(repoRoot, pluginDir)}`);
      }
      await fs.copyFile(src, path.join(staging, file));
      staged.push(file);
    }

    await fs.rm(zipPath, { force: true });
    await fs.mkdir(path.dirname(zipPath), { recursive: true });
    // -X drops platform extras (uid/gid/times) for a reproducible archive.
    execFileSync('zip', ['-q', '-X', '-r', path.resolve(zipPath), '.'], { cwd: staging });
    return staged.sort();
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

function log(...args) {
  // Human output goes to stderr so --dry-run stdout is clean JSON.
  console.error(...args);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    log('Usage: node scripts/build-catalog.mjs [--tag <id>-v<ver>] [--zip <path>] [--repo owner/name]');
    log('       [--icon-ref <ref>] [--out catalog.json] [--skip-catalog] [--dry-run] [--github-output]');
    return;
  }

  const env = process.env;
  const tag = resolveTag(env, opts.tag);
  const { id, version } = parseReleaseTag(tag);
  const repoSlug = resolveRepoSlug(env, opts.repo);
  const iconRef = resolveIconRef(env, opts.iconRef);

  const pluginDir = path.resolve(repoRoot, opts.pluginsDir, id);
  const manifestPath = path.join(pluginDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`no plugin for tag ${tag}: ${path.relative(repoRoot, manifestPath)} does not exist`);
  }
  const manifest = parseManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')));
  if (manifest.id !== id) {
    throw new Error(`tag id "${id}" does not match manifest.id "${manifest.id}"`);
  }
  if (manifest.version !== version) {
    throw new Error(`tag version "${version}" does not match manifest.version "${manifest.version}"`);
  }

  const zipName = pluginZipName(id, version);
  let zipPath;
  if (opts.zip) {
    zipPath = path.resolve(opts.zip);
    if (!existsSync(zipPath)) throw new Error(`--zip not found: ${opts.zip}`);
    log(`Using existing zip: ${path.relative(repoRoot, zipPath)}`);
  } else {
    zipPath = path.resolve(repoRoot, opts.distDir, zipName);
    const staged = await packPlugin({ pluginDir, manifest, zipPath });
    log(`Packed ${zipName} (${staged.join(', ')})`);
  }

  const sha256 = await sha256File(zipPath);
  const downloadUrl = releaseAssetUrl(repoSlug, tag, zipName);
  const icon = manifest.icon ? rawRepoFileUrl(repoSlug, iconRef, id, manifest.icon) : undefined;

  const entry = buildCatalogEntry(manifest, { downloadUrl, sha256, icon });
  log(`Entry: ${entry.id}@${entry.version}  sha256=${sha256}`);
  log(`  zip:  ${downloadUrl}`);
  if (icon) log(`  icon: ${icon}`);

  if (opts.githubOutput && env.GITHUB_OUTPUT) {
    const lines = [
      `id=${id}`,
      `version=${version}`,
      `tag=${tag}`,
      `zip_path=${path.relative(repoRoot, zipPath)}`,
      `zip_name=${zipName}`,
      `sha256=${sha256}`,
      `download_url=${downloadUrl}`,
      ...(icon ? [`icon_url=${icon}`] : []),
    ];
    await fs.appendFile(env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  }

  if (opts.skipCatalog) {
    log('Skipping catalog write (--skip-catalog).');
    if (opts.dryRun) process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
    return;
  }

  const outPath = path.resolve(repoRoot, opts.out);
  let current = EMPTY_CATALOG;
  if (existsSync(outPath)) {
    current = parseCatalog(JSON.parse(await fs.readFile(outPath, 'utf8')));
  } else {
    log(`No existing ${opts.out}; starting from empty catalog.`);
  }
  const next = upsertCatalogEntry(current, entry);
  const serialized = serializeCatalog(next);

  if (opts.dryRun) {
    log(`Dry run: ${outPath} would have ${next.plugins.length} entr${next.plugins.length === 1 ? 'y' : 'ies'}.`);
    process.stdout.write(serialized);
    return;
  }

  await fs.writeFile(outPath, serialized);
  log(`Wrote ${opts.out} (${next.plugins.length} entries).`);
}

main().catch((err) => {
  console.error(`build-catalog: ${err.message}`);
  process.exitCode = 1;
});
