import { useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import IngestPanel from "../components/IngestPanel";
import MarkdownContent from "../components/MarkdownContent";
import "./styles/Ingest.css";

export function NoteDrawer({ item, onClose }) {
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
    .replace(/\s+(\d+\.\s+)/g, "\n$1")
    .replace(/\s+([*-]\s+)/g, "\n$1")
    .replace(/\s+(Overview|Key Components|Benefits|Setting Up[^:]*|Define a Note)\s*/gi, "\n\n$1\n")
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
        background: "rgba(10, 15, 30, 0.85)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-end",
      }}
    >
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "#111827",
          borderLeft: "1px solid rgba(148,163,184,0.12)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "-32px 0 80px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
            padding: "1.5rem 2rem 1.25rem",
            borderBottom: "1px solid rgba(148,163,184,0.08)",
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
                  color: "#475569",
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
                color: "#f8fafc",
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
              border: "1px solid rgba(226,232,240,0.38)",
              background: "rgba(15,23,42,0.92)",
              color: "#f8fafc",
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
          <section style={{ marginBottom: "2rem" }}>
            <span
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "0.65rem",
                color: "#38bdf8",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                display: "block",
                marginBottom: "0.75rem",
              }}
            >
              Summary
            </span>
            <p
              style={{
                fontFamily: "'DM Sans', system-ui, sans-serif",
                fontSize: "0.95rem",
                color: "#cbd5e1",
                lineHeight: 1.8,
                margin: 0,
                fontWeight: 300,
              }}
            >
              {item.summary || item.description || "No summary available."}
            </p>
          </section>

          {item.content && (
            <section style={{ marginBottom: "2rem" }}>
              <span
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "0.65rem",
                  color: "#38bdf8",
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
                  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.94), rgba(15, 23, 42, 0.88))",
                  border: "1px solid rgba(148, 163, 184, 0.14)",
                  borderRadius: "14px",
                  boxShadow: "0 14px 42px rgba(2, 6, 23, 0.35)",
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

