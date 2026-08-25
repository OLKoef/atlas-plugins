import './styles.css';
import type { AtlasPlugin, PluginManifest } from '@atlas/plugin-sdk';
import manifest from '../manifest.json';
import { MathPanel } from './Panel';

/**
 * Math — a `type: "tool"` plugin. Its full sidebar surface is the Panel: the tool-tab shell
 * (MATH1) with Graphing / Scientific / Matrix layered on in MATH2–MATH5. Rendered with
 * Atlas's React (no bundled React) via the typed {@link AtlasPluginApi} bridge; mathjs ships
 * inside the bundle.
 */
const plugin: AtlasPlugin = {
  manifest: manifest as unknown as PluginManifest,
  Panel: MathPanel,
};

export default plugin;
