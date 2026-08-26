/**
 * Math — the Graphing tool's expression rail (MATH2, sliders added in MATH3).
 *
 * Markup and class names ported from `MathPluginApproved.html`'s `.g-rail`: hairline-divided
 * rows, each with an index gutter carrying either the palette swatch, a warning triangle when
 * the row fails to parse, the dashed ghost swatch for the always-present blank next cell, or
 * — for an auto-created parameter slider — the slider glyph. Row actions (hide / remove) live
 * in `.g-cell-actions`, which the stylesheet reveals on hover or selection.
 *
 * The rail head's Add button focuses the blank tail rather than inserting a row — there is
 * always one waiting, which is the whole point of the Desmos idiom. The wireframe's undo /
 * redo ghost buttons are deliberately not rendered: an inert button lies about what works
 * (same call MATH1 made for the topbar's insert / settings actions).
 *
 * A slider cell has no delete action either, and that is deliberate: it exists because a row
 * above it names a free constant, so the way to remove it is to stop naming the constant.
 */

import { useRef } from 'react';
import { graphColorVar } from './lib/graphModel';
import type { GraphAction, GraphCell, RailCell } from './lib/graphModel';
import { formatSliderNumber, formatSliderRange, sliderFraction, valueAtFraction } from './lib/sliders';
import type { SliderState } from './lib/sliders';

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

function SliderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h18" />
      <circle cx="14" cy="12" r="3" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true">
      <path d="M1 0l6 4-6 4z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true">
      <path d="M1 0h2v8H1zM5 0h2v8H5z" />
    </svg>
  );
}

export function ExpressionRail({
  cells,
  activeId,
  tailId,
  animating,
  dispatch,
}: {
  cells: readonly RailCell[];
  activeId: string | null;
  /** id of the always-present blank tail, if the rail currently ends in one. */
  tailId: string | null;
  /** symbols the ▷ sweep is currently running for. */
  animating: Readonly<Record<string, unknown>>;
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
        {cells.map((entry) =>
          entry.kind === 'slider' ? (
            <SliderRow
              key={`slider:${entry.slider.symbol}`}
              index={entry.index}
              slider={entry.slider}
              playing={Boolean(animating[entry.slider.symbol])}
              dispatch={dispatch}
            />
          ) : (
            <ExpressionRow
              key={entry.cell.row.id}
              index={entry.index}
              cell={entry.cell}
              active={entry.cell.row.id === activeId}
              registerInput={(node) => {
                inputs.current.set(entry.cell.row.id, node);
              }}
              dispatch={dispatch}
            />
          ),
        )}
      </div>
    </div>
  );
}

function ExpressionRow({
  index,
  cell,
  active,
  registerInput,
  dispatch,
}: {
  index: number;
  cell: GraphCell;
  active: boolean;
  registerInput(node: HTMLInputElement | null): void;
  dispatch(action: GraphAction): void;
}) {
  const { row, blank, error } = cell;
  return (
    <div
      className={'g-cell' + (active ? ' g-cell-active' : '') + (error ? ' g-cell-error' : '')}
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
          ref={registerInput}
          className="g-input"
          type="text"
          value={row.src}
          placeholder={index === 1 ? 'y = …' : 'Add expression…'}
          aria-label={`Expression ${index}`}
          aria-invalid={error ? true : undefined}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => dispatch({ type: 'selectRow', id: row.id })}
          onChange={(event) => dispatch({ type: 'editRow', id: row.id, src: event.target.value })}
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
}

/**
 * The auto-created parameter slider (MATH3): ▷ / ‖, the `a = 2` readout, the range caption,
 * and the track.
 *
 * The track is a real `<input type="range">` under the wireframe's painted fill and thumb —
 * that buys keyboard stepping, arrow keys, and the pointer capture a drag needs, none of
 * which a `div` and a mousemove listener would get right by accident.
 */
function SliderRow({
  index,
  slider,
  playing,
  dispatch,
}: {
  index: number;
  slider: SliderState;
  playing: boolean;
  dispatch(action: GraphAction): void;
}) {
  const percent = `${Number((sliderFraction(slider) * 100).toFixed(3))}%`;
  const steps = Math.max(1, Math.round((slider.max - slider.min) / slider.step));
  return (
    <div className="g-cell g-cell-slider">
      <div className="g-gutter">
        <span className="g-idx">{index}</span>
        <span className="g-gutter-slider" title="Slider">
          <SliderIcon />
        </span>
      </div>

      <div className="g-cell-body">
        <div className="g-slider-head">
          <button
            className="g-play-btn"
            type="button"
            title={playing ? `Stop animating ${slider.symbol}` : `Animate ${slider.symbol}`}
            aria-pressed={playing}
            onClick={() => dispatch({ type: 'toggleAnimate', symbol: slider.symbol })}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span>
            {slider.symbol} = <span className="g-slider-val">{formatSliderNumber(slider.value)}</span>
          </span>
          <span className="g-slider-range">{formatSliderRange(slider)}</span>
        </div>

        <div className="g-slider-track">
          <div className="g-slider-fill" style={{ width: percent }} />
          <div className="g-slider-thumb" style={{ left: percent }} />
          <input
            className="g-slider-input"
            type="range"
            min={0}
            max={steps}
            step={1}
            value={Math.round(sliderFraction(slider) * steps)}
            aria-label={`Slider ${slider.symbol}`}
            aria-valuetext={`${slider.symbol} = ${formatSliderNumber(slider.value)}`}
            onChange={(event) =>
              dispatch({
                type: 'setSliderValue',
                symbol: slider.symbol,
                value: valueAtFraction(slider, Number(event.target.value) / steps),
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
