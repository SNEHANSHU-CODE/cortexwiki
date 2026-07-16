import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, Link } from "react-router-dom";
import { fetchPublicWikiBySlug, likePublicWiki, recordPublicWikiVisit } from "../utils/api";
import MarkdownContent from "../components/MarkdownContent";
import NotePrintTemplate from "../components/NotePrintTemplate";

import "./styles/WikiDashboard.css"; // Reuse dashboard styles

function PublicWikiPage() {
  const { slug } = useParams();
  const [wiki, setWiki] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [localLikes, setLocalLikes] = useState(0);
  const [hasLiked, setHasLiked] = useState(() => localStorage.getItem(`liked_${slug}`) === "true");
  const [isNativePrinting, setIsNativePrinting] = useState(false);
  const printRef = useRef(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setStatus("loading");
        const data = await fetchPublicWikiBySlug(slug);
        if (active) {
          setWiki(data);
          setLocalLikes(data.likes || 0);
          setStatus("succeeded");

          // Only record visit once per session to prevent StrictMode double-count
          if (!sessionStorage.getItem(`visited_${slug}`)) {
            sessionStorage.setItem(`visited_${slug}`, "true");
            recordPublicWikiVisit(slug).catch(console.error);
          }
        }
      } catch (err) {
        if (active) {
          setError(err.response?.data?.error?.message || "Wiki not found or is private.");
          setStatus("failed");
        }
      }
    };
    load();
    return () => { active = false; };
  }, [slug]);

  if (status === "loading") {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", color: "var(--ws-text-mute)" }}>
        Loading public wiki...
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "100vh", color: "var(--ws-text-danger)" }}>
        <h2>{error}</h2>
        <Link to="/" style={{ color: "var(--ws-text-base)", textDecoration: "underline", marginTop: "1rem" }}>Back to Directory</Link>
      </div>
    );
  }

  const rawNote = wiki?.master_note || "";
  const hasNote = rawNote.trim().length > 0;
  const formattedNote = hasNote
    ? (rawNote.includes("\n")
        ? rawNote
        : rawNote
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
            .trim())
    : "";

  const handleLike = async () => {
    if (hasLiked || localStorage.getItem(`liked_${slug}`)) return;
    try {
      setHasLiked(true);
      localStorage.setItem(`liked_${slug}`, "true");
      setLocalLikes((prev) => prev + 1);
      await likePublicWiki(slug);
    } catch (err) {
      console.error("Failed to like wiki", err);
      // Revert optimistic update
      setHasLiked(false);
      localStorage.removeItem(`liked_${slug}`);
      setLocalLikes((prev) => prev - 1);
    }
  };

  const handlePrint = async () => {
    const safeTitle = `${wiki?.name || "Wiki"}-Note`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const orig = document.title;
    
    document.title = safeTitle;
    if (isMounted.current) setIsNativePrinting(true);
    
    await new Promise(r => setTimeout(r, 150));
    
    try {
      window.print();
    } finally {
      if (isMounted.current) setIsNativePrinting(false);
      setTimeout(() => {
        document.title = orig || "CortexWiki";
      }, 500);
    }
  };

  return (
    <div className="cw-dashboard" style={{ height: "calc(100dvh - 64px)", width: "100%", overflow: "hidden", display: "flex" }}>
      <div className="cw-dashboard__right" style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
        <div className="cw-rightbar" style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span className="cw-rightbar__title">{wiki?.name} (Public)</span>
          </div>
          <div className="cw-rightbar__actions" style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", fontSize: "0.9rem", color: "var(--ws-text-mute)", gap: "0.5rem" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <span>{wiki?.visits || 0} visits</span>
            </div>
            
            <button 
              type="button" 
              className={`ws-btn ${hasLiked ? 'ws-btn--primary' : 'ws-btn--ghost'}`}
              onClick={handleLike}
              disabled={hasLiked}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill={hasLiked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "0.5rem" }}>
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
              {localLikes} Like{localLikes !== 1 && 's'}
            </button>

            <button
              className="ws-btn ws-btn--ghost"
              onClick={handlePrint}
              style={{ padding: "0.4rem 0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}
              title="Print / Save as PDF"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
              Print
            </button>
            <Link to="/directory" className="ws-btn ws-btn--ghost" style={{ textDecoration: "none" }}>
              Back to Public Directory
            </Link>
          </div>
        </div>

        <div className="cw-note-content" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingBottom: "4rem" }}>
          {hasNote ? (
            <div className="cw-note-paper">
              <MarkdownContent content={formattedNote} />
            </div>
          ) : (
            <div className="cw-note-empty">
              <span className="cw-note-empty__icon">Note</span>
              <h3>No content</h3>
              <p>This public wiki has no compiled content yet.</p>
            </div>
          )}
        </div>
      </div>
      {isNativePrinting && createPortal(
        <div className="native-print-overlay">
          <NotePrintTemplate 
            ref={printRef} 
            title={wiki?.name || "Wiki"} 
            content={formattedNote} 
            date={wiki?.updated_at || new Date().toISOString()} 
          />
        </div>,
        document.body
      )}
    </div>
  );
}

export default PublicWikiPage;
