import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MathShell } from '../MathShell';
import { ExportMenu } from '../Topbar';
import { ToolPane } from '../ToolPane';
import { NOTHING_TO_EXPORT, buildExportItems } from '../lib/exportModel';
import type { ExportSubject } from '../lib/exportModel';
import { INSERT_UNAVAILABLE_TITLE } from '../lib/notes';
import type { LiveToolId, ToolDrafts } from '../lib/shellModel';

const noop = () => {};

const DRAFTS: ToolDrafts = { graphing: 'a·sin(x)', scientific: '3^4/2', matrix: 'A × B' };

function render(activeTool: LiveToolId, previews: Partial<Record<LiveToolId, string | null>> = {}) {
  return renderToStaticMarkup(
    <MathShell
      activeTool={activeTool}
      drafts={DRAFTS}
      previews={previews}
      onSelectTool={noop}
      onDraftChange={noop}
    />,
  );
}

/** Panes are hidden with the `hidden` attribute, so presence ≠ visibility. */
function paneIsHidden(html: string, tool: LiveToolId): boolean {
  const open = html.indexOf(`id="math-pane-${tool}"`);
  expect(open).toBeGreaterThan(-1);
  const tagEnd = html.indexOf('>', open);
  return html.slice(open, tagEnd).includes('hidden=""');
}

describe('MathShell topbar (MATH1)', () => {
  it('renders the ∑ brand mark', () => {
    expect(render('graphing')).toContain('∑');
  });

  it('renders the three live tools as real tabs', () => {
    const html = render('graphing');
    for (const label of ['Graphing', 'Scientific', 'Matrix']) {
      expect(html).toContain(`>${label}`);
    }
    expect(html).toContain('id="math-tab-graphing"');
    expect(html).toContain('id="math-tab-scientific"');
    expect(html).toContain('id="math-tab-matrix"');
  });

  it('renders Geometry and 3D as disabled "Soon" slots', () => {
    const html = render('graphing');
    for (const tool of ['geometry', '3d']) {
      const at = html.indexOf(`id="math-tab-${tool}"`);
      expect(at).toBeGreaterThan(-1);
      const tag = html.slice(at, html.indexOf('>', at));
      expect(tag).toContain('tt-disabled');
      expect(tag).toContain('disabled=""');
    }
    expect(html).toContain('Geometry');
    expect(html).toContain('3D');
    // Both carry the "Soon" tag — and only those two.
    expect(html.match(/class="soon-tag"/g)).toHaveLength(2);
  });

  it('marks exactly one tab active, following the selected tool', () => {
    const html = render('matrix');
    expect(html.match(/tool-tab tt-active/g)).toHaveLength(1);
    const at = html.indexOf('id="math-tab-matrix"');
    expect(html.slice(at, html.indexOf('>', at))).toContain('tt-active');
  });

  it('renders the wireframe’s export action, closed, as a menu button (MATH6)', () => {
    const html = render('graphing');
    const at = html.indexOf('title="Insert into note · Copy as LaTeX"');
    expect(at).toBeGreaterThan(-1);
    const tag = html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at));
    expect(tag).toContain('topbar-btn');
    expect(tag).toContain('aria-haspopup="menu"');
    expect(tag).toContain('aria-expanded="false"');
    // Nothing is open until it is pressed, so no menu is in the markup.
    expect(html).not.toContain('class="export-menu"');
  });

  it('renders the open menu’s rows, with insert disabled on a host without the bridge', () => {
    const subjects: ExportSubject[] = [
      { id: 'g', kind: 'latex', label: 'Expressions', latex: 'y = x' },
      { id: 'p', kind: 'image', label: 'Graph snapshot', capture: () => Promise.resolve(null) },
    ];
    const html = renderToStaticMarkup(
      <ExportMenu
        items={buildExportItems(subjects, {
          canInsert: false,
          insertReason: INSERT_UNAVAILABLE_TITLE,
        })}
        onRun={noop}
      />,
    );
    expect(html).toContain('Copy expressions as LaTeX');
    expect(html).toContain('Insert expressions into note');
    expect(html).toContain('Insert graph snapshot into note');
    // Both insert rows disabled and saying why; the copy row untouched.
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html.match(new RegExp(`title="${INSERT_UNAVAILABLE_TITLE}"`, 'g'))).toHaveLength(2);
  });

  it('says so plainly when the active tool has nothing to export', () => {
    const html = renderToStaticMarkup(<ExportMenu items={[]} onRun={noop} />);
    expect(html).toContain('export-menu-empty');
    expect(html).toContain(NOTHING_TO_EXPORT);
  });
});

describe('MathShell tool panes (MATH1)', () => {
  it('renders a pane for each of the three live tools and none for the disabled slots', () => {
    const html = render('graphing');
    expect(html.match(/class="math-pane /g)).toHaveLength(3);
    expect(html).not.toContain('math-pane-geometry');
    expect(html).not.toContain('math-pane-3d');
  });

  it('keeps hidden tools mounted so their state survives a switch', () => {
    // The structural half of "each tool keeps its state while hidden": inactive panes are
    // rendered (with their state intact) and merely hidden, never unmounted.
    const html = render('scientific');
    expect(paneIsHidden(html, 'scientific')).toBe(false);
    expect(paneIsHidden(html, 'graphing')).toBe(true);
    expect(paneIsHidden(html, 'matrix')).toBe(true);
    // The hidden panes are still rendered, rail and all, which is what lets each tool's own
    // reducer state survive the switch: Graphing's rail (MATH2), Scientific's tape (MATH4),
    // Matrix's rail and result history (MATH5).
    expect(html).toContain('g-rail');
    expect(html).toContain('sci-card');
    expect(html).toContain('mx-rail');
  });

  it('renders the shipped tools in their panes, not the placeholder card', () => {
    const html = render('graphing');
    expect(html).toContain('class="g-tool"');
    expect(html).toContain('class="g-rail"');
    expect(html).toContain('class="g-canvas"');
    // MATH4's Scientific pane is the tool now, keypad and all.
    expect(html).toContain('class="sci-card"');
    expect(html).toContain('class="keypad"');
    // …and MATH5's Matrix pane is its rail + editor, so no pane is a placeholder any more.
    expect(html).toContain('class="mx-tool"');
    expect(html).not.toContain('class="pane-card"');
  });

  it('shows only the selected tool', () => {
    const html = render('matrix');
    expect(paneIsHidden(html, 'matrix')).toBe(false);
    expect(paneIsHidden(html, 'graphing')).toBe(true);
    expect(paneIsHidden(html, 'scientific')).toBe(true);
  });

  it('renders the ghost result beside a placeholder pane’s input line', () => {
    // All three of v1's tools have shipped (MATH5 was the last), so the placeholder body is
    // now only reachable by a pane with no tool — the contract kept for a tool not yet built.
    // Rendered directly, since the shell no longer hands any pane a nullish child.
    const placeholder = (preview: string | null) =>
      renderToStaticMarkup(
        <ToolPane
          tool="matrix"
          active
          draft={DRAFTS.matrix}
          preview={preview}
          onDraftChange={noop}
        />,
      );
    expect(placeholder(null)).toContain(DRAFTS.matrix);
    expect(placeholder('40.5')).toContain('= 40.5');
    expect(placeholder(null)).not.toContain('pane-preview');
  });
});
