import { defineConfig } from 'vitest/config';

// Single root Vitest run covers SDK unit tests, the create-plugin scaffolder,
// and the end-to-end React-externalization build assertion.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['sdk/src/**/*.test.ts', 'create-plugin/**/*.test.mjs', 'scripts/**/*.test.mjs'],
    // The externalization test shells out to `vite build`; give it room.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
