/**
 * Math — what the topbar's export action offers, per tool (MATH6).
 *
 * The wireframe's topbar carries one button, titled *"Insert into note · Copy as LaTeX"* —
 * two verbs over whatever the tool in front of you is holding. This file is that "whatever",
 * as data: each tool contributes {@link ExportSubject}s describing what it currently has
 * worth exporting, and {@link buildExportItems} turns those into the menu's rows.
 *
 * Keeping it pure is what makes the gating testable without a DOM: whether an insert row is
 * disabled is a function of the subjects and one boolean, not of a click that did nothing.
 *
 * Two shapes of subject, because they export differently:
 *
 *  - **latex** — copyable *and* insertable. The clipboard is always there, so its copy row is
 *    never disabled; the insert row follows the bridge.
 *  - **image** — the graph snapshot. Insert only: it goes through the notes image pipeline,
 *    and a PNG on the clipboard is a different API than the text one the rest of the plugin
 *    uses. With no bridge, it has no working action at all — which is why it says so rather
 *    than disappearing.
 */

import { computeEntryLatex, graphRailLatex, matrixDefLatex, tapeLatex, tapeRowLatex } from './latex';
import type { TapeRow } from './eval';
import type { MatrixDef } from './matrix';
import type { ComputeEntry } from './matrixModel';
import type { LiveToolId } from './shellModel';

export type ExportSubject =
  | { id: string; kind: 'latex'; label: string; latex: string }
  /** `capture` resolves null when the snapshot cannot be taken (see `lib/snapshot.ts`). */
  | { id: string; kind: 'image'; label: string; capture(): Promise<string | null> };

/** One row of the export menu: a subject plus the verb applied to it. */
export interface ExportItem {
  id: string;
  label: string;
  action: 'copy' | 'insert';
  subject: ExportSubject;
  disabled: boolean;
  /** why it is disabled — rendered as the row's title, never as a silent grey-out. */
  reason?: string;
}

/** What the menu says when the active tool has nothing worth exporting yet. */
export const NOTHING_TO_EXPORT = 'Nothing to export from this tool yet';

/** A tool contributes its subjects through one of these; see `MathPanel`'s registry. */
export type ExportProvider = () => ExportSubject[];
export type RegisterExports = (tool: LiveToolId, provider: ExportProvider | null) => void;

/** "Expressions" → "expressions", but "Matrix A" → "matrix A". */
function midSentence(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * The menu's rows for the given subjects. `canInsert` is the notes bridge's `available` —
 * false disables every insert row and says why, and touches no copy row.
 */
export function buildExportItems(
  subjects: readonly ExportSubject[],
  opts: { canInsert: boolean; insertReason?: string },
): ExportItem[] {
  const items: ExportItem[] = [];
  for (const subject of subjects) {
    if (subject.kind === 'latex') {
      items.push({
        id: `${subject.id}:copy`,
        label: `Copy ${midSentence(subject.label)} as LaTeX`,
        action: 'copy',
        subject,
        disabled: false,
      });
    }
    items.push({
      id: `${subject.id}:insert`,
      label: `Insert ${midSentence(subject.label)} into note`,
      action: 'insert',
      subject,
      disabled: !opts.canInsert,
      ...(opts.canInsert ? {} : { reason: opts.insertReason }),
    });
  }
  return items;
}

/* ------------------------------------------------------------------ *
 * What each tool contributes
 * ------------------------------------------------------------------ */

/**
 * Graphing: the rail as one aligned block, and the canvas as a picture. Both appear only once
 * something is plotted — a snapshot of an empty grid is not what the button promises.
 */
export function graphExportSubjects(
  sources: readonly string[],
  capture: () => Promise<string | null>,
): ExportSubject[] {
  const written = sources.filter((src) => src.trim() !== '');
  if (written.length === 0) return [];
  return [
    { id: 'graph-exprs', kind: 'latex', label: 'Expressions', latex: graphRailLatex(written) },
    { id: 'graph-png', kind: 'image', label: 'Graph snapshot', capture },
  ];
}

/**
 * Scientific: the last answer, and — once there is more than one — the tape as a worked
 * calculation. Failed rows carry no result, so they are not export subjects.
 */
export function scientificExportSubjects(tape: readonly TapeRow[]): ExportSubject[] {
  const rows = tape.filter((row) => !row.failed);
  const last = rows[rows.length - 1];
  if (!last) return [];
  const subjects: ExportSubject[] = [
    { id: 'sci-last', kind: 'latex', label: 'Last result', latex: tapeRowLatex(last) },
  ];
  if (rows.length > 1) {
    subjects.push({ id: 'sci-tape', kind: 'latex', label: 'Whole tape', latex: tapeLatex(rows) });
  }
  return subjects;
}

/** Matrix: the matrix being edited, and the newest result card (the history is newest-first). */
export function matrixExportSubjects(
  active: MatrixDef | null,
  history: readonly ComputeEntry[],
): ExportSubject[] {
  const subjects: ExportSubject[] = [];
  if (active) {
    subjects.push({
      id: 'mx-matrix',
      kind: 'latex',
      label: `Matrix ${active.name}`,
      latex: matrixDefLatex(active),
    });
  }
  const newest = history[0];
  if (newest) {
    subjects.push({
      id: 'mx-result',
      kind: 'latex',
      label: 'Last result',
      latex: computeEntryLatex(newest),
    });
  }
  return subjects;
}
