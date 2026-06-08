import { useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import IngestPanel from "../components/IngestPanel";
import MarkdownContent from "../components/MarkdownContent";
import { useTheme } from "../hooks/useTheme";
import "./styles/Ingest.css";

export function NoteDrawer({ item, onClose }) {
  const { theme } = useTheme();
  const overlayRef = useRef(null);

  useEffect(() => {
    const handler = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (!item) return null;

  const handleOverlayClick = (event) => {
    if (event.target === overlayRef.current) onClose();
  };

  const badgeType = item.source_type || "wiki";
  const normalizedContent = (item.content || "")
    .replace(/\r\n/g, "\n")
    // Ensure numbered sections render as real list lines.
    .replace(/\s+(\d+\.\s+)/g, "\n$1")
    // Ensure bullet markers break to their own lines.
    .replace(/\s+([*-]\s+)/g, "\n$1")
    // Promote common section labels to heading-like lines without breaking Markdown headings.
    .replace(/(?:\r?\n|^)(#*\s*)?(Overview|Key Components|Benefits|Setting Up[^:\n]*|Define a Note)/gi, (match, hashes, title) => {
      const h = (hashes && hashes.trim()) ? hashes.trim() : "##";
      return `\n\n${h} ${title}\n`;
    })
    .trim();

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
        background: theme === "light" ? "rgba(255, 255, 255, 0.5)" : "rgba(10, 15, 30, 0.85)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-end",
      }}
    >
      <div
        className="workspace-page"
        style={{
          width: "100vw",
          height: "100vh",
          background: "var(--ws-surface)",
          borderLeft: "1px solid var(--ws-border)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: theme === "light" ? "-20px 0 50px rgba(15, 23, 42, 0.08)" : "-32px 0 80px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
            padding: "1.5rem 2rem 1.25rem",
            borderBottom: "1px solid var(--ws-border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className={`ws-badge ws-badge--${badgeType}`}>{badgeType}</span>
              <time
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "0.65rem",
                  color: "var(--ws-text-mute)",
                  letterSpacing: "0.04em",
                }}
                dateTime={item.created_at || item.updated_at}
              >
                {new Date(item.updated_at || item.created_at || Date.now()).toLocaleString()}
              </time>
            </div>
            <h2
              style={{
                fontFamily: "'Syne', system-ui, sans-serif",
                fontSize: "clamp(1.1rem, 2.5vw, 1.4rem)",
                fontWeight: 800,
                color: "var(--ws-text)",
                margin: 0,
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
              }}
            >
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
              border: "1px solid var(--ws-border-2)",
              background: "var(--ws-surface-2)",
              color: "var(--ws-text)",
              fontSize: "1rem",
              fontWeight: 700,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "2rem" }}>


          {item.content && (
            <section style={{ marginBottom: "2rem" }}>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "0.65rem",
                  color: "var(--ws-accent)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  display: "block",
                  marginBottom: "0.75rem",
                }}
              >
                Full content
              </span>
              <div
                style={{
                  background: theme === "light"
                    ? "linear-gradient(180deg, #ffffff, #f1f5f9)"
                    : "linear-gradient(180deg, rgba(15, 23, 42, 0.94), rgba(15, 23, 42, 0.88))",
                  border: "1px solid var(--ws-border-2)",
                  borderRadius: "14px",
                  boxShadow: theme === "light"
                    ? "0 10px 30px rgba(15, 23, 42, 0.04)"
                    : "0 14px 42px rgba(2, 6, 23, 0.35)",
                  padding: "1.1rem 1.2rem",
                }}
              >
                <MarkdownContent content={normalizedContent} />
              </div>
            </section>
          )}

          {item.source_url && (
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="ws-btn ws-btn--ghost"
              style={{ display: "inline-flex", fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.75rem", letterSpacing: "0.04em" }}
            >
              Open original source
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function IngestPage() {
  const { activeWikiId } = useSelector((s) => s.wiki);

  return (
    <section className="workspace-page" style={{ padding: "0 1.5rem 2rem", maxWidth: 960, margin: "0 auto" }}>
      <IngestPanel wikiId={activeWikiId} />
    </section>
  );
}

export default IngestPage;

