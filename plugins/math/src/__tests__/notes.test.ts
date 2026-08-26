import { describe, expect, it, vi } from 'vitest';
import type { NotesApi, NotesInsertResult, ToastKind } from '@atlas/plugin-sdk';
import {
  INSERT_TITLE,
  INSERT_UNAVAILABLE_TITLE,
  hasNotesBridge,
  insertFailureToast,
  insertToast,
  makeInsertBridge,
} from '../lib/notes';

/**
 * MATH6's gate. MATH7 is Dashboard-side, so the plugin has to work on a host that has the
 * bridge and on one that does not — and say which it is looking at without a user having to
 * click something that turns out to do nothing.
 */

type Toast = { kind: ToastKind; title: string; message?: string };

function fakeUi() {
  const toasts: Toast[] = [];
  return {
    toasts,
    toast: (kind: ToastKind, title: string, message?: string) => {
      toasts.push({ kind, title, message });
    },
  };
}

function fakeNotes(result: NotesInsertResult | Error): NotesApi & {
  latex: ReturnType<typeof vi.fn>;
  image: ReturnType<typeof vi.fn>;
} {
  const settle = () =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  const latex = vi.fn(settle);
  const image = vi.fn(settle);
  return {
    latex,
    image,
    insertLatex: latex as unknown as NotesApi['insertLatex'],
    insertText: vi.fn(settle) as unknown as NotesApi['insertText'],
    insertImage: image as unknown as NotesApi['insertImage'],
  };
}

const AT_CURSOR: NotesInsertResult = { ok: true, placement: 'cursor', noteId: 'n1' };

describe('detecting the bridge', () => {
  it('accepts a host that implements it', () => {
    expect(hasNotesBridge(fakeNotes(AT_CURSOR))).toBe(true);
  });

  it('treats a missing namespace as absent — a host older than MATH7', () => {
    expect(hasNotesBridge(undefined)).toBe(false);
    expect(hasNotesBridge(null)).toBe(false);
  });

  it('treats a half-implemented namespace as absent', () => {
    // An action that works for LaTeX and throws for an image is worse than one that never
    // offered itself, so a partial bridge does not count as one.
    const partial = { insertLatex: () => Promise.resolve(AT_CURSOR) } as unknown as NotesApi;
    expect(hasNotesBridge(partial)).toBe(false);
  });
});

describe('the insert bridge without a host bridge', () => {
  it('reports itself unavailable, with the reason as its title', () => {
    const bridge = makeInsertBridge(undefined, fakeUi());
    expect(bridge.available).toBe(false);
    expect(bridge.title).toBe(INSERT_UNAVAILABLE_TITLE);
  });

  it('is inert rather than throwing when a control calls it anyway', async () => {
    const ui = fakeUi();
    const bridge = makeInsertBridge(null, ui);
    await expect(bridge.insertLatex('x^2', 'Last result')).resolves.toBeUndefined();
    await expect(bridge.insertImage('data:image/png;base64,AAA', 'Graph')).resolves.toBeUndefined();
    expect(ui.toasts).toEqual([]);
  });
});

describe('the insert bridge with a host bridge', () => {
  it('sends bare LaTeX as display math and toasts where it landed', async () => {
    const notes = fakeNotes(AT_CURSOR);
    const ui = fakeUi();
    const bridge = makeInsertBridge(notes, ui);

    expect(bridge.available).toBe(true);
    expect(bridge.title).toBe(INSERT_TITLE);

    await bridge.insertLatex('\\sqrt{2} = 1.4142136', '√(2) = 1.4142136');
    expect(notes.latex).toHaveBeenCalledWith('\\sqrt{2} = 1.4142136', { display: true });
    expect(ui.toasts).toEqual([
      { kind: 'success', title: 'Inserted into note', message: '√(2) = 1.4142136' },
    ]);
  });

  it('sends a snapshot through the image pipeline, alt text and all', async () => {
    const notes = fakeNotes(AT_CURSOR);
    const bridge = makeInsertBridge(notes, fakeUi());
    await bridge.insertImage('data:image/png;base64,AAA', 'Graph snapshot');
    expect(notes.image).toHaveBeenCalledWith({
      dataUrl: 'data:image/png;base64,AAA',
      alt: 'Graph snapshot',
    });
  });

  it('says it appended when no cursor was there to insert at', async () => {
    const ui = fakeUi();
    const bridge = makeInsertBridge(fakeNotes({ ok: true, placement: 'appended' }), ui);
    await bridge.insertLatex('x^{2}', 'Expressions');
    expect(ui.toasts).toEqual([
      { kind: 'success', title: 'Appended to note', message: 'Expressions' },
    ]);
  });

  it('reports "no note open" as information, not as a failure', () => {
    expect(insertToast({ ok: true, placement: 'none' }, 'Last result')).toEqual({
      kind: 'info',
      title: 'No note open',
      message: 'Last result was not inserted.',
    });
    expect(insertToast({ ok: true, placement: 'appended' }, 'Last result')?.kind).toBe('success');
    expect(insertToast({ ok: false, placement: 'none' }, 'Last result')?.kind).toBe('error');
  });

  it('surfaces a rejected call — a refused permission is not a crash', async () => {
    const ui = fakeUi();
    const bridge = makeInsertBridge(fakeNotes(new Error('notes:insert not granted')), ui);
    await expect(bridge.insertLatex('x^2', 'Expressions')).resolves.toBeUndefined();
    expect(ui.toasts).toEqual([
      {
        kind: 'error',
        title: 'Could not insert',
        message: 'Expressions: notes:insert not granted',
      },
    ]);
  });

  it('still inserts when the host offers no toast surface', async () => {
    const notes = fakeNotes(AT_CURSOR);
    const bridge = makeInsertBridge(notes, null);
    await bridge.insertLatex('x^2', 'Expressions');
    expect(notes.latex).toHaveBeenCalledOnce();
  });

  it('names the subject in a failure with no message of its own', () => {
    expect(insertFailureToast('Graph snapshot', 'nope')).toEqual({
      kind: 'error',
      title: 'Could not insert',
      message: 'Graph snapshot was not inserted.',
    });
  });
});
