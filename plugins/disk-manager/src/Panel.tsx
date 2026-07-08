/**
 * Disk Manager — the Panel shell (DISK5). This is the `type: "tool"` full-sidebar view.
 *
 * It owns the navigation state (reduceDiskManager) and loads the DISK1 scans once, then
 * lets {@link Visualize} — the persistent shell — drive everything. Triage / AI-reorg /
 * Session-summary are placeholders here; DISK6–DISK8 fill them in on top of the locked
 * navigation model wired up below.
 */

import { useEffect, useMemo, useReducer, useState } from 'react';
import type { AtlasPluginApi } from '@atlas/plugin-sdk';
import {
  buildVisualizeModel,
  formatBytes,
  loadVisualizeSources,
  mockDuplicateSummary,
} from './model';
import type { DuplicateSummary, TreemapNode, VisualizeSources } from './model';
import {
  initialDiskManagerState,
  reduceDiskManager,
  triageTargetFromNode,
} from './navigation';
import type { TriageTarget } from './navigation';
import { Visualize } from './Visualize';
import { Triage } from './Triage';
import { Reorg } from './Reorg';
import type { ReorgStatus } from './Reorg';
import {
  TRIAGE_NOW_MS,
  applyTriageDecision,
  mockTriageQueue,
  resolveTriageAction,
  sortByReclaimValue,
} from './triageModel';
import type { TriageActionId } from './triageModel';
import {
  DEFAULT_REORG_PROVIDER,
  REORG_SOURCE_ROOT,
  adjustReorgMove,
  applyReorgDecision,
  buildReorgReview,
  mockReorgFiles,
  proposeReorg,
  reorgScope,
  resolveReorgApply,
  setAllReorgMoves,
  toggleReorgMove,
} from './reorgModel';
import type { ReorgReviewState } from './reorgModel';

/**
 * The swipe-triage controller (DISK6). Owns the per-session state — the reclaim-sorted queue,
 * the current card index, and the per-card app-uninstall confirm — over the pure triage model.
 * A swipe resolves to a {@link resolveTriageAction} decision, fires the matching `disk.*`
 * mutation via {@link applyTriageDecision}, records the reclaimed bytes, then advances; the
 * queue running dry auto-ends the session (→ summary). Mounted keyed by target so each new
 * session starts fresh.
 */
function TriageController({
  api,
  target,
  freedBytes,
  onBack,
  onEndSession,
  onOpenSummary,
  onRecordFreed,
}: {
  api: AtlasPluginApi;
  target: TriageTarget | null;
  freedBytes: number;
  onBack(): void;
  onEndSession(): void;
  onOpenSummary(): void;
  onRecordFreed(bytes: number): void;
}) {
  const queue = useMemo(() => sortByReclaimValue(mockTriageQueue(), TRIAGE_NOW_MS), []);
  const [index, setIndex] = useState(0);
  const [appConfirmed, setAppConfirmed] = useState(false);
  const item = index < queue.length ? queue[index] : null;

  const handleAction = (action: TriageActionId) => {
    if (!item) return;
    const decision = resolveTriageAction(item, action, { confirmed: appConfirmed });
    // Blocked = a disabled button (evict on a non-iCloud file) or an unconfirmed app delete;
    // both are UI-guarded already, so just no-op here.
    if (decision.blocked) return;
    if (decision.op) {
      applyTriageDecision(api, decision).catch((e: unknown) => {
        api.ui?.toast?.('error', 'Action failed', e instanceof Error ? e.message : String(e));
      });
    }
    if (decision.reclaimBytes > 0) onRecordFreed(decision.reclaimBytes);
    setAppConfirmed(false);
    const next = index + 1;
    if (next >= queue.length) onEndSession();
    else setIndex(next);
  };

  return (
    <div className="atlas-disk-manager">
      <Triage
        item={item}
        index={index}
        total={queue.length}
        freedBytes={freedBytes}
        target={target}
        appConfirmed={appConfirmed}
        onToggleConfirm={setAppConfirmed}
        onAction={handleAction}
        onBack={onBack}
        onOpenSummary={onOpenSummary}
        nowMs={TRIAGE_NOW_MS}
      />
    </div>
  );
}

/**
 * The AI-reorg review controller (DISK7). On mount it batches file metadata through the
 * configured model (`ai.chat`) to PROPOSE a folder structure, then owns the tree-diff review
 * state (accept/reject/adjust). Applying goes through {@link resolveReorgApply} with explicit
 * approval — nothing is ever auto-applied, and only the accepted moves reach
 * `disk.applyReorgPlan`. A model rejection surfaces as "can't propose right now," not a crash.
 */
function ReorgController({
  api,
  onBack,
  onRecordFreed,
}: {
  api: AtlasPluginApi;
  onBack(): void;
  onRecordFreed(bytes: number): void;
}) {
  const [status, setStatus] = useState<ReorgStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [review, setReview] = useState<ReorgReviewState | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let live = true;
    proposeReorg(api, { files: mockReorgFiles(), sourceRoot: REORG_SOURCE_ROOT })
      .then((proposal) => {
        if (!live) return;
        setReview(buildReorgReview(proposal));
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (!live) return;
        setErrorMessage(
          `Couldn't propose a reorganization right now — ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        setStatus('error');
      });
    return () => {
      live = false;
    };
  }, [api]);

  const handleApply = () => {
    if (!review || applying) return;
    // The approval gate: this is the ONLY place we pass `approved: true`, and it only ever
    // runs from the explicit "Apply accepted changes" click. A blocked decision fires nothing.
    const decision = resolveReorgApply(review, {
      approved: true,
      scope: reorgScope(review.sourceRoot),
    });
    if (!decision.willApply) return;
    setApplying(true);
    applyReorgDecision(api, decision)
      .then((result) => {
        if (result) {
          onRecordFreed(result.reclaimedBytes);
          api.ui?.toast?.('success', 'Reorganized', result.summary);
        }
        onBack();
      })
      .catch((e: unknown) => {
        api.ui?.toast?.('error', 'Reorg failed', e instanceof Error ? e.message : String(e));
        setApplying(false);
      });
  };

  return (
    <div className="atlas-disk-manager">
      <Reorg
        status={status}
        review={review}
        provider={DEFAULT_REORG_PROVIDER}
        errorMessage={errorMessage}
        applying={applying}
        onToggle={(id, accepted) =>
          setReview((s) => (s ? toggleReorgMove(s, id, accepted) : s))
        }
        onSetAll={(accepted) => setReview((s) => (s ? setAllReorgMoves(s, accepted) : s))}
        onAdjust={(id, to) => setReview((s) => (s ? adjustReorgMove(s, id, to) : s))}
        onApply={handleApply}
        onCancel={onBack}
        onBack={onBack}
      />
    </div>
  );
}

/** Placeholder for the Session summary + undo log (DISK8). */
function SummaryPlaceholder({
  freedBytes,
  onBack,
}: {
  freedBytes: number;
  onBack(): void;
}) {
  return (
    <div className="atlas-disk-manager">
      <div className="dm-page">
        <div className="dm-header">
          <div className="dm-title-wrap">
            <h1 style={{ fontSize: 20 }}>Session summary</h1>
            <p>Every action can be undone individually — the undo log lands in DISK8.</p>
          </div>
        </div>
        <div className="card summary-hero">
          <div className="summary-hero-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div>
            <div className="summary-hero-num">{formatBytes(freedBytes)}</div>
            <div className="summary-hero-lbl">freed this session</div>
          </div>
        </div>
        <div className="summary-footer">
          <button type="button" className="btn btn-md btn-ghost" onClick={onBack}>
            Back to Visualize
          </button>
        </div>
      </div>
    </div>
  );
}

export function DiskManagerPanel({ api }: { api: AtlasPluginApi }) {
  const [state, dispatch] = useReducer(reduceDiskManager, initialDiskManagerState);
  const [sources, setSources] = useState<VisualizeSources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const duplicates: DuplicateSummary = useMemo(() => mockDuplicateSummary(), []);

  useEffect(() => {
    let live = true;
    loadVisualizeSources(api)
      .then((s) => {
        if (live) setSources(s);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [api]);

  const model = useMemo(
    () => (sources ? buildVisualizeModel(state.scope, sources) : null),
    [state.scope, sources],
  );

  const selectNode = (node: TreemapNode) =>
    dispatch({ type: 'selectTarget', target: triageTargetFromNode(node, state.scope) });

  if (state.view === 'triage') {
    return (
      <TriageController
        key={state.triageTarget?.root ?? 'all'}
        api={api}
        target={state.triageTarget}
        freedBytes={state.freedBytes}
        onBack={() => dispatch({ type: 'backToVisualize' })}
        onEndSession={() => dispatch({ type: 'endSession' })}
        onOpenSummary={() => dispatch({ type: 'openSummary' })}
        onRecordFreed={(bytes) => dispatch({ type: 'recordFreed', bytes })}
      />
    );
  }
  if (state.view === 'reorg') {
    return (
      <ReorgController
        api={api}
        onBack={() => dispatch({ type: 'backToVisualize' })}
        onRecordFreed={(bytes) => dispatch({ type: 'recordFreed', bytes })}
      />
    );
  }
  if (state.view === 'summary') {
    return (
      <SummaryPlaceholder
        freedBytes={state.freedBytes}
        onBack={() => dispatch({ type: 'backToVisualize' })}
      />
    );
  }

  // view === 'visualize' — the persistent shell.
  return (
    <div className="atlas-disk-manager">
      {model ? (
        <Visualize
          model={model}
          freedBytes={state.freedBytes}
          duplicates={duplicates}
          onScopeChange={(scope) => dispatch({ type: 'setScope', scope })}
          onSelectNode={selectNode}
          onReorg={() => dispatch({ type: 'openReorg' })}
          onOpenSummary={() => dispatch({ type: 'openSummary' })}
          onReviewDuplicates={() =>
            dispatch({
              type: 'selectTarget',
              target: {
                scope: state.scope,
                label: 'Duplicates',
                root: 'duplicates',
                source: 'duplicates',
                bytes: duplicates.reclaimableBytes,
              },
            })
          }
        />
      ) : (
        <div className="dm-page">
          <div className="dm-placeholder">
            {error ? `Couldn't scan disk: ${error}` : 'Scanning disk…'}
          </div>
        </div>
      )}
    </div>
  );
}
