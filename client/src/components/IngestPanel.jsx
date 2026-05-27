import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  clearIngestionState,
  clearIngestFeedback,
  loadIngestionHistory,
  resetSubmitStatus,
  submitIngestion,
} from "../redux/slices/ingestSlice";
import { IngestFallbackModal } from "./IngestFallback";
import "./styles/IngestPanel.css";

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
  const [pendingSources, setPendingSources] = useState([]); // Array of {id, type, url, status, error}
  const [currentUrl, setCurrentUrl] = useState("");
  const [activeTabId, setActiveTabId] = useState(null);
  const [fallbackSource, setFallbackSource] = useState(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const prevWikiIdRef = useRef(null);
  const dispatch = useDispatch();
  const { items, historyStatus, submitStatus, error, successMessage } =
    useSelector((s) => s.ingest);

  // Load history when wikiId changes (not on every render)
  useEffect(() => {
    if (!wikiId) {
      prevWikiIdRef.current = null;
      setActiveTabId(null);
      setPendingSources([]);
      setCurrentUrl("");
      dispatch(clearIngestionState());
      return;
    }

    if (!wikiId) return;
    if (prevWikiIdRef.current !== wikiId) {
      prevWikiIdRef.current = wikiId;
      setActiveTabId(null);
      dispatch(resetSubmitStatus());
      dispatch(clearIngestFeedback());
      void dispatch(loadIngestionHistory(wikiId));
      // Clear pending sources when wiki changes
      setPendingSources([]);
      setCurrentUrl("");
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
  }, [sourceType, dispatch]);

  // Auto-dismiss success banner after 4s
  useEffect(() => {
    if (!successMessage) return;
    const t = setTimeout(() => dispatch(clearIngestFeedback()), 4000);
    return () => clearTimeout(t);
  }, [successMessage, dispatch]);

  const handleAddSource = () => {
    if (!currentUrl.trim()) return;
    const id = `${sourceType}-${Date.now()}`;
    setPendingSources([
      ...pendingSources,
      { id, type: sourceType, url: currentUrl.trim(), status: "pending", error: null }
    ]);
    setCurrentUrl("");
  };

  const handleRemoveSource = (id) => {
    setPendingSources(pendingSources.filter((s) => s.id !== id));
  };

  const handleIngestAll = async () => {
    if (!wikiId || pendingSources.length === 0 || submitStatus === "loading") return;
    
    dispatch(clearIngestFeedback());
    
    // Process all sources sequentially
    let successCount = 0;
    const updatedSources = [...pendingSources];
    
    for (let i = 0; i < updatedSources.length; i++) {
      const source = updatedSources[i];
      source.status = "ingesting";
      setPendingSources([...updatedSources]);
      
      const action = await dispatch(submitIngestion({
        sourceType: source.type,
        url: source.url,
        wikiId
      }));
      
      if (submitIngestion.fulfilled.match(action)) {
        source.status = "success";
        successCount++;
        if (action.payload?.id) {
          setActiveTabId(action.payload.id);
        }
      } else {
        source.status = "failed";
        source.error = "Automatic ingest failed. Try fallback method.";
      }
      
      setPendingSources([...updatedSources]);
    }
    
    // Clear successful sources, keep failed ones
    setPendingSources(updatedSources.filter((s) => s.status === "failed"));
    
    if (successCount > 0) {
      onIngestSuccess?.({ count: successCount });
    }
  };

  const handleFallbackSubmit = async (fallbackData) => {
    // TODO: Implement fallback ingest endpoint on server
    console.log("Fallback ingest:", fallbackData);
    setFallbackOpen(false);
    // After successful submission, mark the source as removed from pending
    setPendingSources(pendingSources.filter((s) => s.id !== fallbackSource?.id));
  };

  const isSubmitting = submitStatus === "loading";
  const isDisabled = !wikiId;
  const hasFailedSources = pendingSources.some((s) => s.status === "failed");

  return (
    <>
      <div className="ws-panel" style={{ overflow: "hidden", flexShrink: 0 }}>

        {/* ── Form section ──────────────────────────────────────────────── */}
      <div className="ws-panel__header">
        <div>
          <span className="ws-eyebrow" style={{ marginBottom: "0.25rem" }}>Source setup</span>
          <h2 className="ws-panel__title">Add sources</h2>
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

        {/* URL input + Add button */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <div className="ws-field" style={{ flex: 1, marginBottom: 0 }}>
            <input
              className="ws-field__input"
              type="url"
              inputMode="url"
              placeholder={
                sourceType === "youtube"
                  ? "https://youtube.com/watch?v=…"
                  : "https://example.com/article"
              }
              value={currentUrl}
              onChange={(e) => setCurrentUrl(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleAddSource()}
              disabled={isDisabled}
            />
          </div>
          <button
            type="button"
            className="ws-btn ws-btn--ghost"
            style={{ fontSize: "0.8rem", padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}
            onClick={handleAddSource}
            disabled={isDisabled || !currentUrl.trim()}
            aria-label="Add URL"
          >
            + Add
          </button>
        </div>

        {!isDisabled && (
          <p className="ws-field__hint">
            {sourceType === "youtube"
              ? "Add multiple YouTube links, then click 'Ingest all' to process them together."
              : "Add multiple web pages, then click 'Ingest all' to process them together."}
          </p>
        )}

        {/* Pending sources list */}
        {pendingSources.length > 0 && (
          <div style={{
            marginBottom: "0.75rem",
            padding: "0.75rem",
            background: "rgba(56, 189, 248, 0.05)",
            border: "1px solid rgba(56, 189, 248, 0.10)",
            borderRadius: "0.375rem",
            maxHeight: 200,
            overflowY: "auto",
          }}>
            {pendingSources.map((source) => (
              <div
                key={source.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                  padding: "0.5rem",
                  marginBottom: source === pendingSources[pendingSources.length - 1] ? 0 : "0.5rem",
                  borderBottom: source === pendingSources[pendingSources.length - 1] ? "none" : "1px solid rgba(148,163,184,0.07)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className={`ws-badge ws-badge--${source.type}`} style={{ fontSize: "0.58rem", padding: "0.1rem 0.4rem" }}>
                    {source.type}
                  </span>
                  <p style={{
                    fontSize: "0.75rem",
                    color: "#94a3b8",
                    margin: "0.25rem 0 0",
                    wordBreak: "break-all",
                    lineHeight: 1.3,
                  }}>
                    {source.url}
                  </p>
                  {source.status === "ingesting" && (
                    <p style={{ fontSize: "0.7rem", color: "#38bdf8", margin: "0.25rem 0 0", fontStyle: "italic" }}>
                      Processing…
                    </p>
                  )}
                  {source.status === "failed" && source.error && (
                    <p style={{ fontSize: "0.7rem", color: "#ef4444", margin: "0.25rem 0 0", fontStyle: "italic" }}>
                      {source.error}
                    </p>
                  )}
                  {source.status === "success" && (
                    <p style={{ fontSize: "0.7rem", color: "#10b981", margin: "0.25rem 0 0", fontStyle: "italic" }}>
                      ✓ Ingested
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.25rem", flexShrink: 0, alignItems: "center" }}>
                  {source.status === "failed" && (
                    <button
                      type="button"
                      className="ws-btn ws-btn--ghost"
                      style={{ fontSize: "0.65rem", padding: "0.2rem 0.4rem" }}
                      onClick={() => {
                        setFallbackSource(source);
                        setFallbackOpen(true);
                      }}
                      aria-label="Use fallback"
                    >
                      💾
                    </button>
                  )}
                  {source.status === "pending" && (
                    <button
                      type="button"
                      className="ws-btn ws-btn--ghost"
                      style={{ fontSize: "0.65rem", padding: "0.2rem 0.4rem" }}
                      onClick={() => handleRemoveSource(source.id)}
                      aria-label="Remove URL"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="ws-banner ws-banner--error" role="alert">
            <div style={{ fontSize: "0.85rem" }}>
              <p style={{ margin: 0, fontWeight: 500 }}>Error during ingestion</p>
              {/* BUG FIX #24: Show detailed error information */}
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", opacity: 0.9 }}>
                {error}
              </p>
            </div>
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", marginLeft: "auto", flexShrink: 0 }}
              onClick={() => dispatch(clearIngestFeedback())}
            >
              ✕
            </button>
          </div>
        )}

        {/* Success banner */}
        {successMessage && (
          <div className="ws-banner ws-banner--success" role="status">
            <span>✓ {successMessage}</span>
          </div>
        )}

        {/* Ingest all button */}
        {pendingSources.length > 0 && (
          <button
            type="button"
            className="ws-btn ws-btn--primary"
            style={{ width: "100%", justifyContent: "center", padding: "0.7rem" }}
            disabled={isDisabled || isSubmitting || pendingSources.every((s) => s.status !== "pending")}
            aria-busy={isSubmitting}
            onClick={handleIngestAll}
          >
            {isSubmitting ? "Processing…" : `Ingest all (${pendingSources.filter((s) => s.status === "pending").length})`}
          </button>
        )}

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
            Add sources above and click "Ingest all" to begin.
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

      {/* Fallback modal */}
      <IngestFallbackModal
        open={fallbackOpen}
        source={fallbackSource}
        wikiId={wikiId}
        onSubmit={handleFallbackSubmit}
        onClose={() => setFallbackOpen(false)}
        isSubmitting={submitStatus === "loading"}
      />
    </>
  );
}

export default IngestPanel;
