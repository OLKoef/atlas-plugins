import type { ComponentType } from 'react';
import type { AtlasPluginApi } from './api.js';
import type { PluginManifest, PluginPermission, PluginType } from './manifest.js';

/**
 * What a plugin bundle's `index.js` default-exports (implementation.md §2).
 *
 * `type` in the manifest declares the *primary* surface, but a module may export both
 * `Widget` and `Panel`; the runtime uses whichever it finds.
 */
export interface AtlasPlugin {
  /** re-exported manifest, as a sanity check against the sidecar `manifest.json`. */
  manifest: PluginManifest;
  /** rendered on the home grid for `type: "widget"`. */
  Widget?: ComponentType<{ api: AtlasPluginApi }>;
  /** rendered as a full sidebar panel for `type: "tool"`. */
  Panel?: ComponentType<{ api: AtlasPluginApi }>;
  onEnable?(api: AtlasPluginApi): void | Promise<void>;
  onDisable?(): void | Promise<void>;
}

/**
 * The global Atlas installs on `window` before importing any plugin bundle, so plugin
 * bundles share the host's single React instance instead of bundling their own (the
 * React-singleton fix; see implementation.md §"React singleton problem"). The SDK's Vite
 * config (`@atlas/plugin-sdk/vite`) rewrites `react` / `react-dom` imports to read from
 * here, so plugin authors never bundle React.
 */
export interface AtlasPluginRuntime {
  React: typeof import('react');
  ReactDOM: typeof import('react-dom');
  /** the host's supported API version (equals its {@link ATLAS_PLUGIN_API_VERSION}). */
  apiVersion: number;
}

declare global {
  // eslint-disable-next-line no-var
  interface Window {
    AtlasPluginRuntime?: AtlasPluginRuntime;
  }
}

/** A plugin as recorded in the on-disk registry once installed. */
export interface InstalledPlugin {
  manifest: PluginManifest;
  /** installed version (matches `manifest.version`). */
  version: string;
  enabled: boolean;
  /** epoch millis of install. */
  installedAt: number;
  /** absolute path of the unpacked version dir. */
  path: string;
}

/**
 * A marketplace catalog row (PL3 / PL15). The `sha256` is verified against the downloaded
 * zip before install (PL5).
 */
export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  type: PluginType;
  description: string;
  author: string;
  icon?: string;
  homepage?: string;
  minAtlasApi: number;
  /**
   * the manifest's declared permissions, in manifest order (CAT2) — lets the Plugins page
   * say what a plugin can do before install. Optional so pre-CAT2 rows still parse.
   */
  permissions?: PluginPermission[];
  /** URL of the release zip. */
  downloadUrl: string;
  /** sha256 of the release zip, hex-encoded. */
  sha256: string;
  screenshots?: string[];
}
