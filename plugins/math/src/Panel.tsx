/**
 * Math — the stateful Panel (MATH1). This is the `type: "tool"` full-sidebar surface.
 *
 * It owns the shell reducer, restores `shell.lastTool` from plugin storage once on mount,
 * and writes it back whenever the user switches tools. Everything visual lives in
 * {@link MathShell}; everything evaluable goes through the shared mathjs engine.
 */

import { useEffect, useMemo, useReducer } from 'react';
import type { AtlasPluginApi } from '@atlas/plugin-sdk';
import { MathShell } from './MathShell';
import { previewExpression } from './lib/mathEngine';
import { loadMathState, saveLastTool } from './lib/persist';
import {
  DEFAULT_TOOL,
  initialMathShellState,
  reduceMathShell,
} from './lib/shellModel';

export function MathPanel({ api }: { api: AtlasPluginApi }) {
  const [state, dispatch] = useReducer(reduceMathShell, initialMathShellState);

  // Restore the last active tool once. A bad/absent value parses to the default tool, and
  // the reducer ignores a restore that lands after the user already picked a tab.
  useEffect(() => {
    let live = true;
    if (!api.storage) {
      dispatch({ type: 'restoreTool', tool: DEFAULT_TOOL });
      return;
    }
    loadMathState(api.storage)
      .then((persisted) => {
        if (live) dispatch({ type: 'restoreTool', tool: persisted.shell.lastTool });
      })
      .catch(() => {
        if (live) dispatch({ type: 'restoreTool', tool: DEFAULT_TOOL });
      });
    return () => {
      live = false;
    };
  }, [api]);

  // Persist the active tool — but never before the restore has landed, or the initial
  // default would clobber the stored value on mount.
  useEffect(() => {
    if (!state.restored || !api.storage) return;
    saveLastTool(api.storage, state.activeTool).catch(() => {
      /* best-effort persistence; a failed flush only costs the restore next time. */
    });
  }, [api, state.restored, state.activeTool]);

  // The wireframe's live ghost result belongs to the Scientific input row; Graphing draws
  // its drafts on the canvas (MATH2) and Matrix evaluates on ↵ (MATH5).
  const previews = useMemo(
    () => ({ scientific: previewExpression(state.drafts.scientific) }),
    [state.drafts.scientific],
  );

  return (
    <MathShell
      activeTool={state.activeTool}
      drafts={state.drafts}
      previews={previews}
      onSelectTool={(tool) => dispatch({ type: 'selectTool', tool })}
      onDraftChange={(tool, src) => dispatch({ type: 'setDraft', tool, src })}
    />
  );
}
