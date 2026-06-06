import "./styles/Navbar.css";
import { useState, useEffect, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useTheme } from "../hooks/useTheme";

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
  const { theme, toggleTheme } = useTheme();

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
          <button
            type="button"
            className="cw-theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? (
              <svg className="cw-theme-toggle__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg className="cw-theme-toggle__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>

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