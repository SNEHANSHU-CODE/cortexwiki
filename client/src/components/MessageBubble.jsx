import { memo, useEffect, useRef, useState } from "react";
import MarkdownContent from "./MarkdownContent";

function CopyButton({ content }) {
  const [copied, setCopied]   = useState(false);
  const timeoutRef            = useRef(null);

  // Cleanup timeout on unmount to avoid state update on unmounted component.
  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — fail silently.
    }
  };

  return (
    <button
      type="button"
      className="ghost-button"
      onClick={handleCopy}
      aria-label={copied ? "Response copied" : "Copy assistant response"}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

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
          isUser ? "bubble-user" : "bubble-assistant",
          isError     ? " is-error"     : "",
          isStreaming ? " is-streaming" : "",
        ].join(" ").trim()}
      >
        <header className="message-header">
          <span className="message-author">{isUser ? "You" : "CortexWiki"}</span>

          {!isUser && (
            <div className="message-actions">
              {/* Only show copy once there's content */}
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

        {/* ── Message body ─────────────────────────────────────────── */}
        {isUser ? (
          <p className="message-plain">{message.content}</p>
        ) : message.content ? (
          <>
            <MarkdownContent content={message.content} />
            {/* Blinking cursor at end of active stream */}
            {isStreaming && (
              <span className="stream-cursor" aria-hidden="true" />
            )}
          </>
        ) : (
          // Empty placeholder — server hasn't sent first token yet.
          <div
            className="thinking-state"
            aria-label="CortexWiki is thinking…"
            role="status"
          >
            <span className="skeleton-line is-wide" aria-hidden="true" />
            <span className="skeleton-line"        aria-hidden="true" />
            <span className="skeleton-line is-short" aria-hidden="true" />
          </div>
        )}

        {/* ── Metadata footer ──────────────────────────────────────── */}
        {!isUser && metadata && (
          <>
            <footer className="message-meta">
              <span className={`meta-badge ${metadata.is_grounded ? "is-grounded" : "is-warning"}`}>
                {metadata.is_grounded ? "Grounded" : "Needs verification"}
              </span>
              {metadata.confidence != null && (
                <span className="meta-badge">
                  Confidence {Math.round(metadata.confidence * 100)}%
                </span>
              )}
              {metadata.strategy && (
                <span className="meta-badge">{metadata.strategy}</span>
              )}
            </footer>

            {metadata.sources?.length > 0 && (
              <nav className="message-sources" aria-label="Response sources">
                {metadata.sources.map((source) => (
                  <a
                    key={`${source.url}-${source.title}`}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="source-pill"
                  >
                    {source.title}
                  </a>
                ))}
              </nav>
            )}

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

// Memo: skip re-render when the message object reference hasn't changed.
// During streaming the slice mutates message.content in-place via Immer,
// which produces a new reference — so updates still flow through correctly.
export default memo(MessageBubble);