import type { DiskApi, AiApi } from './disk.js';

/**
 * `AtlasPluginApi` — the bridge object handed to a plugin's `Widget` / `Panel` and to its
 * `onEnable` hook. Reads come from Atlas's Zustand stores (already optimistic + rolled
 * back), so plugins observe the same state as built-in views with no extra IPC.
 *
 * The read-model shapes below (`PluginTask`, `PluginSubject`, `PluginCalendarEvent`,
 * `FocusSessionInput`) are the SDK's declared contract. They are pinned exactly against
 * the real Dashboard stores during PL14 (Pomodoro extraction), where the API is expected
 * to grow — additively.
 */

export interface PluginTask {
  id: string;
  title: string;
  done: boolean;
  subjectId?: string;
  /** epoch millis, when scheduled/due. */
  dueMs?: number;
}

export interface PluginSubject {
  id: string;
  name: string;
  color?: string;
}

export interface PluginCalendarEvent {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  subjectId?: string;
}

/** A focus/pomodoro session a plugin logs back to Atlas. */
export interface FocusSessionInput {
  startedMs: number;
  durationMs: number;
  taskId?: string;
  subjectId?: string;
  note?: string;
}

/** Unsubscribe callback returned by `*.onChange` subscriptions. */
export type Unsubscribe = () => void;

export interface TasksApi {
  /** current snapshot of the user's tasks. */
  list(): PluginTask[];
  /** subscribe to task changes; returns an unsubscribe fn. */
  onChange(listener: () => void): Unsubscribe;
}

export interface SubjectsApi {
  list(): PluginSubject[];
  onChange(listener: () => void): Unsubscribe;
}

export interface EventsApi {
  /** events overlapping the `[startMs, endMs)` window. */
  range(startMs: number, endMs: number): PluginCalendarEvent[];
}

export interface FocusApi {
  /** `focus:write` — record a completed focus session. */
  logSession(session: FocusSessionInput): Promise<void>;
}

/**
 * Per-plugin persistent key/value storage. Keys are namespaced by plugin id by Atlas, so
 * plugins never collide. Gated on the `storage` permission.
 */
export interface StorageApi {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export type ToastKind = 'info' | 'success' | 'error';

export interface UiApi {
  /** transient in-app toast. */
  toast(kind: ToastKind, title: string, message?: string): void;
  /** native OS notification (via Atlas's notification bridge). */
  notify(title: string, body: string): void;
  /** navigate the host to a view id. */
  openView(viewId: string): void;
}

/**
 * Main-process-proxied fetch (CSP stays closed on the renderer). Gated on the `net`
 * permission — the first enforced permission (Citation Generator).
 */
export interface NetApi {
  fetchJson<T = unknown>(url: string): Promise<T>;
  fetchText(url: string): Promise<string>;
}

/** One-off migration shim, deprecated from birth (Pomodoro). */
export interface SettingsApi {
  /** @deprecated read a legacy Atlas settings key during migration only. */
  readLegacy(key: string): Promise<unknown>;
}

export interface AtlasPluginApi {
  /** equals {@link ATLAS_PLUGIN_API_VERSION} of the host that mounted this plugin. */
  readonly apiVersion: number;
  tasks: TasksApi;
  subjects: SubjectsApi;
  events: EventsApi;
  focus: FocusApi;
  storage: StorageApi;
  ui: UiApi;
  net: NetApi;
  settings: SettingsApi;
  /** Disk Manager backend (DISK1–DISK4); permission-gated. */
  disk: DiskApi;
  /** configured-model chat bridge (DISK10); permission-gated. */
  ai: AiApi;
}
