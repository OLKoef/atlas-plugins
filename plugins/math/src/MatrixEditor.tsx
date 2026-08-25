/**
 * Math — the Matrix tool's grid editor (MATH5).
 *
 * Markup and class names ported from `MathPluginApproved.html`'s `.mx-editor-head` +
 * `.mx-bracketed`: the title, the two steppers, the four quick-op chips, and the bracketed
 * grid of cells. Two departures from the static wireframe, both forced by "any n × n, no cap":
 *
 *  - the grid's column count is inline (`repeat(n, auto)`) rather than a `.mx-grid-3` class,
 *    and it sits in a scroller — the wireframe's fixed 3-wide grid is one size of a shape
 *    that has none;
 *  - a stepper's `−` stops at {@link MIN_DIM} rather than going to zero. Resizing preserves
 *    entries (`resizeMatrix`), so stepping down and back up is non-destructive as long as
 *    nothing was typed in between — which is the contract the steppers promise.
 *
 * Cells are `<input>`s over *text*, not numbers: a cell being cleared to be retyped is `''`,
 * a state no number holds. What that text means is `lib/matrix.ts`'s question, asked once a
 * computation actually needs it.
 */

import type { ReactNode } from 'react';
import { MIN_DIM, QUICK_OPS } from './lib/matrix';
import type { MatrixDef } from './lib/matrix';
import type { MatrixAction } from './lib/matrixModel';

/** The wireframe's `[ … ]` frame — shared by the editor grid and every matrix result. */
export function Bracketed({ children }: { children: ReactNode }) {
  return (
    <div className="mx-bracketed">
      <div className="mx-bk mx-bk-l" aria-hidden="true" />
      {children}
      <div className="mx-bk mx-bk-r" aria-hidden="true" />
    </div>
  );
}

/** A grid style for `cols` columns — the one part of the wireframe's grid that must be live. */
export function gridColumns(cols: number): { gridTemplateColumns: string } {
  return { gridTemplateColumns: `repeat(${cols}, auto)` };
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(next: number): void;
}) {
  return (
    <>
      <span className="stepper-label">{label}</span>
      <span className="stepper">
        <button
          className="stepper-btn"
          type="button"
          title={`One fewer ${label.toLowerCase().replace(/s$/, '')}`}
          aria-label={`Remove ${label.toLowerCase().replace(/s$/, '')}`}
          disabled={value <= MIN_DIM}
          onClick={() => onChange(value - 1)}
        >
          −
        </button>
        <span className="stepper-val">{value}</span>
        <button
          className="stepper-btn"
          type="button"
          title={`One more ${label.toLowerCase().replace(/s$/, '')}`}
          aria-label={`Add ${label.toLowerCase().replace(/s$/, '')}`}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </span>
    </>
  );
}

export function MatrixEditor({
  def,
  dispatch,
}: {
  def: MatrixDef;
  dispatch(action: MatrixAction): void;
}) {
  return (
    <>
      <div className="mx-editor-head">
        <span className="mx-editor-title">
          Matrix <span className="mono">{def.name}</span>
        </span>
        <span className="mx-steppers">
          <Stepper
            label="Rows"
            value={def.rows}
            onChange={(rows) => dispatch({ type: 'resize', id: def.id, rows, cols: def.cols })}
          />
          <span className="stepper-x">×</span>
          <Stepper
            label="Cols"
            value={def.cols}
            onChange={(cols) => dispatch({ type: 'resize', id: def.id, rows: def.rows, cols })}
          />
        </span>
        <div className="mx-chips">
          {QUICK_OPS.map((op) => (
            <button
              key={op.id}
              className="mx-chip"
              type="button"
              title={op.title}
              onClick={() => dispatch({ type: 'quickOp', op: op.id })}
            >
              {op.label(def.name)}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-grid-scroll">
        <Bracketed>
          <div className="mx-grid" style={gridColumns(def.cols)}>
            {def.cells.map((row, r) =>
              row.map((text, c) => (
                <input
                  key={`${r}:${c}`}
                  className="mx-cell"
                  type="text"
                  inputMode="decimal"
                  value={text}
                  aria-label={`${def.name} row ${r + 1} column ${c + 1}`}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) =>
                    dispatch({
                      type: 'setCell',
                      id: def.id,
                      row: r,
                      col: c,
                      text: event.target.value,
                    })
                  }
                />
              )),
            )}
          </div>
        </Bracketed>
      </div>
    </>
  );
}
