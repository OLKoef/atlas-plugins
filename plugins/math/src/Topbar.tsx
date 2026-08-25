/**
 * Math — the plugin topbar (MATH1): the ∑ brand mark, the segmented tool tabs, and — since
 * MATH6 — the wireframe's export action.
 *
 * Markup and class names are ported from MathPluginApproved.html's `.plugin-topbar`. The
 * three live tools are real tabs; Geometry and 3D render as disabled slots carrying the
 * "Soon" tag — visible roadmap, never activatable.
 *
 * The wireframe titles the right-hand button *"Insert into note · Copy as LaTeX"* — two verbs
 * over whatever the active tool is holding, which is why pressing it opens a menu rather than
 * doing one fixed thing. The rows come from `lib/exportModel.ts`, read at open time so the
 * menu describes the tool's state now, not at last render.
 *
 * Insert rows render **disabled with their reason** when the host has no `notes:insert`
 * bridge (MATH7 is Dashboard-side and may not have landed). Copy rows never depend on it.
 *
 * The wireframe's plugin-settings gear is still deliberately absent: the insert action became
 * real with MATH6, a settings surface did not, and an inert button lies about what works.
 */

import { useEffect, useRef, useState } from 'react';
import { COPIED_MS, writeClipboard } from './lib/clipboard';
import { NOTHING_TO_EXPORT, buildExportItems } from './lib/exportModel';
import type { ExportItem, ExportSubject } from './lib/exportModel';
import type { InsertBridge } from './lib/notes';
import { TOOLS } from './lib/shellModel';
import type { LiveToolId, ToolId } from './lib/shellModel';

export function paneDomId(tool: ToolId): string {
  return `math-pane-${tool}`;
}

export function tabDomId(tool: ToolId): string {
  return `math-tab-${tool}`;
}

function InsertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3h7v7" />
      <path d="M21 3l-9 9" />
      <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

/**
 * The open menu. Presentational and exported on its own, so what the rows look like — and
 * which of them are disabled — can be asserted without driving a click through a DOM.
 */
export function ExportMenu({
  items,
  copiedId,
  onRun,
}: {
  items: readonly ExportItem[];
  /** the row showing its ✓ confirmation, if any. */
  copiedId?: string | null;
  onRun(item: ExportItem): void;
}) {
  return (
    <div className="export-menu" role="menu">
      {items.length === 0 ? (
        <div className="export-menu-empty">{NOTHING_TO_EXPORT}</div>
      ) : (
        items.map((item) => (
          <button
            key={item.id}
            className="export-menu-item"
            type="button"
            role="menuitem"
            disabled={item.disabled}
            title={item.reason}
            onClick={() => onRun(item)}
          >
            {item.label}
            {copiedId === item.id ? <span className="export-menu-mark">✓</span> : null}
          </button>
        ))
      )}
    </div>
  );
}

export function Topbar({
  activeTool,
  onSelectTool,
  subjects,
  insert,
}: {
  activeTool: LiveToolId;
  onSelectTool(tool: ToolId): void;
  /** what the active tool currently has worth exporting; read when the menu opens. */
  subjects?: () => ExportSubject[];
  /** the notes bridge; absent (or unavailable) disables the insert rows. */
  insert?: InsertBridge | null;
}) {
  const [items, setItems] = useState<ExportItem[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on a press outside the menu — attached only while it is open, so the plugin holds
  // no document listener for a menu nobody opened.
  useEffect(() => {
    if (items === null || typeof document === 'undefined') return;
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && wrapRef.current?.contains(target)) return;
      setItems(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [items]);

  function toggleMenu() {
    setCopied(null);
    setItems((open) =>
      open === null
        ? buildExportItems(subjects?.() ?? [], {
            canInsert: insert?.available ?? false,
            insertReason: insert?.title,
          })
        : null,
    );
  }

  function run(item: ExportItem) {
    if (item.disabled) return;

    if (item.action === 'copy') {
      if (item.subject.kind !== 'latex') return;
      // The menu stays open and the row confirms itself — the same feedback-without-a-toast
      // the tape rows and result cards use.
      writeClipboard(item.subject.latex).then((ok) => {
        if (!ok) return;
        setCopied(item.id);
        setTimeout(() => setCopied((current) => (current === item.id ? null : current)), COPIED_MS);
      });
      return;
    }

    setItems(null);
    if (item.subject.kind === 'latex') {
      void insert?.insertLatex(item.subject.latex, item.subject.label);
      return;
    }
    const { capture, label } = item.subject;
    void capture().then((dataUrl) => {
      if (dataUrl) void insert?.insertImage(dataUrl, label);
    });
  }

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

      <div className="export-wrap" ref={wrapRef}>
        <button
          className="topbar-btn"
          type="button"
          title="Insert into note · Copy as LaTeX"
          aria-label="Insert into note · Copy as LaTeX"
          aria-haspopup="menu"
          aria-expanded={items !== null}
          onClick={toggleMenu}
        >
          <InsertIcon />
        </button>

        {items === null ? null : <ExportMenu items={items} copiedId={copied} onRun={run} />}
      </div>
    </div>
  );
}
