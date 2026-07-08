import { defineConfig } from 'vite';
import { defineAtlasPluginConfig } from '@atlas/plugin-sdk/vite';

// React / ReactDOM are provided by the Atlas host at runtime via window.AtlasPluginRuntime
// and are never bundled — see @atlas/plugin-sdk/vite. Authors don't configure externals.
export default defineConfig(defineAtlasPluginConfig());
