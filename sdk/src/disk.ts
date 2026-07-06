/**
 * Disk Manager backend surface (`disk.*`, DISK1–DISK4) and the configured-model bridge
 * (`ai.chat`, DISK10), shipped additively in V0.5.1. Every `disk.*` method is
 * permission-gated and rejects with {@link PluginPermissionError} if the plugin's
 * manifest does not declare the matching permission.
 *
 * Shapes mirror the Dashboard's `src/shared/disk.ts`; implementation.md is this repo's
 * source of truth (it cannot read Dashboard's TypeScript directly).
 */

export type IcloudStatus = 'downloaded' | 'evicted' | 'not-icloud';

export type FileCategory =
  | 'video'
  | 'image'
  | 'audio'
  | 'document'
  | 'archive'
  | 'code'
  | 'app'
  | 'other';

export interface ScannedFile {
  path: string;
  relPath: string;
  size: number;
  createdMs: number;
  modifiedMs: number;
  icloud: IcloudStatus;
}

export interface FolderAggregate {
  name: string;
  size: number;
  count: number;
}

export interface FileTypeAggregate {
  category: FileCategory;
  size: number;
  count: number;
}

export interface DiskScanOptions {
  /** cap on the number of files walked; the backend stops early past this. */
  maxFiles?: number;
  /** include files whose iCloud status is `evicted` (metadata only, no download). */
  includeEvicted?: boolean;
}

export interface DiskScanResult {
  files: ScannedFile[];
  byFolder: FolderAggregate[];
  byType: FileTypeAggregate[];
}

export interface ReorgMove {
  from: string;
  to: string;
}

export interface ReorgScope {
  sourceRoot: string;
  targetRoot?: string;
  /** when true, moves are scoped within the user's home tree. */
  home?: boolean;
}

export type MutationKind = 'delete' | 'evict' | 'uninstall' | 'reorg';

/** How a mutation can be undone; feeds the DISK8 undo log's strategy. */
export type RecoveryStrategy = 'trash' | 'redownload' | 'reverse-move' | 'none';

export interface MutationResult {
  kind: MutationKind;
  ok: boolean;
  reclaimedBytes: number;
  recovery: RecoveryStrategy;
  trashed: string[];
  moves: ReorgMove[];
  skipped: { path: string; reason: string }[];
  summary: string;
}

/** Options for the destructive trash call — a stronger confirmation than a plain swipe. */
export interface DeleteToTrashOptions {
  /** must be `true` or the call is a no-op (returns a result with everything skipped). */
  confirm: boolean;
}

export interface DiskApi {
  /** `disk:read` — walk `root` and return files plus per-folder / per-type aggregates. */
  scan(root: string, opts?: DiskScanOptions): Promise<DiskScanResult>;
  /** `disk:trash` — move paths to the Trash. Requires `opts.confirm === true`. */
  deleteToTrash(paths: string[], opts: DeleteToTrashOptions): Promise<MutationResult>;
  /** `disk:evict` — evict downloaded iCloud files (keep in cloud, free local space). */
  evict(paths: string[]): Promise<MutationResult>;
  /** `disk:uninstall-app` — uninstall an app bundle and its leftovers. */
  uninstallApp(appPath: string): Promise<MutationResult>;
  /** `disk:reorg` — apply a batch of moves within a scope. */
  applyReorgPlan(moves: ReorgMove[], scope: ReorgScope): Promise<MutationResult>;
}

export type AiChatRole = 'system' | 'user' | 'assistant';

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

/** Same provider/model shape Ingest's cleanup config uses. */
export interface AiChatOptions {
  provider: string;
  model: string;
}

export interface AiApi {
  /**
   * `ai:chat` — one-shot chat against the configured model. Rejects if no provider is
   * configured; callers (e.g. DISK7 reorg proposal) should treat a rejection as
   * "can't propose right now", not a crash.
   */
  chat(messages: AiChatMessage[], opts: AiChatOptions): Promise<string>;
}

/**
 * Rejection raised when a plugin calls a permission-gated API (e.g. `disk.deleteToTrash`)
 * without declaring the matching permission in its manifest.
 */
export class PluginPermissionError extends Error {
  /** the permission that was required but not declared (e.g. `disk:trash`). */
  readonly permission: string;

  constructor(permission: string, message?: string) {
    super(message ?? `Plugin is missing required permission: ${permission}`);
    this.name = 'PluginPermissionError';
    this.permission = permission;
  }
}
