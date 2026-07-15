import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import httpClient from "../services/http";
import "./styles/DeleteAccountModal.css";

function EyeIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DeleteAccountModal({ onClose, onLogout }) {
  const [password, setPassword]   = useState("");
  const [showPw, setShowPw]       = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [error, setError]         = useState("");
  const inputRef                  = useRef(null);

  // Focus password input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll while modal open
  useEffect(() => {
    const originalStyle = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = originalStyle; };
  }, []);

  const handleDelete = async (e) => {
    e.preventDefault();
    if (!password) { setError("Please enter your password."); return; }
    setDeleting(true);
    setError("");
    try {
      await httpClient.delete("/api/auth/me", { data: { password } });
      if (onLogout) await onLogout();
      else window.location.href = "/";
    } catch (err) {
      setError(
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        "Incorrect password. Please try again.",
      );
      setDeleting(false);
    }
  };

  return createPortal(
    /* Backdrop */
    <div className="dam-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="dam-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dam-title"
        aria-describedby="dam-desc"
      >
        {/* ── Header ── */}
        <div className="dam-header">
          <div className="dam-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </div>
          <h2 className="dam-title" id="dam-title">Delete Account</h2>
        </div>

        {/* ── Warning ── */}
        <p className="dam-desc" id="dam-desc">
          This will permanently delete your account and{" "}
          <strong>all associated data</strong> — wikis, knowledge graphs, chat
          history, and ingested sources. This action cannot be undone.
        </p>

        {/* ── Password form ── */}
        <form className="dam-form" onSubmit={handleDelete}>
          <div className="dam-field">
            <label className="dam-field__label" htmlFor="dam-password">
              Confirm with your password
            </label>
            <div className="dam-field__wrap">
              <input
                ref={inputRef}
                id="dam-password"
                type={showPw ? "text" : "password"}
                className="dam-field__input"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="••••••••"
                disabled={deleting}
                autoComplete="current-password"
                required
                minLength={8}
              />
              <button
                type="button"
                className="dam-field__eye"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowPw((v) => !v)}
                tabIndex={-1}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                <EyeIcon visible={showPw} />
              </button>
            </div>
          </div>

          {error && (
            <div className="dam-error" role="alert">{error}</div>
          )}

          <div className="dam-actions">
            <button
              type="button"
              className="dam-btn dam-btn--cancel"
              onClick={onClose}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="dam-btn dam-btn--delete"
              disabled={deleting || !password}
              aria-busy={deleting}
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

export default DeleteAccountModal;
