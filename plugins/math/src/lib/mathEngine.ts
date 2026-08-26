/**
 * Math — the shared mathjs engine (MATH1).
 *
 * Per the spec's library decision, **mathjs is shared across all three tools** (expression
 * evaluation, deg/rad trig, matrices, LaTeX serialization) and bundles *into the plugin
 * zip*; only React is external. function-plot joins it in MATH2, lazy-loaded with the
 * Graphing tool.
 *
 * The instance is created once here and hardened at birth: `import` and `createUnit` are
 * disabled so a persisted expression can never reconfigure mathjs itself. MATH2 layers the
 * spec's `lib/expr.ts` on top — implicit-multiplication rewriting plus the full symbol
 * whitelist — before anything user-authored reaches a *stored* evaluation path.
 */

import { create, all } from 'mathjs';

const engine = create(all, { number: 'number' });

function blocked(name: string): () => never {
  return () => {
    throw new Error(`[math] ${name} is disabled in the Atlas Math plugin`);
  };
}

engine.import(
  {
    import: blocked('import'),
    createUnit: blocked('createUnit'),
  },
  { override: true },
);

export { engine as mathEngine };

/** Significant digits the wireframe's results use (`√(2)` → `1.4142136`). */
export const PREVIEW_PRECISION = 8;

/**
 * The live ghost result shown to the right of an input line while typing (wireframe:
 * Scientific input row, "A live result preview ghosts on the right while typing").
 *
 * Returns `null` whenever there is nothing worth showing — an empty line, a half-typed
 * expression, a free variable, or a blocked call. A draft in progress is the normal case,
 * so a failure here is silent rather than an error state; MATH4 owns the committed
 * evaluation path where errors *are* surfaced on the tape.
 */
export function previewExpression(src: string): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;
  try {
    // A throwaway scope per call: an assignment typed into the draft evaluates against a
    // fresh object and can never leak a symbol into the shared engine.
    const value: unknown = engine.evaluate(trimmed, {});
    if (value === undefined || value === null) return null;
    // Function definitions (`f(x) = …`) and unit/type constructors have no useful preview.
    if (typeof value === 'function') return null;
    return engine.format(value, { precision: PREVIEW_PRECISION });
  } catch {
    return null;
  }
}
