import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpressionRail } from '../ExpressionRail';
import { GraphCanvas } from '../GraphCanvas';
import {
  DEFAULT_VIEWPORT,
  SUGGESTION_CHIPS,
  blankTailId,
  graphCells,
  initialGraphState,
  plottedCurves,
  reduceGraph,
} from '../lib/graphModel';
import type { GraphState } from '../lib/graphModel';

const noop = () => {};

function typeIntoTail(state: GraphState, src: string): GraphState {
  return reduceGraph(state, { type: 'editRow', id: blankTailId(state) as string, src });
}

/** The wireframe's error state: one valid curve, one unparseable row, one blank tail. */
function errorState(): GraphState {
  let state = typeIntoTail(initialGraphState, 'x^2/4 − 2');
  state = typeIntoTail(state, '2x^3 −');
  return state;
}

function renderRail(state: GraphState) {
  return renderToStaticMarkup(
    <ExpressionRail
      cells={graphCells(state.rows)}
      activeId={state.activeId}
      tailId={blankTailId(state)}
      dispatch={noop}
    />,
  );
}

function renderCanvas(state: GraphState) {
  return renderToStaticMarkup(
    <GraphCanvas
      curves={plottedCurves(graphCells(state.rows))}
      viewport={state.viewport}
      onPickSuggestion={noop}
      dispatch={noop}
    />,
  );
}

describe('expression rail render (MATH2)', () => {
  it('renders hairline rows with an index gutter', () => {
    const html = renderRail(errorState());
    // `g-cell` exactly, or with a modifier — not `g-cell-body` / `g-cell-actions`.
    expect(html.match(/class="g-cell[ "]/g)).toHaveLength(3);
    for (const index of ['1', '2', '3']) {
      expect(html).toContain(`<span class="g-idx">${index}</span>`);
    }
  });

  it('gives a plotted row its palette swatch as a CSS var', () => {
    const html = renderRail(typeIntoTail(initialGraphState, 'sin(x)'));
    expect(html).toContain('class="g-swatch"');
    expect(html).toContain('background:var(--graph-blue)');
  });

  it('marks a hidden row’s swatch rather than dropping the row', () => {
    const state = typeIntoTail(initialGraphState, 'sin(x)');
    const hidden = reduceGraph(state, { type: 'toggleVisible', id: state.rows[0].id });
    const html = renderRail(hidden);
    expect(html).toContain('g-swatch g-swatch-hidden');
    expect(html).toContain('value="sin(x)"');
    expect(html).toContain('title="Show curve"');
  });

  it('shows the blank next cell with a ghost swatch and no actions', () => {
    const html = renderRail(initialGraphState);
    expect(html).toContain('class="g-swatch-ghost"');
    expect(html).toContain('placeholder="y = …"');
    expect(html).not.toContain('g-cell-actions');
  });

  it('marks only the failing row, with the warning gutter and the inline message', () => {
    const html = renderRail(errorState());
    expect(html.match(/g-cell g-cell-error/g)).toHaveLength(1);
    expect(html.match(/class="g-gutter-warn"/g)).toHaveLength(1);
    expect(html).toContain('Unexpected end of expression');
    // The valid row above still carries its colour swatch.
    expect(html).toContain('background:var(--graph-blue)');
  });

  it('offers hide + remove on a valid row, remove only on an errored one', () => {
    const html = renderRail(errorState());
    expect(html.match(/title="Hide curve"/g)).toHaveLength(1);
    expect(html.match(/title="Remove"/g)).toHaveLength(2);
  });

  it('marks the selected row so its actions and accent edge show', () => {
    const state = typeIntoTail(initialGraphState, 'sin(x)');
    const selected = reduceGraph(state, { type: 'selectRow', id: state.rows[0].id });
    expect(renderRail(selected).match(/g-cell g-cell-active/g)).toHaveLength(1);
  });
});

describe('plot canvas chrome (MATH2)', () => {
  it('renders the zoom-in / zoom-out / reset stack', () => {
    const html = renderCanvas(initialGraphState);
    expect(html.match(/class="g-zoom-btn"/g)).toHaveLength(3);
    for (const title of ['Zoom in', 'Zoom out', 'Reset view']) {
      expect(html).toContain(`title="${title}"`);
    }
  });

  it('renders the window readout for the current viewport', () => {
    expect(renderCanvas(initialGraphState)).toContain('−6.7 ≤ x ≤ 6.7 · −4.9 ≤ y ≤ 4.9');
    const zoomed = reduceGraph(initialGraphState, { type: 'resetView' });
    expect(zoomed.viewport).toEqual(DEFAULT_VIEWPORT);
  });

  it('shows the suggestion chips while nothing is plotted', () => {
    const html = renderCanvas(initialGraphState);
    expect(html).toContain('Plot your first expression');
    for (const chip of SUGGESTION_CHIPS) {
      expect(html).toContain(`>${chip}</button>`);
    }
  });

  it('drops the empty state as soon as a curve is drawn', () => {
    const html = renderCanvas(typeIntoTail(initialGraphState, 'sin(x)'));
    expect(html).not.toContain('g-empty-hint');
    expect(html).not.toContain('Plot your first expression');
  });

  it('still shows the chips when only a broken row exists', () => {
    const html = renderCanvas(typeIntoTail(initialGraphState, '2x^3 −'));
    expect(html).toContain('g-hint-chips');
  });

  it('renders the host the plotter mounts into without importing it', () => {
    // function-plot is only ever touched inside an effect, which SSR never runs — that is
    // what keeps the DOM-less unit run free of d3.
    expect(renderCanvas(initialGraphState)).toContain('class="g-plot-host"');
  });
});
