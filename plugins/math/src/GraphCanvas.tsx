/**
 * Math — the Graphing tool's plot canvas (MATH2).
 *
 * The drawing itself is function-plot's (pan/zoom via d3, unit grid, axis labels, its own
 * sampler); this component is the React seam around it — the wireframe's `.g-canvas` chrome
 * (zoom-in / zoom-out / reset stack, the window readout, the empty-state suggestion chips)
 * plus the lifecycle needed to drive an imperative chart from a reducer.
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
 * as already applied and rebuilds nothing. Together with `appliedKey` (curves + size), a
 * rebuild happens only when something actually changed.
 *
 * function-plot is loaded lazily (`lib/plot.ts`) and only ever touched inside these effects,
 * so nothing here runs — or needs a DOM — in the unit-test run.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Chart, FunctionPlotDatum, FunctionPlotOptions } from 'function-plot';
import { loadFunctionPlot } from './lib/plot';
import { SUGGESTION_CHIPS, graphColorVar, windowReadout } from './lib/graphModel';
import type { GraphAction, GraphCurve, GraphViewport } from './lib/graphModel';

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 9.5L12 3l9 6.5" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function sameViewport(a: GraphViewport, b: GraphViewport | null): boolean {
  if (!b) return false;
  return (
    a.xDomain[0] === b.xDomain[0] &&
    a.xDomain[1] === b.xDomain[1] &&
    a.yDomain[0] === b.yDomain[0] &&
    a.yDomain[1] === b.yDomain[1]
  );
}

/** Everything a rebuild depends on besides the window: which curves, at what size. */
function buildKey(curves: readonly GraphCurve[], width: number, height: number): string {
  return `${width}x${height}|${curves.map((c) => `${c.id}:${c.color}:${c.fn}`).join('|')}`;
}

export function GraphCanvas({
  curves,
  viewport,
  onPickSuggestion,
  dispatch,
}: {
  curves: readonly GraphCurve[];
  viewport: GraphViewport;
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

  // The `all:zoom` listener is attached once per chart, so it reads the current reducer
  // through a ref rather than closing over a stale dispatch.
  const reportViewport = useRef<(next: GraphViewport) => void>(() => {});
  useEffect(() => {
    reportViewport.current = (next) => dispatch({ type: 'setViewport', viewport: next });
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
        }
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });

    return () => {
      cancelled = true;
    };
  }, [curves, viewport, size.width, size.height]);

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
      <div className="g-plot-host" ref={hostRef} />

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
