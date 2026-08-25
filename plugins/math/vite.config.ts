import { defineConfig } from 'vite';
import { defineAtlasPluginConfig } from '@atlas/plugin-sdk/vite';

// React / ReactDOM are provided by the Atlas host at runtime via window.AtlasPluginRuntime
// and are never bundled — see @atlas/plugin-sdk/vite. mathjs, on the other hand, IS bundled
// into the plugin zip (it is the shared engine behind all three tools); function-plot joins
// it in MATH2, lazy-loaded with the Graphing tool.
export default defineConfig(defineAtlasPluginConfig());
