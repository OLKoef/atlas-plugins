/**
 * Math — a tool's pane inside the shell (MATH1).
 *
 * Each live tool gets one pane. MATH1 ships the pane *frame* plus the one thing every tool's
 * wireframe leads with — its draft input line (Graphing's always-present blank next cell,
 * Scientific's `›` input row, Matrix's compute line) — and that draft is the per-tool state
 * the shell proves it retains while the pane is hidden. MATH2 / MATH4 / MATH5 replace the
 * body below with the real rail + canvas, tape + keypad, and matrix rail + editor.
 *
 * Panes are never unmounted on a tool switch — only hidden — so once those tools own local
 * component state, that state survives a switch too.
 */

import { paneDomId, tabDomId } from './Topbar';
import type { LiveToolId } from './lib/shellModel';

interface ToolCopy {
  title: string;
  blurb: string;
  /** placeholder for the tool's draft input line, per the wireframe. */
  draftPlaceholder: string;
}

/** Copy taken from the approved wireframe's per-tool review notes. */
export const TOOL_COPY: Record<LiveToolId, ToolCopy> = {
  graphing: {
    title: 'Graphing',
    blurb:
      'Plot y = f(x) from an expression rail, with parameter sliders and a pannable, zoomable canvas.',
    draftPlaceholder: 'Add expression…',
  },
  scientific: {
    title: 'Scientific',
    blurb:
      'Keypad, tape and REPL in one — a live result preview while you type, DEG/RAD per evaluation.',
    draftPlaceholder: 'Type an expression…',
  },
  matrix: {
    title: 'Matrix',
    blurb:
      'Named matrices at any size — determinant, inverse, transpose, rank, and a free-form compute line.',
    draftPlaceholder: 'A × B',
  },
};

export function ToolPane({
  tool,
  active,
  draft,
  preview,
  onDraftChange,
}: {
  tool: LiveToolId;
  active: boolean;
  draft: string;
  /** live ghost result for the draft, or null when there is nothing to show. */
  preview: string | null;
  onDraftChange(src: string): void;
}) {
  const copy = TOOL_COPY[tool];
  return (
    <section
      id={paneDomId(tool)}
      className={`math-pane math-pane-${tool}`}
      role="tabpanel"
      aria-labelledby={tabDomId(tool)}
      hidden={!active}
    >
      <div className="pane-card">
        <h2 className="pane-title">{copy.title}</h2>
        <p className="pane-blurb">{copy.blurb}</p>
        <div className="pane-input-row">
          <span className="pane-prompt" aria-hidden="true">
            ›
          </span>
          <input
            className="pane-input"
            type="text"
            value={draft}
            placeholder={copy.draftPlaceholder}
            aria-label={`${copy.title} input`}
            onChange={(e) => onDraftChange(e.target.value)}
          />
          {preview ? <span className="pane-preview">= {preview}</span> : null}
        </div>
      </div>
    </section>
  );
}
