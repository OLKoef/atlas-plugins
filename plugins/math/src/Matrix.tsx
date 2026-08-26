/**
 * Math — the Matrix tool (MATH5): the rail of named matrices on the left, the grid editor and
 * the compute line on the right.
 *
 * Same two effects as the other two tools, for the same reasons: **restore once** on mount
 * (the reducer's `hydrated` flag decides a late restore, not this file) and a **debounced
 * save** of the persisted slice — typing into a cell is a keystroke-per-character stream, and
 * without the debounce that is one read-modify-write of the whole blob per character.
 *
 * The keyboard contract is the compute line's: `↵` evaluates, `Esc` clears it. Bound to the
 * field rather than the document, so an open Math panel never swallows a host shortcut.
 */

import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { StorageApi } from '@atlas/plugin-sdk';
import { MatrixEditor } from './MatrixEditor';
import { MatrixRail, NewMatrixSizes } from './MatrixRail';
import { MatrixResults } from './MatrixResults';
import { matrixExportSubjects } from './lib/exportModel';
import type { ExportProvider, RegisterExports } from './lib/exportModel';
import { activeMatrix, initialMatrixState, nextName, reduceMatrix } from './lib/matrixModel';
import type { MatrixAction, MatrixState } from './lib/matrixModel';
import { loadMatrixSection, matrixSeeds, matrixSnapshot, saveMatrixSection } from './lib/persist';

/** Quiet period after the last change before the rail is written back to storage. */
const SAVE_DEBOUNCE_MS = 400;

function ErrorBangIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v6M8 12v1" />
    </svg>
  );
}

/** The wireframe's empty state: the dashed glyph, the copy, and the new-matrix flow. */
function MatrixHero({
  state,
  dispatch,
}: {
  state: MatrixState;
  dispatch(action: MatrixAction): void;
}) {
  return (
    <div className="mx-hero">
      <div className="mx-hero-glyph" aria-hidden="true">
        {Array.from({ length: 9 }, (_unused, index) => (
          <i key={index} />
        ))}
      </div>
      <h3>No matrices yet</h3>
      <p>
        Create matrix <span className="mono">A</span> to start computing — determinants,
        inverses, products and more. Any size, from 2 × 2 up.
      </p>
      <button className="mx-hero-btn" type="button" onClick={() => dispatch({ type: 'create' })}>
        + New matrix
      </button>
      <NewMatrixSizes
        rows={state.newRows}
        cols={state.newCols}
        custom={state.newCustom}
        dispatch={dispatch}
      />
    </div>
  );
}

/**
 * The compute row and its inline error. The error treatment is the graphing rail's, by
 * design: the same destructive row plus a one-line message under it, so a dimension mismatch
 * reads the same way a parse error does two tools over.
 */
export function MatrixCompute({
  name,
  input,
  error,
  dispatch,
}: {
  /** the selected matrix, only to write the placeholder in terms of it. */
  name: string;
  input: string;
  error: string | null;
  dispatch(action: MatrixAction): void;
}) {
  return (
    <>
      <div className="mx-compute-label">Compute</div>
      <div className={'mx-compute-row' + (error ? ' mx-compute-row-error' : '')}>
        <input
          className="mx-compute-input"
          type="text"
          value={input}
          placeholder={`${name} × B · 2${name} + B · det(${name})`}
          aria-label="Compute"
          aria-invalid={error ? true : undefined}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => dispatch({ type: 'setInput', src: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              dispatch({ type: 'submit' });
            } else if (event.key === 'Escape') {
              event.preventDefault();
              dispatch({ type: 'setInput', src: '' });
            }
          }}
        />
        <button
          className="mx-run-btn"
          type="button"
          title="Evaluate"
          aria-label="Evaluate"
          onClick={() => dispatch({ type: 'submit' })}
        >
          ↵
        </button>
      </div>
      {error ? (
        <div className="mx-error-msg" role="status">
          <ErrorBangIcon />
          {error}
        </div>
      ) : null}
    </>
  );
}

export function Matrix({
  storage,
  registerExports,
}: {
  storage?: Pick<StorageApi, 'get' | 'set'> | null;
  /** MATH6: what the topbar's export action offers while this tool is the active one. */
  registerExports?: RegisterExports | null;
}) {
  const [state, dispatch] = useReducer(reduceMatrix, initialMatrixState);

  const active = useMemo(() => activeMatrix(state), [state]);
  const saveName = useMemo(() => nextName(state), [state]);

  /** Keys a newer build wrote inside `matrix`; held so a save from here re-emits them. */
  const extraRef = useRef<Record<string, unknown>>({});

  // 1 · Restore the saved rail once. A missing or malformed section parses to an empty rail,
  // and the reducer drops a restore that lands after the user already created a matrix.
  useEffect(() => {
    if (!storage) return;
    let live = true;
    loadMatrixSection(storage)
      .then((saved) => {
        if (!live) return;
        extraRef.current = saved.extra;
        dispatch({ type: 'hydrate', ...matrixSeeds(saved) });
      })
      .catch(() => {
        /* nothing to restore; the rail opens on its empty hero. */
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
      saveMatrixSection(storage, matrixSnapshot(state, extraRef.current)).catch(() => {
        /* best-effort persistence; a failed flush only costs the restore next time. */
      });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Only the persisted slice should restart the debounce — selecting a matrix must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, state.hydrated, state.matrices, state.history]);

  // 3 · Offer this tool's exports to the topbar (MATH6): the matrix being edited and the
  // newest result card, read through a stable provider when the menu opens.
  const latest = useRef<ExportProvider>(() => []);
  useEffect(() => {
    latest.current = () => matrixExportSubjects(active, state.history);
  });
  useEffect(() => {
    if (!registerExports) return;
    registerExports('matrix', () => latest.current());
    return () => registerExports('matrix', null);
  }, [registerExports]);

  return (
    <div className="mx-tool">
      <MatrixRail
        matrices={state.matrices}
        activeId={state.activeId}
        newOpen={state.newOpen}
        newRows={state.newRows}
        newCols={state.newCols}
        newCustom={state.newCustom}
        dispatch={dispatch}
      />

      <div className="mx-main">
        {active ? (
          <>
            <MatrixEditor def={active} dispatch={dispatch} />
            <MatrixCompute
              name={active.name}
              input={state.input}
              error={state.error}
              dispatch={dispatch}
            />
            <MatrixResults entries={state.history} nextName={saveName} dispatch={dispatch} />
          </>
        ) : (
          <MatrixHero state={state} dispatch={dispatch} />
        )}
      </div>
    </div>
  );
}
