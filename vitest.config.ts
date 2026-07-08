import { defineConfig } from 'vitest/config';

// Single root Vitest run covers SDK unit tests, the create-plugin scaffolder,
// the end-to-end React-externalization build assertion, and per-plugin unit tests.
export default defineConfig({
  // Plugin tests (Visualize) use JSX; render them with the automatic runtime so no
  // per-file React import is needed. SDK/script tests are plain .ts/.mjs (unaffected).
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: [
      'sdk/src/**/*.test.ts',
      'create-plugin/**/*.test.mjs',
      'scripts/**/*.test.mjs',
      'plugins/**/src/**/*.test.ts',
      'plugins/**/src/**/*.test.tsx',
    ],
    // The externalization test shells out to `vite build`; give it room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
