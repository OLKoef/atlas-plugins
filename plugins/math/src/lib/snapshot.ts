/**
 * Math — the graph PNG snapshot (MATH6): the Graphing canvas as an image the notes bridge can
 * insert inline through the image pipeline.
 *
 * function-plot draws an SVG into the live document, which is not a portable picture: its
 * curve colours are **CSS custom properties** (`stroke="var(--graph-blue)"`, the trick that
 * makes a theme switch recolour curves with no redraw), and a serialized SVG loaded into an
 * `<img>` has no document to resolve those against. So the capture is three steps, and the
 * first two are pure text work this file can be tested on:
 *
 *  1. {@link inlineCssVars} — resolve every `var(--x)` against the live element's computed
 *     style, so the snapshot keeps the colours the user was looking at;
 *  2. {@link standaloneSvgMarkup} — namespace it, pin its pixel size, and paint a background
 *     under it (an SVG is transparent; a transparent PNG dropped into a light note is a
 *     picture of nothing);
 *  3. draw it into a canvas and read a PNG data URL back out ({@link capturePlotPng}).
 *
 * The whole thing is best-effort: no canvas, no chart, a browser that refuses the draw — all
 * resolve to `null`, and the caller offers the user something else. A snapshot is a
 * convenience, never a step a user has to get past.
 */

/** Pixel ratio the snapshot is rasterized at, so an inserted graph is not soft. */
export const SNAPSHOT_SCALE = 2;

/** The background painted under a snapshot when the host resolves no colour of its own. */
export const SNAPSHOT_FALLBACK_BACKGROUND = '#ffffff';

const SVG_OPEN_RE = /^\s*<svg\b([^>]*)>/;
const CSS_VAR_RE = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*?))?\s*\)/g;

/**
 * Replace every `var(--x)` (with or without a fallback) using `resolve`. A variable that
 * resolves to nothing falls back to the value written in the `var()` itself, and failing that
 * is left alone — a stroke the renderer ignores beats a stroke turned into a wrong colour.
 */
export function inlineCssVars(markup: string, resolve: (name: string) => string): string {
  return markup.replace(CSS_VAR_RE, (whole: string, name: string, fallback?: string) => {
    const value = resolve(name).trim();
    if (value !== '') return value;
    const written = (fallback ?? '').trim();
    return written === '' ? whole : written;
  });
}

/** Strip what would break out of the attribute this value is written into. */
function attributeSafe(value: string): string {
  return value.replace(/["<>]/g, '').trim();
}

function withAttribute(attrs: string, name: string, value: string): string {
  const existing = new RegExp(`\\s${name}="[^"]*"`);
  const written = ` ${name}="${attributeSafe(value)}"`;
  return existing.test(attrs) ? attrs.replace(existing, written) : attrs + written;
}

export interface StandaloneSvgOptions {
  width: number;
  height: number;
  /** painted under everything; omit for a transparent snapshot. */
  background?: string;
}

/**
 * A live SVG's markup turned into a standalone document: XML-namespaced (an `<img>` refuses it
 * otherwise), sized in real pixels, and backed by a solid rect.
 */
export function standaloneSvgMarkup(markup: string, opts: StandaloneSvgOptions): string {
  const open = SVG_OPEN_RE.exec(markup);
  if (!open) return markup;

  let attrs = open[1];
  attrs = withAttribute(attrs, 'xmlns', 'http://www.w3.org/2000/svg');
  attrs = withAttribute(attrs, 'width', String(opts.width));
  attrs = withAttribute(attrs, 'height', String(opts.height));
  if (!/\sviewBox="/.test(attrs)) {
    attrs = withAttribute(attrs, 'viewBox', `0 0 ${opts.width} ${opts.height}`);
  }

  const background = opts.background
    ? `<rect width="100%" height="100%" fill="${attributeSafe(opts.background)}"/>`
    : '';
  return `<svg${attrs}>${background}${markup.slice(open[0].length)}`;
}

/** SVG markup as a data URL. Percent-encoded, not base64 — the markup carries `−`, `≤`, `π`. */
export function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

/** Read one CSS custom property off an element, or '' when there is no live style engine. */
function cssVarReader(element: Element): (name: string) => string {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return () => '';
  }
  const style = window.getComputedStyle(element);
  return (name) => style.getPropertyValue(name) ?? '';
}

/** Rasterize SVG markup to a PNG data URL, or null if this environment cannot. */
function rasterize(markup: string, width: number, height: number): Promise<string | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return Promise.resolve(null);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * SNAPSHOT_SCALE));
  canvas.height = Math.max(1, Math.round(height * SNAPSHOT_SCALE));
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        // A tainted canvas (or a refused export) is a null snapshot, not a thrown error.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = svgDataUrl(markup);
  });
}

/**
 * The Graphing canvas as a PNG data URL, or null when there is nothing to capture. `host` is
 * function-plot's mount node — the SVG inside it is what gets serialized.
 */
export function capturePlotPng(host: HTMLElement | null | undefined): Promise<string | null> {
  const svg = host?.querySelector('svg');
  if (!svg || typeof XMLSerializer === 'undefined') return Promise.resolve(null);

  const box = svg.getBoundingClientRect?.();
  const width = Math.round(box?.width || Number(svg.getAttribute('width')) || 0);
  const height = Math.round(box?.height || Number(svg.getAttribute('height')) || 0);
  if (width < 1 || height < 1) return Promise.resolve(null);

  const readVar = cssVarReader(host as Element);
  const markup = standaloneSvgMarkup(
    inlineCssVars(new XMLSerializer().serializeToString(svg), readVar),
    {
      width,
      height,
      background: readVar('--bg-primary').trim() || SNAPSHOT_FALLBACK_BACKGROUND,
    },
  );
  return rasterize(markup, width, height);
}
