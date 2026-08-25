import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MathShell } from '../MathShell';
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
    // rendered (with their draft intact) and merely hidden, never unmounted.
    const html = render('scientific');
    expect(paneIsHidden(html, 'scientific')).toBe(false);
    expect(paneIsHidden(html, 'graphing')).toBe(true);
    expect(paneIsHidden(html, 'matrix')).toBe(true);
    for (const draft of Object.values(DRAFTS)) {
      expect(html).toContain(draft);
    }
  });

  it('shows only the selected tool', () => {
    const html = render('matrix');
    expect(paneIsHidden(html, 'matrix')).toBe(false);
    expect(paneIsHidden(html, 'graphing')).toBe(true);
    expect(paneIsHidden(html, 'scientific')).toBe(true);
  });

  it('renders the ghost result beside the input line when there is one', () => {
    expect(render('scientific', { scientific: '40.5' })).toContain('= 40.5');
    // No preview for the tools that do not have one.
    expect(render('graphing')).not.toContain('pane-preview');
  });
});
