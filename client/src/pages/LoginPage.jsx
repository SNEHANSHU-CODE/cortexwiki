import { useState, useEffect } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { clearAuthError, setAuthError, setSession, setStatus } from "../redux/slices/authSlice";
import { loginRequest } from "../utils/api";
import "./styles/Auth.css";

const FEATURES = [
  { icon: "🧠", text: "5-agent query pipeline — planner, retrieval, hallucination guard, and more" },
  { icon: "🔗", text: "Knowledge graph built from your ingested sources — Neo4j + MongoDB" },
  { icon: "📡", text: "Streaming answers via Socket.io with HTTP fallback" },
  { icon: "🛡️", text: "JWT auth — 15min access tokens, 30-day refresh tokens" },
];

function LoginPage() {
  const [form, setForm]             = useState({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw]         = useState(false);
  const dispatch  = useDispatch();
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, status, error } = useSelector((s) => s.auth);

  useEffect(() => {
    window.__hideSplash?.();
  }, []);

  if (status === "authenticated" && user) return <Navigate to="/wiki" replace />;

  const destination = location.state?.from?.pathname || "/wiki";

  const handleChange = (e) => {
    dispatch(clearAuthError());
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedEmail = form.email.trim();
    if (!trimmedEmail) {
      dispatch(setAuthError("Email address is required."));
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      dispatch(setAuthError("Please enter a valid email address."));
      return;
    }
    if (!form.password) {
      dispatch(setAuthError("Password is required."));
      return;
    }

    setSubmitting(true);
    dispatch(setStatus("loading"));
    try {
      const session = await loginRequest({
        email: trimmedEmail,
        password: form.password,
      });
      dispatch(setSession({
        user:                   session.user,
        refreshToken:           session.refresh_token,
        accessToken:            session.access_token,
        accessTokenExpiresAt:   session.expires_at ?? null,
      }));
      navigate(destination, { replace: true });
    } catch (apiError) {
      dispatch(setAuthError(
        apiError?.response?.data?.error?.message ||
        apiError?.response?.data?.message ||
        apiError?.message ||
        "Unable to sign in.",
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
          <div className="auth-side__eyebrow">Secure workspace access</div>

          <h1 className="auth-side__heading">
            AI that knows<br /><em>what you taught it.</em>
          </h1>

          <p className="auth-side__intro">
            Sign in to your knowledge base — ingested sources, grounded answers,
            and a visual concept graph, all in one place.
          </p>

          <ul className="auth-side__features" aria-label="Platform features">
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
            <span className="auth-form-side__label">Welcome back</span>
            <h2 className="auth-form-side__title">Sign in</h2>
            <p className="auth-form-side__sub">
              Continue building and exploring your knowledge graph.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
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
                disabled={submitting}
                required
              />
            </div>

            <div className="auth-field auth-field--pw">
              <label className="auth-field__label" htmlFor="password">
                <span>Password</span>
                <Link to="/forgot-password" className="auth-field__forgot">Forgot password?</Link>
              </label>
              <input
                id="password"
                name="password"
                type={showPw ? "text" : "password"}
                className="auth-field__input"
                value={form.password}
                onChange={handleChange}
                autoComplete="current-password"
                placeholder="••••••••"
                disabled={submitting}
                required
              />
              <button
                type="button"
                className="auth-field__eye"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowPw((v) => !v)}
                tabIndex={-1}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
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
              {submitting ? "Signing in…" : "Sign in →"}
            </button>

            <p className="auth-form__switch">
              New here?{" "}
              <Link to="/register">Create an account</Link>
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}

export default LoginPage;
