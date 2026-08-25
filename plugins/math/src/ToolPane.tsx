/**
 * Math — a tool's pane inside the shell (MATH1).
 *
 * Each live tool gets one pane, rendering that tool as its `children` (MATH2: Graphing's rail
 * + canvas; MATH4: Scientific's tape + keypad; MATH5: Matrix's rail + editor). All three of
 * v1's tools have shipped, so the MATH1 placeholder body below is now the *fallback* rather
 * than a stage: the draft input line every tool's wireframe leads with, kept for a tool that
 * has not been built yet (Geometry / 3D, were either promoted off the roadmap).
 *
 * Panes are never unmounted on a tool switch — only hidden — so a shipped tool's own local
 * component state survives a switch too.
 */

import type { ReactNode } from 'react';
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
  children,
}: {
  tool: LiveToolId;
  active: boolean;
  draft: string;
  /** live ghost result for the draft, or null when there is nothing to show. */
  preview: string | null;
  onDraftChange(src: string): void;
  /** the shipped tool for this pane; absent tools fall back to the placeholder body. */
  children?: ReactNode;
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
      {children ?? <PlaceholderBody copy={copy} draft={draft} preview={preview} onDraftChange={onDraftChange} />}
    </section>
  );
}

/** MATH1's pane body — the fallback for a tool that has not been built (see the module note). */
function PlaceholderBody({
  copy,
  draft,
  preview,
  onDraftChange,
}: {
  copy: ToolCopy;
  draft: string;
  preview: string | null;
  onDraftChange(src: string): void;
}) {
  return (
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
  );
}
