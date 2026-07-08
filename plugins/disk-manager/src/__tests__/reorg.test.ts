import { describe, expect, it, vi } from 'vitest';
import type { AtlasPluginApi, DiskApi, MutationResult } from '@atlas/plugin-sdk';
import {
  DEFAULT_REORG_PROVIDER,
  acceptedReorgMoves,
  adjustReorgMove,
  applyReorgDecision,
  buildReorgPrompt,
  buildReorgReview,
  mockAiReorgApi,
  mockReorgFiles,
  mockReorgProposalJson,
  mockUnconfiguredAiApi,
  parseReorgProposal,
  proposeReorg,
  reorgAcceptedCount,
  reorgScope,
  reorgTotalCount,
  resolveReorgApply,
  setAllReorgMoves,
  toggleReorgMove,
} from '../reorgModel';
import type { ReorgReviewState } from '../reorgModel';

/** A spyable DiskApi whose applyReorgPlan resolves ok — the only mutation reorg ever calls. */
function spyDiskApi(): DiskApi & { applyReorgPlan: ReturnType<typeof vi.fn> } {
  const applyReorgPlan = vi.fn(
    (moves): Promise<MutationResult> =>
      Promise.resolve({
        kind: 'reorg',
        ok: true,
        reclaimedBytes: 0,
        recovery: 'reverse-move',
        trashed: [],
        moves,
        skipped: [],
        summary: `moved ${moves.length}`,
      }),
  );
  const reject = () => Promise.reject(new Error('not used in reorg'));
  return {
    scan: reject as DiskApi['scan'],
    deleteToTrash: reject as DiskApi['deleteToTrash'],
    evict: reject as DiskApi['evict'],
    uninstallApp: reject as DiskApi['uninstallApp'],
    applyReorgPlan: applyReorgPlan as unknown as DiskApi['applyReorgPlan'],
  } as DiskApi & { applyReorgPlan: ReturnType<typeof vi.fn> };
}

/** A ready review over the canned proposal. */
function review(): ReorgReviewState {
  return buildReorgReview(parseReorgProposal(mockReorgProposalJson(), 'Downloads'));
}

// ------------------------------------------------------------------
// 1. Proposal parsing — tolerant + safety-guarded.
// ------------------------------------------------------------------
describe('parseReorgProposal', () => {
  it('parses a well-formed proposal into proposed→current moves', () => {
    const p = parseReorgProposal(mockReorgProposalJson(), 'Downloads');
    expect(p.moves).toHaveLength(5);
    expect(p.moves[0]).toMatchObject({
      from: 'Downloads/Invoice_2024.pdf',
      to: 'Documents/Finance/Invoice_2024.pdf',
    });
    // Folder move carries its file count; single files are null.
    const folder = p.moves.find((m) => m.from === 'Downloads/vacation-photos/');
    expect(folder?.count).toBe(12);
    expect(p.moves[0].count).toBeNull();
    expect(p.unmovedNote).toContain('12 remaining files');
    expect(p.skipped).toHaveLength(0);
  });

  it('tolerates markdown code fences and surrounding prose', () => {
    const fenced = 'Here is the plan:\n```json\n' + mockReorgProposalJson() + '\n```\nDone.';
    const p = parseReorgProposal(fenced, 'Downloads');
    expect(p.moves).toHaveLength(5);
  });

  it('drops unsafe (../ traversal), empty, and no-op moves into `skipped`', () => {
    const raw = JSON.stringify({
      moves: [
        { from: 'Downloads/ok.pdf', to: 'Documents/ok.pdf' }, // valid
        { from: 'Downloads/x', to: '../../etc/passwd' }, // traversal → skipped
        { from: 'Downloads/y', to: '   ' }, // empty → skipped
        { from: 'Downloads/z', to: 'Downloads/z' }, // no-op → skipped
        { from: 123, to: 'Documents/n.pdf' }, // non-string → skipped
      ],
    });
    const p = parseReorgProposal(raw, 'Downloads');
    expect(p.moves.map((m) => m.from)).toEqual(['Downloads/ok.pdf']);
    expect(p.skipped).toHaveLength(4);
    expect(p.skipped.map((s) => s.reason).sort()).toEqual([
      'no-op',
      'unsafe-path',
      'unsafe-path',
      'unsafe-path',
    ]);
  });

  it('throws when there is no JSON object at all (treated as "can\'t propose")', () => {
    expect(() => parseReorgProposal('the model is offline', 'Downloads')).toThrow();
  });
});

// ------------------------------------------------------------------
// 2. Proposal orchestration — batches metadata through ai.chat.
// ------------------------------------------------------------------
describe('proposeReorg', () => {
  it('sends the batched file paths to ai.chat and returns a parsed proposal', async () => {
    const chat = vi.fn(() => Promise.resolve(mockReorgProposalJson()));
    const api = { ai: { chat } } as unknown as Pick<AtlasPluginApi, 'ai'>;
    const files = mockReorgFiles();
    const p = await proposeReorg(api, { files, sourceRoot: 'Downloads' });

    expect(chat).toHaveBeenCalledOnce();
    const [messages, opts] = chat.mock.calls[0];
    // System pins the JSON-only, no-invention, review-not-apply contract.
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toMatch(/JSON ONLY/i);
    // The user message carries the actual batch (a known path proves the metadata went through).
    expect(messages[1].content).toContain('Downloads/Invoice_2024.pdf');
    // Uses the configured provider/model shape.
    expect(opts).toEqual({
      provider: DEFAULT_REORG_PROVIDER.provider,
      model: DEFAULT_REORG_PROVIDER.model,
    });
    // scannedCount reflects the batch size (the diff header's "N items scanned").
    expect(p.scannedCount).toBe(files.length);
  });

  it('rejects when the model is unconfigured — caller treats it as "can\'t propose right now"', async () => {
    const api = { ai: mockUnconfiguredAiApi() } as unknown as Pick<AtlasPluginApi, 'ai'>;
    await expect(proposeReorg(api, { files: mockReorgFiles() })).rejects.toThrow(/no model/i);
  });

  it('works end-to-end against the offline mock AiApi', async () => {
    const api = { ai: mockAiReorgApi() } as unknown as Pick<AtlasPluginApi, 'ai'>;
    const p = await proposeReorg(api, { files: mockReorgFiles() });
    expect(p.moves).toHaveLength(5);
  });
});

// ------------------------------------------------------------------
// 3. Tree-diff review model — accept / reject / adjust.
// ------------------------------------------------------------------
describe('buildReorgReview', () => {
  it('starts with every move accepted (matches the wireframe defaults)', () => {
    const s = review();
    expect(reorgTotalCount(s)).toBe(5);
    expect(reorgAcceptedCount(s)).toBe(5);
    expect(s.entries.every((e) => e.accepted && !e.adjusted && e.to === e.proposedTo)).toBe(true);
  });
});

describe('toggle / setAll', () => {
  it('toggling a single move flips only that row', () => {
    const s = toggleReorgMove(review(), 'mv-0', false);
    expect(s.entries.find((e) => e.id === 'mv-0')?.accepted).toBe(false);
    expect(reorgAcceptedCount(s)).toBe(4);
  });

  it('Reject all / Accept all flip every row', () => {
    const none = setAllReorgMoves(review(), false);
    expect(reorgAcceptedCount(none)).toBe(0);
    const all = setAllReorgMoves(none, true);
    expect(reorgAcceptedCount(all)).toBe(5);
  });
});

describe('adjustReorgMove', () => {
  it('edits the destination, marks it adjusted, and feeds the applied move', () => {
    const s = adjustReorgMove(review(), 'mv-0', 'Documents/Taxes/Invoice_2024.pdf');
    const entry = s.entries.find((e) => e.id === 'mv-0');
    expect(entry?.to).toBe('Documents/Taxes/Invoice_2024.pdf');
    expect(entry?.adjusted).toBe(true);
    // The accepted-move payload uses the ADJUSTED destination.
    expect(acceptedReorgMoves(s)).toContainEqual({
      from: 'Downloads/Invoice_2024.pdf',
      to: 'Documents/Taxes/Invoice_2024.pdf',
    });
  });

  it('rejects an unsafe adjustment (../ traversal / empty) as a no-op', () => {
    const base = review();
    expect(adjustReorgMove(base, 'mv-0', '../../etc/evil')).toEqual(base);
    expect(adjustReorgMove(base, 'mv-0', '   ')).toEqual(base);
  });

  it('re-setting the destination back to the proposal clears the adjusted flag', () => {
    const original = review().entries[0].proposedTo;
    let s = adjustReorgMove(review(), 'mv-0', 'Documents/Other.pdf');
    s = adjustReorgMove(s, 'mv-0', original);
    expect(s.entries.find((e) => e.id === 'mv-0')?.adjusted).toBe(false);
  });
});

describe('acceptedReorgMoves', () => {
  it('excludes rejected rows', () => {
    const s = toggleReorgMove(review(), 'mv-2', false);
    const moves = acceptedReorgMoves(s);
    expect(moves).toHaveLength(4);
    expect(moves.some((m) => m.from === 'Downloads/vacation-photos/')).toBe(false);
  });
});

// ------------------------------------------------------------------
// 4. THE APPROVAL GATE — nothing moves without explicit approval.
// ------------------------------------------------------------------
describe('resolveReorgApply — approve gates apply', () => {
  it('a review on its own NEVER yields an applicable decision (not auto-applied)', () => {
    const d = resolveReorgApply(review(), { approved: false });
    expect(d.willApply).toBe(false);
    expect(d.blocked).toBe(true);
    expect(d.reason).toBe('not-approved');
    expect(d.moves).toEqual([]);
  });

  it('approved but nothing accepted is still blocked', () => {
    const none = setAllReorgMoves(review(), false);
    const d = resolveReorgApply(none, { approved: true });
    expect(d.willApply).toBe(false);
    expect(d.reason).toBe('nothing-accepted');
    expect(d.moves).toEqual([]);
  });

  it('approved with ≥1 accepted move carries exactly the accepted moves + scope', () => {
    const s = toggleReorgMove(review(), 'mv-4', false); // reject one
    const d = resolveReorgApply(s, { approved: true });
    expect(d.willApply).toBe(true);
    expect(d.blocked).toBe(false);
    expect(d.moves).toEqual(acceptedReorgMoves(s));
    expect(d.moves).toHaveLength(4);
    expect(d.scope).toEqual(reorgScope('Downloads'));
  });
});

describe('applyReorgDecision — no move fires without explicit approval', () => {
  it('an unapproved decision returns null and NEVER calls disk.applyReorgPlan', async () => {
    const disk = spyDiskApi();
    const api = { disk } as Pick<AtlasPluginApi, 'disk'>;
    const decision = resolveReorgApply(review(), { approved: false });
    const res = await applyReorgDecision(api, decision);
    expect(res).toBeNull();
    expect(disk.applyReorgPlan).not.toHaveBeenCalled();
  });

  it('rejecting all then applying fires nothing', async () => {
    const disk = spyDiskApi();
    const api = { disk } as Pick<AtlasPluginApi, 'disk'>;
    const none = setAllReorgMoves(review(), false);
    const decision = resolveReorgApply(none, { approved: true });
    const res = await applyReorgDecision(api, decision);
    expect(res).toBeNull();
    expect(disk.applyReorgPlan).not.toHaveBeenCalled();
  });

  it('an approved decision applies exactly the accepted moves within the scope', async () => {
    const disk = spyDiskApi();
    const api = { disk } as Pick<AtlasPluginApi, 'disk'>;
    const s = toggleReorgMove(review(), 'mv-1', false); // reject one → 4 accepted
    const decision = resolveReorgApply(s, { approved: true });
    const res = await applyReorgDecision(api, decision);

    expect(disk.applyReorgPlan).toHaveBeenCalledOnce();
    const [moves, scope] = disk.applyReorgPlan.mock.calls[0];
    expect(moves).toHaveLength(4);
    expect(moves).toEqual(acceptedReorgMoves(s));
    expect(scope).toEqual(reorgScope('Downloads'));
    expect(res?.ok).toBe(true);
  });
});

// ------------------------------------------------------------------
// 5. Prompt framing — the contract sent to the model.
// ------------------------------------------------------------------
describe('buildReorgPrompt', () => {
  it('produces a system+user pair and never instructs the model to apply', () => {
    const msgs = buildReorgPrompt(mockReorgFiles(), 'Downloads');
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user']);
    expect(msgs[0].content.toLowerCase()).toContain('do not apply');
    const payload = JSON.parse(msgs[1].content);
    expect(payload.sourceRoot).toBe('Downloads');
    expect(payload.files.length).toBe(mockReorgFiles().length);
  });
});
