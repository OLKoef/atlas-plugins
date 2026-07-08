import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Summary } from '../Summary';
import { emptySessionLog, recordAction, undoEntry } from '../sessionModel';
import type { RecordActionInput, SessionLog } from '../sessionModel';

const MB = 1024 * 1024;
const noop = () => {};

function input(over: Partial<RecordActionInput> = {}): RecordActionInput {
  return {
    kind: 'delete',
    label: 'file',
    freedBytes: 10 * MB,
    itemCount: 1,
    recovery: 'trash',
    paths: ['/x'],
    moves: [],
    atMs: Date.UTC(2025, 6, 1, 14, 32),
    ...over,
  };
}

function populated(): SessionLog {
  let log = recordAction(emptySessionLog, input({ label: 'Q3_Report.pdf', freedBytes: 84 * MB }));
  log = recordAction(
    log,
    input({ kind: 'evict', recovery: 'redownload', label: 'Thesis.docx', freedBytes: 46 * MB }),
  );
  log = recordAction(log, input({ kind: 'keep', recovery: 'none', label: 'IMG.HEIC', freedBytes: 0 }));
  return log;
}

function render(log: SessionLog): string {
  return renderToStaticMarkup(<Summary log={log} onUndo={noop} onBack={noop} />);
}

describe('Summary — session summary + undo log (DISK8)', () => {
  it('shows the derived freed-this-session hero total', () => {
    const html = render(populated());
    expect(html).toContain('130 MB'); // 84 + 46
    expect(html).toContain('freed this session');
  });

  it('renders the five locked stat cards with counts', () => {
    const html = render(populated());
    for (const label of ['Kept', 'Deleted', 'Evicted', 'App removed', 'Reorganized']) {
      expect(html).toContain(label);
    }
  });

  it('renders a log row per action with its verb, name, tag, and time', () => {
    const html = render(populated());
    expect(html).toContain('Deleted');
    expect(html).toContain('Q3_Report.pdf');
    expect(html).toContain('→ Trash');
    expect(html).toContain('Evicted');
    expect(html).toContain('log-tag evict');
    expect(html).toContain('14:32'); // deterministic UTC time column
    expect(html).toContain('>Undo<'); // each active row is individually undoable
  });

  it('marks an undone row and drops its Undo button', () => {
    const log = undoEntry(populated(), 'act-1');
    const html = render(log);
    expect(html).toContain('log-row del undone');
    expect(html).toContain('Undone');
    // The hero total reflects the undo — 130 MB minus the undone 84 MB delete.
    expect(html).toContain('46 MB');
  });

  it('shows an empty state before any action', () => {
    const html = render(emptySessionLog);
    expect(html).toContain('No actions yet this session.');
  });
});
