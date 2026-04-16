import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  clearIngestFeedback,
  loadIngestionHistory,
  resetSubmitStatus,
  submitIngestion,
} from "../redux/slices/ingestSlice";

function IngestHistorySkeleton() {
  return (
    <div className="history-list" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <article key={i} className="history-card surface-card skeleton-card">
          <span className="skeleton-line is-short" />
          <span className="skeleton-line is-wide" />
          <span className="skeleton-line" />
          <span className="skeleton-line is-short" />
        </article>
      ))}
    </div>
  );
}

function IngestPage() {
  const [sourceType, setSourceType] = useState("youtube");
  const [url, setUrl]               = useState("");
  const dispatch = useDispatch();
  const {
    items,
    latestResult,
    historyStatus,
    submitStatus,
    error,
    successMessage,
  } = useSelector((s) => s.ingest);

  useEffect(() => {
    if (historyStatus === "idle") {
      void dispatch(loadIngestionHistory());
    }
  }, [dispatch, historyStatus]);

  // Reset submit status when the user switches source type so the button
  // doesn't stay in a "succeeded" state across attempts.
  useEffect(() => {
    dispatch(resetSubmitStatus());
    dispatch(clearIngestFeedback());
  }, [sourceType, dispatch]);

  const stats = useMemo(
    () => [
      { label: "Sources", value: items.length },
      { label: "Mode",    value: sourceType === "youtube" ? "Video" : "Web" },
      { label: "Concepts extracted", value: latestResult?.concepts?.length ?? 0 },
    ],
    [items.length, latestResult?.concepts?.length, sourceType],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim() || submitStatus === "loading") return;

    dispatch(clearIngestFeedback());
    const action = await dispatch(submitIngestion({ sourceType, url: url.trim() }));
    if (submitIngestion.fulfilled.match(action)) {
      setUrl("");
    }
  };

  const isSubmitting = submitStatus === "loading";

  return (
    <section className="workspace-page">
      <header className="hero-panel page-header-panel">
        <div className="page-header-copy">
          <span className="eyebrow">Knowledge Intake</span>
          <h1>Turn raw sources into structured memory.</h1>
          <p>
            Bring in a YouTube video or a web page, summarize it into reusable
            concepts, and push the result straight into your graph and chat
            workflow.
          </p>
        </div>
        <div className="page-header-actions">
          <Link className="button button-secondary" to="/chat">Open chat</Link>
          <Link className="button button-primary"   to="/graph">Explore graph</Link>
        </div>
      </header>

      <div className="stats-grid">
        {stats.map((stat) => (
          <article key={stat.label} className="metric-card surface-card">
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </article>
        ))}
      </div>

      <div className="workspace-grid ingest-grid">
        {/* ── Form panel ─────────────────────────────────────────────── */}
        <section className="surface-panel ingest-form-panel">
          <div className="section-heading-inline">
            <div>
              <span className="eyebrow">Source setup</span>
              <h2>Add a new source</h2>
            </div>
          </div>

          <div className="segmented-control" role="tablist" aria-label="Ingestion source type">
            {["youtube", "web"].map((type) => (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={sourceType === type}
                className={`segment${sourceType === type ? " is-active" : ""}`}
                onClick={() => setSourceType(type)}
              >
                {type === "youtube" ? "YouTube" : "Web page"}
              </button>
            ))}
          </div>

          <form className="stack-form" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="sourceUrl">
              {sourceType === "youtube" ? "Video URL" : "Page URL"}
            </label>
            <input
              id="sourceUrl"
              className="text-input"
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

            <p className="field-hint">
              {sourceType === "youtube"
                ? "Transcripts and metadata will be summarized into concepts and relationships."
                : "The page will be cleaned, summarized, and indexed inside your workspace."}
            </p>

            {error && (
              <div className="status-banner is-error" role="alert">
                <span>{error}</span>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => dispatch(clearIngestFeedback())}
                >
                  Dismiss
                </button>
              </div>
            )}

            {successMessage && (
              <div className="status-banner is-success" role="status">
                <span>{successMessage}</span>
              </div>
            )}

            <button
              type="submit"
              className="button button-primary button-block"
              disabled={!url.trim() || isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Building knowledge…" : "Ingest source"}
            </button>
          </form>

          {/* Latest result callout */}
          {latestResult && (
            <article className="result-callout surface-card">
              <div className="result-callout-header">
                <span className="badge">{latestResult.source_type}</span>
                <strong>{latestResult.title}</strong>
              </div>
              <p>{latestResult.summary}</p>
              {Array.isArray(latestResult.concepts) && latestResult.concepts.length > 0 && (
                <div className="tag-row" aria-label="Extracted concepts">
                  {latestResult.concepts.slice(0, 8).map((concept) => (
                    <span key={concept} className="tag">{concept}</span>
                  ))}
                </div>
              )}
            </article>
          )}
        </section>

        {/* ── History panel ───────────────────────────────────────────── */}
        <section className="surface-panel ingest-history-panel">
          <div className="section-heading-inline">
            <div>
              <span className="eyebrow">Knowledge history</span>
              <h2>Recent ingestions</h2>
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void dispatch(loadIngestionHistory())}
              disabled={historyStatus === "loading"}
            >
              Refresh
            </button>
          </div>

          {historyStatus === "loading" && items.length === 0 ? (
            <IngestHistorySkeleton />
          ) : items.length === 0 ? (
            <div className="empty-state">
              <h3>No sources yet</h3>
              <p>
                Ingest your first page or video and it will show up here with a
                summary and graph-ready concepts.
              </p>
            </div>
          ) : (
            <div className="history-list">
              {items.map((item) => (
                <article key={item.id} className="history-card surface-card">
                  <div className="history-card-topline">
                    <span className="badge">{item.source_type}</span>
                    <time dateTime={item.created_at}>
                      {new Date(item.created_at).toLocaleString()}
                    </time>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link"
                  >
                    Open source ↗
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

export default IngestPage;