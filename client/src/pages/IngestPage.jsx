import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  clearIngestFeedback,
  loadIngestionHistory,
  resetSubmitStatus,
  submitIngestion,
} from "../redux/slices/ingestSlice";
import "./styles/Workspace.css";

/* ── History skeleton ─────────────────────────────────────────────────── */
function HistorySkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      {[0, 1, 2, 4].map((i) => (
        <div key={i} className="ws-history-card ws-history-card--skeleton" aria-hidden="true"
          style={{ padding: "0.875rem 1.25rem" }}>
          <div className="ws-skeleton-line ws-skeleton-line--short" style={{ marginBottom: "0.4rem" }} />
          <div className="ws-skeleton-line ws-skeleton-line--wide" />
        </div>
      ))}
    </div>
  );
}

/* ── Full-screen note drawer ──────────────────────────────────────────── */
function NoteDrawer({ item, onClose }) {
  const overlayRef = useRef(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    // Prevent body scroll while open
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!item) return null;

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={`Reading: ${item.title}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        background: "rgba(10, 15, 30, 0.85)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-end",
      }}
    >
      {/* ── Drawer panel ────────────────────────────────────────────── */}
      <div
        style={{
          width: "min(760px, 100vw)",
          height: "100vh",
          background: "#111827",
          borderLeft: "1px solid rgba(148,163,184,0.12)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-32px 0 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
          padding: "1.5rem 2rem 1.25rem",
          borderBottom: "1px solid rgba(148,163,184,0.08)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className={`ws-badge ws-badge--${item.source_type}`}>{item.source_type}</span>
              <time style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.65rem",
                color: "#475569",
                letterSpacing: "0.04em",
              }} dateTime={item.created_at}>
                {new Date(item.created_at).toLocaleString()}
              </time>
            </div>
            <h2 style={{
              fontFamily: "'Syne', system-ui, sans-serif",
              fontSize: "clamp(1.1rem, 2.5vw, 1.4rem)",
              fontWeight: 800,
              color: "#f8fafc",
              margin: 0,
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
            }}>
              {item.title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 8,
              border: "1px solid rgba(148,163,184,0.16)",
              background: "transparent",
              color: "#64748b",
              fontSize: "1.1rem",
              cursor: "pointer",
              flexShrink: 0,
              transition: "all 0.15s",
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "2rem" }}>

          {/* Summary */}
          <section style={{ marginBottom: "2rem" }}>
            <span style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "0.65rem",
              color: "#38bdf8",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              display: "block",
              marginBottom: "0.75rem",
            }}>
              Summary
            </span>
            <p style={{
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: "0.95rem",
              color: "#cbd5e1",
              lineHeight: 1.8,
              margin: 0,
              fontWeight: 300,
            }}>
              {item.summary || "No summary available for this source."}
            </p>
          </section>

          {/* Concepts */}
          {Array.isArray(item.concepts) && item.concepts.length > 0 && (
            <section style={{ marginBottom: "2rem" }}>
              <span style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.65rem",
                color: "#38bdf8",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                display: "block",
                marginBottom: "0.75rem",
              }}>
                Extracted concepts · {item.concepts.length}
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {item.concepts.map((c) => (
                  <span key={c} className="ws-tag"
                    style={{ fontSize: "0.8rem", padding: "0.3rem 0.75rem" }}>
                    {c}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Key points / content */}
          {item.key_points?.length > 0 && (
            <section style={{ marginBottom: "2rem" }}>
              <span style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.65rem",
                color: "#38bdf8",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                display: "block",
                marginBottom: "0.75rem",
              }}>
                Key points
              </span>
              <ul style={{
                margin: 0,
                paddingLeft: "1.25rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.6rem",
              }}>
                {item.key_points.map((point, i) => (
                  <li key={i} style={{
                    fontFamily: "'DM Sans', system-ui, sans-serif",
                    fontSize: "0.9rem",
                    color: "#94a3b8",
                    lineHeight: 1.7,
                    fontWeight: 300,
                  }}>
                    {point}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Full content/notes if available */}
          {item.content && (
            <section style={{ marginBottom: "2rem" }}>
              <span style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.65rem",
                color: "#38bdf8",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                display: "block",
                marginBottom: "0.75rem",
              }}>
                Full content
              </span>
              <div style={{
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: "0.9rem",
                color: "#94a3b8",
                lineHeight: 1.8,
                whiteSpace: "pre-wrap",
                fontWeight: 300,
              }}>
                {item.content}
              </div>
            </section>
          )}

          {/* Conflicts */}
          {item.conflicts?.length > 0 && (
            <section style={{ marginBottom: "2rem" }}>
              <span style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.65rem",
                color: "#f59e0b",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                display: "block",
                marginBottom: "0.75rem",
              }}>
                ⚠ Conflicts detected
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {item.conflicts.map((c, i) => (
                  <div key={i} style={{
                    padding: "0.75rem 1rem",
                    background: "rgba(245,158,11,0.06)",
                    border: "1px solid rgba(245,158,11,0.2)",
                    borderRadius: 10,
                    fontSize: "0.85rem",
                    color: "#fbbf24",
                    fontFamily: "'DM Sans', system-ui, sans-serif",
                  }}>
                    {typeof c === "string" ? c : c.claim || JSON.stringify(c)}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Source link */}
          {item.source_url && (
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="ws-btn ws-btn--ghost"
              style={{
                display: "inline-flex",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.75rem",
                letterSpacing: "0.04em",
              }}
            >
              Open original source ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Tab list ─────────────────────────────────────────────────────────── */
function HistoryTabs({ items, activeId, onSelect }) {
  return (
    <div
      role="tablist"
      aria-label="Ingested sources"
      style={{ display: "flex", flexDirection: "column", gap: 0 }}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onSelect(item.id)}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.3rem",
              width: "100%",
              padding: "1rem 1.5rem",
              background: isActive
                ? "rgba(56,189,248,0.06)"
                : "transparent",
              borderLeft: `2px solid ${isActive ? "#38bdf8" : "transparent"}`,
              borderTop: "none",
              borderRight: "none",
              borderBottom: "1px solid rgba(148,163,184,0.07)",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className={`ws-badge ws-badge--${item.source_type}`}
                style={{ fontSize: "0.58rem", padding: "0.1rem 0.4rem" }}>
                {item.source_type}
              </span>
              <time style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.6rem",
                color: "#475569",
                letterSpacing: "0.03em",
                marginLeft: "auto",
              }} dateTime={item.created_at}>
                {new Date(item.created_at).toLocaleDateString()}
              </time>
            </div>
            <span style={{
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: "0.85rem",
              fontWeight: isActive ? 700 : 500,
              color: isActive ? "#f8fafc" : "#94a3b8",
              lineHeight: 1.3,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              transition: "color 0.15s",
            }}>
              {item.title}
            </span>
            {item.summary && (
              <span style={{
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: "0.75rem",
                color: "#475569",
                lineHeight: 1.5,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 1,
                WebkitBoxOrient: "vertical",
                fontWeight: 300,
              }}>
                {item.summary}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────── */
function IngestPage() {
  const [sourceType, setSourceType] = useState("youtube");
  const [url, setUrl]               = useState("");
  const [activeTabId, setActiveTabId] = useState(null);
  const [drawerItem, setDrawerItem]   = useState(null);
  const dispatch = useDispatch();
  const { items, latestResult, historyStatus, submitStatus, error, successMessage } =
    useSelector((s) => s.ingest);

  useEffect(() => {
    if (historyStatus === "idle") void dispatch(loadIngestionHistory());
  }, [dispatch, historyStatus]);

  // Auto-select first tab when items load
  useEffect(() => {
    if (items.length > 0 && !activeTabId) {
      setActiveTabId(items[0].id);
    }
  }, [items, activeTabId]);

  useEffect(() => {
    dispatch(resetSubmitStatus());
    dispatch(clearIngestFeedback());
  }, [sourceType, dispatch]);

  const stats = useMemo(() => [
    { label: "Total sources",    value: items.length },
    { label: "Mode",             value: sourceType === "youtube" ? "Video" : "Web page" },
    { label: "Latest concepts",  value: latestResult?.concepts?.length ?? 0 },
  ], [items.length, latestResult?.concepts?.length, sourceType]);

  const activeItem = useMemo(
    () => items.find((i) => i.id === activeTabId) ?? null,
    [items, activeTabId],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim() || submitStatus === "loading") return;
    dispatch(clearIngestFeedback());
    const action = await dispatch(submitIngestion({ sourceType, url: url.trim() }));
    if (submitIngestion.fulfilled.match(action)) {
      setUrl("");
      // Auto-select the newly ingested item
      if (action.payload?.id) setActiveTabId(action.payload.id);
    }
  };

  const isSubmitting = submitStatus === "loading";

  return (
    <section
      className="workspace-page"
      style={{ padding: "0 1.5rem 2rem", maxWidth: 1280, margin: "0 auto" }}
    >

      {/* ── Page header ────────────────────────────────────────────────── */}
      <header className="ws-page-header">
        <div className="ws-page-header__copy">
          <span className="ws-eyebrow">Knowledge intake</span>
          <h1>Turn raw sources into structured memory.</h1>
          <p>Ingest a YouTube video or web page — extract concepts, map relationships, and push the result into your graph and chat workflow.</p>
        </div>
        <div className="ws-page-header__actions">
          <Link to="/chat"  className="ws-btn ws-btn--ghost">Open chat</Link>
          <Link to="/graph" className="ws-btn ws-btn--primary">Explore graph →</Link>
        </div>
      </header>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <div className="ws-stats">
        {stats.map((s) => (
          <div key={s.label} className="ws-stat">
            <span className="ws-stat__label">{s.label}</span>
            <span className="ws-stat__value">{s.value}</span>
          </div>
        ))}
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(340px, 400px) minmax(0,1fr)",
        gap: "1rem",
        alignItems: "start",
      }}>

        {/* ── Left column: form + latest result ──────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="ws-panel">
            <div className="ws-panel__header">
              <div>
                <span className="ws-eyebrow" style={{ marginBottom: "0.25rem" }}>Source setup</span>
                <h2 className="ws-panel__title">Add a new source</h2>
              </div>
            </div>
            <div className="ws-panel__body">
              <div className="ws-segments" role="tablist" aria-label="Source type">
                {["youtube", "web"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="tab"
                    aria-selected={sourceType === type}
                    className={`ws-segment${sourceType === type ? " ws-segment--active" : ""}`}
                    onClick={() => setSourceType(type)}
                  >
                    {type === "youtube" ? "▶ YouTube" : "🌐 Web page"}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                <div className="ws-field">
                  <label className="ws-field__label" htmlFor="sourceUrl">
                    {sourceType === "youtube" ? "YouTube video URL" : "Web page URL"}
                  </label>
                  <input
                    id="sourceUrl"
                    className="ws-field__input"
                    type="url"
                    inputMode="url"
                    placeholder={
                      sourceType === "youtube"
                        ? "https://youtube.com/watch?v=…"
                        : "https://example.com/article"
                    }
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                  />
                  <p className="ws-field__hint">
                    {sourceType === "youtube"
                      ? "Transcripts and metadata will be extracted into concepts and relationships."
                      : "The page will be cleaned, summarized, and indexed inside your workspace."}
                  </p>
                </div>

                {error && (
                  <div className="ws-banner ws-banner--error" role="alert">
                    <span>{error}</span>
                    <button
                      type="button"
                      className="ws-btn ws-btn--ghost"
                      style={{ fontSize: "0.8rem", padding: "0.2rem 0.6rem" }}
                      onClick={() => dispatch(clearIngestFeedback())}
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {successMessage && (
                  <div className="ws-banner ws-banner--success" role="status">
                    <span>✓ {successMessage}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="ws-btn ws-btn--primary"
                  style={{ width: "100%", justifyContent: "center", padding: "0.75rem" }}
                  disabled={!url.trim() || isSubmitting}
                  aria-busy={isSubmitting}
                >
                  {isSubmitting ? "Building knowledge…" : "Ingest source →"}
                </button>
              </form>
            </div>
          </div>

          {/* Latest result callout */}
          {latestResult && (
            <div className="ws-result">
              <div className="ws-result__header">
                <span className={`ws-badge ws-badge--${latestResult.source_type}`}>
                  {latestResult.source_type}
                </span>
                <span className="ws-result__title">{latestResult.title}</span>
              </div>
              <p className="ws-result__summary">{latestResult.summary}</p>
              {Array.isArray(latestResult.concepts) && latestResult.concepts.length > 0 && (
                <div className="ws-result__tags" aria-label="Extracted concepts">
                  {latestResult.concepts.slice(0, 8).map((c) => (
                    <span key={c} className="ws-tag">{c}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right column: tab list ──────────────────────────────────── */}
        <div className="ws-panel" style={{ overflow: "hidden" }}>
          <div className="ws-panel__header">
            <div>
              <span className="ws-eyebrow" style={{ marginBottom: "0.25rem" }}>Knowledge history</span>
              <h2 className="ws-panel__title">
                Ingested sources
                {items.length > 0 && (
                  <span style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "0.7rem",
                    fontWeight: 400,
                    color: "#475569",
                    marginLeft: "0.5rem",
                  }}>
                    {items.length}
                  </span>
                )}
              </h2>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              {activeItem && (
                <button
                  type="button"
                  className="ws-btn ws-btn--primary"
                  style={{ fontSize: "0.78rem", padding: "0.35rem 0.875rem" }}
                  onClick={() => setDrawerItem(activeItem)}
                >
                  Read note →
                </button>
              )}
              <button
                type="button"
                className="ws-btn ws-btn--ghost"
                style={{ fontSize: "0.78rem" }}
                onClick={() => void dispatch(loadIngestionHistory())}
                disabled={historyStatus === "loading"}
              >
                {historyStatus === "loading" ? "…" : "Refresh"}
              </button>
            </div>
          </div>

          {/* Tab list body */}
          {historyStatus === "loading" && items.length === 0 ? (
            <HistorySkeleton />
          ) : items.length === 0 ? (
            <div className="ws-empty" style={{ padding: "3rem 2rem" }}>
              <span className="ws-empty__icon">📚</span>
              <h3>No sources yet</h3>
              <p>Ingest your first page or video and it will appear here.</p>
            </div>
          ) : (
            <>
              {/* Preview strip for selected tab */}
              {activeItem && (
                <div
                  style={{
                    padding: "1rem 1.5rem",
                    borderBottom: "1px solid rgba(148,163,184,0.08)",
                    background: "rgba(56,189,248,0.03)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.625rem",
                  }}
                >
                  <p style={{
                    fontFamily: "'DM Sans', system-ui, sans-serif",
                    fontSize: "0.85rem",
                    color: "#64748b",
                    margin: 0,
                    lineHeight: 1.65,
                    fontWeight: 300,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}>
                    {activeItem.summary}
                  </p>
                  {Array.isArray(activeItem.concepts) && activeItem.concepts.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                      {activeItem.concepts.slice(0, 5).map((c) => (
                        <span key={c} className="ws-tag"
                          style={{ fontSize: "0.72rem", padding: "0.15rem 0.5rem" }}>
                          {c}
                        </span>
                      ))}
                      {activeItem.concepts.length > 5 && (
                        <span style={{
                          fontSize: "0.72rem",
                          color: "#475569",
                          fontFamily: "'IBM Plex Mono', monospace",
                          padding: "0.15rem 0",
                        }}>
                          +{activeItem.concepts.length - 5} more
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setDrawerItem(activeItem)}
                    style={{
                      alignSelf: "flex-start",
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: "0.68rem",
                      color: "#38bdf8",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      letterSpacing: "0.04em",
                      transition: "color 0.15s",
                    }}
                  >
                    Read full note →
                  </button>
                </div>
              )}

              {/* Tabs */}
              <div style={{ overflowY: "auto", maxHeight: "480px" }}>
                <HistoryTabs
                  items={items}
                  activeId={activeTabId}
                  onSelect={setActiveTabId}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Full-screen note drawer ─────────────────────────────────────── */}
      {drawerItem && (
        <NoteDrawer
          item={drawerItem}
          onClose={() => setDrawerItem(null)}
        />
      )}
    </section>
  );
}

export default IngestPage;