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
import { Summary } from './Summary';
import {
  applyUndo,
  loadSessionLog,
  planUndo,
  reorgActionInput,
  saveSessionLog,
  triageActionInput,
} from './sessionModel';
import type { RecordActionInput, UndoLogEntry } from './sessionModel';
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
 * mutation via {@link applyTriageDecision}, records the action in the DISK8 undo log (a Keep
 * logs too, for its count), then advances; the queue running dry auto-ends the session
 * (→ summary). Mounted keyed by target so each new session starts fresh.
 */
function TriageController({
  api,
  target,
  freedBytes,
  onBack,
  onEndSession,
  onOpenSummary,
  onLogAction,
}: {
  api: AtlasPluginApi;
  target: TriageTarget | null;
  freedBytes: number;
  onBack(): void;
  onEndSession(): void;
  onOpenSummary(): void;
  onLogAction(input: RecordActionInput): void;
}) {
  const queue = useMemo(() => sortByReclaimValue(mockTriageQueue(), TRIAGE_NOW_MS), []);
  const [index, setIndex] = useState(0);
  const [appConfirmed, setAppConfirmed] = useState(false);
  const item = index < queue.length ? queue[index] : null;

  const handleAction = (action: TriageActionId) => {
    if (!item) return;
    const decision = resolveTriageAction(item, action, { confirmed: appConfirmed });
    // Blocked = a disabled button (evict on a non-iCloud file) or an unconfirmed app delete;
    // both are UI-guarded already, so just no-op here (nothing recorded, no advance).
    if (decision.blocked) return;
    if (decision.op) {
      applyTriageDecision(api, decision).catch((e: unknown) => {
        api.ui?.toast?.('error', 'Action failed', e instanceof Error ? e.message : String(e));
      });
    }
    // Record every resolved swipe (Keep included) in the undo log; the tally derives from it.
    onLogAction(triageActionInput(item, decision, Date.now()));
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
  onLogAction,
}: {
  api: AtlasPluginApi;
  onBack(): void;
  onLogAction(input: RecordActionInput): void;
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
          // Log the whole reorg batch — one undoable entry carrying its moves (reverse-move).
          onLogAction(reorgActionInput(result, Date.now()));
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

export function DiskManagerPanel({ api }: { api: AtlasPluginApi }) {
  const [state, dispatch] = useReducer(reduceDiskManager, initialDiskManagerState);
  const [sources, setSources] = useState<VisualizeSources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
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

  // Hydrate the persisted undo log (DISK8) once, so a reload keeps the tally + undo affordance.
  useEffect(() => {
    let live = true;
    if (!api.storage) {
      setHydrated(true);
      return;
    }
    loadSessionLog(api.storage)
      .then((log) => {
        if (live) dispatch({ type: 'hydrateLog', log });
      })
      .catch(() => {
        /* a bad/absent value already parses to an empty log; nothing to surface. */
      })
      .finally(() => {
        if (live) setHydrated(true);
      });
    return () => {
      live = false;
    };
  }, [api]);

  // Persist the log whenever it changes — but not before hydration, or we'd clobber the
  // stored value with the initial empty log on mount.
  useEffect(() => {
    if (!hydrated || !api.storage) return;
    saveSessionLog(api.storage, state.log).catch(() => {
      /* best-effort persistence; a failed flush is non-fatal to the session. */
    });
  }, [api, hydrated, state.log]);

  const undoAction = (entry: UndoLogEntry) => {
    const plan = planUndo(entry);
    // Reflect the undo in the model immediately (drops it from the tally + counts)…
    dispatch({ type: 'undoLogEntry', id: entry.id });
    // …then physically reverse it where an API primitive exists (a reorg reverse-move);
    // trash / redownload have none, so we just tell the user how to finish.
    if (plan.disk) {
      applyUndo(api, plan, reorgScope())
        .then(() => api.ui?.toast?.('success', 'Undone', plan.message))
        .catch((e: unknown) => {
          api.ui?.toast?.('error', 'Undo failed', e instanceof Error ? e.message : String(e));
        });
    } else {
      api.ui?.toast?.('info', 'Undo', plan.message);
    }
  };

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
        onLogAction={(input) => dispatch({ type: 'logAction', input })}
      />
    );
  }
  if (state.view === 'reorg') {
    return (
      <ReorgController
        api={api}
        onBack={() => dispatch({ type: 'backToVisualize' })}
        onLogAction={(input) => dispatch({ type: 'logAction', input })}
      />
    );
  }
  if (state.view === 'summary') {
    return (
      <Summary
        log={state.log}
        onUndo={undoAction}
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
