/**
 * Math — the Graphing tool's plot canvas (MATH2, trace point added in MATH3).
 *
 * The drawing itself is function-plot's (pan/zoom via d3, unit grid, axis labels, its own
 * sampler); this component is the React seam around it — the wireframe's `.g-canvas` chrome
 * (zoom-in / zoom-out / reset stack, the window readout, the empty-state suggestion chips,
 * the pinned trace tooltip) plus the lifecycle needed to drive an imperative chart from a
 * reducer.
 *
 * Two directions of viewport change have to coexist without fighting:
 *
 *  - **programmatic** — the zoom stack and reset push a new window *into* the chart, which
 *    means overriding the panned domains function-plot keeps on the options object;
 *  - **interactive** — a drag or wheel-zoom reports the chart's new domains back *out* to the
 *    reducer so the readout follows.
 *
 * `appliedViewport` is what tells them apart: the `all:zoom` listener records the window it
 * is about to report before reporting it, so the re-render that follows recognises the value
 * as already applied and rebuilds nothing. Together with `appliedKey` (curves + slider scope
 * + size), a rebuild happens only when something actually changed.
 *
 * Parameter values reach the sampler as each datum's `scope`, which function-plot merges into
 * the variables it evaluates `fn` with — so dragging a slider re-samples the same compiled
 * expression instead of rewriting it.
 *
 * The trace is **ours, not function-plot's**: its tip follows the pointer, while the
 * wireframe pins a point on click. So the dot, its drop line and the tooltip are an absolutely
 * positioned overlay, placed through the chart's own d3 scales (`meta.xScale`) rather than a
 * re-derivation of function-plot's margins.
 *
 * function-plot is loaded lazily (`lib/plot.ts`) and only ever touched inside these effects,
 * so nothing here runs — or needs a DOM — in the unit-test run.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Chart, FunctionPlotDatum, FunctionPlotOptions } from 'function-plot';
import { loadFunctionPlot } from './lib/plot';
import { SUGGESTION_CHIPS, graphColorVar, windowReadout } from './lib/graphModel';
import type { GraphAction, GraphCurve, GraphViewport } from './lib/graphModel';
import { formatTraceLabel, pickTrace } from './lib/trace';
import type { ResolvedTrace } from './lib/trace';

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 9.5L12 3l9 6.5" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

/** How near a click has to land, in pixels, to count as hitting a curve. */
const TRACE_HIT_RADIUS = 14;

function sameViewport(a: GraphViewport, b: GraphViewport | null): boolean {
  if (!b) return false;
  return (
    a.xDomain[0] === b.xDomain[0] &&
    a.xDomain[1] === b.xDomain[1] &&
    a.yDomain[0] === b.yDomain[0] &&
    a.yDomain[1] === b.yDomain[1]
  );
}

/** Everything a rebuild depends on besides the window: which curves, at what values, size. */
function buildKey(curves: readonly GraphCurve[], width: number, height: number): string {
  const data = curves
    .map((curve) => `${curve.id}:${curve.color}:${curve.fn}:${JSON.stringify(curve.scope)}`)
    .join('|');
  return `${width}x${height}|${data}`;
}

export function GraphCanvas({
  curves,
  viewport,
  trace,
  onPickSuggestion,
  dispatch,
}: {
  curves: readonly GraphCurve[];
  viewport: GraphViewport;
  /** the pinned trace resolved against the curves being drawn now, or null. */
  trace: ResolvedTrace | null;
  onPickSuggestion(src: string): void;
  dispatch(action: GraphAction): void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const optionsRef = useRef<FunctionPlotOptions | null>(null);
  const appliedViewport = useRef<GraphViewport | null>(null);
  const appliedKey = useRef<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [unavailable, setUnavailable] = useState(false);
  /** Where the trace overlay draws, in host pixels — recomputed whenever the chart redraws. */
  const [tracePixel, setTracePixel] = useState<{ left: number; top: number } | null>(null);
  /** Last pointer position in data space, as reported by function-plot's own mousemove. */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  // The chart needs explicit pixel dimensions, so the host's size is state, not CSS.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      setSize({ width: Math.round(box.width), height: Math.round(box.height) });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Listeners are attached once per chart, so they read the current reducer and the current
  // curves through refs rather than closing over stale values.
  const reportViewport = useRef<(next: GraphViewport) => void>(() => {});
  const reportTrace = useRef<(at: { x: number; y: number }) => void>(() => {});
  useEffect(() => {
    reportViewport.current = (next) => dispatch({ type: 'setViewport', viewport: next });
    reportTrace.current = (at) => {
      const chart = chartRef.current;
      const yScale = chart?.meta.yScale;
      if (!yScale) return;
      // A pixel radius only becomes a distance in data units once the scale is known — and
      // it changes with every zoom, which is why it is computed per click.
      const tolerance = Math.abs(yScale.invert(0) - yScale.invert(TRACE_HIT_RADIUS));
      dispatch({ type: 'setTrace', trace: pickTrace(curves, at, tolerance) });
    };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || size.width < 1 || size.height < 1) return;

    const key = buildKey(curves, size.width, size.height);
    if (chartRef.current && appliedKey.current === key && sameViewport(viewport, appliedViewport.current)) {
      return; // nothing changed — most often our own `all:zoom` report coming back around.
    }

    let cancelled = false;
    loadFunctionPlot()
      .then((functionPlot) => {
        if (cancelled) return;

        // function-plot augments the options object with internal state (including the
        // panned domains), so the same object is reused across builds — that is also what
        // keeps it returning the same cached Chart instead of stacking up SVGs.
        let options = optionsRef.current;
        if (!options) {
          options = {
            target: host,
            grid: true,
            xAxis: { domain: [viewport.xDomain[0], viewport.xDomain[1]] },
            yAxis: { domain: [viewport.yDomain[0], viewport.yDomain[1]] },
            data: [],
          };
          optionsRef.current = options;
        } else if (!sameViewport(viewport, appliedViewport.current)) {
          // A zoom-stack press or reset — override the window function-plot is holding.
          options.xAxis = { ...options.xAxis, domain: [viewport.xDomain[0], viewport.xDomain[1]] };
          options.yAxis = { ...options.yAxis, domain: [viewport.yDomain[0], viewport.yDomain[1]] };
          delete options.xDomain;
          delete options.yDomain;
        }

        options.width = size.width;
        options.height = size.height;
        options.data = curves.map(
          (curve): FunctionPlotDatum => ({
            fn: curve.fn,
            // Parameter values the sampler merges in when evaluating `fn` — this is what
            // makes a slider drag re-plot without touching the expression itself.
            scope: curve.scope,
            // A CSS var, so the host's light/dark switch recolours curves with no redraw.
            color: graphColorVar(curve.color),
            graphType: 'polyline',
            skipTip: true,
          }),
        );

        const chart = functionPlot(options);
        appliedViewport.current = viewport;
        appliedKey.current = key;

        if (chartRef.current !== chart) {
          chartRef.current = chart;
          chart.on('all:zoom', () => {
            const meta = chart.meta;
            const x = meta.xScale?.domain();
            const y = meta.yScale?.domain();
            if (!x || !y) return;
            const next: GraphViewport = { xDomain: [x[0], x[1]], yDomain: [y[0], y[1]] };
            // Record before reporting: the render this triggers must not rebuild.
            appliedViewport.current = next;
            reportViewport.current(next);
          });
          // function-plot already converts the pointer into data space against its own
          // scales (margins included); tracking its last position is cheaper and more
          // accurate than redoing that conversion for the click.
          chart.on('mousemove', (at: { x: number; y: number }) => {
            pointerRef.current = at;
          });
        }
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });

    return () => {
      cancelled = true;
    };
  }, [curves, viewport, size.width, size.height]);

  const onCanvasClick = useCallback(() => {
    const at = pointerRef.current;
    if (at) reportTrace.current(at);
  }, []);

  // Project the pinned point into host pixels. Runs after the chart effect (and after any
  // pan/zoom, which changes `viewport`), so the scales it reads are the ones just drawn.
  useEffect(() => {
    const chart = chartRef.current;
    const meta = chart?.meta;
    if (!trace || !meta?.xScale || !meta.yScale) {
      setTracePixel(null);
      return;
    }
    setTracePixel({
      left: (meta.margin?.left ?? 0) + meta.xScale(trace.x),
      top: (meta.margin?.top ?? 0) + meta.yScale(trace.y),
    });
  }, [trace, viewport, size.width, size.height, curves]);

  // Drop the chart on unmount so a remount builds a fresh one rather than reviving the
  // cached instance against a detached node.
  useEffect(() => {
    const host = hostRef.current;
    return () => {
      chartRef.current = null;
      optionsRef.current = null;
      appliedKey.current = null;
      appliedViewport.current = null;
      if (host) host.innerHTML = '';
    };
  }, []);

  const zoomIn = useCallback(() => dispatch({ type: 'zoomIn' }), [dispatch]);
  const zoomOut = useCallback(() => dispatch({ type: 'zoomOut' }), [dispatch]);
  const resetView = useCallback(() => dispatch({ type: 'resetView' }), [dispatch]);

  return (
    <div className="g-canvas">
      {/* The click pins a trace; the pointer position it resolves against is function-plot's
          own, tracked above. Pinning is additive and undone by clicking empty space. */}
      <div className="g-plot-host" ref={hostRef} onClick={onCanvasClick} />

      {trace && tracePixel ? (
        <div
          className="g-trace"
          style={{ left: `${tracePixel.left}px`, top: `${tracePixel.top}px` }}
        >
          <span className="g-trace-dot" style={{ background: graphColorVar(trace.color) }} />
          <span className="g-trace-tip" role="status">
            {formatTraceLabel(trace.x, trace.y)}
          </span>
        </div>
      ) : null}

      {curves.length === 0 ? (
        <div className="g-empty-hint">
          <p>
            {unavailable
              ? 'The plotter could not be loaded.'
              : 'Plot your first expression — or try one of these'}
          </p>
          {unavailable ? null : (
            <div className="g-hint-chips">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip}
                  className="g-hint-chip"
                  type="button"
                  onClick={() => onPickSuggestion(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="g-window-readout">{windowReadout(viewport)}</div>

      <div className="g-zoom-stack">
        <button className="g-zoom-btn" type="button" title="Zoom in" onClick={zoomIn}>
          +
        </button>
        <button className="g-zoom-btn" type="button" title="Zoom out" onClick={zoomOut}>
          −
        </button>
        <button className="g-zoom-btn" type="button" title="Reset view" onClick={resetView}>
          <ResetIcon />
        </button>
      </div>
    </div>
  );
}
