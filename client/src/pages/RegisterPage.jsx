import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import Navbar from "../components/Navbar";
import { clearAuthError, setAuthError, setSession, setStatus } from "../redux/slices/authSlice";
import { registerRequest } from "../utils/api";

function RegisterPage() {
  const [form, setForm]             = useState({ full_name: "", username: "", email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { accessToken, error } = useSelector((s) => s.auth);

  if (accessToken) {
    return <Navigate to="/chat" replace />;
  }

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
      dispatch(
        setSession({
          accessToken: session.access_token,
          user:        session.user,
          expiresAt:   session.expires_at ?? null,
        }),
      );
      navigate("/chat", { replace: true });
    } catch (apiError) {
      const msg =
        apiError?.response?.data?.error?.message ||
        apiError?.response?.data?.message ||
        apiError?.message ||
        "Unable to create account.";
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
        actions={[{ to: "/login", label: "Sign in", kind: "secondary" }]}
      />

      <section className="auth-layout">
        <article className="auth-side-panel surface-panel">
          <span className="eyebrow">Production-ready onboarding</span>
          <h1>Create your CortexWiki workspace</h1>
          <p className="auth-intro">
            Register once, ingest trusted sources, and turn scattered content
            into a searchable knowledge system with a visual graph layer.
          </p>
          <ul className="auth-highlights">
            <li>Bring in YouTube videos and web pages</li>
            <li>Automatically structure concepts and relationships</li>
            <li>Ask grounded questions against your own knowledge base</li>
          </ul>
        </article>

        <section className="auth-card surface-panel">
          <div className="auth-copy">
            <span className="eyebrow">Get started</span>
            <h2>Create account</h2>
            <p>Set up your account and step straight into the workspace.</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <label className="field-label" htmlFor="full_name">Full name</label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              className="text-input"
              value={form.full_name}
              onChange={handleChange}
              autoComplete="name"
            />

            <label className="field-label" htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              className="text-input"
              value={form.username}
              onChange={handleChange}
              autoComplete="username"
              minLength={3}
              required
            />

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
              autoComplete="new-password"
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
              {submitting ? "Creating account…" : "Create account"}
            </button>

            <p className="auth-switch">
              Already registered? <Link to="/login">Sign in</Link>
            </p>
          </form>
        </section>
      </section>
    </main>
  );
}

export default RegisterPage;