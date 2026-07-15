import { memo, useEffect, useRef, useState } from "react";
import MarkdownContent from "./MarkdownContent";
import { useTheme } from "../hooks/useTheme";
import { fetchPageByUrl } from "../utils/api";
import "./styles/MessageBubble.css";

// ── Copy button ────────────────────────────────────────────────────────────

function CopyButton({ content }) {
  const [copied, setCopied] = useState(false);
  const timerRef            = useRef(null);
  const isMounted           = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      if (!isMounted.current) return;
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (isMounted.current) setCopied(false);
      }, 1500);
    } catch {
      // Clipboard unavailable — fail silently
    }
  };

  return (
    <button
      type="button"
      className="ghost-button"
      onClick={handleCopy}
      aria-label={copied ? "Response copied" : "Copy response"}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

// ── Confidence bar ─────────────────────────────────────────────────────────

function ConfidenceBar({ value }) {
  const { theme } = useTheme();
  const pct   = Math.round(value * 100);
  const color = theme === "light"
    ? (pct >= 70 ? "#0f766e" : pct >= 40 ? "#d97706" : "#dc2626")
    : (pct >= 70 ? "#5eead4" : pct >= 40 ? "#f59e0b" : "#f87171");
  return (
    <div className="confidence-bar">
      <div
        className="confidence-fill"
        style={{ width: `${pct}%`, background: color }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Confidence: ${pct}%`}
      />
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────

function MessageBubble({ message, onRetry, wikiId, onSuggest }) {
  const isUser      = message.role === "user";
  const isStreaming = message.status === "streaming";
  const isError     = message.status === "error";
  const metadata    = message.metadata ?? null;

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalBody, setModalBody] = useState("");
  const [modalLoading, setModalLoading] = useState(false);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const handleSourceClick = async (e, src) => {
    const isCustomProtocol = src.url?.startsWith("pdf://") || src.url?.startsWith("file://");
    if (isCustomProtocol) {
      e.preventDefault();
      if (!wikiId) {
        setModalTitle(src.title);
        setModalBody("Unable to fetch document: no active wiki namespace.");
        setModalOpen(true);
        return;
      }
      setModalOpen(true);
      setModalLoading(true);
      setModalTitle(src.title);
      setModalBody("");
      try {
        const pageData = await fetchPageByUrl(wikiId, src.url);
        if (isMounted.current) {
          setModalBody(pageData.content || pageData.summary || "No document content retrieved.");
        }
      } catch (err) {
        if (isMounted.current) {
          setModalBody(`Failed to load document content: ${err?.message || "Unknown error"}`);
        }
      } finally {
        if (isMounted.current) {
          setModalLoading(false);
        }
      }
    }
  };

  return (
    <article
      className={`message-row ${isUser ? "is-user" : "is-assistant"}`}
      aria-label={isUser ? "Your message" : "CortexWiki response"}
    >
      <div
        className={[
          "message-bubble",
          isUser      ? "bubble-user"      : "bubble-assistant",
          isError     ? "is-error"         : "",
          isStreaming ? "is-streaming"     : "",
        ].filter(Boolean).join(" ")}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="message-header">
          <span className="message-author">
            {isUser ? "You" : "CortexWiki"}
          </span>

          {!isUser && (
            <div className="message-actions">
              {message.content && !isStreaming && (
                <CopyButton content={message.content} />
              )}
              {isError && onRetry && (
                <button type="button" className="ghost-button" onClick={onRetry}>
                  Retry
                </button>
              )}
            </div>
          )}
        </header>

        {/* ── Body ───────────────────────────────────────────────────── */}
        {isUser ? (
          <p className="message-plain">{message.content}</p>
        ) : message.content ? (
          <>
            <MarkdownContent content={message.content.replace(/\[SUGGEST:([\s\S]*?)\]/g, "")} />
            
            {/* Suggestions */}
            {!isStreaming && message.content.includes("[SUGGEST:") && (
              <div className="message-suggestions" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
                {(() => {
                  const match = message.content.match(/\[SUGGEST:([\s\S]*?)\]/);
                  if (match && match[1]) {
                    const questions = match[1].split("|").map(q => q.trim()).filter(Boolean);
                    return questions.map((q, idx) => (
                      <button
                        key={idx}
                        className="ws-btn ws-btn--ghost"
                        style={{ fontSize: "0.75rem", borderRadius: "100px", padding: "0.25rem 0.75rem", border: "1px solid var(--ws-border)" }}
                        onClick={() => onSuggest && onSuggest(q)}
                      >
                        {q}
                      </button>
                    ));
                  }
                  return null;
                })()}
              </div>
            )}
            
            {isStreaming && <span className="stream-cursor" aria-hidden="true" />}
          </>
        ) : (
          <div className="thinking-state" role="status" aria-label="CortexWiki is thinking…">
            <span className="skeleton-line is-wide"  aria-hidden="true" />
            <span className="skeleton-line"          aria-hidden="true" />
            <span className="skeleton-line is-short" aria-hidden="true" />
          </div>
        )}

        {/* ── Metadata ───────────────────────────────────────────────── */}
        {!isUser && metadata && (
          <>
            <footer className="message-meta">
              <span className={`meta-badge ${metadata.is_grounded ? "is-grounded" : "is-warning"}`}>
                {metadata.is_grounded ? "Grounded" : "Needs verification"}
              </span>
              {metadata.confidence != null && (
                <span className="meta-badge">
                  {Math.round(metadata.confidence * 100)}% confidence
                </span>
              )}
              {metadata.strategy && (
                <span className="meta-badge">{metadata.strategy}</span>
              )}
            </footer>

            {/* Confidence bar */}
            {metadata.confidence != null && (
              <ConfidenceBar value={metadata.confidence} />
            )}

            {/* Sources */}
            {metadata.sources?.length > 0 && (
              <nav className="message-sources" aria-label="Response sources">
                {metadata.sources.map((src, idx) => (
                  <a
                    key={`${src.url}:${src.title}:${idx}`}
                    href={src.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="source-pill"
                    onClick={(e) => handleSourceClick(e, src)}
                  >
                    {src.title}
                  </a>
                ))}
              </nav>
            )}

            {/* Debug */}
            {metadata.debug && (
              <details className="debug-panel">
                <summary>Debug context</summary>
                <pre>{JSON.stringify(metadata.debug, null, 2)}</pre>
              </details>
            )}
          </>
        )}
      </div>

      {modalOpen && (
        <div className="ws-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="ws-modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="ws-modal-header">
              <h3 className="ws-modal-title">{modalTitle}</h3>
              <button
                type="button"
                className="ws-modal-close"
                onClick={() => setModalOpen(false)}
                aria-label="Close document modal"
              >
                ✕
              </button>
            </div>
            <div className="ws-modal-body">
              {modalLoading ? (
                <div className="ws-modal-loading">
                  <div className="ws-modal-spinner" />
                  <span>Extracting document content…</span>
                </div>
              ) : (
                modalBody
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

// memo: Immer produces a new object reference on every chunk so streaming
// updates still flow through, but unchanged messages in the list don't re-render.
export default memo(MessageBubble);