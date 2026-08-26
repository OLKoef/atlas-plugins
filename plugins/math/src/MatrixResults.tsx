/**
 * Math — the Matrix tool's result history (MATH5).
 *
 * The wireframe's `.mx-results`: one card per computed line, the expression in the head with
 * copy / copy-as-LaTeX beside it, and the value below — a big `.mx-scalar` for a determinant
 * or a rank, the bracketed grid for a matrix.
 *
 * `→ C` appears only on a matrix card, and it is labelled with the name the result *would*
 * take, so the button says what it is about to do. The chips and the compute line both land
 * here, which is the spec's "sharing one result history" made structural: the cards know
 * nothing about which one produced them.
 */

import { useState } from 'react';
import { Bracketed, gridColumns } from './MatrixEditor';
import { COPIED_MS, writeClipboard } from './lib/clipboard';
import { formatNumber, isSavableResult, resultText } from './lib/matrix';
import type { ComputeEntry, MatrixAction } from './lib/matrixModel';
import { computeEntryLatex } from './lib/latex';

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

export function MatrixResults({
  entries,
  nextName,
  dispatch,
}: {
  entries: readonly ComputeEntry[];
  /** the name `→ C` would give the next saved result. */
  nextName: string;
  dispatch(action: MatrixAction): void;
}) {
  // Which action last confirmed a copy, as `${entryId}:${kind}` — the same feedback-without-a
  // -toast the tape uses, so neither tool needs the `ui` API to say the copy landed.
  const [copied, setCopied] = useState<string | null>(null);

  function copy(mark: string, text: string) {
    writeClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(mark);
      setTimeout(() => setCopied((current) => (current === mark ? null : current)), COPIED_MS);
    });
  }

  if (entries.length === 0) return null;

  return (
    <div className="mx-results" role="log" aria-label="Results">
      {entries.map((entry) => (
        <div key={entry.id} className="mx-result-card">
          <div className="mx-result-head">
            <span className="mx-result-expr">{entry.src} =</span>
            <div className="mx-result-acts">
              <button
                className="tape-act-btn"
                type="button"
                title="Copy as LaTeX"
                onClick={() => copy(`${entry.id}:latex`, computeEntryLatex(entry))}
              >
                {copied === `${entry.id}:latex` ? '✓' : 'TeX'}
              </button>
              <button
                className="tape-act-btn"
                type="button"
                title="Copy result"
                onClick={() => copy(`${entry.id}:result`, resultText(entry.result))}
              >
                {copied === `${entry.id}:result` ? '✓' : <CopyIcon />}
              </button>
              {isSavableResult(entry.result) ? (
                <button
                  className="tape-act-btn mx-save-btn"
                  type="button"
                  title={`Save as matrix ${nextName}`}
                  onClick={() => dispatch({ type: 'saveResult', id: entry.id })}
                >
                  → {nextName}
                </button>
              ) : null}
            </div>
          </div>

          {entry.result.kind === 'scalar' ? (
            <span className="mx-scalar">{formatNumber(entry.result.value)}</span>
          ) : (
            <Bracketed>
              <div className="mx-grid mx-grid-result" style={gridColumns(entry.result.cols)}>
                {entry.result.cells.map((row, r) =>
                  row.map((value, c) => (
                    <span key={`${r}:${c}`} className="mx-rcell">
                      {formatNumber(value)}
                    </span>
                  )),
                )}
              </div>
            </Bracketed>
          )}
        </div>
      ))}
    </div>
  );
}
