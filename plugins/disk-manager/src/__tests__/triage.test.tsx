import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Triage } from '../Triage';
import { TRIAGE_NOW_MS, mockTriageQueue, sortByReclaimValue } from '../triageModel';
import type { TriageItem } from '../triageModel';
import type { TriageTarget } from '../navigation';

const queue = sortByReclaimValue(mockTriageQueue(), TRIAGE_NOW_MS);
const byName = (n: string): TriageItem => {
  const found = queue.find((i) => i.name === n);
  if (!found) throw new Error(`no queue item ${n}`);
  return found;
};
const pdf = byName('Q3_Report_FINAL_v3.pdf'); // local file, 3 duplicates, evict disabled
const docx = byName('Thesis_Chapter2_backup.docx'); // downloaded iCloud file, evict enabled
const app = byName('Adobe Reader.app'); // application → uninstaller treatment

const noop = () => {};
const target: TriageTarget = {
  scope: 'local',
  label: 'Downloads',
  root: 'Downloads',
  source: 'treemap',
  bytes: 27 * 1024 ** 3,
};

function render(item: TriageItem, opts: { appConfirmed?: boolean; freedBytes?: number } = {}): string {
  return renderToStaticMarkup(
    <Triage
      item={item}
      index={0}
      total={4}
      freedBytes={opts.freedBytes ?? 0}
      target={target}
      appConfirmed={opts.appConfirmed ?? false}
      onToggleConfirm={noop}
      onAction={noop}
      onBack={noop}
      onOpenSummary={noop}
    />,
  );
}

/** The opening `<button …>` tag for a given action (so we can assert its `disabled` state). */
function buttonTag(html: string, action: string): string {
  const m = html.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`));
  if (!m) throw new Error(`no ${action} button rendered`);
  return m[0];
}

describe('Triage — locked action order + iconography', () => {
  const html = render(pdf);

  it('renders exactly three actions in Delete → Evict → Keep DOM order', () => {
    const di = html.indexOf('data-action="delete"');
    const ei = html.indexOf('data-action="evict"');
    const ki = html.indexOf('data-action="keep"');
    expect(di).toBeGreaterThanOrEqual(0);
    expect(di).toBeLessThan(ei);
    expect(ei).toBeLessThan(ki);
  });

  it('pins the arrows: Delete=left, Evict=up, Keep=right', () => {
    expect(buttonTag(html, 'delete')).toContain('data-arrow="left"');
    expect(buttonTag(html, 'evict')).toContain('data-arrow="up"');
    expect(buttonTag(html, 'keep')).toContain('data-arrow="right"');
    // The exact arrow polyline geometry from the approved wireframe.
    expect(html).toContain('points="12 19 5 12 12 5"'); // left  (Delete)
    expect(html).toContain('points="5 12 12 5 19 12"'); // up    (Evict)
    expect(html).toContain('points="12 5 19 12 12 19"'); // right (Keep)
  });

  it('labels the buttons Delete / Evict / Keep', () => {
    expect(html).toContain('data-action-lbl="delete">Delete<');
    expect(html).toContain('data-action-lbl="keep">Keep<');
  });

  it('shows the session progress and the running-tally pill', () => {
    expect(html).toContain('<b>1</b> of <b>4</b> in this session');
    expect(html).toContain('Space freed');
  });
});

describe('Triage — Evict eligibility (iCloud only)', () => {
  it('disables Evict and labels it local-only for a non-iCloud file', () => {
    const html = render(pdf);
    expect(buttonTag(html, 'evict')).toContain('disabled');
    expect(html).toContain('Evict (local only)');
  });

  it('enables Evict and shows the iCloud badge + full label for a downloaded iCloud file', () => {
    const html = render(docx);
    expect(buttonTag(html, 'evict')).not.toContain('disabled');
    expect(html).toContain('badge-accent');
    expect(html).toContain('iCloud Drive');
    expect(html).toContain('data-action-lbl="evict">Evict<');
  });
});

describe('Triage — duplicate pre-flagging', () => {
  it('shows the in-queue duplicate badge on a flagged card', () => {
    expect(render(pdf)).toContain('3 duplicates found');
    // A unique file carries no duplicate badge.
    expect(render(docx)).not.toContain('duplicates found');
  });
});

describe('Triage — app uninstaller treatment', () => {
  it('surfaces the DISK3 leftover Application Support / Caches / Preferences items', () => {
    const html = render(app);
    expect(html).toContain('uninstall-panel');
    expect(html).toContain('Also remove');
    expect(html).toContain('~/Library/Application Support/Adobe');
    expect(html).toContain('~/Library/Caches/com.adobe.reader');
    expect(html).toContain('~/Library/Preferences/com.adobe.reader.plist');
  });

  it('keeps Delete DISABLED until the confirm is checked — stronger than a plain swipe', () => {
    expect(buttonTag(render(app, { appConfirmed: false }), 'delete')).toContain('disabled');
    expect(buttonTag(render(app, { appConfirmed: true }), 'delete')).not.toContain('disabled');
  });

  it('a plain file has no uninstall panel and an immediately-enabled Delete', () => {
    const html = render(pdf);
    expect(html).not.toContain('uninstall-panel');
    expect(buttonTag(html, 'delete')).not.toContain('disabled');
  });
});
