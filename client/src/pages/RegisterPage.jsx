import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { clearAuthError, setAuthError, setSession, setStatus } from "../redux/slices/authSlice";
import { registerRequest } from "../utils/api";
import "./styles/Auth.css";

const FEATURES = [
  { icon: "⚡", text: "Ingest YouTube videos and web pages into structured knowledge" },
  { icon: "🕸️", text: "Automatically extract concepts and map relationships as a graph" },
  { icon: "🎯", text: "Ask grounded questions — every answer traced back to a source" },
  { icon: "📊", text: "Confidence scoring per response — deterministic, not vibes" },
];

function RegisterPage() {
  const [form, setForm]             = useState({ full_name: "", username: "", email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { accessToken, error } = useSelector((s) => s.auth);

  if (accessToken) return <Navigate to="/chat" replace />;

  const handleChange = (e) => {
    dispatch(clearAuthError());
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    dispatch(setStatus("loading"));
    try {
      const session = await registerRequest(form);
      dispatch(setSession({
        accessToken: session.access_token,
        user:        session.user,
        expiresAt:   session.expires_at ?? null,
      }));
      navigate("/chat", { replace: true });
    } catch (apiError) {
      dispatch(setAuthError(
        apiError?.response?.data?.error?.message ||
        apiError?.response?.data?.message ||
        apiError?.message ||
        "Unable to create account.",
      ));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Ambient background */}
      <div className="auth-page__orb auth-page__orb--a" aria-hidden="true" />
      <div className="auth-page__orb auth-page__orb--b" aria-hidden="true" />
      <div className="auth-page__grid"                  aria-hidden="true" />

      <div className="auth-layout">
        {/* ── Left: brand panel ────────────────────────────────────────── */}
        <aside className="auth-side">
          <div className="auth-side__eyebrow">Start for free</div>

          <h1 className="auth-side__heading">
            Build knowledge<br /><em>that compounds.</em>
          </h1>

          <p className="auth-side__intro">
            One workspace. Ingest sources, explore the graph, ask grounded
            questions. Every session makes the next one smarter.
          </p>

          <ul className="auth-side__features" aria-label="What you get">
            {FEATURES.map((f) => (
              <li key={f.text} className="auth-side__feature">
                <span className="auth-side__feature-icon" aria-hidden="true">{f.icon}</span>
                {f.text}
              </li>
            ))}
          </ul>

          <div className="auth-side__stat-row" aria-label="Platform stats">
            <div className="auth-side__stat">
              <span className="auth-side__stat-num">5</span>
              <span className="auth-side__stat-label">Agents</span>
            </div>
            <div className="auth-side__stat">
              <span className="auth-side__stat-num">96%</span>
              <span className="auth-side__stat-label">Max conf.</span>
            </div>
            <div className="auth-side__stat">
              <span className="auth-side__stat-num">2</span>
              <span className="auth-side__stat-label">LLM fallbacks</span>
            </div>
          </div>
        </aside>

        {/* ── Right: form panel ─────────────────────────────────────────── */}
        <section className="auth-form-side">
          <div className="auth-form-side__header">
            <span className="auth-form-side__label">Get started</span>
            <h2 className="auth-form-side__title">Create account</h2>
            <p className="auth-form-side__sub">
              Set up your workspace and start ingesting knowledge.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="auth-field">
              <label className="auth-field__label" htmlFor="full_name">Full name</label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                className="auth-field__input"
                value={form.full_name}
                onChange={handleChange}
                autoComplete="name"
                placeholder="Jane Smith"
              />
            </div>

            <div className="auth-field">
              <label className="auth-field__label" htmlFor="username">
                Username <span style={{ color: "#334155", fontWeight: 400 }}>(required)</span>
              </label>
              <input
                id="username"
                name="username"
                type="text"
                className="auth-field__input"
                value={form.username}
                onChange={handleChange}
                autoComplete="username"
                placeholder="janesmith"
                minLength={3}
                required
              />
            </div>

            <div className="auth-field">
              <label className="auth-field__label" htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                className="auth-field__input"
                value={form.email}
                onChange={handleChange}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="auth-field">
              <label className="auth-field__label" htmlFor="password">
                Password <span style={{ color: "#334155", fontWeight: 400 }}>(min 8 chars)</span>
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className="auth-field__input"
                value={form.password}
                onChange={handleChange}
                autoComplete="new-password"
                placeholder="••••••••"
                minLength={8}
                required
              />
            </div>

            {error && (
              <div className="auth-error" role="alert">{error}</div>
            )}

            <button
              type="submit"
              className="auth-submit-btn"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? "Creating account…" : "Create account →"}
            </button>

            <p className="auth-form__switch">
              Already registered?{" "}
              <Link to="/login">Sign in</Link>
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}

export default RegisterPage;