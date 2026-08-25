/**
 * `@atlas/plugin-sdk` — the typed plugin API surface for authoring Atlas marketplace
 * plugins. Mirrors the Dashboard-side `src/shared/plugins.ts` (PL1).
 *
 * The Vite library-mode build config lives in the `@atlas/plugin-sdk/vite` subpath so that
 * importing the types never pulls Vite into a plugin's runtime graph.
 */

export { ATLAS_PLUGIN_API_VERSION } from './version.js';
export type { AtlasPluginApiVersion } from './version.js';

export {
  PLUGIN_TYPES,
  KNOWN_PERMISSIONS,
  ManifestError,
  parseManifest,
  safeParseManifest,
  isApiCompatible,
  isKnownPermission,
} from './manifest.js';
export type {
  PluginType,
  PluginPermission,
  PluginManifest,
  SafeParseResult,
} from './manifest.js';

export type {
  AtlasPluginApi,
  TasksApi,
  SubjectsApi,
  EventsApi,
  FocusApi,
  StorageApi,
  UiApi,
  NetApi,
  SettingsApi,
  NotesApi,
  NotesInsertPlacement,
  NotesInsertResult,
  NotesImageInput,
  ToastKind,
  Unsubscribe,
  PluginTask,
  PluginSubject,
  PluginCalendarEvent,
  FocusSessionInput,
} from './api.js';

export { PluginPermissionError } from './disk.js';
export type {
  DiskApi,
  AiApi,
  IcloudStatus,
  FileCategory,
  ScannedFile,
  FolderAggregate,
  FileTypeAggregate,
  DiskScanOptions,
  DiskScanResult,
  ReorgMove,
  ReorgScope,
  MutationKind,
  MutationResult,
  RecoveryStrategy,
  DeleteToTrashOptions,
  AiChatRole,
  AiChatMessage,
  AiChatOptions,
} from './disk.js';

export type {
  AtlasPlugin,
  AtlasPluginRuntime,
  InstalledPlugin,
  CatalogEntry,
} from './plugin.js';

export {
  EMPTY_CATALOG,
  CatalogError,
  parseCatalogEntry,
  parseCatalog,
  safeParseCatalog,
  buildCatalogEntry,
  upsertCatalogEntry,
  serializeCatalog,
} from './catalog.js';
export type { Catalog, ReleaseFacts, SafeParseCatalogResult } from './catalog.js';
