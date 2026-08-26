import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Matrix, MatrixCompute } from '../Matrix';
import { MatrixEditor } from '../MatrixEditor';
import { MatrixRail } from '../MatrixRail';
import { MatrixResults } from '../MatrixResults';
import { createMatrix } from '../lib/matrix';
import type { MatrixDef } from '../lib/matrix';
import type { ComputeEntry } from '../lib/matrixModel';

const noop = () => {};

function editor(def: MatrixDef) {
  return renderToStaticMarkup(<MatrixEditor def={def} dispatch={noop} />);
}

function rail(matrices: MatrixDef[], activeId: string | null = null, newOpen = false) {
  return renderToStaticMarkup(
    <MatrixRail
      matrices={matrices}
      activeId={activeId}
      newOpen={newOpen}
      newRows={3}
      newCols={3}
      newCustom={false}
      dispatch={noop}
    />,
  );
}

const A = createMatrix('m1', 'A', 3, 3);
const B = createMatrix('m2', 'B', 2, 2);

describe('Matrix empty state (MATH5)', () => {
  it('renders the wireframe’s hero: rail, count 0, and the size presets', () => {
    const html = renderToStaticMarkup(<Matrix />);
    expect(html).toContain('class="mx-tool"');
    expect(html).toContain('class="mx-rail"');
    expect(html).toContain('Matrices');
    expect(html).toContain('class="mx-count">0<');
    expect(html).toContain('No matrices yet');
    expect(html).toContain('class="mx-hero-btn"');
    for (const size of ['2 × 2', '3 × 3', '4 × 4', 'n × n…']) expect(html).toContain(size);
    // No matrix means no editor and no compute line yet.
    expect(html).not.toContain('mx-compute-row');
  });

  it('marks the 3 × 3 preset as the selected one', () => {
    const html = renderToStaticMarkup(<Matrix />);
    expect(html.match(/mx-chip mx-chip-active/g)).toHaveLength(1);
    const at = html.indexOf('>3 × 3<');
    expect(html.slice(html.lastIndexOf('<button', at), at)).toContain('mx-chip-active');
  });
});

describe('Matrix rail (MATH5)', () => {
  it('lists each matrix with its name, size and a delete action', () => {
    const html = rail([A, B], A.id);
    expect(html).toContain('class="mx-count">2<');
    expect(html).toContain('>A<');
    expect(html).toContain('>3 × 3<');
    expect(html).toContain('>B<');
    expect(html).toContain('>2 × 2<');
    expect(html).toContain('aria-label="Delete matrix A"');
    // Exactly one row reads as selected.
    expect(html.match(/mx-item mx-item-active/g)).toHaveLength(1);
  });

  it('draws the dot glyph at the matrix’s shape, capped at three per side', () => {
    const wide = createMatrix('m3', 'C', 9, 9);
    expect(renderToStaticMarkup(<MatrixRail
      matrices={[wide]}
      activeId={null}
      newOpen={false}
      newRows={3}
      newCols={3}
      newCustom={false}
      dispatch={noop}
    />).match(/<i><\/i>/g)).toHaveLength(9);
    // A 2 × 2 gets the wireframe's four-dot glyph.
    expect(rail([B]).match(/<i><\/i>/g)).toHaveLength(4);
    expect(rail([B])).toContain('mx-glyph mx-glyph-2');
  });

  it('opens the size chooser above the New matrix button', () => {
    expect(rail([A], A.id, false)).not.toContain('mx-new-panel');
    const open = rail([A], A.id, true);
    expect(open).toContain('mx-new-panel');
    expect(open).toContain('>Create<');
    expect(open.indexOf('mx-new-panel')).toBeLessThan(open.indexOf('mx-new-btn'));
  });
});

describe('Matrix editor (MATH5)', () => {
  it('renders the bracketed grid with one input per cell', () => {
    const html = editor(A);
    expect(html).toContain('class="mx-bk mx-bk-l"');
    expect(html).toContain('class="mx-bk mx-bk-r"');
    expect(html.match(/class="mx-cell"/g)).toHaveLength(9);
    expect(html).toContain('aria-label="A row 3 column 3"');
    // The column count is inline, because n has no cap.
    expect(html).toContain('grid-template-columns:repeat(3, auto)');
  });

  it('scrolls rather than stretching for a large n', () => {
    const big = createMatrix('m4', 'A', 12, 12);
    const html = editor(big);
    expect(html).toContain('class="mx-grid-scroll"');
    expect(html.match(/class="mx-cell"/g)).toHaveLength(144);
    expect(html).toContain('grid-template-columns:repeat(12, auto)');
  });

  it('renders both steppers and the four quick-op chips, labelled for the matrix', () => {
    const html = editor(A);
    expect(html).toContain('Rows');
    expect(html).toContain('Cols');
    expect(html.match(/class="stepper"/g)).toHaveLength(2);
    for (const chip of ['det(A)', 'A⁻¹', 'Aᵀ', 'rank']) expect(html).toContain(chip);
  });

  it('disables a stepper’s − at the floor, never below it', () => {
    const single = createMatrix('m5', 'A', 1, 4);
    const html = editor(single);
    const at = html.indexOf('aria-label="Remove row"');
    expect(html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at))).toContain(
      'disabled=""',
    );
    const cols = html.indexOf('aria-label="Remove col"');
    expect(html.slice(html.lastIndexOf('<button', cols), html.indexOf('>', cols))).not.toContain(
      'disabled=""',
    );
  });
});

describe('Matrix compute line (MATH5)', () => {
  function compute(error: string | null) {
    return renderToStaticMarkup(
      <MatrixCompute name="A" input="A × B" error={error} dispatch={noop} />,
    );
  }

  it('renders the compute row with the run button', () => {
    const html = compute(null);
    expect(html).toContain('class="mx-compute-row"');
    expect(html).toContain('class="mx-run-btn"');
    expect(html).toContain('aria-label="Evaluate"');
    expect(html).toContain('placeholder="A × B · 2A + B · det(A)"');
    expect(html).not.toContain('mx-error-msg');
  });

  it('marks a mismatch with the graphing rail’s inline error treatment', () => {
    const html = compute('Cannot add a 3 × 3 to a 2 × 2 — both matrices must have the same size');
    expect(html).toContain('mx-compute-row mx-compute-row-error');
    expect(html).toContain('class="mx-error-msg"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('both matrices must have the same size');
  });
});

describe('Matrix results (MATH5)', () => {
  const entries: ComputeEntry[] = [
    { id: 'r2', src: 'det(A)', result: { kind: 'scalar', value: 8 } },
    {
      id: 'r1',
      src: 'A × B',
      result: { kind: 'matrix', rows: 2, cols: 2, cells: [[2, 1], [0, 2]] },
    },
  ];

  it('renders a scalar card and a bracketed matrix card, newest first', () => {
    const html = renderToStaticMarkup(
      <MatrixResults entries={entries} nextName="C" dispatch={noop} />,
    );
    expect(html.indexOf('det(A) =')).toBeLessThan(html.indexOf('A × B ='));
    expect(html).toContain('class="mx-scalar">8<');
    expect(html.match(/class="mx-rcell"/g)).toHaveLength(4);
    expect(html).toContain('Copy as LaTeX');
  });

  it('offers → C on a matrix result only, named for the next free slot', () => {
    const html = renderToStaticMarkup(
      <MatrixResults entries={entries} nextName="C" dispatch={noop} />,
    );
    expect(html.match(/Save as matrix C/g)).toHaveLength(1);
    expect(html).toContain('→ C');
  });

  it('renders nothing at all when no line has been run', () => {
    expect(renderToStaticMarkup(<MatrixResults entries={[]} nextName="A" dispatch={noop} />)).toBe(
      '',
    );
  });
});
