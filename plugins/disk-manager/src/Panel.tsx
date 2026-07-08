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

function BackToVisualize({ onBack }: { onBack(): void }) {
  return (
    <button type="button" className="crumb-btn" onClick={onBack}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Visualize
    </button>
  );
}

/** Placeholder for the swipe-triage UI (DISK6). Demonstrates the scoped target + nav model. */
function TriagePlaceholder({
  target,
  freedBytes,
  onBack,
  onEndSession,
  onOpenSummary,
}: {
  target: TriageTarget | null;
  freedBytes: number;
  onBack(): void;
  onEndSession(): void;
  onOpenSummary(): void;
}) {
  return (
    <div className="atlas-disk-manager">
      <div className="dm-page">
        <BackToVisualize onBack={onBack} />
        <div className="dm-header">
          <div className="dm-title-wrap">
            <h1 style={{ fontSize: 20 }}>Triage — {target?.label ?? 'Everything'}</h1>
            <p>Sorted by reclaim value — largest &amp; least-recently-opened first.</p>
          </div>
          <div className="dm-header-actions">
            <button type="button" className="tally-pill" onClick={onOpenSummary}>
              Space freed: {formatBytes(freedBytes)}
            </button>
          </div>
        </div>
        <div className="dm-placeholder">
          <p>
            Scoped triage session for <strong>{target?.label ?? 'this scope'}</strong>
            {target ? ` (${formatBytes(target.bytes)} in scope)` : ''}. The keep / delete /
            evict swipe UI lands in DISK6.
          </p>
          <button type="button" className="btn btn-md btn-primary" onClick={onEndSession}>
            End session
          </button>
        </div>
      </div>
    </div>
  );
}

/** Placeholder for the AI-reorg review (DISK7). */
function ReorgPlaceholder({ onBack }: { onBack(): void }) {
  return (
    <div className="atlas-disk-manager">
      <div className="dm-page">
        <BackToVisualize onBack={onBack} />
        <div className="dm-header">
          <div className="dm-title-wrap">
            <h1 style={{ fontSize: 20 }}>AI-reorganization review</h1>
            <p>A proposed plan, not applied yet — review and adjust each move before approving.</p>
          </div>
        </div>
        <div className="dm-placeholder">
          <p>The LM Studio-proposed folder plan (tree diff, review/adjust/approve) lands in DISK7.</p>
        </div>
      </div>
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
      <TriagePlaceholder
        target={state.triageTarget}
        freedBytes={state.freedBytes}
        onBack={() => dispatch({ type: 'backToVisualize' })}
        onEndSession={() => dispatch({ type: 'endSession' })}
        onOpenSummary={() => dispatch({ type: 'openSummary' })}
      />
    );
  }
  if (state.view === 'reorg') {
    return <ReorgPlaceholder onBack={() => dispatch({ type: 'backToVisualize' })} />;
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
