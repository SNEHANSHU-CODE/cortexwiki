import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.core.config import settings
from app.utils.errors import AppError


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 390_000)
    return f"{base64.b64encode(salt).decode()}:{base64.b64encode(digest).decode()}"


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        salt_b64, digest_b64 = hashed_password.split(":", maxsplit=1)
        salt = base64.b64decode(salt_b64)
        expected_digest = base64.b64decode(digest_b64)
    except Exception as exc:
        raise AppError(
            status_code=500,
            code="password_hash_invalid",
            message="Stored password hash is invalid.",
        ) from exc

    candidate_digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 390_000)
    return hmac.compare_digest(candidate_digest, expected_digest)


def create_access_token(*, user_id: str, email: str) -> tuple[str, str, datetime]:
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    jti = secrets.token_urlsafe(16)
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
        "jti": jti,
        "exp": expires_at,
        "iat": now,
    }
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return token, jti, expires_at


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except jwt.ExpiredSignatureError as exc:
        raise AppError(
            status_code=401,
            code="access_token_expired",
            message="Access token expired.",
        ) from exc
    except jwt.PyJWTError as exc:
        raise AppError(
            status_code=401,
            code="access_token_invalid",
            message="Invalid access token.",
        ) from exc

    if payload.get("type") != "access":
        raise AppError(
            status_code=401,
            code="access_token_invalid",
            message="Invalid access token type.",
        )
    if not payload.get("sub") or not payload.get("jti"):
        raise AppError(
            status_code=401,
            code="access_token_invalid",
            message="Malformed access token.",
        )
    return payload


def create_refresh_token() -> tuple[str, datetime]:
    token = secrets.token_urlsafe(48)
    expires_at = datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return token, expires_at


def hash_refresh_token(token: str) -> str:
    """HMAC-SHA256 of the raw refresh token using SECRET_KEY."""
    return hmac.new(
        settings.SECRET_KEY.encode(),
        token.encode(),
        hashlib.sha256,
    ).hexdigest()