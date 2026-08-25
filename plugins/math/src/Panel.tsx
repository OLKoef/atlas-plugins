/**
 * Math — the stateful Panel (MATH1). This is the `type: "tool"` full-sidebar surface.
 *
 * It owns the shell reducer, restores `shell.lastTool` from plugin storage once on mount,
 * and writes it back whenever the user switches tools. Everything visual lives in
 * {@link MathShell}; everything evaluable goes through the shared mathjs engine.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { AtlasPluginApi } from '@atlas/plugin-sdk';
import { MathShell } from './MathShell';
import type { ExportProvider } from './lib/exportModel';
import { previewExpression } from './lib/mathEngine';
import { makeInsertBridge } from './lib/notes';
import { loadMathState, saveLastTool } from './lib/persist';
import {
  DEFAULT_TOOL,
  initialMathShellState,
  reduceMathShell,
} from './lib/shellModel';
import type { LiveToolId } from './lib/shellModel';

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

  // The wireframe's live ghost result belongs to the Scientific input row, which owns its own
  // since MATH4 (it knows the angle mode and `ans`); Graphing draws its drafts on the canvas
  // (MATH2) and Matrix evaluates its compute line on ↵ (MATH5). What is left here is the
  // shell-level preview a pane still on the placeholder body would show.
  const previews = useMemo(
    () => ({ scientific: previewExpression(state.drafts.scientific) }),
    [state.drafts.scientific],
  );

  /**
   * MATH6's export registry. A ref, not state: registering is a tool telling the topbar where
   * to ask, and re-rendering the whole shell every time a tape row lands would be a heavy way
   * to keep a menu that is usually closed up to date. The topbar reads it when it opens.
   */
  const providers = useRef(new Map<LiveToolId, ExportProvider>());
  const registerExports = useCallback((tool: LiveToolId, provider: ExportProvider | null) => {
    if (provider) providers.current.set(tool, provider);
    else providers.current.delete(tool);
  }, []);
  const subjectsFor = useCallback((tool: LiveToolId) => providers.current.get(tool)?.() ?? [], []);

  // The notes bridge, or a bridge that reports itself unavailable — which is what a host
  // older than MATH7 gets, and what every insert control in the plugin disables on.
  const insert = useMemo(() => makeInsertBridge(api.notes, api.ui), [api]);

  return (
    <MathShell
      activeTool={state.activeTool}
      drafts={state.drafts}
      previews={previews}
      storage={api.storage}
      registerExports={registerExports}
      subjectsFor={subjectsFor}
      insert={insert}
      onSelectTool={(tool) => dispatch({ type: 'selectTool', tool })}
      onDraftChange={(tool, src) => dispatch({ type: 'setDraft', tool, src })}
    />
  );
}
