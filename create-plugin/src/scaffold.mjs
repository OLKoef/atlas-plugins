import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Default template dir shipped alongside this package. */
export const TEMPLATE_DIR = fileURLToPath(new URL('../template', import.meta.url));

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Files that must be renamed when written (npm strips leading-dot files from packages). */
const RENAME_ON_WRITE = { gitignore: '.gitignore' };

/** Turn a kebab-case id into a Title Case display name ("disk-manager" -> "Disk Manager"). */
export function titleCaseFromId(id) {
  return id
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function applyTokens(text, tokens) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(tokens, key)) return String(tokens[key]);
    return match;
  });
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/**
 * Scaffold a new plugin from the template into `targetDir`. Pure filesystem work; returns
 * the list of written (relative) file paths. Throws on invalid id or a non-empty target.
 *
 * @param {object} opts
 * @param {string} opts.id           kebab-case plugin id
 * @param {string} opts.targetDir    directory to create the plugin in
 * @param {string} [opts.name]       display name (defaults to Title Case of id)
 * @param {string} [opts.description]
 * @param {string} [opts.author]
 * @param {string} [opts.version]    defaults to "0.1.0"
 * @param {string} [opts.templateDir] override the template source dir
 * @param {boolean} [opts.force]     allow writing into a non-empty dir
 */
export async function scaffoldPlugin(opts) {
  const { id } = opts;
  if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 64) {
    throw new Error(`Invalid plugin id ${JSON.stringify(id)} — must be kebab-case ([a-z0-9] and single dashes).`);
  }

  const templateDir = opts.templateDir ?? TEMPLATE_DIR;
  const targetDir = path.resolve(opts.targetDir);
  const tokens = {
    id,
    name: opts.name ?? titleCaseFromId(id),
    description: opts.description ?? `${opts.name ?? titleCaseFromId(id)} — an Atlas plugin.`,
    author: opts.author ?? 'Atlas',
    version: opts.version ?? '0.1.0',
  };

  // Refuse to clobber an existing non-empty dir unless forced.
  let existing = [];
  try {
    existing = await fs.readdir(targetDir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (existing.length > 0 && !opts.force) {
    throw new Error(`Target directory ${targetDir} is not empty. Pass { force: true } to write anyway.`);
  }

  const templateFiles = await walk(templateDir);
  const written = [];
  for (const src of templateFiles) {
    const rel = path.relative(templateDir, src);
    const parts = rel.split(path.sep);
    const base = parts[parts.length - 1];
    parts[parts.length - 1] = RENAME_ON_WRITE[base] ?? base;
    const outRel = parts.join(path.sep);
    const outPath = path.join(targetDir, outRel);

    const raw = await fs.readFile(src, 'utf8');
    const rendered = applyTokens(raw, tokens);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, rendered);
    written.push(outRel);
  }
  written.sort();
  return written;
}
