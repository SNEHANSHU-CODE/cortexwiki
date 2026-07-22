import { useEffect, useMemo, useState, useRef } from "react";
// Removed unused router imports
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import NotePrintTemplate from "../components/NotePrintTemplate";
import MCQModal from "../components/MCQModal";
import MarkdownContent from "../components/MarkdownContent";
import IngestPanel from "../components/IngestPanel";
import {
  clearWikiError,
  createWiki,
  deleteWiki,
  loadWikiDetail,
  loadWikis,
  renameWiki,
  setActiveWiki,
  setRightView,
  togglePublicWikiStatus,
} from "../redux/slices/wikiSlice";
import { clearMessages } from "../redux/slices/chatSlice";
import { loadIngestionHistory, undoIngestion } from "../redux/slices/ingestSlice";
import ChatPage from "./ChatPage";
import GraphPage from "./GraphPage";
import { NoteDrawer } from "./IngestPage";
import "./styles/WikiDashboard.css";

function CreateWikiModal({ open, onClose, onSubmit, busy }) {
  const [name, setName] = useState("");
  const [description, setDesc] = useState("");
  const modalRef = useRef(null);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName("");
      setDesc("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !modalRef.current) return;
    const focusableElements = modalRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusableElements.length) return;
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTab = (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    await onSubmit({ name: name.trim(), description: description.trim() });
  };

  return (
    <div
      className="cw-modal"
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label="Create wiki"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cw-modal__panel">
        <div className="cw-modal__header">
          <h2>Create new wiki</h2>
          <button type="button" className="cw-icon-btn" onClick={onClose} aria-label="Close">
            {/* BUG-L1 FIX: Use SVG icon for close button instead of text X */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="cw-modal__form">
          <div className="ws-field">
            <label className="ws-field__label" htmlFor="wikiName">
              Wiki name
            </label>
            <input
              id="wikiName"
              className="ws-field__input"
              placeholder="e.g. Agentic AI, World History..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="ws-field">
            <label className="ws-field__label" htmlFor="wikiDesc">
              Description <span className="cw-optional">(optional)</span>
            </label>
            <textarea
              id="wikiDesc"
              className="ws-field__textarea"
              placeholder="What is this wiki about?"
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
            />
          </div>
          <div className="cw-modal__actions">
            <button type="button" className="ws-btn ws-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ws-btn ws-btn--primary" disabled={busy || !name.trim()}>
              {busy ? "Creating..." : "Create wiki"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ShareWikiModal({ open, onClose, activeWiki, onToggleShare }) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const shareUrl = activeWiki?.is_public 
    ? `${window.location.origin}/share/${activeWiki.slug}`
    : "";

  return (
    <div
      className="cw-modal"
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label="Share wiki"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cw-modal__panel" style={{ maxWidth: "450px" }}>
        <div className="cw-modal__header">
          <h2>Share Wiki</h2>
          <button type="button" className="cw-icon-btn" onClick={onClose} aria-label="Close">
            {/* BUG-L1 FIX: Use SVG icon for close button instead of text X */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div style={{ padding: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <div style={{ paddingRight: "1rem" }}>
              <div style={{ fontWeight: 600, color: "var(--ws-text)", marginBottom: "0.25rem" }}>Publish to Web</div>
              <div style={{ fontSize: "0.85rem", color: "var(--ws-text-mute)", lineHeight: "1.4" }}>Anyone on the internet with the link can view this wiki.</div>
            </div>
            <label className="cl-switch" style={{ margin: 0, flexShrink: 0 }}>
              <input 
                type="checkbox" 
                checked={activeWiki?.is_public || false}
                onChange={onToggleShare}
              />
              <span></span>
            </label>
          </div>

          {activeWiki?.is_public && (
            <div style={{ marginTop: "1.5rem", display: "flex", alignItems: "center", background: "var(--ws-bg)", border: "1px solid var(--ws-border)", borderRadius: "8px", padding: "0.4rem 0.4rem 0.4rem 0.75rem" }}>
              <input
                type="text"
                readOnly
                value={shareUrl}
                style={{ flex: 1, background: "transparent", border: "none", color: "var(--ws-text-mute)", fontSize: "0.85rem", outline: "none", padding: 0 }}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="ws-btn ws-btn--primary"
                style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem", height: "auto", minHeight: "0" }}
                onClick={(e) => {
                  navigator.clipboard.writeText(shareUrl);
                  // BUG-M2 FIX: e.target inside setTimeout could be the child node. 
                  // Capture currentTarget (the button) before the timeout gap.
                  const btn = e.currentTarget;
                  const orig = btn.innerText;
                  btn.innerText = "Copied!";
                  setTimeout(() => { if (btn) btn.innerText = orig; }, 2000);
                }}
              >
                Copy Link
              </button>
            </div>
          )}
        </div>
        <div className="cw-modal__actions" style={{ padding: "1.25rem 1.5rem", borderTop: "1px solid var(--ws-border)", marginTop: 0, background: "rgba(0,0,0,0.15)" }}>
          <button type="button" className="ws-btn ws-btn--ghost" onClick={onClose} style={{ marginLeft: "auto" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function WikiCard({ wiki, isActive, onSelect, pendingDeleteId, onRequestDelete, onCancelDelete, onConfirmDelete }) {
  const isConfirming = pendingDeleteId === wiki.id;
  const rawPreview =
    wiki.master_note_excerpt ||
    wiki.master_note ||
    wiki.summary ||
    wiki.description ||
    "";
  const cleanPreview = rawPreview.replace(/\s+/g, " ").trim();
  const previewLines = cleanPreview
    ? (cleanPreview.match(/[^.!?]+[.!?]+/g) || [cleanPreview])
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

  return (
    <article className={`cw-wiki-card${isActive ? " cw-wiki-card--active" : ""}`}>
      <button type="button" className="cw-wiki-card__body" onClick={() => onSelect(wiki.id)}>
        <div className="cw-wiki-card__topline">
          <strong className="cw-wiki-card__name">{wiki.name}</strong>
          <time className="cw-wiki-card__time" dateTime={wiki.updated_at}>
            {new Date(wiki.updated_at).toLocaleDateString()}
          </time>
        </div>
        {previewLines.length > 0 ? (
          <ul className="cw-wiki-card__preview">
            {previewLines.map((line, idx) => (
              <li key={`${wiki.id}-preview-${idx}`}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="cw-wiki-card__desc">
            No note summary yet. Ingest sources to build a master note preview.
          </p>
        )}
        <span className="cw-wiki-card__meta">{wiki.source_count ?? 0} sources</span>
      </button>

      <div className="cw-wiki-card__actions">
        {isConfirming ? (
          <>
            <button type="button" className="ws-btn ws-btn--danger" onClick={() => onConfirmDelete(wiki.id)}>
              Delete
            </button>
            <button type="button" className="ws-btn ws-btn--ghost" onClick={onCancelDelete}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ws-btn ws-btn--ghost cw-wiki-card__trash"
            onClick={() => onRequestDelete(wiki.id)}
            aria-label={`Delete ${wiki.name}`}
          >
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

function MasterNote({ wiki, detailStatus, onOpenDrawer }) {
  const dispatch = useDispatch();
  const printRef = useRef(null);
  const [isNativePrinting, setIsNativePrinting] = useState(false);
  const [showMCQ, setShowMCQ] = useState(false);
  const [selectedVersionNum, setSelectedVersionNum] = useState(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackModalOpen, setRollbackModalOpen] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Reset version selection when wiki changes or when a new version is created
  useEffect(() => {
    setSelectedVersionNum(null);
  }, [wiki?.id, wiki?.version_count]);

  const versions = useMemo(() => {
    if (!wiki) return [];
    // Do not show any versions for a wiki that has never been ingested
    if (!wiki.master_note || wiki.source_count === 0) return [];

    // The DB always stores the pre-ingestion state as `note` inside master_note_versions.
    // For the very first batch ingestion the previous state is "" (empty wiki), which must
    // live in the DB so rollback can find the page_ids to delete — but it should never
    // appear as a selectable version in the UI (there is no meaningful content to display).
    // Filter it out BEFORE numbering so: 1st ingestion → v1, 2nd → v2, etc.
    const visiblePastVersions = (wiki.master_note_versions || [])
      .map((v, i) => ({
        rawNote: v.note,
        stepsToRevert: (wiki.master_note_versions.length - i),
      }))
      .filter(v => v.rawNote?.trim());   // drop empty-note snapshots from display

    const latest = {
      version: visiblePastVersions.length + 1,
      note: wiki.master_note,
      isLatest: true,
      stepsToRevert: 0,
    };

    const pastVersions = visiblePastVersions.map((v, i) => ({
      version: i + 1,
      note: v.rawNote,
      isLatest: false,
      stepsToRevert: v.stepsToRevert,
    }));

    return [...pastVersions, latest].reverse();
  }, [wiki]);

  const activeVersionObj = useMemo(() => {
    if (!selectedVersionNum) return versions[0] || null;
    return versions.find(v => v.version === parseInt(selectedVersionNum, 10)) || versions[0] || null;
  }, [versions, selectedVersionNum]);

  const handlePrint = async () => {
    const safeTitle = `${wiki?.name || "Wiki"}-Note`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const orig = document.title;
    
    // Set parent title
    document.title = safeTitle;
    if (isMounted.current) setIsNativePrinting(true);
    
    // Give React time to render the portal, and browser to register title change
    await new Promise(r => setTimeout(r, 150));
    
    try {
      window.print();
    } finally {
      if (isMounted.current) setIsNativePrinting(false);
      // Give browser time to close dialog before reverting title
      setTimeout(() => {
        document.title = orig || "CortexWiki";
      }, 500);
    }
  };

  if (detailStatus === "loading" && !wiki?.master_note) {
    return (
      <div className="cw-note-wrap">
        <div className="cw-note-loading">
          <div className="ws-skeleton-line ws-skeleton-line--short" />
          <div className="ws-skeleton-line ws-skeleton-line--wide" />
          <div className="ws-skeleton-line ws-skeleton-line--med" />
          <div className="ws-skeleton-line ws-skeleton-line--wide" />
          <div className="ws-skeleton-line ws-skeleton-line--short" />
        </div>
      </div>
    );
  }

  const executeRollback = async () => {
    if (!activeVersionObj || activeVersionObj.isLatest || isRollingBack) return;
    setIsRollingBack(true);
    setRollbackModalOpen(false);
    try {
      await dispatch(undoIngestion({ wikiId: wiki.id, steps: activeVersionObj.stepsToRevert })).unwrap();
      await dispatch(loadWikiDetail(wiki.id));
      await dispatch(loadIngestionHistory(wiki.id));
      setSelectedVersionNum(null);
    } catch (err) {
      alert(err.message || "Failed to rollback.");
    } finally {
      if (isMounted.current) setIsRollingBack(false);
    }
  };

  const handleRollback = () => {
    if (!activeVersionObj || activeVersionObj.isLatest || isRollingBack) return;
    setRollbackModalOpen(true);
  };

  const rawNote = activeVersionObj?.note || "";
  const hasNote = Boolean(rawNote.trim());
  const formattedNote = hasNote
    ? (rawNote.includes("\n")
        ? rawNote
        : rawNote
            .replace(/\r\n/g, "\n")
            // Ensure numbered sections render as real list lines.
            .replace(/\s+(\d+\.\s+)/g, "\n$1")
            // Ensure bullet markers break to their own lines.
            .replace(/\s+([*-]\s+)/g, "\n$1")
            // Promote common section labels to heading-like lines without breaking Markdown headings.
            .replace(/(?:\r?\n|^)(#*\s*)?(Overview|Key Components|Benefits|Setting Up[^:\n]*|Define a Note)/gi, (match, hashes, title) => {
              const h = (hashes && hashes.trim()) ? hashes.trim() : "##";
              return `\n\n${h} ${title}\n`;
            })
            .trim())
    : "";

  return (
    <div className="cw-note-wrap">
      <div className="cw-note-header">
        <div className="cw-note-header__left">
          <span className="ws-eyebrow">Master note</span>
          <div className="cw-note-meta">
            <span>{wiki?.source_count ?? 0} sources</span>
            <span className="cw-note-meta__sep">-</span>
            {versions.length > 0 ? (
              <select 
                style={{ 
                  appearance: "none",
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--surface-border)",
                  borderRadius: "999px",
                  color: "var(--accent)",
                  padding: "0.15rem 1.4rem 0.15rem 0.75rem",
                  fontSize: "0.75rem",
                  fontWeight: "700",
                  cursor: "pointer",
                  outline: "none",
                  backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%230f62fe' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 0.4rem center",
                  backgroundSize: "10px",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
                }}
                value={selectedVersionNum || (wiki?.version_count || 0)}
                onChange={(e) => setSelectedVersionNum(e.target.value)}
              >
                {versions.map(v => (
                  <option key={v.version} value={v.version} style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text)" }}>
                    v{v.version} {v.isLatest ? "(Latest)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              wiki?.version_count > 0 ? <span>v{wiki.version_count}</span> : null
            )}
            {wiki?.description && <span className="cw-note-meta__sep">-</span>}
            {wiki?.description && <span>{wiki.description}</span>}
            {detailStatus === "loading" && <span className="cw-note-meta__loading">Refreshing...</span>}
          </div>
        </div>
        {hasNote && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" className="ws-btn ws-btn--primary" style={{ fontSize: "0.8rem" }} onClick={() => setShowMCQ(true)}>
              Quiz Me
            </button>
            <button type="button" className="ws-btn ws-btn--ghost" style={{ fontSize: "0.8rem" }} onClick={handlePrint}>
              Download PDF
            </button>
            <button type="button" className="ws-btn ws-btn--ghost" style={{ fontSize: "0.8rem" }} onClick={onOpenDrawer}>
              Full screen
            </button>
          </div>
        )}
      </div>

      {hasNote && isNativePrinting && createPortal(
        <div className="native-print-overlay">
          <NotePrintTemplate 
            ref={printRef} 
            title={wiki?.name} 
            content={formattedNote} 
            date={wiki?.updated_at} 
          />
        </div>,
        document.body
      )}

      <div className="cw-note-content">
        {hasNote ? (
          <div className="cw-note-paper">
            {!activeVersionObj?.isLatest && (
              <div style={{ padding: "1rem", backgroundColor: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: "8px", marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#f87171", fontSize: "0.9rem" }}>
                  <strong>Read-Only Preview:</strong> You are viewing an older version (v{activeVersionObj.version}).
                </span>
                <button 
                  className="ws-btn ws-btn--danger" 
                  onClick={handleRollback}
                  disabled={isRollingBack}
                >
                  {isRollingBack ? "Rolling back..." : "Rollback to this version"}
                </button>
              </div>
            )}
            <MarkdownContent content={formattedNote} />
          </div>
        ) : (
          <div className="cw-note-empty">
            <span className="cw-note-empty__icon">Note</span>
            <h3>No master note yet</h3>
            <p>Ingest sources into this wiki - each source compounds into one unified note that grows smarter over time.</p>
          </div>
        )}
      </div>

      {rollbackModalOpen && createPortal(
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999
        }}>
          <div style={{
            background: "var(--bg)", border: "1px solid var(--surface-border)",
            padding: "1.5rem", borderRadius: "8px", maxWidth: "400px", width: "90%",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)"
          }}>
            <h3 style={{ margin: "0 0 1rem 0", color: "var(--text)" }}>⚠️ Warning</h3>
            <p style={{ margin: "0 0 1.5rem 0", color: "var(--text-soft)", fontSize: "0.9rem", lineHeight: "1.5" }}>
              Are you sure you want to rollback to v{activeVersionObj?.version}? This will permanently delete all ingestions that occurred after this version.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button type="button" className="ws-btn ws-btn--ghost" onClick={() => setRollbackModalOpen(false)}>Cancel</button>
              <button 
                type="button" 
                className="ws-btn ws-btn--primary" 
                style={{ background: "#ef4444", borderColor: "#ef4444", color: "white" }} 
                onClick={executeRollback}
              >
                Rollback
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showMCQ && (
        <MCQModal wikiId={wiki?.id} onClose={() => setShowMCQ(false)} />
      )}
    </div>
  );
}

function WikiDashboard() {
  const dispatch = useDispatch();
  const { wikis, activeWikiId, activeWiki, listStatus, createStatus, detailStatus, error, rightView } = useSelector((s) => s.wiki);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [pendingDeleteId, setPending] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    window.__hideSplash?.();
  }, []);

  useEffect(() => {
    void dispatch(loadWikis());
  }, [dispatch]);

  useEffect(() => {
    if (activeWikiId) void dispatch(loadWikiDetail(activeWikiId));
  }, [activeWikiId, dispatch]);

  const drawerItem = useMemo(() => {
    if (!activeWiki) return null;
    return {
      title: activeWiki.name,
      description: activeWiki.description,
      summary: activeWiki.description,
      content: activeWiki.master_note,
      source_type: "wiki",
      created_at: activeWiki.created_at,
      updated_at: activeWiki.updated_at,
    };
  }, [activeWiki]);

  const handleCreateWiki = async (payload) => {
    const action = await dispatch(createWiki(payload));
    if (createWiki.fulfilled.match(action)) {
      setIsCreateOpen(false);
      void dispatch(loadWikiDetail(action.payload.id));
    }
  };

  const handleSelectWiki = (wikiId) => {
    dispatch(clearMessages());
    dispatch(setActiveWiki(wikiId));
  };

  const handleBackToWikiList = () => {
    dispatch(setActiveWiki(null));
  };

  const handleDeleteWiki = async (wikiId) => {
    const action = await dispatch(deleteWiki(wikiId));
    if (deleteWiki.fulfilled.match(action)) setPending(null);
  };

  const handleIngestSuccess = () => {
    if (activeWikiId) void dispatch(loadWikiDetail(activeWikiId));
  };

  const handleToggleShare = () => {
    if (!activeWiki) return;
    dispatch(togglePublicWikiStatus({ wikiId: activeWiki.id, isPublic: !activeWiki.is_public }));
  };

  const shareUrl = activeWiki?.is_public 
    ? `${window.location.origin}/share/${activeWiki.slug}`
    : "";

  const showBack = rightView === "chat" || rightView === "graph";

  return (
    <div className="cw-dashboard">
      <aside className="cw-dashboard__left">
        <IngestPanel wikiId={activeWikiId} onIngestSuccess={handleIngestSuccess} />
      </aside>

      <div className="cw-dashboard__right">
        <div className="cw-rightbar">
          {activeWikiId ? (
            <>
              <span className="cw-rightbar__title">{activeWiki?.name}</span>
              <div className="cw-rightbar__actions">
                <button type="button" className={`ws-btn ${activeWiki?.is_public ? 'ws-btn--primary' : 'ws-btn--ghost'}`} onClick={() => setIsShareModalOpen(true)}>
                  Share: {activeWiki?.is_public ? "ON" : "OFF"}
                </button>
                {showBack && (
                  <button type="button" className="ws-btn ws-btn--ghost" onClick={() => dispatch(setRightView("note"))}>
                    Back
                  </button>
                )}
                <button type="button" className={`ws-btn ${rightView === "chat" ? "ws-btn--primary" : "ws-btn--ghost"}`} onClick={() => dispatch(setRightView("chat"))}>
                  Chat
                </button>
                <button type="button" className={`ws-btn ${rightView === "graph" ? "ws-btn--primary" : "ws-btn--ghost"}`} onClick={() => dispatch(setRightView("graph"))}>
                  Graph
                </button>
                <button type="button" className="ws-btn ws-btn--ghost" onClick={handleBackToWikiList}>
                  Back to list
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="cw-rightbar__title">Your wikis</span>
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => setIsCreateOpen(true)}>
                + New wiki
              </button>
            </>
          )}
        </div>

        {!activeWikiId ? (
          <div className="cw-wiki-list" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
            {listStatus === "loading" && wikis.length === 0 ? (
              <div className="cw-wiki-list__empty">
                <div className="ws-skeleton-line ws-skeleton-line--wide" />
                <div className="ws-skeleton-line ws-skeleton-line--med" />
                <div className="ws-skeleton-line ws-skeleton-line--short" />
              </div>
            ) : wikis.length === 0 ? (
              <div className="cw-wiki-list__empty" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
                <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem", fontWeight: 700, color: "var(--text)" }}>No wikis yet</h3>
                <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-muted)", textAlign: "center" }}>Click "New wiki" to create your first knowledge base</p>
              </div>
            ) : (
              <div className="cw-wiki-list__items" style={{ display: "flex", flexDirection: "column", padding: "0.5rem" }}>
                {wikis.map((wiki) => (
                  <WikiCard
                    key={wiki.id}
                    wiki={wiki}
                    isActive={false}
                    onSelect={handleSelectWiki}
                    pendingDeleteId={pendingDeleteId}
                    onRequestDelete={setPending}
                    onCancelDelete={() => setPending(null)}
                    onConfirmDelete={handleDeleteWiki}
                  />
                ))}
              </div>
            )}
          </div>
        ) : rightView === "chat" ? (
          <ChatPage wikiId={activeWikiId} />
        ) : rightView === "graph" ? (
          <GraphPage wikiId={activeWikiId} />
        ) : (
          <MasterNote wiki={activeWiki} detailStatus={detailStatus} onOpenDrawer={() => setDrawerOpen(true)} />
        )}

        {error && (
          <div className="ws-banner ws-banner--error" style={{ margin: "1rem" }} role="alert">
            <span>{error}</span>
            <button type="button" className="ws-btn ws-btn--ghost" style={{ fontSize: "0.8rem" }} onClick={() => dispatch(clearWikiError())}>
              Dismiss
            </button>
          </div>
        )}
      </div>

      <CreateWikiModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreateWiki}
        busy={createStatus === "loading"}
      />
      <ShareWikiModal
        open={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        activeWiki={activeWiki}
        onToggleShare={handleToggleShare}
      />

      {drawerOpen && drawerItem && <NoteDrawer item={drawerItem} onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}

export default WikiDashboard;
