import { useState } from "react";
import { Link, NavLink } from "react-router-dom";

function Navbar({
  variant   = "marketing",
  links     = [],
  actions   = [],
  user      = null,
  loggingOut = false,
  onLogout,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const isWorkspace = variant === "workspace";

  return (
    <header className={`app-navbar${isWorkspace ? " is-workspace" : ""}`}>
      {/* Skip-to-content for keyboard / screen-reader users */}
      <a className="skip-link" href="#main-content">Skip to content</a>

      <div className="app-navbar-inner surface-panel">
        <Link className="brand-lockup" to="/" aria-label="CortexWiki — home">
          <span className="brand-mark" aria-hidden="true">CW</span>
          <span className="brand-copy">
            CortexWiki
            <small>{isWorkspace ? "Grounded AI workspace" : "Knowledge-first AI workspace"}</small>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="nav-links" aria-label="Primary navigation">
          {links.map((item) =>
            item.href ? (
              <a key={item.label} href={item.href} className="nav-link">
                {item.label}
              </a>
            ) : (
              <NavLink
                key={item.label}
                to={item.to}
                className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}
              >
                {item.label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="nav-actions">
          {user ? (
            <>
              <div className="profile-pill" aria-label={`Signed in as ${user.full_name || user.username}`}>
                <strong>{user.full_name || user.username}</strong>
                <span>{user.email}</span>
              </div>
              <button
                type="button"
                className="button button-secondary"
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
                  className={`button ${action.kind === "secondary" ? "button-secondary" : "button-primary"}`}
                >
                  {action.label}
                </a>
              ) : (
                <Link
                  key={action.label}
                  to={action.to}
                  className={`button ${action.kind === "secondary" ? "button-secondary" : "button-primary"}`}
                >
                  {action.label}
                </Link>
              ),
            )
          )}

          {/* Mobile hamburger — CSS shows/hides this via media query */}
          {links.length > 0 && (
            <button
              type="button"
              className="nav-hamburger"
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Mobile nav drawer — visibility controlled by CSS + .is-open */}
      {links.length > 0 && (
        <nav
          id="mobile-nav"
          className={`nav-mobile${menuOpen ? " is-open" : ""}`}
          aria-label="Mobile navigation"
          aria-hidden={!menuOpen}
        >
          {links.map((item) =>
            item.href ? (
              <a
                key={item.label}
                href={item.href}
                className="nav-link"
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </a>
            ) : (
              <NavLink
                key={item.label}
                to={item.to}
                className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </NavLink>
            ),
          )}
        </nav>
      )}
    </header>
  );
}

export default Navbar;