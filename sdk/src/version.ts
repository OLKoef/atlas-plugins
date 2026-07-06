/**
 * The integer Atlas plugin API version this SDK targets.
 *
 * A plugin's `manifest.minAtlasApi` is gated against this value at load time: Atlas
 * refuses to mount a plugin whose `minAtlasApi` is greater than the host's supported
 * version. Changes to the API surface are **additive only** within a version — any
 * breaking change bumps this number (see implementation.md §3).
 *
 * The `disk.*` (DISK1–DISK4) and `ai.chat` (DISK10) namespaces shipped in V0.5.1 were
 * additive, so they did **not** bump this value — it is still `1`.
 */
export const ATLAS_PLUGIN_API_VERSION = 1 as const;

export type AtlasPluginApiVersion = typeof ATLAS_PLUGIN_API_VERSION;
