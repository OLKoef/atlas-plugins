/**
 * Math — the presentational tool-tab shell (MATH1): topbar + one pane per live tool.
 *
 * Stateless on purpose, so the whole shell can be asserted from any state in tests (see
 * `__tests__/shell.test.tsx`); {@link MathPanel} owns the state and the storage wiring.
 *
 * The key structural guarantee: **all three live panes are rendered on every pass**, with
 * the inactive ones hidden rather than unmounted. That is what makes "each tool keeps its
 * state while hidden" true for tool-local React state — which MATH2's Graphing tool is the
 * first to rely on, since its rail and viewport live in its own reducer.
 */

import { Graphing } from './Graphing';
import { Topbar } from './Topbar';
import { ToolPane } from './ToolPane';
import { LIVE_TOOLS } from './lib/shellModel';
import type { LiveToolId, ToolDrafts, ToolId } from './lib/shellModel';

export function MathShell({
  activeTool,
  drafts,
  previews,
  onSelectTool,
  onDraftChange,
}: {
  activeTool: LiveToolId;
  drafts: ToolDrafts;
  /** per-tool ghost result; a tool with no preview maps to null. */
  previews: Partial<Record<LiveToolId, string | null>>;
  onSelectTool(tool: ToolId): void;
  onDraftChange(tool: LiveToolId, src: string): void;
}) {
  return (
    <div className="atlas-math">
      <Topbar activeTool={activeTool} onSelectTool={onSelectTool} />
      <div className="tool-area">
        {LIVE_TOOLS.map((tool) => (
          <ToolPane
            key={tool}
            tool={tool}
            active={tool === activeTool}
            draft={drafts[tool]}
            preview={previews[tool] ?? null}
            onDraftChange={(src) => onDraftChange(tool, src)}
          >
            {tool === 'graphing' ? <Graphing /> : null}
          </ToolPane>
        ))}
      </div>
    </div>
  );
}
