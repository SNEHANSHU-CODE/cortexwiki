import { useState, useEffect } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { clearAuthError, setAuthError, setSession, setStatus } from "../redux/slices/authSlice";
import { sendOtpRequest, verifyOtpRequest } from "../utils/api";
import OtpVerify from "../components/OtpVerify";
import "./styles/Auth.css";

const FEATURES = [
  { icon: "⚡", text: "Ingest YouTube videos and web pages into structured knowledge" },
  { icon: "🕸️", text: "Automatically extract concepts and map relationships as a graph" },
  { icon: "🎯", text: "Ask grounded questions — every answer traced back to a source" },
  { icon: "📊", text: "Confidence scoring per response — deterministic, not vibes" },
];

function RegisterPage() {
  const [step, setStep]             = useState(1); // 1 = form, 2 = OTP
  const [form, setForm]             = useState({ full_name: "", username: "", email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw]         = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError]     = useState(null);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user, status, error } = useSelector((s) => s.auth);

  useEffect(() => {
    window.__hideSplash?.();
  }, []);

  if (status === "authenticated" && user) return <Navigate to="/wiki" replace />;

  const handleChange = (e) => {
    dispatch(clearAuthError());
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  // ── Step 1: validate form & send OTP ──────────────────────────────────
  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    const trimmedUsername = form.username.trim();
    if (!trimmedUsername) { dispatch(setAuthError("Username is required.")); return; }
    if (trimmedUsername.length < 3) { dispatch(setAuthError("Username must be at least 3 characters long.")); return; }
    const trimmedEmail = form.email.trim();
    if (!trimmedEmail) { dispatch(setAuthError("Email address is required.")); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) { dispatch(setAuthError("Please enter a valid email address.")); return; }
    if (!form.password) { dispatch(setAuthError("Password is required.")); return; }
    if (form.password.length < 8) { dispatch(setAuthError("Password must be at least 8 characters long.")); return; }

    setSubmitting(true);
    dispatch(setStatus("loading"));
    try {
      await sendOtpRequest({
        email: trimmedEmail,
        purpose: "register",
        name: form.full_name.trim() || trimmedUsername,
      });
      dispatch(clearAuthError());
      setStep(2);
    } catch (apiError) {
      dispatch(setAuthError(
        apiError?.response?.data?.error?.message ||
        apiError?.response?.data?.message ||
        apiError?.message ||
        "Unable to send verification code.",
      ));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 2: verify OTP & create account ──────────────────────────────
  const handleOtpVerify = async (otp) => {
    setOtpLoading(true);
    setOtpError(null);
    try {
      const session = await verifyOtpRequest({
        email:     form.email.trim(),
        otp,
        purpose:   "register",
        username:  form.username.trim(),
        full_name: form.full_name.trim(),
        password:  form.password,
      });
      dispatch(setSession({
        user:                 session.user,
        refreshToken:         session.refresh_token,
        accessToken:          session.access_token,
        accessTokenExpiresAt: session.expires_at ?? null,
      }));
      navigate("/wiki", { replace: true });
    } catch (apiError) {
      setOtpError(
        apiError?.response?.data?.error?.message ||
        apiError?.response?.data?.message ||
        apiError?.message ||
        "Invalid or expired code. Please try again.",
      );
    } finally {
      setOtpLoading(false);
    }
  };

  // ── Step 2: resend OTP ────────────────────────────────────────────────
  const handleOtpResend = async () => {
    setOtpError(null);
    try {
      await sendOtpRequest({
        email: form.email.trim(),
        purpose: "register",
        name: form.full_name.trim() || form.username.trim(),
      });
    } catch {
      setOtpError("Failed to resend code. Please try again.");
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
          {step === 1 ? (
            <>
              <div className="auth-form-side__header">
                <span className="auth-form-side__label">Get started</span>
                <h2 className="auth-form-side__title">Create account</h2>
                <p className="auth-form-side__sub">
                  Set up your workspace and start ingesting knowledge.
                </p>
              </div>

              <form className="auth-form" onSubmit={handleFormSubmit} noValidate>
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
                    disabled={submitting}
                  />
                </div>

                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="username">
                    Username <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(required)</span>
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
                    disabled={submitting}
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
                    disabled={submitting}
                    required
                  />
                </div>

                <div className="auth-field auth-field--pw">
                  <label className="auth-field__label" htmlFor="password">
                    Password <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(min 8 chars)</span>
                  </label>
                  <input
                    id="password"
                    name="password"
                    type={showPw ? "text" : "password"}
                    className="auth-field__input"
                    value={form.password}
                    onChange={handleChange}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    disabled={submitting}
                    minLength={8}
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
                  {submitting ? "Sending code…" : "Continue →"}
                </button>

                <p className="auth-form__switch">
                  Already registered?{" "}
                  <Link to="/login">Sign in</Link>
                </p>
              </form>
            </>
          ) : (
            <>
              <div className="auth-form-side__header">
                <span className="auth-form-side__label">Verify your email</span>
                <h2 className="auth-form-side__title">Check your inbox</h2>
                <p className="auth-form-side__sub">
                  Enter the 6-digit code we sent to complete registration.
                </p>
              </div>

              <OtpVerify
                email={form.email.trim()}
                onVerify={handleOtpVerify}
                onResend={handleOtpResend}
                loading={otpLoading}
                error={otpError}
              />

              <p className="auth-form__switch" style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#38bdf8", fontWeight: 600, fontSize: "0.82rem", fontFamily: "inherit", padding: 0 }}
                  onClick={() => { setStep(1); dispatch(clearAuthError()); setOtpError(null); }}
                >
                  ← Back to form
                </button>
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default RegisterPage;
