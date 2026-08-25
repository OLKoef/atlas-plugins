import { readFileSync } from 'node:fs';
import { it } from 'vitest';

const NUL = String.fromCharCode(0);
const NBSP = String.fromCharCode(0xa0);

it('scan', () => {
  const path = 'plugins/math/src/__tests__/expr.test.ts';
  const text = readFileSync(path, 'utf8');
  text.split('\n').forEach((line, index) => {
    if (line.includes(NUL) || line.includes(NBSP)) {
      console.log(`${index + 1}: ${JSON.stringify(line)}`);
    }
  });
});
