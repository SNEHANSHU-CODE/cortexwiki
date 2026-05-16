import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  clearIngestFeedback,
  loadIngestionHistory,
  resetSubmitStatus,
  submitIngestion,
} from "../redux/slices/ingestSlice";
import "../pages/styles/Workspace.css";

/* ── Skeleton ─────────────────────────────────────────────────────────── */
function HistorySkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            padding: "0.875rem 1rem",
            borderBottom: "1px solid rgba(148,163,184,0.07)",
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
          }}
        >
          <div className="ws-skeleton-line ws-skeleton-line--short" />
          <div className="ws-skeleton-line ws-skeleton-line--wide" />
        </div>
      ))}
    </div>
  );
}

/* ── History tab list ─────────────────────────────────────────────────── */
function HistoryTabs({ items, activeId, onSelect }) {
  return (
    <div role="tablist" aria-label="Ingested sources">
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
              padding: "0.875rem 1rem",
              background: isActive ? "rgba(56,189,248,0.06)" : "transparent",
              borderLeft: `2px solid ${isActive ? "#38bdf8" : "transparent"}`,
              borderTop: "none",
              borderRight: "none",
              borderBottom: "1px solid rgba(148,163,184,0.07)",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
              <span
                className={`ws-badge ws-badge--${item.source_type}`}
                style={{ fontSize: "0.58rem", padding: "0.1rem 0.4rem" }}
              >
                {item.source_type}
              </span>
              <time
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.6rem", color: "#475569" }}
                dateTime={item.created_at}
              >
                {new Date(item.created_at).toLocaleDateString()}
              </time>
            </div>
            <span
              style={{
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: "0.83rem",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "#f8fafc" : "#94a3b8",
                lineHeight: 1.35,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {item.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── IngestPanel ──────────────────────────────────────────────────────── */
function IngestPanel({ wikiId, onIngestSuccess }) {
  const [sourceType, setSourceType] = useState("youtube");
  const [url, setUrl]               = useState("");
  const [activeTabId, setActiveTabId] = useState(null);
  const prevWikiIdRef = useRef(null);
  const dispatch = useDispatch();
  const { items, historyStatus, submitStatus, error, successMessage } =
    useSelector((s) => s.ingest);

  // Load history when wikiId changes (not on every render)
  useEffect(() => {
    if (!wikiId) return;
    if (prevWikiIdRef.current !== wikiId) {
      prevWikiIdRef.current = wikiId;
      setActiveTabId(null);
      dispatch(resetSubmitStatus());
      dispatch(clearIngestFeedback());
      void dispatch(loadIngestionHistory(wikiId));
    }
  }, [wikiId, dispatch]);

  // Auto-select first item when items arrive for a new wiki
  useEffect(() => {
    if (items.length > 0 && !activeTabId) {
      setActiveTabId(items[0].id);
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset form when source type changes
  useEffect(() => {
    dispatch(resetSubmitStatus());
    dispatch(clearIngestFeedback());
    setUrl("");
  }, [sourceType, dispatch]);

  // Auto-dismiss success banner after 4s
  useEffect(() => {
    if (!successMessage) return;
    const t = setTimeout(() => dispatch(clearIngestFeedback()), 4000);
    return () => clearTimeout(t);
  }, [successMessage, dispatch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!wikiId || !url.trim() || submitStatus === "loading") return;
    dispatch(clearIngestFeedback());
    const action = await dispatch(submitIngestion({ sourceType, url: url.trim(), wikiId }));
    if (submitIngestion.fulfilled.match(action)) {
      setUrl("");
      if (action.payload?.id) setActiveTabId(action.payload.id);
      onIngestSuccess?.(action.payload);
    }
  };

  const isSubmitting = submitStatus === "loading";
  const isDisabled   = !wikiId;

  return (
    <div className="ws-panel" style={{ overflow: "hidden", flexShrink: 0 }}>

      {/* ── Form section ──────────────────────────────────────────────── */}
      <div className="ws-panel__header">
        <div>
          <span className="ws-eyebrow" style={{ marginBottom: "0.25rem" }}>Source setup</span>
          <h2 className="ws-panel__title">Add a source</h2>
        </div>
      </div>

      <div className="ws-panel__body">
        {/* Source type toggle */}
        <div className="ws-segments" role="tablist" aria-label="Source type">
          {["youtube", "web"].map((type) => (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={sourceType === type}
              className={`ws-segment${sourceType === type ? " ws-segment--active" : ""}`}
              onClick={() => setSourceType(type)}
              disabled={isDisabled}
            >
              {type === "youtube" ? "▶ YouTube" : "🌐 Web"}
            </button>
          ))}
        </div>

        {/* URL form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div className="ws-field">
            <label className="ws-field__label" htmlFor="ingestUrl">
              {sourceType === "youtube" ? "YouTube video URL" : "Web page URL"}
            </label>
            <input
              id="ingestUrl"
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
              disabled={isDisabled}
            />
            {!isDisabled && (
              <p className="ws-field__hint">
                {sourceType === "youtube"
                  ? "Transcripts are extracted, summarized, and compounded into the wiki's master note."
                  : "The page is cleaned, summarized, and merged into the master note."}
              </p>
            )}
          </div>

          {/* No wiki selected hint */}
          {isDisabled && (
            <p style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: "0.68rem",
              color: "#475569",
              letterSpacing: "0.04em",
              margin: 0,
            }}>
              Select or create a wiki first.
            </p>
          )}

          {/* Error */}
          {error && (
            <div className="ws-banner ws-banner--error" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="ws-btn ws-btn--ghost"
                style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                onClick={() => dispatch(clearIngestFeedback())}
              >
                ✕
              </button>
            </div>
          )}

          {/* Success */}
          {successMessage && (
            <div className="ws-banner ws-banner--success" role="status">
              <span>✓ {successMessage}</span>
            </div>
          )}

          <button
            type="submit"
            className="ws-btn ws-btn--primary"
            style={{ width: "100%", justifyContent: "center", padding: "0.7rem" }}
            disabled={isDisabled || !url.trim() || isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "Building knowledge…" : "Ingest source →"}
          </button>
        </form>
      </div>

      {/* ── History section ───────────────────────────────────────────── */}
      <div
        className="ws-panel__header"
        style={{ borderTop: "1px solid rgba(148,163,184,0.10)" }}
      >
        <div>
          <span className="ws-eyebrow" style={{ marginBottom: "0.25rem" }}>History</span>
          <h2 className="ws-panel__title">
            Ingested sources
            {items.length > 0 && (
              <span style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.65rem",
                fontWeight: 400,
                color: "#475569",
                marginLeft: "0.4rem",
              }}>
                {items.length}
              </span>
            )}
          </h2>
        </div>
        <button
          type="button"
          className="ws-btn ws-btn--ghost"
          style={{ fontSize: "0.72rem" }}
          onClick={() => wikiId && void dispatch(loadIngestionHistory(wikiId))}
          disabled={isDisabled || historyStatus === "loading"}
        >
          {historyStatus === "loading" ? "…" : "Refresh"}
        </button>
      </div>

      {/* History body */}
      {historyStatus === "loading" && items.length === 0 ? (
        <HistorySkeleton />
      ) : isDisabled ? (
        <div style={{
          padding: "1.5rem 1rem",
          textAlign: "center",
          fontSize: "0.8rem",
          color: "#334155",
          fontFamily: "'IBM Plex Mono', monospace",
          letterSpacing: "0.04em",
        }}>
          No wiki selected
        </div>
      ) : items.length === 0 ? (
        <div style={{
          padding: "1.5rem 1rem",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "0.375rem",
        }}>
          <p style={{ fontSize: "0.85rem", color: "#64748b", margin: 0 }}>No sources yet</p>
          <p style={{ fontSize: "0.78rem", color: "#334155", margin: 0 }}>
            Ingest your first page or video above.
          </p>
        </div>
      ) : (
        <div style={{ overflowY: "auto", maxHeight: 280 }}>
          <HistoryTabs
            items={items}
            activeId={activeTabId}
            onSelect={setActiveTabId}
          />
        </div>
      )}
    </div>
  );
}

export default IngestPanel;