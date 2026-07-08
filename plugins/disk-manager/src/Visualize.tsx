/**
 * Disk Manager — the Visualize screen (DISK5). Presentational: it renders a fully-derived
 * {@link VisualizeModel} and calls back on interaction. All navigation state lives in the
 * Panel shell (see navigation.ts), so this file has no local state and is trivially
 * render-testable.
 *
 * Class names mirror DiskManagerApproved.html, scoped under `.atlas-disk-manager` so the
 * plugin's CSS can't collide with the host.
 */

import type { DuplicateSummary, TreemapNode, VisualizeModel } from './model';
import { DISK_SCOPES, SCOPE_LABELS, formatBytes } from './model';
import type { DiskScope } from './model';

export interface VisualizeProps {
  model: VisualizeModel;
  onScopeChange(scope: DiskScope): void;
  onSelectNode(node: TreemapNode): void;
  onReorg(): void;
  /** running tally of bytes freed this session; shows the pill when > 0. */
  freedBytes: number;
  onOpenSummary(): void;
  duplicates?: DuplicateSummary | null;
  onReviewDuplicates?(): void;
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function FlaskPillIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function treemapSizeClass(w: number, h: number): string {
  if (w < 7 || h < 10) return 'tm-node tm-tiny';
  if (w < 13 || h < 16) return 'tm-node tm-small';
  return 'tm-node';
}

export function Visualize({
  model,
  onScopeChange,
  onSelectNode,
  onReorg,
  freedBytes,
  onOpenSummary,
  duplicates,
  onReviewDuplicates,
}: VisualizeProps) {
  return (
    <div className="atlas-disk-manager">
      <div className="dm-page">
        <div className="dm-header">
          <div className="dm-title-wrap">
            <h1>Disk Manager</h1>
            <p>See what&apos;s taking up space, then clean it up.</p>
          </div>
          <div className="dm-header-actions">
            <div className="seg" role="tablist" aria-label="Scan scope">
              {DISK_SCOPES.map((scope) => (
                <button
                  key={scope}
                  type="button"
                  role="tab"
                  aria-selected={model.scope === scope}
                  data-scope={scope}
                  className={`seg-btn${model.scope === scope ? ' active' : ''}`}
                  onClick={() => onScopeChange(scope)}
                >
                  {SCOPE_LABELS[scope]}
                </button>
              ))}
            </div>
            {freedBytes > 0 && (
              <button type="button" className="tally-pill" onClick={onOpenSummary}>
                <FlaskPillIcon />
                Space freed: {formatBytes(freedBytes)}
              </button>
            )}
            <button type="button" className="btn btn-md btn-ghost" onClick={onReorg}>
              <SparkleIcon />
              Reorganize with AI
            </button>
          </div>
        </div>

        {duplicates && duplicates.files > 0 && (
          <div className="dupe-banner">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <div className="dupe-banner-text">
              <strong>{duplicates.files.toLocaleString()} duplicate files found</strong> — about{' '}
              {formatBytes(duplicates.reclaimableBytes)} reclaimable.
            </div>
            {onReviewDuplicates && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={onReviewDuplicates}
              >
                Review duplicates
              </button>
            )}
          </div>
        )}

        <div className="viz-body">
          <div className="viz-main">
            <div className="treemap-wrap" data-testid="treemap">
              {model.layout.map((rect) => (
                <button
                  key={rect.key}
                  type="button"
                  className={treemapSizeClass(rect.w, rect.h)}
                  data-node-key={rect.key}
                  title={`${rect.name} — ${formatBytes(rect.bytes)}`}
                  style={{
                    left: `${rect.x}%`,
                    top: `${rect.y}%`,
                    width: `${rect.w}%`,
                    height: `${rect.h}%`,
                    background: rect.color,
                  }}
                  onClick={() => onSelectNode(rect)}
                >
                  <span className="tm-name">{rect.name}</span>
                  <span className="tm-size">{formatBytes(rect.bytes)}</span>
                  <span className="tm-count">{rect.count.toLocaleString()} items</span>
                </button>
              ))}
            </div>
            <div className="viz-legend">
              {model.legend.map((node) => (
                <div key={node.key} className="legend-chip">
                  <span className="legend-dot" style={{ background: node.color }} />
                  {node.name}
                </div>
              ))}
            </div>
          </div>

          <div className="viz-side">
            {model.icloud && (
              <div data-testid="icloud-extras">
                <div className="side-block-lbl">iCloud — aggregate only</div>
                {model.icloud.aggregates.map((agg) => (
                  <div
                    key={agg.key}
                    className="card agg-card"
                    data-agg-key={agg.key}
                    aria-disabled="true"
                  >
                    <div className="agg-card-top">
                      <span className="agg-card-name">
                        <LockIcon />
                        {agg.name}
                      </span>
                      <span className="agg-card-size">{formatBytes(agg.bytes)}</span>
                    </div>
                    <div className="agg-card-sub">
                      {agg.count ? `${agg.count.toLocaleString()} items · ` : ''}
                      {agg.note}
                    </div>
                  </div>
                ))}
                <div className="backup-line" data-testid="icloud-backup">
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    <LockIcon />
                    {model.icloud.backup.bytes === null
                      ? 'iCloud Backup — out of scope'
                      : `iCloud Backup — ${formatBytes(model.icloud.backup.bytes)} (read-only)`}
                  </span>
                </div>
              </div>
            )}

            <div>
              <div className="side-block-lbl">Top reclaim targets</div>
              <div className="card" style={{ padding: '6px 14px' }}>
                {model.reclaimTargets.map((node) => (
                  <div key={node.key} className="reclaim-row">
                    <span className="reclaim-name">
                      <span className="reclaim-dot" style={{ background: node.color }} />
                      {node.name}
                    </span>
                    <span className="reclaim-val">{formatBytes(node.bytes)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
