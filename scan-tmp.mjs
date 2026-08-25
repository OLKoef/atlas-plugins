import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const NUL = String.fromCharCode(0);
const NBSP = String.fromCharCode(0xa0);

const roots = ['plugins', 'sdk/src', 'create-plugin', 'scripts'];
const bad = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(ts|tsx|mjs|js|css|json|md)$/.test(path)) continue;
    const text = readFileSync(path, 'utf8');
    text.split('\n').forEach((line, index) => {
      const nul = line.indexOf(NUL);
      const nbsp = line.indexOf(NBSP);
      if (nul >= 0 || nbsp >= 0) {
        bad.push(`${path}:${index + 1} nul=${nul} nbsp=${nbsp} :: ${JSON.stringify(line)}`);
      }
    });
  }
}

for (const root of roots) walk(root);
console.log(bad.length ? bad.join('\n') : 'clean');
