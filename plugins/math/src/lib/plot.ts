/**
 * Math — the lazy function-plot loader (MATH2).
 *
 * function-plot (d3-based, with its own sampler) is the heaviest thing in the plugin, and
 * two of the three tools never touch it. The spec's answer is to **lazy-load it with the
 * Graphing tool**, which this module is: nothing here pulls d3 into the module graph until
 * {@link loadFunctionPlot} is first awaited — i.e. until a `<GraphCanvas>` actually mounts.
 *
 * That laziness is deliberately *source-level*. An installed plugin dir is flat — the PL15
 * packer stages exactly `manifest.entry` plus the declared styles/icon — so the build keeps
 * `dist/index.js` self-contained (`inlineDynamicImports`, see `vite.config.ts`) rather than
 * emitting a sibling chunk that would never make it into the zip.
 *
 * It also keeps the library out of the unit-test run: the tests are node-env with no DOM,
 * and the import only happens inside a browser effect.
 */

import type functionPlot from 'function-plot';

export type FunctionPlot = typeof functionPlot;

let pending: Promise<FunctionPlot> | null = null;

/**
 * Import function-plot once and share the promise. Repeated calls (a remount, a second
 * canvas) resolve against the same module; a failed import is not cached, so a transient
 * failure can be retried by mounting again.
 */
export function loadFunctionPlot(): Promise<FunctionPlot> {
  if (!pending) {
    pending = import('function-plot')
      .then((module) => module.default)
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
