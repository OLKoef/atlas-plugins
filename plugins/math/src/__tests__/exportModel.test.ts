import { describe, expect, it } from 'vitest';
import {
  NOTHING_TO_EXPORT,
  buildExportItems,
  graphExportSubjects,
  matrixExportSubjects,
  scientificExportSubjects,
} from '../lib/exportModel';
import type { ExportSubject } from '../lib/exportModel';
import { INSERT_UNAVAILABLE_TITLE } from '../lib/notes';
import { evaluateScientific, makeTapeRow } from '../lib/eval';
import type { TapeRow } from '../lib/eval';
import type { MatrixDef } from '../lib/matrix';

/**
 * MATH6's topbar menu, as data. The gating question — *which rows work on this host* — is
 * answered here rather than by a click that quietly does nothing.
 */

const noSnapshot = () => Promise.resolve(null);

function row(src: string): TapeRow {
  return makeTapeRow(src, src, evaluateScientific(src, { angleMode: 'rad' }), 'rad');
}

function matrix(name: string, cells: string[][]): MatrixDef {
  return { id: `m-${name}`, name, rows: cells.length, cols: cells[0].length, cells };
}

const LATEX: ExportSubject = { id: 's', kind: 'latex', label: 'Expressions', latex: 'y = x' };
const IMAGE: ExportSubject = { id: 'p', kind: 'image', label: 'Graph snapshot', capture: noSnapshot };

describe('the menu rows', () => {
  it('offers copy and insert for a LaTeX subject', () => {
    const items = buildExportItems([LATEX], { canInsert: true });
    expect(items.map((item) => item.label)).toEqual([
      'Copy expressions as LaTeX',
      'Insert expressions into note',
    ]);
    expect(items.every((item) => item.disabled)).toBe(false);
  });

  it('offers insert only for an image — a PNG has no LaTeX to copy', () => {
    const items = buildExportItems([IMAGE], { canInsert: true });
    expect(items).toHaveLength(1);
    expect(items[0].action).toBe('insert');
    expect(items[0].label).toBe('Insert graph snapshot into note');
  });

  it('keeps a proper noun capitalised mid-sentence', () => {
    const subject: ExportSubject = { id: 'm', kind: 'latex', label: 'Matrix A', latex: 'A' };
    expect(buildExportItems([subject], { canInsert: true })[0].label).toBe(
      'Copy matrix A as LaTeX',
    );
  });

  it('disables every insert row — and no copy row — without a notes bridge', () => {
    const items = buildExportItems([LATEX, IMAGE], {
      canInsert: false,
      insertReason: INSERT_UNAVAILABLE_TITLE,
    });
    const copies = items.filter((item) => item.action === 'copy');
    const inserts = items.filter((item) => item.action === 'insert');

    expect(copies).toHaveLength(1);
    expect(copies.every((item) => item.disabled)).toBe(false);
    expect(inserts).toHaveLength(2);
    expect(inserts.every((item) => item.disabled)).toBe(true);
    // Disabled, and carrying why — a silent grey-out would look like a bug.
    expect(inserts.every((item) => item.reason === INSERT_UNAVAILABLE_TITLE)).toBe(true);
  });

  it('has nothing to offer when the tool is empty', () => {
    expect(buildExportItems([], { canInsert: true })).toEqual([]);
    expect(NOTHING_TO_EXPORT).toContain('Nothing to export');
  });
});

describe('what Graphing contributes', () => {
  it('offers the rail and a snapshot once something is plotted', () => {
    const subjects = graphExportSubjects(['sin(x)', ''], noSnapshot);
    expect(subjects.map((subject) => subject.kind)).toEqual(['latex', 'image']);
    expect(subjects[0]).toMatchObject({ label: 'Expressions', latex: 'y = \\sin\\left( x\\right)' });
  });

  it('offers nothing for an empty rail — a picture of a blank grid is not an export', () => {
    expect(graphExportSubjects(['', '  '], noSnapshot)).toEqual([]);
  });
});

describe('what Scientific contributes', () => {
  it('offers the last result, and the tape once there is more than one row', () => {
    expect(scientificExportSubjects([row('1+1')]).map((subject) => subject.label)).toEqual([
      'Last result',
    ]);
    expect(
      scientificExportSubjects([row('1+1'), row('3^2')]).map((subject) => subject.label),
    ).toEqual(['Last result', 'Whole tape']);
  });

  it('ignores failed rows — there is no result on them to export', () => {
    expect(scientificExportSubjects([row('2 +')])).toEqual([]);
    const subjects = scientificExportSubjects([row('1+1'), row('2 +')]);
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toMatchObject({ latex: '1+1 = 2' });
  });

  it('offers nothing before the first evaluation', () => {
    expect(scientificExportSubjects([])).toEqual([]);
  });
});

describe('what Matrix contributes', () => {
  it('offers the matrix being edited and the newest result', () => {
    const subjects = matrixExportSubjects(matrix('A', [['1', '2'], ['3', '4']]), [
      { id: 'r2', src: 'det(A)', result: { kind: 'scalar', value: -2 } },
      { id: 'r1', src: 'A × B', result: { kind: 'matrix', rows: 1, cols: 1, cells: [[5]] } },
    ]);
    expect(subjects.map((subject) => subject.label)).toEqual(['Matrix A', 'Last result']);
    expect(subjects[0]).toMatchObject({
      latex: 'A = \\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}',
    });
    // The history is newest-first, so "last result" is the head, not the tail.
    expect(subjects[1]).toMatchObject({ latex: '\\det\\left(\\mathrm{A}\\right) = -2' });
  });

  it('offers nothing on the empty hero', () => {
    expect(matrixExportSubjects(null, [])).toEqual([]);
  });
});
