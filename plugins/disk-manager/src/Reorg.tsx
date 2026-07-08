/**
 * Disk Manager — the AI-reorg review screen (DISK7). Presentational: it renders the tree
 * diff (proposed vs. current) over a {@link ReorgReviewState} and calls back on every
 * interaction — accept/reject a move, Accept-all / Reject-all, adjust a destination inline,
 * Cancel, and Apply. It owns NO review or navigation state (that lives in the Panel's
 * ReorgController), and no move fires from here — the Apply button just calls `onApply`,
 * which the controller resolves through the approval gate.
 *
 * Class names mirror DiskManagerApproved.html's AI-reorg state, scoped under
 * `.atlas-disk-manager`.
 */

import { useState } from 'react';
import type { ReorgProvider, ReorgReviewEntry, ReorgReviewState } from './reorgModel';
import { reorgAcceptedCount, reorgTotalCount } from './reorgModel';

export type ReorgStatus = 'loading' | 'error' | 'ready';

export interface ReorgProps {
  status: ReorgStatus;
  /** the tree-diff review state; present when `status === 'ready'`. */
  review: ReorgReviewState | null;
  /** the configured model behind the proposal (drives the "Connected via …" pill). */
  provider: ReorgProvider;
  /** message shown when `status === 'error'` (e.g. "can't propose right now"). */
  errorMessage?: string;
  /** true while the accepted plan is being applied (disables Apply to prevent double-fire). */
  applying?: boolean;
  onToggle(id: string, accepted: boolean): void;
  onSetAll(accepted: boolean): void;
  onAdjust(id: string, to: string): void;
  onApply(): void;
  onCancel(): void;
  onBack(): void;
}

function BackCrumb({ onBack }: { onBack(): void }) {
  return (
    <button type="button" className="crumb-btn" onClick={onBack}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Visualize
    </button>
  );
}

function ReorgHeader() {
  return (
    <div className="dm-header">
      <div className="dm-title-wrap">
        <h1 style={{ fontSize: 20 }}>AI-reorganization review</h1>
        <p>A proposed plan, not applied yet — review and adjust each move before approving.</p>
      </div>
    </div>
  );
}

/** One tree-diff row: accept toggle, `from → to` paths, optional folder count, inline adjust. */
function DiffRow({
  entry,
  onToggle,
  onAdjust,
}: {
  entry: ReorgReviewEntry;
  onToggle(id: string, accepted: boolean): void;
  onAdjust(id: string, to: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.to);

  const save = () => {
    onAdjust(entry.id, draft);
    setEditing(false);
  };

  return (
    <div
      className={`diff-row${entry.accepted ? '' : ' rejected'}`}
      data-idx={entry.id}
      data-accepted={entry.accepted}
    >
      <input
        type="checkbox"
        className="ck"
        checked={entry.accepted}
        aria-label={`Accept moving ${entry.from}`}
        onChange={(e) => onToggle(entry.id, e.currentTarget.checked)}
      />
      <span className="diff-paths">
        <span className="diff-from">{entry.from}</span>
        <span className="diff-arrow" aria-hidden="true">
          →
        </span>
        {editing ? (
          <input
            className="diff-edit"
            value={draft}
            aria-label={`Destination for ${entry.from}`}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <span className="diff-to" data-adjusted={entry.adjusted}>
            {entry.to}
          </span>
        )}
        {entry.count ? <span className="diff-count">{entry.count} files</span> : null}
      </span>
      {editing ? (
        <button type="button" className="diff-adjust" onClick={save}>
          Save
        </button>
      ) : (
        <button
          type="button"
          className="diff-adjust"
          data-adjust={entry.id}
          onClick={() => {
            setDraft(entry.to);
            setEditing(true);
          }}
        >
          Adjust
        </button>
      )}
    </div>
  );
}

export function Reorg({
  status,
  review,
  provider,
  errorMessage,
  applying = false,
  onToggle,
  onSetAll,
  onAdjust,
  onApply,
  onCancel,
  onBack,
}: ReorgProps) {
  if (status !== 'ready' || !review) {
    return (
      <div className="dm-page">
        <BackCrumb onBack={onBack} />
        <ReorgHeader />
        <div className="dm-placeholder" data-testid="reorg-status">
          {status === 'error'
            ? errorMessage ?? "Couldn't propose a reorganization right now."
            : 'Asking the configured model for a proposed structure…'}
        </div>
      </div>
    );
  }

  const accepted = reorgAcceptedCount(review);
  const total = reorgTotalCount(review);

  return (
    <div className="dm-page">
      <BackCrumb onBack={onBack} />
      <ReorgHeader />

      <div className="reorg-provider">
        <span className="dot" aria-hidden="true" />
        Connected via {provider.label} · {provider.model}
      </div>

      <div className="card diff-card">
        <div className="diff-hd">
          <span className="diff-hd-title">
            {review.sourceRoot}/ — {review.scannedCount} items scanned
          </span>
          <div className="diff-hd-actions">
            <button type="button" data-action="accept-all" onClick={() => onSetAll(true)}>
              Accept all
            </button>
            <button type="button" data-action="reject-all" onClick={() => onSetAll(false)}>
              Reject all
            </button>
          </div>
        </div>

        <div id="diff-rows" data-testid="diff-rows">
          {review.entries.map((entry) => (
            <DiffRow key={entry.id} entry={entry} onToggle={onToggle} onAdjust={onAdjust} />
          ))}
          {review.unmovedNote && (
            <div className="diff-row">
              <span className="diff-noop">{review.unmovedNote}</span>
            </div>
          )}
        </div>

        <div className="diff-summary-row">
          <span className="diff-summary-count">
            <b data-testid="diff-accepted-count">{accepted}</b> of {total} changes accepted
          </span>
          <div className="diff-summary-actions">
            <button type="button" className="btn btn-md btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-md btn-primary"
              data-action="apply"
              disabled={accepted === 0 || applying}
              onClick={onApply}
            >
              {applying ? 'Applying…' : 'Apply accepted changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
