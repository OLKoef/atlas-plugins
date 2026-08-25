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
  railCells,
  reduceGraph,
} from '../lib/graphModel';
import type { GraphState } from '../lib/graphModel';
import { resolveTrace } from '../lib/trace';

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
      cells={railCells(graphCells(state.rows), state.sliders)}
      activeId={state.activeId}
      tailId={blankTailId(state)}
      animating={state.animating}
      dispatch={noop}
    />,
  );
}

function renderCanvas(state: GraphState) {
  const curves = plottedCurves(graphCells(state.rows), state.sliders);
  return renderToStaticMarkup(
    <GraphCanvas
      curves={curves}
      viewport={state.viewport}
      trace={resolveTrace(curves, state.trace)}
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

  it('draws no trace overlay until the chart exists to project it', () => {
    // The pin is placed through function-plot's own scales, so — like the curves themselves —
    // it only appears once the chart has been built. `trace.test.ts` covers the geometry.
    const state = typeIntoTail(initialGraphState, 'sin(x)');
    const pinned = reduceGraph(state, {
      type: 'setTrace',
      trace: { rowId: state.rows[0].id, x: 1 },
    });
    expect(renderCanvas(pinned)).not.toContain('g-trace');
  });
});

describe('parameter slider cell (MATH3)', () => {
  /** The wireframe's default rail: `a·sin(x)`, its slider, `x²/4 − 2`, the blank tail. */
  function sliderState(): GraphState {
    let state = typeIntoTail(initialGraphState, 'a·sin(x)');
    state = typeIntoTail(state, 'x^2/4 − 2');
    return reduceGraph(state, { type: 'setSliderValue', symbol: 'a', value: 2 });
  }

  it('renders the slider cell beneath its row, in the same index gutter', () => {
    const html = renderRail(sliderState());
    expect(html.match(/class="g-cell[ "]/g)).toHaveLength(4);
    expect(html).toContain('class="g-cell g-cell-slider"');
    for (const index of ['1', '2', '3', '4']) {
      expect(html).toContain(`<span class="g-idx">${index}</span>`);
    }
    // …and the slider glyph rather than a colour swatch in its gutter.
    expect(html.match(/class="g-gutter-slider"/g)).toHaveLength(1);
  });

  it('writes the wireframe’s head: ▷, `a = 2`, and the range caption', () => {
    const html = renderRail(sliderState());
    expect(html).toContain('<span class="g-slider-val">2</span>');
    expect(html).toContain('−5 ≤ a ≤ 5 · step 0.1');
    expect(html).toContain('title="Animate a"');
  });

  it('paints the track fill and thumb at the value’s position', () => {
    // a = 2 over −5…5 sits 70% along, exactly where the wireframe draws it.
    const html = renderRail(sliderState());
    expect(html).toContain('class="g-slider-fill" style="width:70%"');
    expect(html).toContain('class="g-slider-thumb" style="left:70%"');
  });

  it('offers a real range input, so the drag has keyboard and pointer behaviour', () => {
    const html = renderRail(sliderState());
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="Slider a"');
    expect(html).toContain('aria-valuetext="a = 2"');
  });

  it('flips ▷ to ‖ while the sweep is running', () => {
    const running = reduceGraph(sliderState(), { type: 'toggleAnimate', symbol: 'a' });
    const html = renderRail(running);
    expect(html).toContain('title="Stop animating a"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('gives a slider cell no hide or delete action — it is owned by its row', () => {
    // Removing it means no longer naming the constant, so an action here would lie.
    const only = renderRail(typeIntoTail(initialGraphState, 'a·x'));
    expect(only.match(/title="Remove"/g)).toHaveLength(1);
    expect(only.match(/title="Hide curve"/g)).toHaveLength(1);
  });

  it('drops the cell as soon as nothing names the constant', () => {
    const state = typeIntoTail(initialGraphState, 'a·x');
    const edited = reduceGraph(state, { type: 'editRow', id: state.rows[0].id, src: '2x' });
    expect(renderRail(edited)).not.toContain('g-cell-slider');
  });
});
