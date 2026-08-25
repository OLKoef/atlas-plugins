/**
 * Math — the copy actions' clipboard write (MATH4's tape rows, MATH5's result cards).
 *
 * The host is an Electron renderer, so `navigator.clipboard` is there — but a plugin has no
 * business throwing because it wasn't. The boolean is what the caller needs: it decides
 * whether to show the ✓ confirmation, which is how these actions report success without the
 * tool needing the `ui.toast` API for it.
 */

/** How long a copied action shows its confirmation before returning to its icon. */
export const COPIED_MS = 1200;

/** Best-effort clipboard write; resolves false rather than rejecting. */
export function writeClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard;
  if (!clipboard?.writeText) return Promise.resolve(false);
  return clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}
