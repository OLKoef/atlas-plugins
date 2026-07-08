/**
 * Disk Manager — Session summary + undo log (DISK8). Presentational only; all state lives in
 * the {@link SessionLog} the Panel owns + persists. Ported from DiskManagerApproved.html:
 * the "freed this session" hero, the five-card action grid, and the per-row undo log where
 * every keep/delete/evict/move can be individually undone.
 */

import { formatBytes } from './model';
import {
  entryVerb,
  formatLogTime,
  logRowStyle,
  recentEntries,
  sessionCounts,
  sessionFreedBytes,
  totalActions,
} from './sessionModel';
import type { SessionActionKind, SessionLog, UndoLogEntry } from './sessionModel';

/** Stat cards in the locked wireframe order + labels. */
const STAT_CARDS: readonly { kind: SessionActionKind; label: string }[] = [
  { kind: 'keep', label: 'Kept' },
  { kind: 'delete', label: 'Deleted' },
  { kind: 'evict', label: 'Evicted' },
  { kind: 'uninstall', label: 'App removed' },
  { kind: 'reorg', label: 'Reorganized' },
];

const LOG_LIMIT = 20;

/** The trailing detail on a log row: freed bytes and/or the Trash destination. */
function rowDetail(entry: UndoLogEntry): string {
  const parts: string[] = [];
  if (entry.freedBytes > 0) parts.push(`(${formatBytes(entry.freedBytes)})`);
  if (entry.recovery === 'trash') parts.push('→ Trash');
  return parts.length ? ` ${parts.join(' ')}` : '';
}

export function Summary({
  log,
  onUndo,
  onBack,
}: {
  log: SessionLog;
  onUndo(entry: UndoLogEntry): void;
  onBack(): void;
}) {
  const freed = sessionFreedBytes(log);
  const counts = sessionCounts(log);
  const rows = recentEntries(log, LOG_LIMIT);
  const total = totalActions(log);

  return (
    <div className="atlas-disk-manager">
      <div className="dm-page">
        <div className="dm-header">
          <div className="dm-title-wrap">
            <h1 style={{ fontSize: 20 }}>Session summary</h1>
            <p>
              Every action below can be undone individually — Trash-deleted files also recover
              from Trash.
            </p>
          </div>
        </div>

        <div className="card summary-hero">
          <div className="summary-hero-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div>
            <div className="summary-hero-num">{formatBytes(freed)}</div>
            <div className="summary-hero-lbl">freed this session</div>
          </div>
        </div>

        <div className="stat-grid">
          {STAT_CARDS.map((c) => (
            <div className="card stat-card" key={c.kind}>
              <div className="stat-card-num">{counts[c.kind]}</div>
              <div className="stat-card-lbl">{c.label}</div>
            </div>
          ))}
        </div>

        <div className="log-head">
          <div className="side-block-lbl" style={{ marginBottom: 0 }}>
            Undo log{total > LOG_LIMIT ? ` — last ${LOG_LIMIT}` : ''}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="card log-list log-empty">No actions yet this session.</div>
        ) : (
          <div className="card log-list">
            {rows.map((entry) => {
              const style = logRowStyle(entry.kind);
              return (
                <div
                  className={`log-row ${style.rowClass}${entry.undone ? ' undone' : ''}`.trim()}
                  key={entry.id}
                >
                  <span className="log-time">{formatLogTime(entry.atMs)}</span>
                  <span className="log-desc">
                    {entryVerb(entry)} <b>{entry.label}</b>
                    {rowDetail(entry)}
                  </span>
                  <span className={`log-tag ${style.tagClass}`}>{style.tagText}</span>
                  {entry.undone ? (
                    <span className="log-undone">Undone</span>
                  ) : (
                    <button type="button" className="log-undo" onClick={() => onUndo(entry)}>
                      Undo
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="summary-footer">
          <button type="button" className="btn btn-md btn-ghost" onClick={onBack}>
            Back to Visualize
          </button>
          <button type="button" className="btn btn-md btn-primary" onClick={onBack}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
