from datetime import UTC, datetime

from fastapi import Response

from app.core.config import settings
from app.core.redis import get_redis_store
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.utils.errors import AppError
from app.utils.logging import get_logger
from modules.db.mongo import get_mongo_manager


logger = get_logger("services.auth")


class AuthService:
    """Stateless service — resolves mongo/redis per call to avoid stale references."""

    @property
    def mongo(self):
        return get_mongo_manager()

    @property
    def redis(self):
        return get_redis_store()

    async def register_user(
        self,
        *,
        email: str,
        username: str,
        password: str,
        full_name: str = "",
        user_agent: str = "",
        ip_address: str = "",
    ) -> dict:
        if await self.mongo.get_user_by_email(email):
            raise AppError(status_code=409, code="email_in_use", message="Email is already registered.")
        if await self.mongo.get_user_by_username(username):
            raise AppError(status_code=409, code="username_in_use", message="Username is already registered.")

        try:
            user = await self.mongo.create_user(
                {
                    "email": email,
                    "username": username,
                    "full_name": full_name,
                    "password_hash": hash_password(password),
                }
            )
        except ValueError as exc:
            raise AppError(status_code=409, code="user_exists", message=str(exc)) from exc

        await self.mongo.create_agent_log(
            {
                "user_id": user["id"],
                "event_type": "auth",
                "event_name": "register",
                "details": {"email": user["email"], "ip_address": ip_address, "user_agent": user_agent},
            }
        )
        logger.info("Registered user %s", user["email"])
        return await self._issue_session(user=user, user_agent=user_agent, ip_address=ip_address)

    async def login_user(
        self,
        *,
        email: str,
        password: str,
        user_agent: str = "",
        ip_address: str = "",
    ) -> dict:
        user = await self.mongo.get_user_by_email(email)
        if not user or not verify_password(password, user["password_hash"]):
            raise AppError(status_code=401, code="invalid_credentials", message="Invalid email or password.")

        await self.mongo.update_user_login(user["id"])
        await self.mongo.create_agent_log(
            {
                "user_id": user["id"],
                "event_type": "auth",
                "event_name": "login",
                "details": {"ip_address": ip_address, "user_agent": user_agent},
            }
        )
        logger.info("Logged in user %s", user["email"])
        return await self._issue_session(user=user, user_agent=user_agent, ip_address=ip_address)

    async def refresh_session(
        self,
        *,
        refresh_token: str,
        user_agent: str = "",
        ip_address: str = "",
    ) -> dict:
        token_hash = hash_refresh_token(refresh_token)
        record = await self.mongo.find_refresh_token(token_hash)
        if not record:
            raise AppError(status_code=401, code="refresh_token_invalid", message="Refresh token is invalid.")
        if record["expires_at"] <= datetime.now(UTC):
            await self.mongo.revoke_refresh_token(token_hash)
            raise AppError(status_code=401, code="refresh_token_expired", message="Refresh token expired.")

        user = await self.mongo.get_user_by_id(record["user_id"])
        if not user:
            await self.mongo.revoke_refresh_token(token_hash)
            raise AppError(status_code=401, code="user_not_found", message="Authenticated user no longer exists.")

        # Rotate: revoke old token before issuing new session
        await self.mongo.revoke_refresh_token(token_hash)
        await self.mongo.create_agent_log(
            {
                "user_id": user["id"],
                "event_type": "auth",
                "event_name": "refresh",
                "details": {"ip_address": ip_address, "user_agent": user_agent},
            }
        )
        return await self._issue_session(user=user, user_agent=user_agent, ip_address=ip_address)

    async def logout_user(
        self,
        *,
        user_id: str | None,
        access_token_jti: str | None,
        refresh_token: str | None,
    ) -> None:
        if user_id:
            # Revoke ALL tokens for this user in one pass — no need to also
            # call revoke_access_token individually for the current jti.
            await self.redis.revoke_user_tokens(user_id)
            await self.mongo.revoke_user_refresh_tokens(user_id)
            await self.mongo.create_agent_log(
                {
                    "user_id": user_id,
                    "event_type": "auth",
                    "event_name": "logout",
                    "details": {},
                }
            )
        else:
            # Unauthenticated logout — best-effort revocation
            if access_token_jti:
                await self.redis.revoke_access_token(access_token_jti)
            if refresh_token:
                await self.mongo.revoke_refresh_token(hash_refresh_token(refresh_token))

    def set_refresh_cookie(self, response: Response, refresh_token: str, expires_at: datetime) -> None:
        response.set_cookie(
            key=settings.REFRESH_COOKIE_NAME,
            value=refresh_token,
            httponly=True,
            secure=settings.COOKIE_SECURE,
            samesite=settings.COOKIE_SAMESITE,
            expires=expires_at,
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
            path="/",
            domain=settings.COOKIE_DOMAIN,
        )

    def clear_refresh_cookie(self, response: Response) -> None:
        response.delete_cookie(
            key=settings.REFRESH_COOKIE_NAME,
            httponly=True,
            secure=settings.COOKIE_SECURE,
            samesite=settings.COOKIE_SAMESITE,
            path="/",
            domain=settings.COOKIE_DOMAIN,
        )

    async def _issue_session(self, *, user: dict, user_agent: str, ip_address: str) -> dict:
        access_token, jti, access_expires_at = create_access_token(
            user_id=user["id"],
            email=user["email"],
        )
        refresh_token, refresh_expires_at = create_refresh_token()

        await self.redis.store_access_token(
            jti=jti,
            user_id=user["id"],
            expires_at=access_expires_at,
            token=access_token,
        )
        await self.mongo.save_refresh_token(
            {
                "user_id": user["id"],
                "token_hash": hash_refresh_token(refresh_token),
                "expires_at": refresh_expires_at,
                "user_agent": user_agent,
                "ip_address": ip_address,
            }
        )

        return {
            "user": {
                "id": user["id"],
                "email": user["email"],
                "username": user["username"],
                "full_name": user.get("full_name", ""),
            },
            "access_token": access_token,
            "access_token_expires_at": access_expires_at,
            "refresh_token": refresh_token,
            "refresh_token_expires_at": refresh_expires_at,
        }


_auth_service = AuthService()


def get_auth_service() -> AuthService:
    return _auth_service