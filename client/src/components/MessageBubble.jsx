import { memo, useEffect, useRef, useState } from "react";
import MarkdownContent from "./MarkdownContent";
import "./styles/Components.css";

// ── Copy button ────────────────────────────────────────────────────────────

function CopyButton({ content }) {
  const [copied, setCopied] = useState(false);
  const timerRef            = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
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
  const pct   = Math.round(value * 100);
  const color = pct >= 70 ? "#5eead4" : pct >= 40 ? "#f59e0b" : "#f87171";
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

function MessageBubble({ message, onRetry }) {
  const isUser      = message.role === "user";
  const isStreaming = message.status === "streaming";
  const isError     = message.status === "error";
  const metadata    = message.metadata ?? null;

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
            <MarkdownContent content={message.content} />
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
                {metadata.sources.map((src) => (
                  <a
                    key={`${src.url}:${src.title}`}
                    href={src.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="source-pill"
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
    </article>
  );
}

// memo: Immer produces a new object reference on every chunk so streaming
// updates still flow through, but unchanged messages in the list don't re-render.
export default memo(MessageBubble);