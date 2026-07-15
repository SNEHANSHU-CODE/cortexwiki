/* ── OTP Verification Component ────────────────────────────────────────────
   6-box code input with:
   - auto-advance on digit entry
   - backspace navigation
   - paste handling (paste all 6 digits at once)
   - resend countdown timer
────────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";
import "./styles/OtpVerify.css";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

function OtpVerify({ onVerify, onResend, loading = false, error = null, email = "" }) {
  const [digits, setDigits]   = useState(Array(OTP_LENGTH).fill(""));
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const inputRefs = useRef([]);

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  const handleResend = () => {
    if (countdown > 0) return;
    setDigits(Array(OTP_LENGTH).fill(""));
    setCountdown(RESEND_SECONDS);
    inputRefs.current[0]?.focus();
    onResend?.();
  };

  const handleChange = (index, value) => {
    // Accept only single digit
    const digit = value.replace(/\D/g, "").slice(-1);
    const updated = [...digits];
    updated[index] = digit;
    setDigits(updated);
    // Auto-advance
    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
    // Auto-submit when all filled
    if (updated.every((d) => d !== "") && digit) {
      onVerify?.(updated.join(""));
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      if (digits[index]) {
        // Clear current cell
        const updated = [...digits];
        updated[index] = "";
        setDigits(updated);
      } else if (index > 0) {
        // Move back
        inputRefs.current[index - 1]?.focus();
      }
    }
    if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
    if (e.key === "Enter") {
      const code = digits.join("");
      if (code.length === OTP_LENGTH) onVerify?.(code);
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    const updated = Array(OTP_LENGTH).fill("");
    pasted.split("").forEach((ch, i) => { updated[i] = ch; });
    setDigits(updated);
    // Focus last filled or last box
    const focusIdx = Math.min(pasted.length, OTP_LENGTH - 1);
    inputRefs.current[focusIdx]?.focus();
    if (pasted.length === OTP_LENGTH) {
      onVerify?.(pasted);
    }
  };

  return (
    <div className="otp-verify">
      <div className="otp-verify__info">
        <svg className="otp-verify__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
        </svg>
        <p className="otp-verify__hint">
          We sent a 6-digit code to{" "}
          <strong>{email || "your email"}</strong>.<br />
          Check your inbox (and spam folder). It expires in 10 minutes.
        </p>
      </div>

      {/* 6-box input */}
      <div className="otp-boxes" role="group" aria-label="Enter verification code">
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            className={`otp-box${digit ? " otp-box--filled" : ""}`}
            aria-label={`Digit ${i + 1}`}
            autoComplete="one-time-code"
            disabled={loading}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
          />
        ))}
      </div>

      {/* Error message */}
      {error && (
        <div className="otp-verify__error" role="alert">{error}</div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="otp-verify__loading" aria-live="polite">
          <span className="otp-spinner" />
          Verifying…
        </div>
      )}

      {/* Resend */}
      <div className="otp-verify__resend">
        {countdown > 0 ? (
          <span className="otp-verify__countdown">
            Resend code in <strong>{countdown}s</strong>
          </span>
        ) : (
          <button
            type="button"
            className="otp-verify__resend-btn"
            onClick={handleResend}
            disabled={loading}
          >
            Resend code
          </button>
        )}
      </div>
    </div>
  );
}

export default OtpVerify;
