import { useEffect, useRef, useState } from "react";
import DeleteAccountModal from "./DeleteAccountModal";
import httpClient from "../services/http";
import "./styles/UsageDropdown.css";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function pct(used, limit) {
  return Math.min(100, limit > 0 ? Math.round((used / limit) * 100) : 0);
}

// Returns CSS class for bar color: green → amber → red
function barColor(percent) {
  if (percent >= 90) return "usage-bar__fill--danger";
  if (percent >= 70) return "usage-bar__fill--warn";
  return "usage-bar__fill--ok";
}

function UsageBar({ label, used, limit }) {
  const p = pct(used, limit);
  return (
    <div className="usage-bar">
      <div className="usage-bar__header">
        <span className="usage-bar__label">{label}</span>
        <span className="usage-bar__value">
          {fmt(used)} <span className="usage-bar__sep">/</span> {fmt(limit)}
        </span>
      </div>
      <div className="usage-bar__track" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit} aria-label={label}>
        <div
          className={`usage-bar__fill ${barColor(p)}`}
          style={{ width: `${p}%` }}
        />
      </div>
      <span className="usage-bar__pct">{p}% used</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

function UsageDropdown({ user, onLogout }) {
  const [open, setOpen]             = useState(false);
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const dropdownRef                 = useRef(null);

  // Fetch usage when dropdown opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const fetchUsage = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: d } = await httpClient.get("/api/auth/me/usage");
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setError("Could not load usage.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchUsage();
    return () => { cancelled = true; };
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const displayName = user?.full_name || user?.username || "Account";

  return (
    <>
      {showDeleteModal && (
        <DeleteAccountModal
          onClose={() => setShowDeleteModal(false)}
          onLogout={onLogout}
        />
      )}

      <div className="usage-dropdown" ref={dropdownRef}>
      {/* Trigger — clickable username chip */}
      <button
        type="button"
        className={`usage-dropdown__trigger${open ? " usage-dropdown__trigger--active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="View token usage"
      >
        <span className="usage-dropdown__avatar" aria-hidden="true">
          {displayName.charAt(0).toUpperCase()}
        </span>
        <span className="usage-dropdown__name">{displayName}</span>
        <svg
          className={`usage-dropdown__chevron${open ? " usage-dropdown__chevron--up" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Panel */}
      {open && (
        <div className="usage-dropdown__panel" role="dialog" aria-label="Daily token usage">
          <div className="usage-dropdown__header">
            <span className="usage-dropdown__title">Daily Token Usage</span>
            <span className="usage-dropdown__reset">Resets at midnight</span>
          </div>

          <div className="usage-dropdown__body">
            {loading && !data && (
              <div className="usage-dropdown__state">
                <div className="usage-skeleton" />
                <div className="usage-skeleton usage-skeleton--short" />
              </div>
            )}

            {error && !data && (
              <div className="usage-dropdown__state usage-dropdown__error">
                {error}
              </div>
            )}

            {data && (
              <div style={{ opacity: loading ? 0.6 : 1 }}>
                <UsageBar
                  label="Input Tokens"
                  used={data.daily_input_tokens_used}
                  limit={data.daily_input_limit}
                />
                <UsageBar
                  label="Output Tokens"
                  used={data.daily_output_tokens_used}
                  limit={data.daily_output_limit}
                />
              </div>
            )}
          </div>
          <div className="usage-dropdown__footer">
            <button
              type="button"
              className="usage-dropdown__delete-btn"
              onClick={() => { setOpen(false); setShowDeleteModal(true); }}
            >
              Delete Account
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

export default UsageDropdown;
