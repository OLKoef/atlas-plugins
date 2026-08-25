/**
 * Math — the Graphing tool (MATH2): expression rail on the left, plot canvas on the right.
 *
 * The tool owns its own reducer rather than borrowing a slice of the shell's. That is the
 * retention contract MATH1 set up cashing in: live panes stay **mounted** while hidden, so
 * tool-local state survives a tab switch for free. Writing any of it to `storage` is MATH3's
 * job (alongside sliders and the trace point), which is why nothing here touches the API.
 */

import { useMemo, useReducer } from 'react';
import { ExpressionRail } from './ExpressionRail';
import { GraphCanvas } from './GraphCanvas';
import { blankTailId, graphCells, initialGraphState, plottedCurves, reduceGraph } from './lib/graphModel';

export function Graphing() {
  const [state, dispatch] = useReducer(reduceGraph, initialGraphState);

  const cells = useMemo(() => graphCells(state.rows), [state.rows]);
  const curves = useMemo(() => plottedCurves(cells), [cells]);
  const tailId = blankTailId(state);

  return (
    <div className="g-tool">
      <ExpressionRail cells={cells} activeId={state.activeId} tailId={tailId} dispatch={dispatch} />
      <GraphCanvas
        curves={curves}
        viewport={state.viewport}
        dispatch={dispatch}
        onPickSuggestion={(src) => {
          if (tailId) dispatch({ type: 'editRow', id: tailId, src });
        }}
      />
    </div>
  );
}
