import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import Navbar from "../components/Navbar";
import { clearAuthError, setAuthError, setSession, setStatus } from "../redux/slices/authSlice";
import { loginRequest } from "../utils/api";

function LoginPage() {
  const [form, setForm]           = useState({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const dispatch  = useDispatch();
  const navigate  = useNavigate();
  const location  = useLocation();
  const { accessToken, error } = useSelector((s) => s.auth);

  // Already authenticated — redirect immediately.
  if (accessToken) {
    return <Navigate to="/chat" replace />;
  }

  const destination = location.state?.from?.pathname || "/chat";

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
      const session = await loginRequest(form);
      dispatch(
        setSession({
          accessToken: session.access_token,
          user:        session.user,
          expiresAt:   session.expires_at ?? null,
        }),
      );
      navigate(destination, { replace: true });
    } catch (apiError) {
      const msg =
        apiError?.response?.data?.error?.message ||
        apiError?.response?.data?.message ||
        apiError?.message ||
        "Unable to sign in.";
      dispatch(setAuthError(msg));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <Navbar
        variant="marketing"
        links={[
          { href: "/#features", label: "Features" },
          { href: "/#workflow", label: "Workflow" },
          { href: "/#preview",  label: "Preview" },
        ]}
        actions={[{ to: "/register", label: "Create account", kind: "secondary" }]}
      />

      <section className="auth-layout">
        <article className="auth-side-panel surface-panel">
          <span className="eyebrow">Secure access</span>
          <h1>Sign in to your knowledge workspace</h1>
          <p className="auth-intro">
            Move from raw sources to structured understanding with one workspace
            for ingestion, grounded chat, and graph exploration.
          </p>
          <ul className="auth-highlights">
            <li>JWT auth with refresh cookies</li>
            <li>Grounded answers from ingested knowledge</li>
            <li>Visual graph exploration for concepts and relationships</li>
          </ul>
        </article>

        <section className="auth-card surface-panel">
          <div className="auth-copy">
            <span className="eyebrow">Welcome back</span>
            <h2>Sign in</h2>
            <p>Use your account to continue building and exploring your knowledge graph.</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <label className="field-label" htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              className="text-input"
              value={form.email}
              onChange={handleChange}
              autoComplete="email"
              required
            />

            <label className="field-label" htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              className="text-input"
              value={form.password}
              onChange={handleChange}
              autoComplete="current-password"
              minLength={8}
              required
            />

            {error && (
              <div className="status-banner is-error" role="alert">{error}</div>
            )}

            <button
              type="submit"
              className="button button-primary button-block auth-submit"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>

            <p className="auth-switch">
              New here? <Link to="/register">Create an account</Link>
            </p>
          </form>
        </section>
      </section>
    </main>
  );
}

export default LoginPage;