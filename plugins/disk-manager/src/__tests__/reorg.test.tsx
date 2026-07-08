import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Reorg } from '../Reorg';
import {
  DEFAULT_REORG_PROVIDER,
  buildReorgReview,
  mockReorgProposalJson,
  parseReorgProposal,
  setAllReorgMoves,
} from '../reorgModel';
import type { ReorgReviewState } from '../reorgModel';

const noop = () => {};

function review(): ReorgReviewState {
  return buildReorgReview(parseReorgProposal(mockReorgProposalJson(), 'Downloads'));
}

function render(
  overrides: Partial<Parameters<typeof Reorg>[0]> = {},
): string {
  return renderToStaticMarkup(
    <Reorg
      status="ready"
      review={review()}
      provider={DEFAULT_REORG_PROVIDER}
      onToggle={noop}
      onSetAll={noop}
      onAdjust={noop}
      onApply={noop}
      onCancel={noop}
      onBack={noop}
      {...overrides}
    />,
  );
}

describe('Reorg — tree diff (proposed vs. current)', () => {
  const html = render();

  it('shows the LM Studio provider pill for the configured model', () => {
    expect(html).toContain('reorg-provider');
    expect(html).toContain('Connected via LM Studio');
    expect(html).toContain(DEFAULT_REORG_PROVIDER.model);
  });

  it('renders each move as a struck-through current path → proposed destination', () => {
    expect(html).toContain('diff-from');
    expect(html).toContain('Downloads/Invoice_2024.pdf'); // current (from)
    expect(html).toContain('Documents/Finance/Invoice_2024.pdf'); // proposed (to)
    expect(html).toContain('→');
  });

  it('shows the file count on a folder move', () => {
    expect(html).toContain('12 files');
  });

  it('surfaces the "left as-is" unmoved tail row', () => {
    expect(html).toContain('diff-noop');
    expect(html).toContain('no confident category, left as-is');
  });

  it('offers Accept all / Reject all and per-row Adjust', () => {
    expect(html).toContain('data-action="accept-all"');
    expect(html).toContain('data-action="reject-all"');
    expect(html).toContain('data-adjust="mv-0"');
  });

  it('makes clear nothing is applied yet — "not applied yet" copy + a review header', () => {
    expect(html).toContain('not applied yet');
    expect(html).toContain('AI-reorganization review');
  });
});

describe('Reorg — the apply button reflects the approval state', () => {
  it('is enabled with a live accepted count when moves are accepted', () => {
    const html = render();
    expect(html).toContain('data-testid="diff-accepted-count">5<');
    const applyBtn = html.match(/<button[^>]*data-action="apply"[^>]*>/)?.[0] ?? '';
    expect(applyBtn).not.toContain('disabled');
    expect(html).toContain('Apply accepted changes');
  });

  it('DISABLES apply when every move is rejected (0 accepted — nothing to apply)', () => {
    const html = render({ review: setAllReorgMoves(review(), false) });
    expect(html).toContain('data-testid="diff-accepted-count">0<');
    const applyBtn = html.match(/<button[^>]*data-action="apply"[^>]*>/)?.[0] ?? '';
    expect(applyBtn).toContain('disabled');
  });

  it('DISABLES apply while an apply is already in flight', () => {
    const html = render({ applying: true });
    const applyBtn = html.match(/<button[^>]*data-action="apply"[^>]*>/)?.[0] ?? '';
    expect(applyBtn).toContain('disabled');
    expect(html).toContain('Applying…');
  });
});

describe('Reorg — loading / error states', () => {
  it('shows a "asking the model" placeholder while loading', () => {
    const html = renderToStaticMarkup(
      <Reorg
        status="loading"
        review={null}
        provider={DEFAULT_REORG_PROVIDER}
        onToggle={noop}
        onSetAll={noop}
        onAdjust={noop}
        onApply={noop}
        onCancel={noop}
        onBack={noop}
      />,
    );
    expect(html).toContain('reorg-status');
    expect(html).toContain('Asking the configured model');
    // No diff / apply affordances render before a proposal exists.
    expect(html).not.toContain('data-action="apply"');
  });

  it('shows the "can\'t propose right now" message on error and no apply button', () => {
    const html = renderToStaticMarkup(
      <Reorg
        status="error"
        review={null}
        provider={DEFAULT_REORG_PROVIDER}
        errorMessage="Couldn't propose a reorganization right now — No model configured"
        onToggle={noop}
        onSetAll={noop}
        onAdjust={noop}
        onApply={noop}
        onCancel={noop}
        onBack={noop}
      />,
    );
    // renderToStaticMarkup HTML-escapes the apostrophe, so match the non-escaped remainder.
    expect(html).toContain('propose a reorganization right now');
    expect(html).toContain('No model configured');
    expect(html).not.toContain('data-action="apply"');
  });
});
