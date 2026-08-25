import { defineConfig, mergeConfig } from 'vite';
import { defineAtlasPluginConfig } from '@atlas/plugin-sdk/vite';

// React / ReactDOM are provided by the Atlas host at runtime via window.AtlasPluginRuntime
// and are never bundled — see @atlas/plugin-sdk/vite. mathjs and function-plot, on the other
// hand, both ship *inside* the plugin zip: mathjs is the shared engine behind all three
// tools, function-plot draws the MATH2 graph canvas.
//
// `inlineDynamicImports` keeps the whole plugin in one `dist/index.js`. An installed plugin
// dir is flat and entry-only — `scripts/build-catalog.mjs` stages exactly `manifest.entry`
// plus the declared styles/icon — so the code-split chunk that `lib/plot.ts`'s `import()`
// would otherwise emit could never reach the zip, and the entry would resolve against a file
// that isn't there. The `import()` stays in the source as the seam (see `lib/plot.ts`); what
// this flag trades away is deferred *evaluation*, which costs least here of anywhere: the
// shell opens on Graphing, so the canvas is the common first paint anyway.
export default defineConfig(
  mergeConfig(defineAtlasPluginConfig(), {
    build: { rollupOptions: { output: { inlineDynamicImports: true } } },
  }),
);
