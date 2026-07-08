/**
 * Disk Manager — the AI-reorg **review-then-approve** model (DISK7), framework-free.
 *
 * Everything here is pure so it can be unit-tested without a DOM. The flow, per the approved
 * wireframe (DiskManagerApproved.html §AI-reorg):
 *
 *   1. Batch scanned file metadata through the configured model (`ai.chat`, DISK10) to
 *      PROPOSE a tidier folder structure. `buildReorgPrompt` frames the batch; `ai.chat`
 *      returns a string; `parseReorgProposal` turns it into a validated set of moves.
 *   2. Present the proposal as a **tree diff** (proposed vs. current) the user reviews —
 *      accept/reject each move, "Accept all" / "Reject all", and adjust a destination inline.
 *   3. **Approval gates apply.** Nothing moves until the user explicitly approves, and even
 *      then only the accepted moves are handed to `disk.applyReorgPlan` (DISK3). The whole
 *      point of DISK7 is that the plan is NEVER auto-applied — {@link resolveReorgApply} +
 *      {@link applyReorgDecision} enforce this in one place so no code path can bypass it.
 *
 * This mirrors the triage model's decision seam ({@link resolveTriageAction} /
 * {@link applyTriageDecision}): a pure `resolve*` returns *what would happen*, and a thin
 * `apply*` is the only thing that touches the host `disk` bridge — and it refuses unless the
 * decision says `willApply`.
 */

import type {
  AiApi,
  AiChatMessage,
  AiChatOptions,
  AtlasPluginApi,
  FileCategory,
  MutationResult,
  ReorgMove,
  ReorgScope,
} from '@atlas/plugin-sdk';

const MB = 1024 * 1024;

/** Where a reorg session is scoped — the Downloads tree in the wireframe's scenario. */
export const REORG_SOURCE_ROOT = 'Downloads';

/**
 * The configured model used for a proposal. In the real host this comes from the user's
 * settings (the same provider/model shape Ingest / Vault Q&A use); offline we default to the
 * wireframe's LM Studio label. Passed straight to `ai.chat` as {@link AiChatOptions}.
 */
export interface ReorgProvider extends AiChatOptions {
  /** display label for the "Connected via …" pill (e.g. `LM Studio`). */
  label: string;
}

export const DEFAULT_REORG_PROVIDER: ReorgProvider = {
  label: 'LM Studio',
  provider: 'lmstudio',
  model: 'llama3.2-70b-instruct',
};

// ============================================================================
// 1. Proposal — batch file metadata to `ai.chat` and parse the response.
// ============================================================================

/** Compact per-file metadata sent to the model (a slimmed DISK1 {@link ScannedFile}). */
export interface ReorgFileMeta {
  /** current path, relative to the source root (e.g. `Downloads/Invoice_2024.pdf`). */
  path: string;
  size: number;
  /** DISK1 file-type classification, a hint for the model. */
  category: FileCategory;
  /** epoch ms last modified — lets the model bucket by year, etc. */
  modifiedMs: number;
}

/** One proposed move in the tree diff — a rename/relocation the model suggests. */
export interface ReorgMoveProposal {
  /** stable key for the review list. */
  id: string;
  /** current path. */
  from: string;
  /** proposed destination path. */
  to: string;
  /** when `from` is a folder, how many files it contains; `null` for a single file. */
  count: number | null;
}

/** The parsed, validated model proposal — the input to the review model. */
export interface ReorgProposal {
  sourceRoot: string;
  /** how many items were scanned/sent to the model (drives the diff header). */
  scannedCount: number;
  moves: ReorgMoveProposal[];
  /** the "N files left as-is — no confident category" tail row; `null` if none. */
  unmovedNote: string | null;
  /** proposals dropped by the safety guard (traversal / empty / no-op), with a reason. */
  skipped: { from?: string; to?: string; reason: string }[];
}

/**
 * Frame a batch of file metadata as a chat for the configured model. The system message
 * pins the output contract (JSON only, never invent files, keep destinations inside the home
 * tree, leave a file unmoved when unsure); the user message carries the batch. Pure — the
 * caller sends it via {@link proposeReorg}.
 */
export function buildReorgPrompt(
  files: ReorgFileMeta[],
  sourceRoot: string,
): AiChatMessage[] {
  const system =
    'You are a meticulous file-organization assistant for a macOS disk manager. ' +
    'Given a batch of files under a source folder, propose a tidier destination path for ' +
    'each file you are CONFIDENT about. Rules: respond with JSON ONLY, matching ' +
    '{"moves":[{"from":string,"to":string,"count"?:number}],"unmovedNote"?:string}. ' +
    'Never invent files that are not in the batch. Keep every destination inside the ' +
    "user's home tree (no absolute system paths, no \"..\" segments). Leave a file unmoved " +
    '(omit it) when you are not confident, and summarize how many you left in "unmovedNote". ' +
    'Do not apply anything — this is a proposal the user will review.';
  const user = JSON.stringify({
    sourceRoot,
    fileCount: files.length,
    files: files.map((f) => ({
      path: f.path,
      sizeBytes: f.size,
      category: f.category,
      modifiedMs: f.modifiedMs,
    })),
  });
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Path is unsafe to move to/from — empty, or escaping the home tree via a `..` segment. */
function isUnsafePath(p: unknown): p is never {
  if (typeof p !== 'string') return true;
  const trimmed = p.trim();
  if (trimmed.length === 0) return true;
  // Reject any parent-traversal segment (guards against a hallucinated `../../etc/...`).
  return trimmed.split('/').some((seg) => seg === '..');
}

/**
 * Parse a model response string into a validated {@link ReorgProposal}. Tolerant of
 * markdown code fences and leading/trailing prose: it extracts the first `{`…last `}` block
 * and `JSON.parse`s it. Each proposed move is safety-checked — non-string / empty / `..`
 * traversal / no-op (`from === to`) proposals are dropped into `skipped` rather than trusted.
 *
 * Throws only when there is no JSON object at all to parse (treat like a model rejection —
 * "can't propose a reorg right now").
 */
export function parseReorgProposal(raw: string, sourceRoot: string): ReorgProposal {
  const json = extractJsonObject(raw);
  if (json === null) {
    throw new Error('Model did not return a JSON reorg proposal.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Model returned malformed JSON for the reorg proposal.');
  }

  const moves: ReorgMoveProposal[] = [];
  const skipped: ReorgProposal['skipped'] = [];
  const rawMoves =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).moves)
      ? ((parsed as Record<string, unknown>).moves as unknown[])
      : [];

  let scannedFiles = 0;
  rawMoves.forEach((m, i) => {
    const move = m as Record<string, unknown>;
    const from = move?.from;
    const to = move?.to;
    if (isUnsafePath(from) || isUnsafePath(to)) {
      skipped.push({
        from: typeof from === 'string' ? from : undefined,
        to: typeof to === 'string' ? to : undefined,
        reason: 'unsafe-path',
      });
      return;
    }
    if ((from as string).trim() === (to as string).trim()) {
      skipped.push({ from: from as string, to: to as string, reason: 'no-op' });
      return;
    }
    const count =
      typeof move.count === 'number' && Number.isFinite(move.count) && move.count > 0
        ? Math.floor(move.count)
        : null;
    scannedFiles += count ?? 1;
    moves.push({
      id: `mv-${i}`,
      from: (from as string).trim(),
      to: (to as string).trim(),
      count,
    });
  });

  const noteRaw = (parsed as Record<string, unknown>)?.unmovedNote;
  const unmovedNote = typeof noteRaw === 'string' && noteRaw.trim().length > 0 ? noteRaw.trim() : null;

  return { sourceRoot, scannedCount: scannedFiles, moves, unmovedNote, skipped };
}

/** Extract the first balanced-ish `{`…`}` block from a string (strips fences/prose). */
function extractJsonObject(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return raw.slice(start, end + 1);
}

/** Inputs for a proposal run. */
export interface ProposeReorgInput {
  files: ReorgFileMeta[];
  sourceRoot?: string;
  provider?: ReorgProvider;
}

/**
 * Orchestrate a proposal: build the prompt, call the configured model via `ai.chat`, and
 * parse the response. Rejects (does NOT swallow) when the model is unconfigured / returns
 * nothing / returns unparseable output — per implementation.md, the caller (the Reorg
 * screen) treats a rejection as "can't propose right now," not a crash. `scannedCount` is
 * stamped from the batch size so the diff header reflects what was actually scanned.
 */
export async function proposeReorg(
  api: Pick<AtlasPluginApi, 'ai'>,
  input: ProposeReorgInput,
): Promise<ReorgProposal> {
  const sourceRoot = input.sourceRoot ?? REORG_SOURCE_ROOT;
  const provider = input.provider ?? DEFAULT_REORG_PROVIDER;
  const messages = buildReorgPrompt(input.files, sourceRoot);
  const raw = await api.ai.chat(messages, { provider: provider.provider, model: provider.model });
  const proposal = parseReorgProposal(raw, sourceRoot);
  return { ...proposal, scannedCount: input.files.length };
}

// ============================================================================
// 2. Review — the tree-diff model the user drives (accept/reject/adjust).
// ============================================================================

/** One row in the tree diff — a proposed move plus its review state. */
export interface ReorgReviewEntry {
  id: string;
  from: string;
  /** the model's original suggested destination (retained so "adjusted" is visible). */
  proposedTo: string;
  /** the current destination — starts equal to {@link proposedTo}, editable via adjust. */
  to: string;
  count: number | null;
  /** whether this move is accepted (checked). Defaults to accepted, matching the wireframe. */
  accepted: boolean;
  /** true once the user has edited `to` away from `proposedTo`. */
  adjusted: boolean;
}

/** The full review state — the source of truth for the Reorg screen. */
export interface ReorgReviewState {
  sourceRoot: string;
  scannedCount: number;
  entries: ReorgReviewEntry[];
  unmovedNote: string | null;
}

/** Build the initial review state from a proposal — every move accepted by default. */
export function buildReorgReview(proposal: ReorgProposal): ReorgReviewState {
  return {
    sourceRoot: proposal.sourceRoot,
    scannedCount: proposal.scannedCount,
    unmovedNote: proposal.unmovedNote,
    entries: proposal.moves.map((m) => ({
      id: m.id,
      from: m.from,
      proposedTo: m.to,
      to: m.to,
      count: m.count,
      accepted: true,
      adjusted: false,
    })),
  };
}

/** Toggle a single move's accepted flag (does not mutate the input). */
export function toggleReorgMove(
  state: ReorgReviewState,
  id: string,
  accepted: boolean,
): ReorgReviewState {
  return {
    ...state,
    entries: state.entries.map((e) => (e.id === id ? { ...e, accepted } : e)),
  };
}

/** Accept-all / Reject-all — the diff header actions. */
export function setAllReorgMoves(state: ReorgReviewState, accepted: boolean): ReorgReviewState {
  return { ...state, entries: state.entries.map((e) => ({ ...e, accepted })) };
}

/**
 * Adjust a move's destination inline. Rejects an unsafe destination (empty / `..` traversal)
 * as a NO-OP — the same guard the parser applies, so a hand-edited path can't slip a move
 * outside the home tree past review. `adjusted` flips true only when `to` differs from the
 * model's original `proposedTo`.
 */
export function adjustReorgMove(
  state: ReorgReviewState,
  id: string,
  to: string,
): ReorgReviewState {
  if (isUnsafePath(to)) return state;
  const next = to.trim();
  return {
    ...state,
    entries: state.entries.map((e) =>
      e.id === id ? { ...e, to: next, adjusted: next !== e.proposedTo } : e,
    ),
  };
}

/** The accepted moves as DISK3 {@link ReorgMove}s — the exact payload for `applyReorgPlan`. */
export function acceptedReorgMoves(state: ReorgReviewState): ReorgMove[] {
  return state.entries.filter((e) => e.accepted).map((e) => ({ from: e.from, to: e.to }));
}

export function reorgAcceptedCount(state: ReorgReviewState): number {
  return state.entries.reduce((n, e) => n + (e.accepted ? 1 : 0), 0);
}

export function reorgTotalCount(state: ReorgReviewState): number {
  return state.entries.length;
}

/** The scope handed alongside the moves — Downloads within the home tree. */
export function reorgScope(sourceRoot = REORG_SOURCE_ROOT): ReorgScope {
  return { sourceRoot, home: true };
}

// ============================================================================
// 3. The approval gate — nothing moves without explicit approval.
// ============================================================================

/** Why an apply is blocked, when it is. */
export type ReorgApplyBlock = 'not-approved' | 'nothing-accepted';

/** The resolved outcome of asking to apply a review — the single approval seam. */
export interface ReorgApplyDecision {
  /** the accepted moves to apply; EMPTY unless `willApply` is true. */
  moves: ReorgMove[];
  scope: ReorgScope;
  /** true ONLY when the user explicitly approved AND at least one move is accepted. */
  willApply: boolean;
  /** true when the apply cannot proceed. */
  blocked: boolean;
  /** why it's blocked, when applicable. */
  reason?: ReorgApplyBlock;
}

/**
 * Resolve a review + explicit-approval flag into a {@link ReorgApplyDecision}. This is the
 * ONE place that decides whether the plan may be applied:
 *   - `approved !== true`  → blocked (`not-approved`), no moves. This is the "NEVER
 *     auto-apply" guarantee — a review can never yield an applicable decision on its own.
 *   - approved but nothing accepted → blocked (`nothing-accepted`).
 *   - approved with ≥1 accepted move → `willApply`, carrying exactly the accepted moves.
 * Pure — {@link applyReorgDecision} is the only thing that then touches disk.
 */
export function resolveReorgApply(
  state: ReorgReviewState,
  opts: { approved: boolean; scope?: ReorgScope },
): ReorgApplyDecision {
  const scope = opts.scope ?? reorgScope(state.sourceRoot);
  if (opts.approved !== true) {
    return { moves: [], scope, willApply: false, blocked: true, reason: 'not-approved' };
  }
  const moves = acceptedReorgMoves(state);
  if (moves.length === 0) {
    return { moves: [], scope, willApply: false, blocked: true, reason: 'nothing-accepted' };
  }
  return { moves, scope, willApply: true, blocked: false };
}

/**
 * Fire the reorg against the host `disk` bridge — but ONLY when the decision says
 * `willApply`. A blocked / unapproved decision returns `null` without ever calling
 * `disk.applyReorgPlan`, so no move can fire without having passed through
 * {@link resolveReorgApply} with explicit approval.
 */
export function applyReorgDecision(
  api: Pick<AtlasPluginApi, 'disk'>,
  decision: ReorgApplyDecision,
): Promise<MutationResult | null> {
  if (!decision.willApply) return Promise.resolve(null);
  return api.disk.applyReorgPlan(decision.moves, decision.scope);
}

// ============================================================================
// Mocked proposal + provider — mirrors DiskManagerApproved.html's Downloads scenario so the
// review UI works offline and in tests. In the real host `files` come from `disk.scan`
// (DISK1) and the proposal from a live `ai.chat`; no live model call here.
// ============================================================================

/** A 26-item mocked Downloads batch (5 confidently-moved, the rest left as-is). */
export function mockReorgFiles(): ReorgFileMeta[] {
  const files: ReorgFileMeta[] = [
    { path: 'Downloads/Invoice_2024.pdf', size: 240 * 1024, category: 'document', modifiedMs: Date.UTC(2024, 2, 3) },
    { path: 'Downloads/IMG_0234.jpg', size: 3 * MB, category: 'image', modifiedMs: Date.UTC(2024, 5, 21) },
    { path: 'Downloads/vacation-photos/', size: 480 * MB, category: 'image', modifiedMs: Date.UTC(2024, 6, 2) },
    { path: 'Downloads/Report_draft.docx', size: 1.1 * MB, category: 'document', modifiedMs: Date.UTC(2024, 8, 14) },
    { path: 'Downloads/project-mockup.fig', size: 12 * MB, category: 'other', modifiedMs: Date.UTC(2024, 9, 1) },
  ];
  // 12 remaining "no confident category" files — the wireframe's unmoved tail.
  for (let i = 0; i < 12; i++) {
    files.push({
      path: `Downloads/misc_${i + 1}.bin`,
      size: 2 * MB,
      category: 'other',
      modifiedMs: Date.UTC(2024, 3, (i % 27) + 1),
    });
  }
  // Rounds the batch out to the wireframe's "26 items scanned".
  for (let i = 0; i < 9; i++) {
    files.push({
      path: `Downloads/archive_${i + 1}.zip`,
      size: 40 * MB,
      category: 'archive',
      modifiedMs: Date.UTC(2023, 11, (i % 27) + 1),
    });
  }
  return files;
}

/** The JSON a well-behaved model returns for {@link mockReorgFiles} — mirrors REORG_DIFF. */
export function mockReorgProposalJson(): string {
  return JSON.stringify({
    moves: [
      { from: 'Downloads/Invoice_2024.pdf', to: 'Documents/Finance/Invoice_2024.pdf' },
      { from: 'Downloads/IMG_0234.jpg', to: 'Pictures/2024/IMG_0234.jpg' },
      { from: 'Downloads/vacation-photos/', to: 'Pictures/2024/vacation-photos/', count: 12 },
      { from: 'Downloads/Report_draft.docx', to: 'Documents/Work/Report_draft.docx' },
      { from: 'Downloads/project-mockup.fig', to: 'Design/project-mockup.fig' },
    ],
    unmovedNote: '12 remaining files in Downloads/ — no confident category, left as-is',
  });
}

/**
 * A stand-in {@link AiApi} for offline dev / tests that returns the canned proposal above.
 * Ignores the messages/opts (no live model). Pair with {@link mockUnconfiguredAiApi} to
 * exercise the "can't propose right now" path.
 */
export function mockAiReorgApi(response: string = mockReorgProposalJson()): AiApi {
  return { chat: () => Promise.resolve(response) };
}

/** An {@link AiApi} that rejects as if no provider were configured. */
export function mockUnconfiguredAiApi(): AiApi {
  return { chat: () => Promise.reject(new Error('No model configured for ai.chat')) };
}
