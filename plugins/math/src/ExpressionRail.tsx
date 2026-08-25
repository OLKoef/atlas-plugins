/**
 * Math — the Graphing tool's expression rail (MATH2).
 *
 * Markup and class names ported from `MathPluginApproved.html`'s `.g-rail`: hairline-divided
 * rows, each with an index gutter carrying either the palette swatch, a warning triangle when
 * the row fails to parse, or the dashed ghost swatch for the always-present blank next cell.
 * Row actions (hide / remove) live in `.g-cell-actions`, which the stylesheet reveals on
 * hover or selection.
 *
 * The rail head's Add button focuses the blank tail rather than inserting a row — there is
 * always one waiting, which is the whole point of the Desmos idiom. The wireframe's undo /
 * redo ghost buttons are deliberately not rendered: an inert button lies about what works
 * (same call MATH1 made for the topbar's insert / settings actions).
 */

import { useRef } from 'react';
import { graphColorVar } from './lib/graphModel';
import type { GraphAction, GraphCell } from './lib/graphModel';

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3L2 21h20L12 3z" />
      <path d="M12 10v5" />
      <path d="M12 18.5v.5" />
    </svg>
  );
}

function ErrorBangIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v6M8 12v1" />
    </svg>
  );
}

export function ExpressionRail({
  cells,
  activeId,
  tailId,
  dispatch,
}: {
  cells: readonly GraphCell[];
  activeId: string | null;
  /** id of the always-present blank tail, if the rail currently ends in one. */
  tailId: string | null;
  dispatch(action: GraphAction): void;
}) {
  const inputs = useRef(new Map<string, HTMLInputElement | null>());

  function focusTail() {
    if (!tailId) return;
    dispatch({ type: 'selectRow', id: tailId });
    inputs.current.get(tailId)?.focus();
  }

  return (
    <div className="g-rail">
      <div className="g-rail-head">
        <button className="g-add-btn" type="button" onClick={focusTail}>
          <PlusIcon /> Add
        </button>
        <div className="topbar-spacer" />
      </div>

      <div className="g-list">
        {cells.map((cell) => {
          const { row, index, blank, error } = cell;
          const active = row.id === activeId;
          return (
            <div
              key={row.id}
              className={
                'g-cell' + (active ? ' g-cell-active' : '') + (error ? ' g-cell-error' : '')
              }
            >
              <div className="g-gutter">
                <span className="g-idx">{index}</span>
                {blank ? (
                  <span className="g-swatch-ghost" />
                ) : error ? (
                  <span className="g-gutter-warn" title="This row cannot be plotted">
                    <WarningIcon />
                  </span>
                ) : (
                  <span
                    className={'g-swatch' + (row.visible ? '' : ' g-swatch-hidden')}
                    style={{ background: graphColorVar(row.color) }}
                  />
                )}
              </div>

              <div className="g-cell-body">
                <input
                  ref={(node) => {
                    inputs.current.set(row.id, node);
                  }}
                  className="g-input"
                  type="text"
                  value={row.src}
                  placeholder={index === 1 ? 'y = …' : 'Add expression…'}
                  aria-label={`Expression ${index}`}
                  aria-invalid={error ? true : undefined}
                  spellCheck={false}
                  autoComplete="off"
                  onFocus={() => dispatch({ type: 'selectRow', id: row.id })}
                  onChange={(event) =>
                    dispatch({ type: 'editRow', id: row.id, src: event.target.value })
                  }
                />
                {error ? (
                  <div className="g-error-msg" role="status">
                    <ErrorBangIcon />
                    {error}
                  </div>
                ) : null}
              </div>

              {blank ? null : (
                <div className="g-cell-actions">
                  {error ? null : (
                    <button
                      className="g-cell-btn"
                      type="button"
                      title={row.visible ? 'Hide curve' : 'Show curve'}
                      aria-pressed={!row.visible}
                      onClick={() => dispatch({ type: 'toggleVisible', id: row.id })}
                    >
                      <EyeIcon />
                    </button>
                  )}
                  <button
                    className="g-cell-btn g-del"
                    type="button"
                    title="Remove"
                    onClick={() => dispatch({ type: 'deleteRow', id: row.id })}
                  >
                    <CloseIcon />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
