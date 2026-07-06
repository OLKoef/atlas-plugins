#!/usr/bin/env node
import path from 'node:path';
import { scaffoldPlugin, titleCaseFromId } from './src/scaffold.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') args.name = argv[++i];
    else if (a === '--description') args.description = argv[++i];
    else if (a === '--author') args.author = argv[++i];
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

const HELP = `create-atlas-plugin — scaffold a new Atlas marketplace plugin

Usage:
  create-atlas-plugin <id> [options]

Options:
  --name <name>            display name (default: Title Case of id)
  --description <text>     manifest description
  --author <author>        manifest author (default: Atlas)
  --dir <path>             target directory (default: ./<id>)
  --force                  write into a non-empty directory
  -h, --help               show this help

Example:
  create-atlas-plugin disk-manager --name "Disk Manager"
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    process.stdout.write(HELP);
    process.exit(args.help ? 0 : 1);
  }

  const id = args._[0];
  const targetDir = args.dir ? path.resolve(args.dir) : path.resolve(process.cwd(), id);

  try {
    const written = await scaffoldPlugin({
      id,
      name: args.name,
      description: args.description,
      author: args.author,
      targetDir,
      force: args.force,
    });
    const name = args.name ?? titleCaseFromId(id);
    process.stdout.write(`\nScaffolded "${name}" (${id}) into ${targetDir}\n`);
    process.stdout.write(`  ${written.length} files written\n\n`);
    process.stdout.write('Next steps:\n');
    process.stdout.write(`  cd ${path.relative(process.cwd(), targetDir) || '.'}\n`);
    process.stdout.write('  npm install\n');
    process.stdout.write('  npm run build\n\n');
  } catch (err) {
    process.stderr.write(`create-atlas-plugin: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

main();
