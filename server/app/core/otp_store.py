"""
OTP in-memory store with 10-minute expiry.

Uses a plain dict — no Redis/DB dependency.
Thread safety: handled by asyncio's single-threaded event loop.
"""

import random
import string
from datetime import UTC, datetime, timedelta

from app.utils.logging import get_logger

logger = get_logger("core.otp_store")

OTP_TTL_MINUTES = 10
MAX_OTP_ATTEMPTS = 5

# { email -> (otp_code, expires_at, attempts) }
_store: dict[str, tuple[str, datetime, int]] = {}


def _generate_otp(length: int = 6) -> str:
    return "".join(random.choices(string.digits, k=length))


def create_otp(email: str) -> str:
    """Generate, store and return a fresh OTP for the given email."""
    email = email.lower().strip()
    otp = _generate_otp()
    expires_at = datetime.now(UTC) + timedelta(minutes=OTP_TTL_MINUTES)
    _store[email] = (otp, expires_at, 0)
    logger.info("OTP created for email=%s expires_at=%s", email, expires_at.isoformat())
    return otp


def check_otp(email: str, otp: str) -> bool:
    """
    Check if an OTP is valid without consuming it.
    Increments the attempt counter.
    Returns True if valid, False otherwise.
    """
    email = email.lower().strip()
    record = _store.get(email)
    if not record:
        return False
    
    stored_otp, expires_at, attempts = record
    if datetime.now(UTC) > expires_at:
        _store.pop(email, None)
        return False
        
    if attempts >= MAX_OTP_ATTEMPTS:
        logger.warning("OTP max attempts reached for email=%s", email)
        _store.pop(email, None)
        return False

    if stored_otp != otp.strip():
        # Increment attempt counter
        _store[email] = (stored_otp, expires_at, attempts + 1)
        return False

    return True


def verify_otp(email: str, otp: str) -> bool:
    """
    Verify an OTP.
    Returns True if valid (and deletes the record).
    Returns False if not found, expired, or wrong code.
    """
    email = email.lower().strip()
    if not check_otp(email, otp):
        logger.warning("OTP verify: invalid or expired for email=%s", email)
        return False
    
    _store.pop(email, None)
    logger.info("OTP verified successfully for email=%s", email)
    return True


def delete_otp(email: str) -> None:
    """Manually invalidate an OTP (e.g. on resend)."""
    _store.pop(email.lower().strip(), None)
