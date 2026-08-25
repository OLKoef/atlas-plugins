/**
 * Math — the Scientific tool's history tape (MATH4).
 *
 * Markup and class names ported from `MathPluginApproved.html`'s `.tape`: one hairline row
 * per committed line, the expression on the left, the result on the right, and the mode tag
 * between them **only when the mode decided the answer** — `sin(45)` is tagged, `√(2)` is
 * not, exactly as the wireframe draws it.
 *
 * Hovering a row reveals copy / copy-as-LaTeX / insert-into-note. Insert renders **disabled**
 * rather than hidden: the wireframe's third action is real, its bridge is not (MATH6 + the
 * Dashboard-side MATH7 `notes:insert` API), and a disabled control with a reason says that
 * where a missing one would just look like a gap.
 *
 * A failed row carries no actions — there is no result to copy, only the reason there isn't.
 */

import { useState } from 'react';
import type { RefObject } from 'react';
import { tapeRowLatex } from './lib/eval';
import type { TapeRow } from './lib/eval';

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function InsertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3h7v7" />
      <path d="M21 3l-9 9" />
      <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

/**
 * Best-effort clipboard write. The host is an Electron renderer, so `navigator.clipboard` is
 * there — but a plugin has no business throwing because it wasn't.
 */
function writeClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard;
  if (!clipboard?.writeText) return Promise.resolve(false);
  return clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

/** How long a copied action shows its confirmation before returning to its icon. */
const COPIED_MS = 1200;

export function Tape({
  rows,
  containerRef,
}: {
  rows: readonly TapeRow[];
  /** the scrolling element, so the tool can keep the newest row in view. */
  containerRef?: RefObject<HTMLDivElement>;
}) {
  // Which action last confirmed a copy, as `${rowId}:${kind}` — feedback with no toast, so
  // the tool needs no `ui` API to tell the user the copy landed.
  const [copied, setCopied] = useState<string | null>(null);

  function copy(mark: string, text: string) {
    writeClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(mark);
      setTimeout(() => setCopied((current) => (current === mark ? null : current)), COPIED_MS);
    });
  }

  return (
    <div className="tape" role="log" aria-label="History tape" ref={containerRef}>
      {rows.map((row) => (
        <div key={row.id} className={'tape-row' + (row.failed ? ' tape-row-failed' : '')}>
          <span className="tape-expr">{row.src}</span>
          {row.angular ? <span className="tape-unit-tag">{row.angleMode}</span> : null}
          <span className={'tape-result' + (row.failed ? ' tape-result-failed' : '')}>
            {row.result}
          </span>

          {row.failed ? null : (
            <div className="tape-actions">
              <button
                className="tape-act-btn"
                type="button"
                title="Copy result"
                onClick={() => copy(`${row.id}:result`, row.result)}
              >
                {copied === `${row.id}:result` ? '✓' : <CopyIcon />}
              </button>
              <button
                className="tape-act-btn"
                type="button"
                title="Copy as LaTeX"
                onClick={() => copy(`${row.id}:latex`, tapeRowLatex(row))}
              >
                {copied === `${row.id}:latex` ? '✓' : 'TeX'}
              </button>
              <button
                className="tape-act-btn"
                type="button"
                disabled
                title="Insert into note — coming soon"
              >
                <InsertIcon />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
