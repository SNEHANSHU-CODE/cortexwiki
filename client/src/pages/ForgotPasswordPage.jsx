import { useState, useEffect, useRef } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { setSession } from "../redux/slices/authSlice";
import { sendOtpRequest, verifyOtpRequest, resetPasswordRequest } from "../utils/api";
import OtpVerify from "../components/OtpVerify";
import "./styles/Auth.css";

const STEPS = { EMAIL: 1, OTP: 2, NEW_PASSWORD: 3, DONE: 4 };

function ForgotPasswordPage() {
  const [step, setStep]             = useState(STEPS.EMAIL);
  const [email, setEmail]           = useState("");
  const [resetToken, setResetToken] = useState(""); // keep JWT for step 3 POST
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError]     = useState(null);
  const [fieldError, setFieldError] = useState("");
  const [showPw, setShowPw]         = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const timeoutRef                  = useRef(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user, status } = useSelector((s) => s.auth);

  useEffect(() => { window.__hideSplash?.(); }, []);

  if (status === "authenticated" && user) return <Navigate to="/wiki" replace />;

  // ── Step 1: send OTP ──────────────────────────────────────────────────
  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setFieldError("");
    const trimmed = email.trim();
    if (!trimmed) { setFieldError("Email address is required."); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) { setFieldError("Please enter a valid email address."); return; }

    setSubmitting(true);
    setOtpError(null);
    setResetToken("");
    try {
      await sendOtpRequest({ email: trimmed, purpose: "reset" });
      setStep(STEPS.OTP);
    } catch (apiError) {
      setFieldError(
        apiError?.response?.data?.error?.message ||
        apiError?.response?.data?.message ||
        apiError?.message ||
        "Could not send verification code.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 2: verify OTP (consumes OTP and issues reset token) ───────────
  const handleOtpVerify = async (otp) => {
    setOtpLoading(true);
    setOtpError(null);
    try {
      const res = await verifyOtpRequest({ email: email.trim(), otp, purpose: "reset" });
      setResetToken(res.reset_token);
      setStep(STEPS.NEW_PASSWORD);
    } catch (apiError) {
      setOtpError(
        apiError?.response?.data?.error?.message ||
        apiError?.response?.data?.message ||
        "Invalid or expired code."
      );
    } finally {
      setOtpLoading(false);
    }
  };

  const handleOtpResend = async () => {
    setOtpError(null);
    try {
      await sendOtpRequest({ email: email.trim(), purpose: "reset" });
    } catch {
      setOtpError("Failed to resend code. Please try again.");
    }
  };

  // ── Step 3: set new password ──────────────────────────────────────────
  const handlePasswordReset = async (e) => {
    e.preventDefault();
    setFieldError("");
    if (!newPassword) { setFieldError("New password is required."); return; }
    if (newPassword.length < 8) { setFieldError("Password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setFieldError("Passwords do not match."); return; }

    setSubmitting(true);
    try {
      const session = await resetPasswordRequest({
        reset_token:  resetToken,
        new_password: newPassword,
      });
      dispatch(setSession({
        user:                 session.user,
        refreshToken:         session.refresh_token,
        accessToken:          session.access_token,
        accessTokenExpiresAt: session.expires_at ?? null,
      }));
      navigate("/wiki", { replace: true });
    } catch (apiError) {
      setFieldError(
        apiError?.response?.data?.error?.message ||
        apiError?.response?.data?.message ||
        apiError?.message ||
        "Reset failed. The code may have expired — please start over.",
      );
      if (apiError?.response?.data?.error?.code === "otp_invalid") {
        timeoutRef.current = setTimeout(() => { setStep(STEPS.OTP); setFieldError(""); }, 3000);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-page__orb auth-page__orb--a" aria-hidden="true" />
      <div className="auth-page__orb auth-page__orb--b" aria-hidden="true" />
      <div className="auth-page__grid"                  aria-hidden="true" />

      <div className="auth-layout auth-layout--narrow">
        <section className="auth-form-side auth-form-side--centered">

          {/* ── Step 1: Enter email ── */}
          {step === STEPS.EMAIL && (
            <>
              <div className="auth-form-side__header">
                <span className="auth-form-side__label">Account recovery</span>
                <h1 className="auth-form-side__title">Forgot password?</h1>
                <p className="auth-form-side__sub">
                  Enter your email and we'll send a verification code to reset your password.
                </p>
              </div>

              <form className="auth-form" onSubmit={handleEmailSubmit} noValidate>
                <div className="auth-field">
                  <label className="auth-field__label" htmlFor="fp-email">Email address</label>
                  <input
                    id="fp-email"
                    type="email"
                    className="auth-field__input"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setFieldError(""); }}
                    autoComplete="email"
                    placeholder="you@example.com"
                    disabled={submitting}
                    required
                  />
                </div>

                {fieldError && <div className="auth-error" role="alert">{fieldError}</div>}

                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={submitting}
                  aria-busy={submitting}
                >
                  {submitting ? "Sending code…" : "Send verification code →"}
                </button>

                <p className="auth-form__switch">
                  Remember your password? <Link to="/login">Sign in</Link>
                </p>
              </form>
            </>
          )}

          {/* ── Step 2: Verify OTP ── */}
          {step === STEPS.OTP && (
            <>
              <div className="auth-form-side__header">
                <span className="auth-form-side__label">Verification</span>
                <h1 className="auth-form-side__title">Enter your code</h1>
                <p className="auth-form-side__sub">
                  A 6-digit code was sent to reset your password.
                </p>
              </div>

              <OtpVerify
                email={email.trim()}
                onVerify={handleOtpVerify}
                onResend={handleOtpResend}
                loading={otpLoading}
                error={otpError}
              />

              <p className="auth-form__switch" style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#38bdf8", fontWeight: 600, fontSize: "0.82rem", fontFamily: "inherit", padding: 0 }}
                  onClick={() => { setStep(STEPS.EMAIL); setOtpError(null); setResetToken(""); }}
                >
                  ← Change email
                </button>
              </p>
            </>
          )}

          {/* ── Step 3: New password ── */}
          {step === STEPS.NEW_PASSWORD && (
            <>
              <div className="auth-form-side__header">
                <span className="auth-form-side__label">Almost done</span>
                <h1 className="auth-form-side__title">Set new password</h1>
                <p className="auth-form-side__sub">
                  Choose a strong password for your account.
                </p>
              </div>

              <form className="auth-form" onSubmit={handlePasswordReset} noValidate>
                <div className="auth-field auth-field--pw">
                  <label className="auth-field__label" htmlFor="fp-new-password">
                    New password <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(min 8 chars)</span>
                  </label>
                  <input
                    id="fp-new-password"
                    type={showPw ? "text" : "password"}
                    className="auth-field__input"
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setFieldError(""); }}
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

                <div className="auth-field auth-field--pw">
                  <label className="auth-field__label" htmlFor="fp-confirm-password">Confirm password</label>
                  <input
                    id="fp-confirm-password"
                    type={showConfirmPw ? "text" : "password"}
                    className="auth-field__input"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setFieldError(""); }}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    disabled={submitting}
                    required
                  />
                  <button
                    type="button"
                    className="auth-field__eye"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setShowConfirmPw((v) => !v)}
                    tabIndex={-1}
                    aria-label={showConfirmPw ? "Hide password" : "Show password"}
                  >
                    {showConfirmPw ? (
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

                {fieldError && <div className="auth-error" role="alert">{fieldError}</div>}

                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={submitting}
                  aria-busy={submitting}
                >
                  {submitting ? "Saving…" : "Reset password →"}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default ForgotPasswordPage;
