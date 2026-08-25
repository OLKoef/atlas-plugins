/**
 * Math — the plugin topbar (MATH1): the ∑ brand mark plus the segmented tool tabs.
 *
 * Markup and class names are ported from MathPluginApproved.html's `.plugin-topbar`. The
 * three live tools are real tabs; Geometry and 3D render as disabled slots carrying the
 * "Soon" tag — visible roadmap, never activatable.
 *
 * The topbar's right-hand actions (insert-into-note / copy-as-LaTeX, plugin settings) are
 * deliberately absent here: the insert action is MATH6/MATH7's `notes:insert` bridge, and a
 * shell that renders them as permanently inert buttons would be lying about what works.
 */

import { TOOLS } from './lib/shellModel';
import type { LiveToolId, ToolId } from './lib/shellModel';

export function paneDomId(tool: ToolId): string {
  return `math-pane-${tool}`;
}

export function tabDomId(tool: ToolId): string {
  return `math-tab-${tool}`;
}

export function Topbar({
  activeTool,
  onSelectTool,
}: {
  activeTool: LiveToolId;
  onSelectTool(tool: ToolId): void;
}) {
  return (
    <div className="plugin-topbar">
      <div className="plugin-brand" aria-hidden="true">
        ∑
      </div>
      <div className="tool-tabs" role="tablist" aria-label="Math tools">
        {TOOLS.map((tool) => {
          const soon = tool.status === 'soon';
          const active = !soon && tool.id === activeTool;
          return (
            <button
              key={tool.id}
              id={tabDomId(tool.id)}
              type="button"
              role="tab"
              className={`tool-tab${active ? ' tt-active' : ''}${soon ? ' tt-disabled' : ''}`}
              aria-selected={active}
              aria-controls={soon ? undefined : paneDomId(tool.id)}
              disabled={soon}
              title={soon ? `${tool.label} — coming soon` : undefined}
              onClick={() => onSelectTool(tool.id)}
            >
              {tool.label}
              {soon ? <span className="soon-tag">Soon</span> : null}
            </button>
          );
        })}
      </div>
      <div className="topbar-spacer" />
    </div>
  );
}
