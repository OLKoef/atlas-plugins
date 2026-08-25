import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_FALLBACK_BACKGROUND,
  capturePlotPng,
  inlineCssVars,
  standaloneSvgMarkup,
  svgDataUrl,
} from '../lib/snapshot';

/**
 * MATH6's graph snapshot. The rasterizing half needs a browser; what is testable — and what
 * actually decides whether the picture is right — is the markup handed to it.
 */

describe('inlining CSS custom properties', () => {
  const palette: Record<string, string> = { '--graph-blue': '#4c5de6', '--bg-primary': '#f7f8fa' };
  const resolve = (name: string) => palette[name] ?? '';

  it('resolves the curve colours a live document would have', () => {
    expect(inlineCssVars('<path stroke="var(--graph-blue)"/>', resolve)).toBe(
      '<path stroke="#4c5de6"/>',
    );
    expect(inlineCssVars('fill:var( --bg-primary )', resolve)).toBe('fill:#f7f8fa');
  });

  it('uses the fallback written into the var() when the property is unset', () => {
    expect(inlineCssVars('<path stroke="var(--graph-pink, #ff00aa)"/>', resolve)).toBe(
      '<path stroke="#ff00aa"/>',
    );
  });

  it('leaves an unresolvable var alone rather than inventing a colour', () => {
    expect(inlineCssVars('<path stroke="var(--graph-pink)"/>', resolve)).toBe(
      '<path stroke="var(--graph-pink)"/>',
    );
  });

  it('resolves every occurrence, not just the first', () => {
    const markup = '<path stroke="var(--graph-blue)"/><rect fill="var(--bg-primary)"/>';
    expect(inlineCssVars(markup, resolve)).toBe(
      '<path stroke="#4c5de6"/><rect fill="#f7f8fa"/>',
    );
  });
});

describe('the standalone SVG document', () => {
  it('namespaces it, sizes it, and paints a background under it', () => {
    expect(
      standaloneSvgMarkup('<svg class="fp"><path d="M0 0"/></svg>', {
        width: 640,
        height: 400,
        background: '#ffffff',
      }),
    ).toBe(
      '<svg class="fp" xmlns="http://www.w3.org/2000/svg" width="640" height="400"' +
        ' viewBox="0 0 640 400">' +
        '<rect width="100%" height="100%" fill="#ffffff"/><path d="M0 0"/></svg>',
    );
  });

  it('overwrites the live element’s own size and keeps its viewBox', () => {
    const out = standaloneSvgMarkup('<svg width="10" height="5" viewBox="0 0 10 5"></svg>', {
      width: 640,
      height: 400,
    });
    expect(out).toContain('width="640"');
    expect(out).toContain('height="400"');
    expect(out).toContain('viewBox="0 0 10 5"');
    // No background asked for, so none painted — the caller decides transparency.
    expect(out).not.toContain('<rect');
  });

  it('cannot be broken out of by a hostile background value', () => {
    const out = standaloneSvgMarkup('<svg></svg>', {
      width: 8,
      height: 8,
      background: '"><script>x</script>',
    });
    expect(out).not.toContain('<script');
  });

  it('hands back markup it does not recognise untouched', () => {
    expect(standaloneSvgMarkup('not an svg', { width: 1, height: 1 })).toBe('not an svg');
  });
});

describe('the data URL', () => {
  it('percent-encodes rather than base64s — the markup carries − and π', () => {
    const url = svgDataUrl('<svg><text>−π ≤ x</text></svg>');
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.split(',')[1])).toBe('<svg><text>−π ≤ x</text></svg>');
  });
});

describe('capturing the plot', () => {
  it('resolves null when there is no chart to capture', async () => {
    await expect(capturePlotPng(null)).resolves.toBeNull();
    await expect(capturePlotPng(undefined)).resolves.toBeNull();
    // No DOM in this run at all, so a host that claims an SVG still cannot be rasterized.
    const host = { querySelector: () => ({}) } as unknown as HTMLElement;
    await expect(capturePlotPng(host)).resolves.toBeNull();
  });

  it('has a background to fall back on when the host resolves no colour', () => {
    expect(SNAPSHOT_FALLBACK_BACKGROUND).toBe('#ffffff');
  });
});
