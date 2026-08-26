/**
 * Math — the Matrix tool's rail (MATH5): the named matrices, and the new-matrix flow.
 *
 * Markup and class names ported from `MathPluginApproved.html`'s `.mx-rail`: a head with the
 * count pill, one `.mx-item` per matrix (dot glyph, name, `3 × 3` caption), and the dashed
 * `+ New matrix` button pinned to the bottom.
 *
 * The size chooser is one component ({@link NewMatrixSizes}) used twice — inside the rail's
 * popover and inline in the empty-state hero — because the wireframe draws the same three
 * presets plus `n × n…` in both places, and a second copy would be a second thing to keep in
 * step with the model.
 *
 * Each rail item carries a delete action revealed on hover, the same treatment (and the same
 * icon) the Graphing rail gives a row. The wireframe does not draw one, but a rail that can
 * only grow strands storage the user cannot reach; deleting is how a name is freed for reuse.
 */

import { MIN_DIM, NEW_MATRIX_SIZES, matrixLabel } from './lib/matrix';
import type { MatrixDef } from './lib/matrix';
import type { MatrixAction } from './lib/matrixModel';

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
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

/** How many dots a rail glyph draws per side — a 9 × 9 matrix is still three dots wide. */
const GLYPH_MAX = 3;

function Glyph({ rows, cols }: { rows: number; cols: number }) {
  const r = Math.min(rows, GLYPH_MAX);
  const c = Math.min(cols, GLYPH_MAX);
  const small = r <= 2 && c <= 2;
  return (
    <span
      className={'mx-glyph' + (small ? ' mx-glyph-2' : '')}
      style={{ gridTemplateColumns: `repeat(${c}, ${small ? 4 : 3}px)` }}
      aria-hidden="true"
    >
      {Array.from({ length: r * c }, (_unused, index) => (
        <i key={index} />
      ))}
    </span>
  );
}

/** The `Size  2 × 2 · 3 × 3 · 4 × 4 · n × n…` row, shared by the rail popover and the hero. */
export function NewMatrixSizes({
  rows,
  cols,
  custom,
  dispatch,
}: {
  rows: number;
  cols: number;
  custom: boolean;
  dispatch(action: MatrixAction): void;
}) {
  return (
    <>
      <div className="mx-hero-sizes">
        <span className="mx-hero-sizes-label">Size</span>
        {NEW_MATRIX_SIZES.map((size) => (
          <button
            key={size}
            className={
              'mx-chip' + (!custom && rows === size && cols === size ? ' mx-chip-active' : '')
            }
            type="button"
            aria-pressed={!custom && rows === size && cols === size}
            onClick={() => dispatch({ type: 'setNewSize', rows: size, cols: size })}
          >
            {matrixLabel(size, size)}
          </button>
        ))}
        <button
          className={'mx-chip' + (custom ? ' mx-chip-active' : '')}
          type="button"
          title="Enter custom rows × columns"
          aria-pressed={custom}
          onClick={() => dispatch({ type: 'setCustomSize', rows, cols })}
        >
          n × n…
        </button>
      </div>

      {custom ? (
        <div className="mx-custom">
          <input
            className="mx-custom-field"
            type="number"
            min={MIN_DIM}
            value={rows}
            aria-label="Custom rows"
            onChange={(event) =>
              dispatch({ type: 'setCustomSize', rows: Number(event.target.value), cols })
            }
          />
          <span className="stepper-x">×</span>
          <input
            className="mx-custom-field"
            type="number"
            min={MIN_DIM}
            value={cols}
            aria-label="Custom columns"
            onChange={(event) =>
              dispatch({ type: 'setCustomSize', rows, cols: Number(event.target.value) })
            }
          />
        </div>
      ) : null}
    </>
  );
}

export function MatrixRail({
  matrices,
  activeId,
  newOpen,
  newRows,
  newCols,
  newCustom,
  dispatch,
}: {
  matrices: readonly MatrixDef[];
  activeId: string | null;
  newOpen: boolean;
  newRows: number;
  newCols: number;
  newCustom: boolean;
  dispatch(action: MatrixAction): void;
}) {
  return (
    <div className="mx-rail">
      <div className="mx-rail-head">
        <span className="mx-rail-title">Matrices</span>
        <span className="mx-count">{matrices.length}</span>
      </div>

      <div className="mx-list">
        {matrices.map((def) => {
          const active = def.id === activeId;
          return (
            <div key={def.id} className={'mx-item' + (active ? ' mx-item-active' : '')}>
              <button
                className="mx-item-open"
                type="button"
                aria-pressed={active}
                onClick={() => dispatch({ type: 'select', id: def.id })}
              >
                <Glyph rows={def.rows} cols={def.cols} />
                <span className="mx-item-name">{def.name}</span>
                <span className="mx-item-dim">{matrixLabel(def.rows, def.cols)}</span>
              </button>
              <button
                className="mx-item-del"
                type="button"
                title={`Delete matrix ${def.name}`}
                aria-label={`Delete matrix ${def.name}`}
                onClick={() => dispatch({ type: 'remove', id: def.id })}
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>

      {newOpen ? (
        <div className="mx-new-panel">
          <NewMatrixSizes
            rows={newRows}
            cols={newCols}
            custom={newCustom}
            dispatch={dispatch}
          />
          <div className="mx-new-actions">
            <button
              className="mx-new-cancel"
              type="button"
              onClick={() => dispatch({ type: 'closeNew' })}
            >
              Cancel
            </button>
            <button
              className="mx-hero-btn mx-new-create"
              type="button"
              onClick={() => dispatch({ type: 'create' })}
            >
              Create
            </button>
          </div>
        </div>
      ) : null}

      <button
        className="mx-new-btn"
        type="button"
        aria-expanded={newOpen}
        onClick={() => dispatch({ type: newOpen ? 'closeNew' : 'openNew' })}
      >
        <PlusIcon /> New matrix
      </button>
    </div>
  );
}
