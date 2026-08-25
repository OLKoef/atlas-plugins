/**
 * Math — the Graphing tool (MATH2/MATH3): expression rail on the left, plot canvas on the
 * right, with parameter sliders in the rail and a pinned trace on the canvas.
 *
 * The tool owns its own reducer rather than borrowing a slice of the shell's. That is the
 * retention contract MATH1 set up cashing in: live panes stay **mounted** while hidden, so
 * tool-local state survives a tab switch for free. MATH3 adds the layer *below* that — the
 * `storage.graphing` section, so the rail survives closing the plugin, not just switching
 * away from it.
 *
 * Three effects, in the order they matter:
 *
 *  1. **restore once** on mount. Storage is async, so a restore that lands after the user has
 *     started typing must lose — the reducer's `hydrated` flag decides that, not this file.
 *  2. **save on change**, debounced. Dragging a slider fires a value per animation frame;
 *     without the debounce that is one read-modify-write of the whole blob per frame.
 *  3. **tick the ▷ sweep** while any slider is animating, at a fixed interval. The step
 *     itself is the reducer's (`advanceSlider`), so what lives here is only the timer.
 */

import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { StorageApi } from '@atlas/plugin-sdk';
import { ExpressionRail } from './ExpressionRail';
import { GraphCanvas } from './GraphCanvas';
import {
  blankTailId,
  graphCells,
  initialGraphState,
  plottedCurves,
  railCells,
  reduceGraph,
} from './lib/graphModel';
import { SLIDER_TICK_MS } from './lib/sliders';
import { resolveTrace } from './lib/trace';
import { graphingSnapshot, loadGraphing, saveGraphing } from './lib/persist';

/** Quiet period after the last change before the graph is written back to storage. */
const SAVE_DEBOUNCE_MS = 400;

export function Graphing({ storage }: { storage?: Pick<StorageApi, 'get' | 'set'> | null }) {
  const [state, dispatch] = useReducer(reduceGraph, initialGraphState);

  const cells = useMemo(() => graphCells(state.rows), [state.rows]);
  const curves = useMemo(() => plottedCurves(cells, state.sliders), [cells, state.sliders]);
  const rail = useMemo(() => railCells(cells, state.sliders), [cells, state.sliders]);
  const trace = useMemo(() => resolveTrace(curves, state.trace), [curves, state.trace]);
  const tailId = blankTailId(state);

  /**
   * Keys a newer build wrote inside `graphing` that this one does not understand. Held so a
   * save from here re-emits them — the same forward-compat contract the top-level blob has.
   */
  const extraRef = useRef<Record<string, unknown>>({});

  // 1 · Restore the saved graph once. A missing or malformed section parses to the empty
  // graph, and the reducer drops a restore that lands after the user already typed.
  useEffect(() => {
    if (!storage) return;
    let live = true;
    loadGraphing(storage)
      .then((saved) => {
        if (!live) return;
        extraRef.current = saved.extra;
        dispatch({
          type: 'hydrate',
          exprs: saved.exprs,
          sliders: saved.sliders,
          viewport: saved.viewport,
        });
      })
      .catch(() => {
        /* nothing to restore; the rail opens on its blank first row. */
      });
    return () => {
      live = false;
    };
  }, [storage]);

  // 2 · Save the persistable slice, debounced. Never before the restore has landed, or the
  // empty initial rail would overwrite the stored one on mount.
  useEffect(() => {
    if (!storage || !state.hydrated) return;
    const timer = setTimeout(() => {
      saveGraphing(storage, graphingSnapshot(state, extraRef.current)).catch(() => {
        /* best-effort persistence; a failed flush only costs the restore next time. */
      });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `state` is read whole inside the timer, but only these slices are persisted — so only
    // they should restart the debounce (selecting a row or pinning a trace must not).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, state.hydrated, state.rows, state.sliders, state.viewport]);

  // 3 · Drive the ▷ sweep while at least one slider is animating.
  const animatingCount = Object.keys(state.animating).length;
  useEffect(() => {
    if (animatingCount === 0) return;
    const timer = setInterval(() => dispatch({ type: 'tickAnimation' }), SLIDER_TICK_MS);
    return () => clearInterval(timer);
  }, [animatingCount]);

  return (
    <div className="g-tool">
      <ExpressionRail
        cells={rail}
        activeId={state.activeId}
        tailId={tailId}
        animating={state.animating}
        dispatch={dispatch}
      />
      <GraphCanvas
        curves={curves}
        viewport={state.viewport}
        trace={trace}
        dispatch={dispatch}
        onPickSuggestion={(src) => {
          if (tailId) dispatch({ type: 'editRow', id: tailId, src });
        }}
      />
    </div>
  );
}
