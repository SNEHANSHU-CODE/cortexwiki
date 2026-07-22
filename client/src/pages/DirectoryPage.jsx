import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { fetchPublicWikis } from "../utils/api";
import "./styles/DirectoryPage.css";

function DirectoryPage() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);
  const [wikis, setWikis] = useState([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [status, setStatus] = useState("loading");
  const [isRefreshing, setIsRefreshing] = useState(false); // BUG-H4 FIX: track in-flight refresh separately
  const limit = 20;
  const navigate = useNavigate();

  const loadWikis = async (query = "", currentSkip = 0, currentSort = "newest") => {
    try {
      setStatus("loading");
      // BUG-H4 FIX: flag a refresh when stale results are already visible
      if (wikis.length > 0) setIsRefreshing(true);
      const data = await fetchPublicWikis(query, currentSkip, limit, currentSort);
      setWikis(data.wikis || []);
      setTotal(data.total || 0);
      setStatus("succeeded");
    } catch (err) {
      console.error("Failed to load public wikis", err);
      setStatus("failed");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sortRef.current && !sortRef.current.contains(event.target)) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSkip(0);
      loadWikis(search, 0, sortBy);
    }, 400);
    return () => clearTimeout(timer);
  }, [search, sortBy]);

  const handleNext = () => {
    setSkip((prevSkip) => {
      if (prevSkip + limit < total) {
        const nextSkip = prevSkip + limit;
        loadWikis(search, nextSkip, sortBy);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return nextSkip;
      }
      return prevSkip;
    });
  };

  const handlePrev = () => {
    setSkip((prevSkip) => {
      if (prevSkip > 0) {
        const newSkip = Math.max(0, prevSkip - limit);
        loadWikis(search, newSkip, sortBy);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return newSkip;
      }
      return prevSkip;
    });
  };

  return (
    <div className="cw-directory-page">
      <header className="cw-directory__hero">
        <div className="cw-directory__ambient"></div>
        <h1 className="cw-directory__title">Explore the Directory</h1>
        <p className="cw-directory__subtitle">
          Discover a world of public knowledge. Browse highly curated, interconnected wikis shared by the global community.
        </p>
        
        <div className="cw-directory__controls-wrapper">
          <div className="cw-directory__search-wrapper">
            <input
              type="text"
              className="cw-directory__search-input"
              placeholder="Search wikis by topic, keywords, or concepts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <svg className="cw-directory__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>

          <div className="cw-directory__sort-wrapper" ref={sortRef}>
            <button 
              className="cw-directory__sort-trigger"
              onClick={() => setSortOpen(!sortOpen)}
            >
              {sortBy === "newest" ? "Newest" : 
               sortBy === "popular" ? "Most Popular" : 
               sortBy === "likes" ? "Most Liked" : "Most Relevant"}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`cw-directory__sort-chevron ${sortOpen ? 'open' : ''}`}>
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            
            {sortOpen && (
              <div className="cw-directory__sort-menu">
                <button className={`cw-directory__sort-option ${sortBy === 'newest' ? 'active' : ''}`} onClick={() => { setSortBy('newest'); setSortOpen(false); }}>Newest</button>
                <button className={`cw-directory__sort-option ${sortBy === 'popular' ? 'active' : ''}`} onClick={() => { setSortBy('popular'); setSortOpen(false); }}>Most Popular</button>
                <button className={`cw-directory__sort-option ${sortBy === 'likes' ? 'active' : ''}`} onClick={() => { setSortBy('likes'); setSortOpen(false); }}>Most Liked</button>
                {search.trim().length > 0 && (
                  <button className={`cw-directory__sort-option ${sortBy === 'relevant' ? 'active' : ''}`} onClick={() => { setSortBy('relevant'); setSortOpen(false); }}>Most Relevant</button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="cw-directory__main">
        {status === "loading" && wikis.length === 0 ? (
          <div className="cw-directory__grid">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="cw-skeleton-card" />
            ))}
          </div>
        ) : status === "failed" ? (
          <div style={{ textAlign: "center", color: "#ef4444", padding: "4rem" }}>
            Failed to load public directory. Please try again later.
          </div>
        ) : wikis.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--ws-text-mute)", padding: "6rem 0" }}>
            <svg style={{ width: "64px", height: "64px", opacity: 0.5, marginBottom: "1rem" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
            <h3 style={{ fontSize: "1.5rem", fontWeight: 600, color: "var(--ws-text)", marginBottom: "0.5rem" }}>No wikis found</h3>
            <p style={{ fontSize: "1rem" }}>Try adjusting your search terms or exploring a different topic.</p>
          </div>
        ) : (
          <>
            {/* BUG-H4 FIX: overlay spinner while refreshing over stale results */}
            {isRefreshing && (
              <div style={{
                position: "fixed", top: "50%", left: "50%",
                transform: "translate(-50%, -50%)",
                background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
                borderRadius: "12px", padding: "1.25rem 2rem",
                color: "var(--ws-text-mute)", fontSize: "0.9rem",
                zIndex: 100, pointerEvents: "none",
              }}>
                Updating…
              </div>
            )}
            <div className="cw-directory__grid">
              {wikis.map((wiki, index) => (
                <article 
                  key={wiki.id} 
                  className="cw-directory__card"
                  style={{ animationDelay: `${index * 0.05}s` }}
                  onClick={() => navigate(`/share/${wiki.slug}`)}
                >
                  <h3 className="cw-card__title" title={wiki.name}>{wiki.name}</h3>
                  <p className="cw-card__desc" title={wiki.description}>
                    {wiki.description || wiki.master_note_excerpt || "No description provided."}
                  </p>
                  <div className="cw-card__footer">
                    <div className="cw-card__stats">
                      <span className="cw-card__meta-pill" title={`${wiki.source_count} sources`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                          <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        {wiki.source_count}
                      </span>
                      <span className="cw-card__meta-pill" title={`${wiki.visits || 0} visits`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        {wiki.visits || 0}
                      </span>
                      <span className="cw-card__meta-pill" title={`${wiki.likes || 0} likes`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                        </svg>
                        {wiki.likes || 0}
                      </span>
                      <span className="cw-card__meta-pill cw-card__meta-date" title="Last updated">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"></circle>
                          <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        {new Date(wiki.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <button
                      className="cw-card__share-btn"
                      title="Copy Share Link"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(`${window.location.origin}/share/${wiki.slug}`);
                        const svgHtml = e.currentTarget.innerHTML;
                        e.currentTarget.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                        setTimeout(() => { if(e.target) e.currentTarget.innerHTML = svgHtml; }, 2000);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="18" cy="5" r="3"></circle>
                        <circle cx="6" cy="12" r="3"></circle>
                        <circle cx="18" cy="19" r="3"></circle>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                      </svg>
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {(skip > 0 || skip + limit < total) && (
              <div className="cw-directory__pagination">
                <button 
                  className="cw-directory__page-btn" 
                  onClick={handlePrev} 
                  disabled={skip === 0}
                >
                  ← Previous
                </button>
                <span className="cw-directory__page-info">
                  Showing {skip + 1} to {Math.min(skip + limit, total)} of {total}
                </span>
                <button 
                  className="cw-directory__page-btn" 
                  onClick={handleNext} 
                  disabled={skip + limit >= total}
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default DirectoryPage;
