import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.6rem", color: "var(--ws-text-mute)" }}
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
                color: isActive ? "var(--ws-text)" : "var(--ws-text-dim)",
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
  const [selectedFile, setSelectedFile] = useState(null);
  const [localError, setLocalError] = useState(null);
  const prevWikiIdRef = useRef(null);
  const wikiIdRef = useRef(wikiId);
  useEffect(() => {
    wikiIdRef.current = wikiId;
  }, [wikiId]);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);
  const dispatch = useDispatch();
  const { items, historyStatus, submitStatus, error, successMessage } =
    useSelector((s) => s.ingest);

  // Load history when wikiId changes (not on every render)
  useEffect(() => {
    if (!wikiId) {
      prevWikiIdRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTabId(null);
      setPendingSources([]);
      setCurrentUrl("");

      dispatch(clearIngestionState());
      return;
    }

    if (prevWikiIdRef.current !== wikiId) {
      prevWikiIdRef.current = wikiId;
      setActiveTabId(null);
      dispatch(resetSubmitStatus());
      dispatch(clearIngestFeedback());
      setLocalError(null);
      setSelectedFile(null);
      void dispatch(loadIngestionHistory(wikiId));
      // Clear pending sources when wiki changes
      setPendingSources([]);
      setCurrentUrl("");
    }
  }, [wikiId, dispatch]);

  // Auto-select first item when items arrive for a new wiki
  useEffect(() => {
    if (items.length > 0 && !activeTabId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTabId(items[0].id);
    }
  }, [items, activeTabId]);

  // Reset form when source type changes
  useEffect(() => {
    dispatch(resetSubmitStatus());
    dispatch(clearIngestFeedback());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentUrl("");
    setSelectedFile(null);
    const input = document.getElementById("pdf-file-input");
    if (input) input.value = "";
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

  const handleFileChange = (e) => {
    setLocalError(null);
    const file = e.target.files[0];
    if (!file) return;

    // Validate type (must be PDF)
    const isPDF = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
    if (!isPDF) {
      setLocalError("Only PDF files are supported.");
      setSelectedFile(null);
      e.target.value = "";
      return;
    }

    // Validate size (max 16MB)
    const maxSize = 16 * 1024 * 1024;
    if (file.size > maxSize) {
      setLocalError("File size exceeds the 16MB limit. MongoDB document limit is 16MB.");
      setSelectedFile(null);
      e.target.value = "";
      return;
    }

    setSelectedFile(file);
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    const input = document.getElementById("pdf-file-input");
    if (input) input.value = "";
  };

  const handleAddPDFSource = () => {
    if (!selectedFile) return;
    const id = `pdf-${Date.now()}`;
    setPendingSources([
      ...pendingSources,
      { id, type: "pdf", url: `file://${selectedFile.name}`, file: selectedFile, status: "pending", error: null }
    ]);
    handleClearFile();
  };

  const handleRemoveSource = (id) => {
    setPendingSources(pendingSources.filter((s) => s.id !== id));
  };

  const handleIngestAll = async () => {
    if (!wikiId || pendingSources.length === 0 || submitStatus === "loading") return;
    
    dispatch(clearIngestFeedback());
    setLocalError(null);
    const startWikiId = wikiId;
    
    let successCount = 0;
    const sourcesToProcess = [...pendingSources];
    // One shared ID for the entire batch — the backend uses this to group
    // all sources into a single version entry so rollback undoes the whole batch.
    const batchId = crypto.randomUUID();
    
    for (let i = 0; i < sourcesToProcess.length; i++) {
      if (!isMounted.current || wikiIdRef.current !== startWikiId) break;
      
      const currentSource = sourcesToProcess[i];
      
      setPendingSources((prev) => 
        prev.map(s => s.id === currentSource.id ? { ...s, status: "ingesting" } : s)
      );
      
      const action = await dispatch(submitIngestion({
        sourceType: currentSource.type,
        url: currentSource.url,
        wikiId: startWikiId,
        file: currentSource.file,
        batchId,
      }));
      
      if (!isMounted.current || wikiIdRef.current !== startWikiId) break;
      
      const isSuccess = submitIngestion.fulfilled.match(action);
      if (isSuccess) {
        successCount++;
        if (action.payload?.id) setActiveTabId(action.payload.id);
      }
      
      setPendingSources((prev) => 
        prev.map(s => s.id === currentSource.id ? {
          ...s,
          status: isSuccess ? "success" : "failed",
          error: isSuccess ? null : (currentSource.type === "pdf" ? (action.payload || "Ingestion failed.") : "Automatic ingest failed. Try fallback method.")
        } : s)
      );
    }
    
    if (isMounted.current && wikiIdRef.current === startWikiId) {
      setPendingSources((prev) => prev.filter((s) => s.status !== "success"));
      
      if (successCount > 0) {
        onIngestSuccess?.({ count: successCount });
      }
    }
  };

  const handleFallbackSubmit = async (fallbackData) => {
    setFallbackOpen(false);
    const action = await dispatch(
      submitIngestion({
        sourceType: fallbackData.type,
        url: fallbackData.url,
        wikiId,
        content: fallbackData.content,
      })
    );

    if (submitIngestion.fulfilled.match(action)) {
      setPendingSources((prev) => prev.filter((s) => s.id !== fallbackSource?.id));
      if (action.payload?.id) {
        setActiveTabId(action.payload.id);
      }
    }
  };

  const isSubmitting = submitStatus === "loading";
  const isDisabled = !wikiId;


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
          {["youtube", "web", "pdf"].map((type) => (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={sourceType === type}
              className={`ws-segment${sourceType === type ? " ws-segment--active" : ""}`}
              onClick={() => {
                setSourceType(type);
                setLocalError(null);
              }}
              disabled={isDisabled}
            >
              {type === "youtube" && (
                <>
                  <span>▶</span>
                  <span>YouTube</span>
                </>
              )}
              {type === "web" && (
                <>
                  <span>🌐</span>
                  <span>Web</span>
                </>
              )}
              {type === "pdf" && (
                <>
                  <span>📄</span>
                  <span>PDF</span>
                </>
              )}
            </button>
          ))}
        </div>

        {/* URL or File input + Add button */}
        {sourceType === "pdf" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <div className="ws-field" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
              <input
                id="pdf-file-input"
                className="ws-field__input"
                type="file"
                accept=".pdf"
                style={{ display: "none" }}
                onChange={handleFileChange}
                disabled={isDisabled}
              />
              {selectedFile ? (
                <div
                  className="ws-field__input"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    color: "var(--ws-text)",
                    boxSizing: "border-box",
                    minHeight: "43px",
                    overflow: "hidden",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: "0.5rem" }}>
                    {selectedFile.name}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--ws-text-dim)" }}>
                      ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                    </span>
                    <button
                      type="button"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "var(--ws-text-dim)",
                        cursor: "pointer",
                        fontSize: "0.8rem",
                        padding: "0 0.25rem",
                        display: "flex",
                        alignItems: "center",
                      }}
                      onClick={handleClearFile}
                      aria-label="Clear file selection"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <label
                  htmlFor="pdf-file-input"
                  className="ws-field__input"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: isDisabled ? "not-allowed" : "pointer",
                    color: "var(--ws-text-dim)",
                    boxSizing: "border-box",
                    minHeight: "43px",
                    overflow: "hidden",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: "0.5rem" }}>
                    Choose PDF file...
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--ws-text-dim)", flexShrink: 0 }}>
                    Browse
                  </span>
                </label>
              )}
            </div>
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              style={{ fontSize: "0.8rem", padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}
              onClick={handleAddPDFSource}
              disabled={isDisabled || !selectedFile}
            >
              + Add
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <div className="ws-field" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
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
                onKeyDown={(e) => e.key === "Enter" && handleAddSource()}
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
        )}

        {!isDisabled && (
          <p className="ws-field__hint">
            {sourceType === "youtube"
              ? "Add multiple YouTube links, then click 'Ingest all' to process them together."
              : sourceType === "web"
              ? "Add multiple web pages, then click 'Ingest all' to process them together."
              : "Select a PDF file (max 16MB), add it, and click 'Ingest all' to upload and extract text."}
            <br />
            <br />
            💡 <strong>Tip:</strong> Add all your sources at once to reduce LLM token usage!
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
                    color: "var(--ws-text-dim)",
                    margin: "0.25rem 0 0",
                    wordBreak: "break-all",
                    lineHeight: 1.3,
                  }}>
                    {source.url}
                  </p>
                  {source.status === "ingesting" && (
                    <p style={{ fontSize: "0.7rem", color: "var(--ws-accent)", margin: "0.25rem 0 0", fontStyle: "italic" }}>
                      Processing…
                    </p>
                  )}
                  {source.status === "failed" && source.error && (
                    <p style={{ fontSize: "0.7rem", color: "var(--ws-red)", margin: "0.25rem 0 0", fontStyle: "italic" }}>
                      {source.error}
                    </p>
                  )}
                  {source.status === "success" && (
                    <p style={{ fontSize: "0.7rem", color: "var(--ws-green)", margin: "0.25rem 0 0", fontStyle: "italic" }}>
                      ✓ Ingested
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", gap: "0.25rem", flexShrink: 0, alignItems: "center" }}>
                  {source.status === "failed" && source.type !== "pdf" && (
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
                  {(source.status === "pending" || source.status === "failed") && (
                    <button
                      type="button"
                      className="ws-btn ws-btn--ghost"
                      style={{ fontSize: "0.65rem", padding: "0.2rem 0.4rem" }}
                      onClick={() => handleRemoveSource(source.id)}
                      aria-label="Remove source"
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
        {(error || localError) && (
          <div className="ws-banner ws-banner--error" role="alert">
            <div style={{ fontSize: "0.85rem" }}>
              <p style={{ margin: 0, fontWeight: 500 }}>Error during ingestion</p>
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", opacity: 0.9 }}>
                {error || localError}
              </p>
            </div>
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", marginLeft: "auto", flexShrink: 0 }}
              onClick={() => {
                dispatch(clearIngestFeedback());
                setLocalError(null);
              }}
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
            color: "var(--ws-text-mute)",
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
        style={{ borderTop: "1px solid var(--ws-border)" }}
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
                color: "var(--ws-text-mute)",
                marginLeft: "0.4rem",
              }}>
                {items.length}
              </span>
            )}
          </h2>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>

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
      </div>

      {/* History body */}
      {historyStatus === "loading" && items.length === 0 ? (
        <HistorySkeleton />
      ) : isDisabled ? (
        <div style={{
          padding: "1.5rem 1rem",
          textAlign: "center",
          fontSize: "0.8rem",
          color: "var(--ws-text-mute)",
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
          <p style={{ fontSize: "0.85rem", color: "var(--ws-text-dim)", margin: 0 }}>No sources yet</p>
          <p style={{ fontSize: "0.78rem", color: "var(--ws-text-mute)", margin: 0 }}>
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
