import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  clearIngestFeedback,
  loadIngestionHistory,
  resetSubmitStatus,
  submitIngestion,
} from "../redux/slices/ingestSlice";
import "./styles/Workspace.css";

function HistorySkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {[0, 1, 2].map((i) => (
        <div key={i} className="ws-history-card ws-history-card--skeleton" aria-hidden="true">
          <div className="ws-skeleton-line ws-skeleton-line--short" style={{ marginBottom: "0.4rem" }} />
          <div className="ws-skeleton-line ws-skeleton-line--wide" />
          <div className="ws-skeleton-line ws-skeleton-line--med" />
        </div>
      ))}
    </div>
  );
}

function IngestPage() {
  const [sourceType, setSourceType] = useState("youtube");
  const [url, setUrl]               = useState("");
  const dispatch = useDispatch();
  const { items, latestResult, historyStatus, submitStatus, error, successMessage } =
    useSelector((s) => s.ingest);

  useEffect(() => {
    if (historyStatus === "idle") void dispatch(loadIngestionHistory());
  }, [dispatch, historyStatus]);

  useEffect(() => {
    dispatch(resetSubmitStatus());
    dispatch(clearIngestFeedback());
  }, [sourceType, dispatch]);

  const stats = useMemo(() => [
    { label: "Total sources", value: items.length },
    { label: "Mode",          value: sourceType === "youtube" ? "Video" : "Web page" },
    { label: "Latest concepts", value: latestResult?.concepts?.length ?? 0 },
  ], [items.length, latestResult?.concepts?.length, sourceType]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim() || submitStatus === "loading") return;
    dispatch(clearIngestFeedback());
    const action = await dispatch(submitIngestion({ sourceType, url: url.trim() }));
    if (submitIngestion.fulfilled.match(action)) setUrl("");
  };

  const isSubmitting = submitStatus === "loading";

  return (
    <section className="workspace-page" style={{ padding: "0 1.5rem 2rem", maxWidth: 1280, margin: "0 auto" }}>

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
      <div style={{ display: "grid", gridTemplateColumns: "minmax(360px, 420px) minmax(0,1fr)", gap: "1rem", alignItems: "start" }}>

        {/* ── Form panel ─────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="ws-panel">
            <div className="ws-panel__header">
              <div>
                <span className="ws-eyebrow" style={{ marginBottom: "0.25rem" }}>Source setup</span>
                <h2 className="ws-panel__title">Add a new source</h2>
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
                  >
                    {type === "youtube" ? "▶ YouTube" : "🌐 Web page"}
                  </button>
                ))}
              </div>

              {/* URL form */}
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
                    placeholder={sourceType === "youtube" ? "https://youtube.com/watch?v=…" : "https://example.com/article"}
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
                    <button type="button" className="ws-btn ws-btn--ghost" style={{ fontSize: "0.8rem", padding: "0.2rem 0.6rem" }}
                      onClick={() => dispatch(clearIngestFeedback())}>Dismiss</button>
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

          {/* Latest result */}
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

        {/* ── History panel ───────────────────────────────────────────── */}
        <div className="ws-panel">
          <div className="ws-panel__header">
            <div>
              <span className="ws-eyebrow" style={{ marginBottom: "0.25rem" }}>Knowledge history</span>
              <h2 className="ws-panel__title">Recent ingestions</h2>
            </div>
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              style={{ fontSize: "0.8rem" }}
              onClick={() => void dispatch(loadIngestionHistory())}
              disabled={historyStatus === "loading"}
            >
              {historyStatus === "loading" ? "Loading…" : "Refresh"}
            </button>
          </div>

          {historyStatus === "loading" && items.length === 0 ? (
            <HistorySkeleton />
          ) : items.length === 0 ? (
            <div className="ws-empty" style={{ padding: "3rem 2rem" }}>
              <span className="ws-empty__icon">📚</span>
              <h3>No sources yet</h3>
              <p>Ingest your first page or video and it will appear here with a summary and graph-ready concepts.</p>
            </div>
          ) : (
            <div className="ws-history-list">
              {items.map((item) => (
                <article key={item.id} className="ws-history-card">
                  <div className="ws-history-card__topline">
                    <span className={`ws-badge ws-badge--${item.source_type}`}>{item.source_type}</span>
                    <time className="ws-history-card__time" dateTime={item.created_at}>
                      {new Date(item.created_at).toLocaleString()}
                    </time>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ws-history-card__link"
                  >
                    Open source ↗
                  </a>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default IngestPage;