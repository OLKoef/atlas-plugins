/**
 * Math — the presentational tool-tab shell (MATH1): topbar + one pane per live tool.
 *
 * Stateless on purpose, so the whole shell can be asserted from any state in tests (see
 * `__tests__/shell.test.tsx`); {@link MathPanel} owns the state and the storage wiring.
 *
 * The key structural guarantee: **all three live panes are rendered on every pass**, with
 * the inactive ones hidden rather than unmounted. That is what makes "each tool keeps its
 * state while hidden" true for tool-local React state — which MATH2's Graphing tool is the
 * first to rely on, since its rail and viewport live in its own reducer, and MATH4's
 * Scientific the second, since its tape and input line live in its own.
 */

import type { ReactNode } from 'react';
import type { StorageApi } from '@atlas/plugin-sdk';
import { Graphing } from './Graphing';
import { Scientific } from './Scientific';
import { Topbar } from './Topbar';
import { ToolPane } from './ToolPane';
import { LIVE_TOOLS } from './lib/shellModel';
import type { LiveToolId, ToolDrafts, ToolId } from './lib/shellModel';

/**
 * The shipped tool for a pane, or null while it is still the MATH1 placeholder (Matrix,
 * until MATH5). One expression rather than one conditional per tool: `ToolPane` falls back
 * to the placeholder on a *nullish* child, and a list of `null`s is not nullish.
 */
function toolFor(
  tool: LiveToolId,
  storage?: Pick<StorageApi, 'get' | 'set'> | null,
): ReactNode {
  if (tool === 'graphing') return <Graphing storage={storage} />;
  if (tool === 'scientific') return <Scientific storage={storage} />;
  return null;
}

export function MathShell({
  activeTool,
  drafts,
  previews,
  storage,
  onSelectTool,
  onDraftChange,
}: {
  activeTool: LiveToolId;
  drafts: ToolDrafts;
  /** per-tool ghost result; a tool with no preview maps to null. */
  previews: Partial<Record<LiveToolId, string | null>>;
  /**
   * The host's storage namespace, handed to the tools that persist their own section
   * (MATH3: Graphing, MATH4: Scientific). Absent when the plugin runs without the `storage`
   * permission — the tools still work, they just start empty every time.
   */
  storage?: Pick<StorageApi, 'get' | 'set'> | null;
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
            {toolFor(tool, storage)}
          </ToolPane>
        ))}
      </div>
    </div>
  );
}
