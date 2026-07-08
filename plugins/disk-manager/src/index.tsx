import './styles.css';
import type { AtlasPlugin, PluginManifest } from '@atlas/plugin-sdk';
import manifest from '../manifest.json';
import { DiskManagerPanel } from './Panel';

/**
 * Disk Manager — a `type: "tool"` plugin. Its full sidebar surface is the Panel: the
 * Visualize shell (DISK5) with Triage / AI-reorg / Session-summary layered on in later
 * DISK tickets. Rendered with Atlas's React (no bundled React) via the typed
 * {@link AtlasPluginApi} bridge.
 */
const plugin: AtlasPlugin = {
  manifest: manifest as unknown as PluginManifest,
  Panel: DiskManagerPanel,
};

export default plugin;
