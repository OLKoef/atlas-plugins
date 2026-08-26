/**
 * Math — the insert-into-note bridge (MATH6), wrapping the SDK's `notes:insert` API (MATH7).
 *
 * The wireframe draws an insert action on the topbar and on every tape row. Its bridge is
 * Dashboard-side and may not be there: a host older than MATH7 hands the plugin an `api` with
 * no `notes` namespace at all. So every insert action in this plugin asks one question first —
 * {@link makeInsertBridge}'s `available` — and renders **disabled with a reason** when the
 * answer is no. Copy-as-LaTeX never asks: the clipboard is always there.
 *
 * Three decisions worth stating:
 *
 *  - **the gate is the method, not the permission.** A manifest declares `notes:insert`, but
 *    whether the *host* implements it is a different question, and only a shape check answers
 *    it. A permission the host refuses surfaces as a rejected call, which is the failure path
 *    below, not the disabled path.
 *  - **inserting is fire-and-forget from the UI's side.** The bridge owns the toast, so a row
 *    action is one click with no local state to unwind — and the plugin never invents its own
 *    confirmation for something the host already reports.
 *  - **`placement: 'none'` is not an error.** The spec's fallback is "append + toast when no
 *    note is open"; the host decides that, and the plugin only relays what it says.
 */

import type { NotesApi, NotesInsertResult, ToastKind, UiApi } from '@atlas/plugin-sdk';

/** Title on an insert control the host cannot serve — says which half is missing. */
export const INSERT_UNAVAILABLE_TITLE =
  'Insert into note — this Atlas build has no notes bridge yet';

/** Title on a working insert control. */
export const INSERT_TITLE = 'Insert into note';

/** What the plugin tells the user after an insert, when the host has not already. */
export interface InsertToast {
  kind: ToastKind;
  title: string;
  message?: string;
}

/**
 * True when the host actually implements the notes bridge. A partial namespace counts as
 * absent: an insert action that works for LaTeX but throws for an image would be worse than
 * one that never offered itself.
 */
export function hasNotesBridge(notes: NotesApi | null | undefined): notes is NotesApi {
  return (
    !!notes &&
    typeof notes.insertLatex === 'function' &&
    typeof notes.insertImage === 'function'
  );
}

/** The toast for a settled insert, or null when the outcome speaks for itself. */
export function insertToast(result: NotesInsertResult, subject: string): InsertToast | null {
  if (!result.ok) {
    return { kind: 'error', title: 'Could not insert', message: `${subject} was not inserted.` };
  }
  if (result.placement === 'none') {
    return { kind: 'info', title: 'No note open', message: `${subject} was not inserted.` };
  }
  return {
    kind: 'success',
    title: result.placement === 'appended' ? 'Appended to note' : 'Inserted into note',
    message: subject,
  };
}

/** The message shown when the bridge itself rejects (a refused permission, a host error). */
export function insertFailureToast(subject: string, error: unknown): InsertToast {
  const detail = error instanceof Error ? error.message : '';
  return {
    kind: 'error',
    title: 'Could not insert',
    message: detail ? `${subject}: ${detail}` : `${subject} was not inserted.`,
  };
}

/**
 * What the UI holds: one object that either inserts or reports itself unavailable. Callers
 * render `available` and call the methods; nothing else in the plugin touches `api.notes`.
 */
export interface InsertBridge {
  /** false when the host has no notes bridge — every insert control disables on this. */
  available: boolean;
  /** the title an insert control should carry, given {@link available}. */
  title: string;
  /** insert bare LaTeX at the cursor as display math. `subject` names it in the toast. */
  insertLatex(latex: string, subject: string): Promise<void>;
  /** insert a PNG data URL through the notes image pipeline. */
  insertImage(dataUrl: string, alt: string): Promise<void>;
}

/** The bridge every insert action in the plugin talks to. Never throws, never rejects. */
export function makeInsertBridge(
  notes: NotesApi | null | undefined,
  ui?: Pick<UiApi, 'toast'> | null,
): InsertBridge {
  const toast = (entry: InsertToast | null) => {
    if (entry && ui?.toast) ui.toast(entry.kind, entry.title, entry.message);
  };

  if (!hasNotesBridge(notes)) {
    return {
      available: false,
      title: INSERT_UNAVAILABLE_TITLE,
      insertLatex: () => Promise.resolve(),
      insertImage: () => Promise.resolve(),
    };
  }

  const settle = (
    call: Promise<NotesInsertResult>,
    subject: string,
  ): Promise<void> =>
    call.then(
      (result) => toast(insertToast(result, subject)),
      (error: unknown) => toast(insertFailureToast(subject, error)),
    );

  return {
    available: true,
    title: INSERT_TITLE,
    insertLatex: (latex, subject) =>
      settle(notes.insertLatex(latex, { display: true }), subject),
    insertImage: (dataUrl, alt) => settle(notes.insertImage({ dataUrl, alt }), alt),
  };
}
