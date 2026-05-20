import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import MarkdownContent from "../components/MarkdownContent";
import IngestPanel from "../components/IngestPanel";
import {
  clearWikiError,
  createWiki,
  deleteWiki,
  loadWikiDetail,
  loadWikis,
  setActiveWiki,
  setRightView,
} from "../redux/slices/wikiSlice";
import ChatPage  from "./ChatPage";
import GraphPage from "./GraphPage";
import { NoteDrawer } from "./IngestPage";
import "./styles/WikiDashboard.css";

/* ── Create wiki modal ───────────────────────────────────────────────────── */
function CreateWikiModal({ open, onClose, onSubmit, busy }) {
  const [name, setName]         = useState("");
  const [description, setDesc]  = useState("");

  useEffect(() => {
    if (!open) { setName(""); setDesc(""); }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    await onSubmit({ name: name.trim(), description: description.trim() });
  };

  return (
    <div
      className="cw-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Create wiki"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="cw-modal__panel">
        <div className="cw-modal__header">
          <h2>Create new wiki</h2>
          <button type="button" className="cw-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="cw-modal__form">
          <div className="ws-field">
            <label className="ws-field__label" htmlFor="wikiName">Wiki name</label>
            <input
              id="wikiName"
              className="ws-field__input"
              placeholder="e.g. Agentic AI, World History…"
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
            <button type="button" className="ws-btn ws-btn--ghost" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="ws-btn ws-btn--primary"
              disabled={busy || !name.trim()}
            >
              {busy ? "Creating…" : "Create wiki →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Wiki card ───────────────────────────────────────────────────────────── */
function WikiCard({ wiki, isActive, onSelect, pendingDeleteId, onRequestDelete, onCancelDelete, onConfirmDelete }) {
  const isConfirming = pendingDeleteId === wiki.id;

  return (
    <article className={`cw-wiki-card${isActive ? " cw-wiki-card--active" : ""}`}>
      <button type="button" className="cw-wiki-card__body" onClick={() => onSelect(wiki.id)}>
        <div className="cw-wiki-card__topline">
          <strong className="cw-wiki-card__name">{wiki.name}</strong>
          <time className="cw-wiki-card__time" dateTime={wiki.updated_at}>
            {new Date(wiki.updated_at).toLocaleDateString()}
          </time>
        </div>
        {wiki.description && (
          <p className="cw-wiki-card__desc">{wiki.description}</p>
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
            🗑
          </button>
        )}
      </div>
    </article>
  );
}

/* ── Master note panel ───────────────────────────────────────────────────── */
function MasterNote({ wiki, detailStatus, onOpenDrawer }) {
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

  const hasNote = wiki?.master_note && wiki.master_note.trim().length > 0;

  return (
    <div className="cw-note-wrap">
      <div className="cw-note-header">
        <div className="cw-note-header__left">
          <span className="ws-eyebrow">Master note</span>
          <div className="cw-note-meta">
            <span>{wiki?.source_count ?? 0} sources</span>
            {wiki?.description && <span className="cw-note-meta__sep">·</span>}
            {wiki?.description && <span>{wiki.description}</span>}
            {detailStatus === "loading" && (
              <span className="cw-note-meta__loading">Refreshing…</span>
            )}
          </div>
        </div>
        {hasNote && (
          <button
            type="button"
            className="ws-btn ws-btn--ghost"
            style={{ fontSize: "0.8rem" }}
            onClick={onOpenDrawer}
          >
            Full screen ↗
          </button>
        )}
      </div>

      <div className="cw-note-content">
        {hasNote ? (
          <MarkdownContent content={wiki.master_note} />
        ) : (
          <div className="cw-note-empty">
            <span className="cw-note-empty__icon">📝</span>
            <h3>No master note yet</h3>
            <p>
              Ingest sources into this wiki — each source compounds into one
              unified note that grows smarter over time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Wiki Dashboard ──────────────────────────────────────────────────────── */
function WikiDashboard() {
  const dispatch = useDispatch();
  const {
    wikis, activeWikiId, activeWiki,
    listStatus, createStatus, detailStatus,
    error, rightView,
  } = useSelector((s) => s.wiki);

  const [isCreateOpen, setIsCreateOpen]   = useState(false);
  const [pendingDeleteId, setPending]     = useState(null);
  const [drawerOpen, setDrawerOpen]       = useState(false);

  // Load wiki list on mount
  useEffect(() => { void dispatch(loadWikis()); }, [dispatch]);

  // Auto-select first wiki when list loads
  useEffect(() => {
    if (!activeWikiId && wikis.length > 0) {
      const first = wikis[0].id;
      dispatch(setActiveWiki(first));
      void dispatch(loadWikiDetail(first));
    }
  }, [activeWikiId, wikis, dispatch]);

  // Load detail whenever active wiki changes
  useEffect(() => {
    if (activeWikiId) void dispatch(loadWikiDetail(activeWikiId));
  }, [activeWikiId, dispatch]);

  // Drawer item — the active wiki as a note-drawer-compatible object
  const drawerItem = useMemo(() => {
    if (!activeWiki) return null;
    return {
      title:       activeWiki.name,
      description: activeWiki.description,
      summary:     activeWiki.description,
      content:     activeWiki.master_note,
      source_type: "wiki",
      created_at:  activeWiki.created_at,
      updated_at:  activeWiki.updated_at,
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
    dispatch(setActiveWiki(wikiId));
    void dispatch(loadWikiDetail(wikiId));
  };

  const handleDeleteWiki = async (wikiId) => {
    const action = await dispatch(deleteWiki(wikiId));
    if (deleteWiki.fulfilled.match(action)) setPending(null);
  };

  const handleIngestSuccess = () => {
    if (activeWikiId) void dispatch(loadWikiDetail(activeWikiId));
  };

  const showBack = rightView === "chat" || rightView === "graph";

  return (
    <div className="cw-dashboard">

      {/* ── Left panel ──────────────────────────────────────────────────── */}
      <aside className="cw-dashboard__left">

        {/* Create button */}
        <div className="cw-dashboard__left-head">
          <button
            type="button"
            className="ws-btn ws-btn--primary"
            style={{ width: "100%", justifyContent: "center", padding: "0.75rem" }}
            onClick={() => setIsCreateOpen(true)}
          >
            + Create new wiki
          </button>
        </div>

        {/* Ingest panel — scoped to active wiki */}
        <IngestPanel wikiId={activeWikiId} onIngestSuccess={handleIngestSuccess} />

        {/* Wiki list */}
        <div className="cw-wiki-list">
          <div className="cw-wiki-list__header">
            <span className="ws-eyebrow">Your wikis</span>
            <span className="cw-wiki-list__count">{wikis.length}</span>
          </div>

          {listStatus === "loading" && wikis.length === 0 ? (
            <div className="cw-wiki-list__empty">
              <div className="ws-skeleton-line ws-skeleton-line--wide" />
              <div className="ws-skeleton-line ws-skeleton-line--med" />
              <div className="ws-skeleton-line ws-skeleton-line--short" />
            </div>
          ) : wikis.length === 0 ? (
            <div className="cw-wiki-list__empty">
              <p>No wikis yet. Create one above to begin.</p>
            </div>
          ) : (
            <div className="cw-wiki-list__items">
              {wikis.map((wiki) => (
                <WikiCard
                  key={wiki.id}
                  wiki={wiki}
                  isActive={wiki.id === activeWikiId}
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
      </aside>

      {/* ── Right panel ─────────────────────────────────────────────────── */}
      <div className="cw-dashboard__right">

        {/* Sticky top bar */}
        <div className="cw-rightbar">
          <span className="cw-rightbar__title">
            {activeWiki?.name || "Select a wiki"}
          </span>
          {activeWikiId && (
            <div className="cw-rightbar__actions">
              {showBack && (
                <button
                  type="button"
                  className="ws-btn ws-btn--ghost"
                  onClick={() => dispatch(setRightView("note"))}
                >
                  ← Back
                </button>
              )}
              <button
                type="button"
                className={`ws-btn ${rightView === "chat" ? "ws-btn--primary" : "ws-btn--ghost"}`}
                onClick={() => dispatch(setRightView("chat"))}
              >
                Chat
              </button>
              <button
                type="button"
                className={`ws-btn ${rightView === "graph" ? "ws-btn--primary" : "ws-btn--ghost"}`}
                onClick={() => dispatch(setRightView("graph"))}
              >
                Graph
              </button>
            </div>
          )}
        </div>

        {/* Right panel body */}
        {!activeWikiId ? (
          <div className="cw-no-wiki">
            <span className="cw-no-wiki__icon">🧠</span>
            <h3>Create or select a wiki</h3>
            <p>Use the left panel to create a new wiki or pick one from your list.</p>
          </div>
        ) : rightView === "chat" ? (
          <ChatPage wikiId={activeWikiId} />
        ) : rightView === "graph" ? (
          <GraphPage wikiId={activeWikiId} />
        ) : (
          <MasterNote
            wiki={activeWiki}
            detailStatus={detailStatus}
            onOpenDrawer={() => setDrawerOpen(true)}
          />
        )}

        {/* Error banner */}
        {error && (
          <div className="ws-banner ws-banner--error" style={{ margin: "1rem" }} role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              style={{ fontSize: "0.8rem" }}
              onClick={() => dispatch(clearWikiError())}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ── Modals / Drawers ─────────────────────────────────────────────── */}
      <CreateWikiModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreateWiki}
        busy={createStatus === "loading"}
      />

      {drawerOpen && drawerItem && (
        <NoteDrawer item={drawerItem} onClose={() => setDrawerOpen(false)} />
      )}
    </div>
  );
}

export default WikiDashboard;