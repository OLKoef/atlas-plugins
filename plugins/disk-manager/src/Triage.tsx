/**
 * Disk Manager — the Triage swipe screen (DISK6). Presentational: it renders one
 * {@link TriageItem} card plus the three LOCKED actions (Delete-left / Evict-middle /
 * Keep-right, with the wireframe's arrow iconography) and calls back on interaction. All
 * session state (queue, index, tally, per-card confirm) lives in the Panel shell, so this
 * file has no navigation state and is trivially render-testable.
 *
 * Class names mirror DiskManagerApproved.html, scoped under `.atlas-disk-manager`.
 */

import type { TriageActionDef, TriageItem } from './triageModel';
import {
  ARROW_ICONS,
  TRIAGE_ACTIONS,
  TRIAGE_NOW_MS,
  canEvict,
  evictLabel,
  formatDate,
  formatLastOpened,
} from './triageModel';
import { formatBytes } from './model';
import type { TriageTarget } from './navigation';

export interface TriageProps {
  /** the current card, or `null` once the queue is exhausted (Panel then shows the summary). */
  item: TriageItem | null;
  /** 0-based position of `item` in the sorted queue. */
  index: number;
  total: number;
  /** running tally of bytes freed this session (drives the pill). */
  freedBytes: number;
  target: TriageTarget | null;
  /** whether the app-uninstall confirm has been given for the current card. */
  appConfirmed: boolean;
  onToggleConfirm(next: boolean): void;
  onAction(action: TriageActionDef['id']): void;
  onBack(): void;
  onOpenSummary(): void;
  /** reference time for the "last opened" line; defaults to the mocked-queue reference. */
  nowMs?: number;
}

function ArrowIcon({ arrow }: { arrow: TriageActionDef['arrow'] }) {
  const { line, polyline } = ARROW_ICONS[arrow];
  const [x1, y1, x2, y2] = line;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <polyline points={polyline} />
    </svg>
  );
}

/** Whether a given action is disabled for this card (evict on non-iCloud / unconfirmed app delete). */
function actionDisabled(action: TriageActionDef, item: TriageItem, appConfirmed: boolean): boolean {
  if (action.id === 'evict') return !canEvict(item);
  if (action.id === 'delete') return Boolean(item.app) && !appConfirmed;
  return false;
}

function SwipeCard({
  item,
  appConfirmed,
  onToggleConfirm,
  nowMs,
}: {
  item: TriageItem;
  appConfirmed: boolean;
  onToggleConfirm(next: boolean): void;
  nowMs: number;
}) {
  return (
    <div className="swipe-card" data-testid="swipe-card">
      <div className="swipe-preview">
        <div className="swipe-badges">
          {item.icloud === 'downloaded' && (
            <span className="badge badge-accent">iCloud Drive</span>
          )}
        </div>
        {item.duplicateCount > 0 && (
          <div className="swipe-badges right">
            <span className="badge badge-warning">{item.duplicateCount} duplicates found</span>
          </div>
        )}
        <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: item.iconPath }} />
      </div>

      <div className="swipe-body">
        <div className="swipe-name">{item.name}</div>
        <div className="swipe-kind">
          {item.kind} · {formatBytes(item.bytes)}
        </div>
        <div className="swipe-meta">
          <div className="meta-item">
            <span className="meta-key">Created</span>
            <span className="meta-val">{formatDate(item.createdMs)}</span>
          </div>
          <div className="meta-item">
            <span className="meta-key">Last opened</span>
            <span className="meta-val">{formatLastOpened(item, nowMs)}</span>
          </div>
          <div className="meta-item full">
            <span className="meta-key" style={{ display: 'block', marginBottom: 2 }}>
              Location
            </span>
            <span className="meta-val full">{item.location}</span>
          </div>
        </div>
      </div>

      {item.app && (
        <div className="uninstall-panel" data-testid="uninstall-panel">
          <div className="uninstall-hd">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
            Also remove — leftover app data found
          </div>
          {item.app.leftovers.map((lo) => (
            <div key={lo.path} className="leftover-row" data-leftover-path={lo.path}>
              <span className="leftover-meta">
                <div className="leftover-path">{lo.path}</div>
                <div className="leftover-size">{formatBytes(lo.bytes)}</div>
              </span>
            </div>
          ))}
          <label className="uninstall-confirm-gate">
            <input
              type="checkbox"
              className="ck"
              checked={appConfirmed}
              onChange={(e) => onToggleConfirm(e.currentTarget.checked)}
            />
            <span>
              Yes — move <strong>{item.name}</strong> and the {item.app.leftovers.length} items above
              to Trash. This is a stronger confirm than a plain swipe; Delete stays disabled until
              it&apos;s checked.
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

export function Triage({
  item,
  index,
  total,
  freedBytes,
  target,
  appConfirmed,
  onToggleConfirm,
  onAction,
  onBack,
  onOpenSummary,
  nowMs = TRIAGE_NOW_MS,
}: TriageProps) {
  return (
    <div className="dm-page">
      <button type="button" className="crumb-btn" onClick={onBack}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Visualize
      </button>
      <div className="dm-header">
        <div className="dm-title-wrap">
          <h1 style={{ fontSize: 20 }}>Triage — {target?.label ?? 'Everything'}</h1>
          <p>Sorted by reclaim value — largest &amp; least-recently-opened first.</p>
        </div>
      </div>

      <div className="triage-shell">
        <div className="triage-top">
          <span className="triage-progress">
            <b>{Math.min(index + 1, total)}</b> of <b>{total}</b> in this session
          </span>
          <button type="button" className="tally-pill" onClick={onOpenSummary}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            Space freed: {formatBytes(freedBytes)}
          </button>
        </div>

        {item ? (
          <SwipeCard
            item={item}
            appConfirmed={appConfirmed}
            onToggleConfirm={onToggleConfirm}
            nowMs={nowMs}
          />
        ) : (
          <div className="swipe-card dm-placeholder">Nothing left to triage in this scope.</div>
        )}

        <div className="swipe-actions" role="group" aria-label="Triage actions">
          {TRIAGE_ACTIONS.map((action) => {
            const disabled = !item || actionDisabled(action, item, appConfirmed);
            const label =
              action.id === 'evict' && item ? evictLabel(item) : action.label;
            return (
              <div className="swipe-action-col" key={action.id}>
                <button
                  type="button"
                  className={`swipe-btn ${action.className}`}
                  data-action={action.id}
                  data-arrow={action.arrow}
                  title={action.title}
                  disabled={disabled}
                  onClick={() => onAction(action.id)}
                >
                  <ArrowIcon arrow={action.arrow} />
                </button>
                <span className="swipe-btn-lbl" data-action-lbl={action.id}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
