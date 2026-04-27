import "./styles/Navbar.css";
import { useState, useEffect, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

function Navbar({
  links       = [],
  actions     = [],
  user        = null,
  loggingOut  = false,
  onLogout,
  transparent = false,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navRef   = useRef(null);
  const location = useLocation();

  // Close drawer on route change
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // Transparent → solid on scroll (landing only)
  useEffect(() => {
    if (!transparent) return;
    const handler = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [transparent]);

  // Close drawer on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const isSolid    = !transparent || scrolled;
  const hasLinks   = links.length > 0;

  return (
    <header
      ref={navRef}
      className={[
        "cw-navbar",
        isSolid  ? "cw-navbar--solid"    : "cw-navbar--transparent",
        menuOpen ? "cw-navbar--open"     : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="cw-navbar__inner">

        {/* ── Brand ──────────────────────────────────────────────────── */}
        <Link to="/" className="cw-navbar__brand" aria-label="CortexWiki home">
          <span className="cw-navbar__mark" aria-hidden="true">CW</span>
          <span className="cw-navbar__name">
            CortexWiki
            <small>{user ? "Grounded AI workspace" : "Knowledge-first AI workspace"}</small>
          </span>
        </Link>

        {/* ── Desktop nav links ───────────────────────────────────────── */}
        {hasLinks && (
          <nav className="cw-navbar__links" aria-label="Primary navigation">
            {links.map((item) =>
              item.href ? (
                <a key={item.label} href={item.href} className="cw-navbar__link">
                  {item.label}
                </a>
              ) : (
                <NavLink
                  key={item.label}
                  to={item.to}
                  className={({ isActive }) =>
                    `cw-navbar__link${isActive ? " cw-navbar__link--active" : ""}`
                  }
                >
                  {item.label}
                </NavLink>
              ),
            )}
          </nav>
        )}

        {/* ── Right side ─────────────────────────────────────────────── */}
        <div className="cw-navbar__actions">
          {user ? (
            <>
              <span className="cw-navbar__profile">
                {user.full_name || user.username}
              </span>
              <button
                type="button"
                className="cw-btn cw-btn--ghost"
                onClick={onLogout}
                disabled={loggingOut}
                aria-busy={loggingOut}
              >
                {loggingOut ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            actions.map((action) =>
              action.href ? (
                <a
                  key={action.label}
                  href={action.href}
                  className={`cw-btn cw-btn--${action.kind === "primary" ? "primary" : "ghost"}`}
                >
                  {action.label}
                </a>
              ) : (
                <Link
                  key={action.label}
                  to={action.to}
                  className={`cw-btn cw-btn--${action.kind === "primary" ? "primary" : "ghost"}`}
                >
                  {action.label}
                </Link>
              ),
            )
          )}

          {/* Hamburger — only shown on mobile via CSS */}
          {hasLinks && (
            <button
              type="button"
              className="cw-navbar__hamburger"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="cw-mobile-nav"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span />
              <span />
              <span />
            </button>
          )}
        </div>
      </div>

      {/* ── Mobile drawer — hidden via CSS when not open ─────────────── */}
      {hasLinks && (
        <nav
          id="cw-mobile-nav"
          className={`cw-navbar__drawer${menuOpen ? " cw-navbar__drawer--open" : ""}`}
          aria-label="Mobile navigation"
          aria-hidden={!menuOpen}
        >
          {links.map((item) =>
            item.href ? (
              <a
                key={item.label}
                href={item.href}
                className="cw-navbar__link"
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </a>
            ) : (
              <NavLink
                key={item.label}
                to={item.to}
                className={({ isActive }) =>
                  `cw-navbar__link${isActive ? " cw-navbar__link--active" : ""}`
                }
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </NavLink>
            ),
          )}
          {user && (
            <div className="cw-navbar__drawer-profile">
              <strong>{user.full_name || user.username}</strong>
              <span>{user.email}</span>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}

export default Navbar;