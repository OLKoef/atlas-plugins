/**
 * Math — the presentational tool-tab shell (MATH1): topbar + one pane per live tool.
 *
 * Stateless on purpose, so the whole shell can be asserted from any state in tests (see
 * `__tests__/shell.test.tsx`); {@link MathPanel} owns the state and the storage wiring.
 *
 * The key structural guarantee: **all three live panes are rendered on every pass**, with
 * the inactive ones hidden rather than unmounted. That is what makes "each tool keeps its
 * state while hidden" true for tool-local React state — which every one of the three tools
 * now relies on, since each keeps its own reducer: Graphing's rail and viewport (MATH2),
 * Scientific's tape and input line (MATH4), Matrix's rail and result history (MATH5).
 */

import type { ReactNode } from 'react';
import type { StorageApi } from '@atlas/plugin-sdk';
import { Graphing } from './Graphing';
import { Matrix } from './Matrix';
import { Scientific } from './Scientific';
import { Topbar } from './Topbar';
import { ToolPane } from './ToolPane';
import type { ExportSubject, RegisterExports } from './lib/exportModel';
import type { InsertBridge } from './lib/notes';
import { LIVE_TOOLS } from './lib/shellModel';
import type { LiveToolId, ToolDrafts, ToolId } from './lib/shellModel';

/** Everything a tool pane needs from the shell besides its own state. */
interface ToolWiring {
  storage?: Pick<StorageApi, 'get' | 'set'> | null;
  registerExports?: RegisterExports | null;
  insert?: InsertBridge | null;
}

/**
 * The shipped tool for a pane. All three of v1's tools have landed as of MATH5, so this never
 * returns null in practice — `ToolPane`'s placeholder fallback stays as the contract for a
 * tool that has not shipped (Geometry and 3D, if either is ever promoted off the roadmap).
 */
function toolFor(tool: LiveToolId, wiring: ToolWiring): ReactNode {
  const { storage, registerExports, insert } = wiring;
  if (tool === 'graphing') {
    return <Graphing storage={storage} registerExports={registerExports} />;
  }
  if (tool === 'scientific') {
    return <Scientific storage={storage} registerExports={registerExports} insert={insert} />;
  }
  return <Matrix storage={storage} registerExports={registerExports} />;
}

export function MathShell({
  activeTool,
  drafts,
  previews,
  storage,
  registerExports,
  subjectsFor,
  insert,
  onSelectTool,
  onDraftChange,
}: {
  activeTool: LiveToolId;
  drafts: ToolDrafts;
  /** per-tool ghost result; a tool with no preview maps to null. */
  previews: Partial<Record<LiveToolId, string | null>>;
  /**
   * The host's storage namespace, handed to the tools that persist their own section
   * (MATH3: Graphing, MATH4: Scientific, MATH5: Matrix). Absent when the plugin runs without
   * the `storage` permission — the tools still work, they just start empty every time.
   */
  storage?: Pick<StorageApi, 'get' | 'set'> | null;
  /**
   * MATH6's export wiring, both halves owned by {@link MathPanel}: tools register what they
   * have worth exporting, and the topbar asks the *active* tool's registration when its menu
   * opens. Absent leaves the menu empty rather than breaking the shell.
   */
  registerExports?: RegisterExports | null;
  subjectsFor?: (tool: LiveToolId) => ExportSubject[];
  /** the notes bridge (MATH6), for the topbar's and the tape rows' insert actions. */
  insert?: InsertBridge | null;
  onSelectTool(tool: ToolId): void;
  onDraftChange(tool: LiveToolId, src: string): void;
}) {
  return (
    <div className="atlas-math">
      <Topbar
        activeTool={activeTool}
        onSelectTool={onSelectTool}
        subjects={() => subjectsFor?.(activeTool) ?? []}
        insert={insert}
      />
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
            {toolFor(tool, { storage, registerExports, insert })}
          </ToolPane>
        ))}
      </div>
    </div>
  );
}
