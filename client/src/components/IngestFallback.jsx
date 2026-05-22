import { useState } from "react";
import "./styles/IngestFallback.css";

/* ── YouTube Fallback ───────────────────────────────────────────────── */
export function YouTubeFallback({ sourceUrl, wikiId, onSubmit, onClose, isSubmitting }) {
  const [method, setMethod] = useState(null);
  const [transcript, setTranscript] = useState("");

  const handleSubmit = async () => {
    if (!transcript.trim() || isSubmitting) return;
    await onSubmit({
      type: "youtube",
      url: sourceUrl,
      fallbackMethod: "manual_transcript",
      content: transcript.trim(),
    });
  };

  if (!method) {
    return (
      <div className="ingest-fallback">
        <div className="ingest-fallback__header">
          <h3>📹 YouTube Fallback</h3>
          <button type="button" className="cw-icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="ingest-fallback__body">
          <p className="ingest-fallback__description">
            We couldn't automatically extract the transcript from this video. Please choose a method below:
          </p>
          <div className="ingest-fallback__methods">
            <button
              type="button"
              className="ingest-fallback__method"
              onClick={() => setMethod("copy_paste")}
            >
              <span className="ingest-fallback__method-icon">📋</span>
              <span className="ingest-fallback__method-title">Paste Manually</span>
              <span className="ingest-fallback__method-desc">Copy the transcript from YouTube and paste it</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (method === "copy_paste") {
    return (
      <div className="ingest-fallback">
        <div className="ingest-fallback__header">
          <button
            type="button"
            className="ws-btn ws-btn--ghost"
            style={{ fontSize: "0.8rem" }}
            onClick={() => setMethod(null)}
          >
            ← Back
          </button>
          <h3>📝 Paste Transcript</h3>
          <button type="button" className="cw-icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="ingest-fallback__body">
          <div className="ingest-fallback__steps">
            <div className="ingest-fallback__step">
              <span className="ingest-fallback__step-num">1</span>
              <div>
                <strong>Open YouTube video</strong>
                <p>Click on the "Show transcript" button (if available)</p>
              </div>
            </div>
            <div className="ingest-fallback__step">
              <span className="ingest-fallback__step-num">2</span>
              <div>
                <strong>Copy transcript</strong>
                <p>Select all text (Ctrl+A) and copy (Ctrl+C)</p>
              </div>
            </div>
            <div className="ingest-fallback__step">
              <span className="ingest-fallback__step-num">3</span>
              <div>
                <strong>Paste below</strong>
                <p>Paste the transcript in the text area</p>
              </div>
            </div>
          </div>

          <div className="ws-field" style={{ marginTop: "1rem" }}>
            <label className="ws-field__label" htmlFor="transcript">
              Video Transcript
            </label>
            <textarea
              id="transcript"
              className="ws-field__textarea"
              placeholder="Paste the video transcript here…"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={8}
            />
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              onClick={() => setMethod(null)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ws-btn ws-btn--primary"
              style={{ flex: 1 }}
              onClick={handleSubmit}
              disabled={!transcript.trim() || isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Ingesting…" : "Ingest transcript →"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/* ── Web Fallback ───────────────────────────────────────────────────── */
export function WebFallback({ sourceUrl, wikiId, onSubmit, onClose, isSubmitting }) {
  const [method, setMethod] = useState(null);
  const [content, setContent] = useState("");
  const [fileError, setFileError] = useState(null);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "text/html") {
      setFileError("Please upload an HTML file (.html)");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFileError("File size must be under 5MB");
      return;
    }

    setFileError(null);
    const text = await file.text();
    setContent(text);
  };

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting) return;
    await onSubmit({
      type: "web",
      url: sourceUrl,
      fallbackMethod: method,
      content: content.trim(),
    });
  };

  if (!method) {
    return (
      <div className="ingest-fallback">
        <div className="ingest-fallback__header">
          <h3>🌐 Web Fallback</h3>
          <button type="button" className="cw-icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="ingest-fallback__body">
          <p className="ingest-fallback__description">
            We couldn't automatically extract content from this webpage. Please choose a method below:
          </p>
          <div className="ingest-fallback__methods">
            <button
              type="button"
              className="ingest-fallback__method"
              onClick={() => setMethod("copy_paste")}
            >
              <span className="ingest-fallback__method-icon">📋</span>
              <span className="ingest-fallback__method-title">Paste Text</span>
              <span className="ingest-fallback__method-desc">Copy content and paste it here</span>
            </button>
            <button
              type="button"
              className="ingest-fallback__method"
              onClick={() => setMethod("html_upload")}
            >
              <span className="ingest-fallback__method-icon">📁</span>
              <span className="ingest-fallback__method-title">Upload HTML</span>
              <span className="ingest-fallback__method-desc">Save the page as HTML and upload</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (method === "copy_paste") {
    return (
      <div className="ingest-fallback">
        <div className="ingest-fallback__header">
          <button
            type="button"
            className="ws-btn ws-btn--ghost"
            style={{ fontSize: "0.8rem" }}
            onClick={() => setMethod(null)}
          >
            ← Back
          </button>
          <h3>📝 Paste Content</h3>
          <button type="button" className="cw-icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="ingest-fallback__body">
          <div className="ingest-fallback__steps">
            <div className="ingest-fallback__step">
              <span className="ingest-fallback__step-num">1</span>
              <div>
                <strong>Select article content</strong>
                <p>Highlight the main text on the webpage</p>
              </div>
            </div>
            <div className="ingest-fallback__step">
              <span className="ingest-fallback__step-num">2</span>
              <div>
                <strong>Copy to clipboard</strong>
                <p>Press Ctrl+C (Cmd+C on Mac) to copy</p>
              </div>
            </div>
            <div className="ingest-fallback__step">
              <span className="ingest-fallback__step-num">3</span>
              <div>
                <strong>Paste below</strong>
                <p>Press Ctrl+V (Cmd+V on Mac) to paste</p>
              </div>
            </div>
          </div>

          <div className="ws-field" style={{ marginTop: "1rem" }}>
            <label className="ws-field__label" htmlFor="content">
              Article Content
            </label>
            <textarea
              id="content"
              className="ws-field__textarea"
              placeholder="Paste the article text here…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
            />
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              onClick={() => setMethod(null)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ws-btn ws-btn--primary"
              style={{ flex: 1 }}
              onClick={handleSubmit}
              disabled={!content.trim() || isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Ingesting…" : "Ingest content →"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (method === "html_upload") {
    return (
      <div className="ingest-fallback">
        <div className="ingest-fallback__header">
          <button
            type="button"
            className="ws-btn ws-btn--ghost"
            style={{ fontSize: "0.8rem" }}
            onClick={() => setMethod(null)}
          >
            ← Back
          </button>
          <h3>📁 Upload HTML</h3>
          <button type="button" className="cw-icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="ingest-fallback__body">
          <div className="ingest-fallback__steps">
            <div className="ingest-fallback__step">
              <span className="ingest-fallback__step-num">1</span>
              <div>
                <strong>Right-click on webpage</strong>
                <p>Select "Save as" or "Save page as"</p>
              </div>
            </div>
            <div className="ingest-fallback__step">
              <span className="ingest-fallback__step-num">2</span>
              <div>
                <strong>Save as HTML</strong>
                <p>Choose "Webpage, HTML only" format</p>
              </div>
            </div>
            <div className="ingest-fallback__step">
              <span className="ingest-fallback__step-num">3</span>
              <div>
                <strong>Upload the file</strong>
                <p>Click below to select the saved HTML file</p>
              </div>
            </div>
          </div>

          <div style={{ marginTop: "1.5rem" }}>
            <label
              className="ingest-fallback__file-input"
              htmlFor="htmlFile"
            >
              <span>📁 Choose HTML file…</span>
              <input
                id="htmlFile"
                type="file"
                accept=".html"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
            </label>

            {fileError && (
              <div className="ws-banner ws-banner--error" style={{ marginTop: "0.75rem" }}>
                <span>{fileError}</span>
              </div>
            )}

            {content && (
              <div style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "rgba(16, 185, 129, 0.05)",
                border: "1px solid rgba(16, 185, 129, 0.10)",
                borderRadius: "0.375rem",
                fontSize: "0.8rem",
                color: "#10b981",
              }}>
                ✓ File loaded ({Math.round(content.length / 1024)}KB)
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem" }}>
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              onClick={() => setMethod(null)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ws-btn ws-btn--primary"
              style={{ flex: 1 }}
              onClick={handleSubmit}
              disabled={!content.trim() || isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Ingesting…" : "Ingest HTML →"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/* ── Fallback Modal ──────────────────────────────────────────────────── */
export function IngestFallbackModal({ open, source, wikiId, onSubmit, onClose, isSubmitting }) {
  if (!open || !source) return null;

  return (
    <div
      className="cw-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Ingest fallback"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="cw-modal__panel" style={{ maxWidth: 500 }}>
        {source.type === "youtube" ? (
          <YouTubeFallback
            sourceUrl={source.url}
            wikiId={wikiId}
            onSubmit={onSubmit}
            onClose={onClose}
            isSubmitting={isSubmitting}
          />
        ) : (
          <WebFallback
            sourceUrl={source.url}
            wikiId={wikiId}
            onSubmit={onSubmit}
            onClose={onClose}
            isSubmitting={isSubmitting}
          />
        )}
      </div>
    </div>
  );
}
