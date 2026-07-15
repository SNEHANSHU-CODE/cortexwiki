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
from app.db.mongo import get_mongo_manager


logger = get_logger("services.auth")


def _ensure_utc(dt: datetime) -> datetime:
    """Make datetime timezone-aware (UTC) if it is naive — MongoDB returns naive datetimes."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


class AuthService:
    @property
    def mongo(self):
        return get_mongo_manager()

    @property
    def redis(self):
        return get_redis_store()

    async def register_user(self, *, email: str, username: str, password: str, full_name: str = "", user_agent: str = "", ip_address: str = "") -> dict:
        try:
            user = await self.mongo.create_user({
                "email": email,
                "username": username,
                "full_name": full_name,
                "password_hash": hash_password(password),
            })
        except ValueError as exc:
            raise AppError(status_code=409, code="user_exists", message=str(exc)) from exc

        await self.mongo.create_agent_log({
            "user_id": user["id"],
            "event_type": "auth",
            "event_name": "register",
            "details": {"ip_address": ip_address, "user_agent": user_agent},
        })
        logger.info("Registered user id=%s", user["id"])
        return await self._issue_session(user=user, user_agent=user_agent, ip_address=ip_address)

    async def login_user(self, *, email: str, password: str, user_agent: str = "", ip_address: str = "") -> dict:
        user = await self.mongo.get_user_by_email(email)
        if not user or not verify_password(password, user["password_hash"]):
            raise AppError(status_code=401, code="invalid_credentials", message="Invalid email or password.")

        await self.mongo.update_user_login(user["id"])
        await self.mongo.create_agent_log({
            "user_id": user["id"],
            "event_type": "auth",
            "event_name": "login",
            "details": {"ip_address": ip_address, "user_agent": user_agent},
        })
        logger.info("Logged in user id=%s", user["id"])
        return await self._issue_session(user=user, user_agent=user_agent, ip_address=ip_address)

    async def refresh_session(self, *, refresh_token: str, user_agent: str = "", ip_address: str = "") -> dict:
        token_hash = hash_refresh_token(refresh_token)
        record = await self.mongo.find_refresh_token(token_hash)
        if not record:
            raise AppError(status_code=401, code="refresh_token_invalid", message="Refresh token is invalid.")

        # ATOMIC revocation check
        revoked = await self.mongo.revoke_refresh_token_if_active(token_hash)
        if not revoked:
            if _ensure_utc(record["expires_at"]) <= datetime.now(UTC):
                raise AppError(status_code=401, code="refresh_token_expired", message="Refresh token expired.")
            raise AppError(status_code=401, code="refresh_token_used", message="Refresh token already used or revoked.")

        user = await self.mongo.get_user_by_id(record["user_id"])
        if not user:
            raise AppError(status_code=401, code="user_not_found", message="Authenticated user no longer exists.")

        access_token, jti, access_expires_at = create_access_token(user_id=user["id"], email=user["email"])
        refresh_token_new, refresh_expires_at = create_refresh_token()

        try:
            await self.redis.store_access_token(
                jti=jti,
                user_id=user["id"],
                expires_at=access_expires_at,
                token=access_token,
            )
            await self.mongo.save_refresh_token({
                "user_id": user["id"],
                "token_hash": hash_refresh_token(refresh_token_new),
                "expires_at": refresh_expires_at,
                "user_agent": user_agent,
                "ip_address": ip_address,
            })
        except Exception as exc:
            logger.exception("Failed to refresh session for user %s", user["id"])
            try:
                await self.redis.revoke_access_token(jti)
            except Exception:
                logger.warning("Failed to clean up new access token after refresh failure for user %s", user["id"])
            raise AppError(status_code=500, code="session_refresh_failed", message="Unable to refresh session. Please try again.") from exc

        await self.mongo.create_agent_log({
            "user_id": user["id"],
            "event_type": "auth",
            "event_name": "refresh",
            "details": {"ip_address": ip_address, "user_agent": user_agent},
        })
        return {
            "user": {
                "id": user["id"],
                "email": user["email"],
                "username": user["username"],
                "full_name": user.get("full_name", ""),
            },
            "access_token": access_token,
            "access_token_expires_at": access_expires_at,
            "refresh_token": refresh_token_new,
            "refresh_token_expires_at": refresh_expires_at,
        }

    async def logout_user(self, *, user_id: str | None, access_token_jti: str | None, refresh_token: str | None, global_logout: bool = False) -> None:
        if global_logout and user_id:
            await self.redis.revoke_user_tokens(user_id)
            await self.mongo.revoke_user_refresh_tokens(user_id)
            await self.mongo.create_agent_log({
                "user_id": user_id,
                "event_type": "auth",
                "event_name": "global_logout",
                "details": {},
            })
        else:
            if access_token_jti:
                await self.redis.revoke_access_token(access_token_jti)
            if refresh_token:
                await self.mongo.revoke_refresh_token(hash_refresh_token(refresh_token))
            if user_id:
                await self.mongo.create_agent_log({
                    "user_id": user_id,
                    "event_type": "auth",
                    "event_name": "logout",
                    "details": {},
                })

    def set_refresh_cookie(self, response: Response, refresh_token: str, expires_at: datetime) -> None:
        logger.debug("Setting refresh cookie: expires_at=%s, secure=%s, samesite=%s, domain=%s", 
                     expires_at, settings.COOKIE_SECURE, settings.COOKIE_SAMESITE, settings.COOKIE_DOMAIN)
        response.set_cookie(
            key=settings.REFRESH_COOKIE_NAME,
            value=refresh_token,
            httponly=True,
            secure=settings.COOKIE_SECURE,
            samesite=settings.COOKIE_SAMESITE,
            expires=expires_at,
            max_age=int((expires_at - datetime.now(UTC)).total_seconds()),
            path="/",
            domain=settings.COOKIE_DOMAIN,
        )

    def set_access_cookie(self, response: Response, access_token: str, expires_at: datetime) -> None:
        logger.debug("Setting access cookie: expires_at=%s, secure=%s, samesite=%s, domain=%s", 
                     expires_at, settings.COOKIE_SECURE, settings.COOKIE_SAMESITE, settings.COOKIE_DOMAIN)
        response.set_cookie(
            key=settings.ACCESS_COOKIE_NAME,
            value=access_token,
            httponly=True,
            secure=settings.COOKIE_SECURE,
            samesite=settings.COOKIE_SAMESITE,
            expires=expires_at,
            max_age=int((expires_at - datetime.now(UTC)).total_seconds()),
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

    def clear_access_cookie(self, response: Response) -> None:
        response.delete_cookie(
            key=settings.ACCESS_COOKIE_NAME,
            httponly=True,
            secure=settings.COOKIE_SECURE,
            samesite=settings.COOKIE_SAMESITE,
            path="/",
            domain=settings.COOKIE_DOMAIN,
        )

    async def delete_account(self, user_id: str) -> None:
        """
        GDPR compliance: Deletes all user data from Redis, MongoDB, and Neo4j.
        """
        logger.info("Starting account deletion for user: %s", user_id)
        try:
            # 1. Revoke all active tokens from Redis
            await self.redis.revoke_user_tokens(user_id)
            
            # 2. Delete the user's graph data from Neo4j
            from app.services.graph_service import get_graph_service
            graph_service = get_graph_service()
            await graph_service.delete_user_graph(user_id=user_id)

            # 3. Delete all data from MongoDB (user, wikis, pages, vectors, tokens, logs)
            await self.mongo.delete_user_data(user_id)
            
            logger.info("Account deletion completed for user: %s", user_id)
        except Exception as e:
            logger.exception("Failed to fully delete account for user %s: %s", user_id, str(e))
            raise AppError(status_code=500, code="delete_account_failed", message="Failed to delete account.") from e


    async def _issue_session(self, *, user: dict, user_agent: str, ip_address: str) -> dict:
        access_token, jti, access_expires_at = create_access_token(user_id=user["id"], email=user["email"])
        refresh_token, refresh_expires_at = create_refresh_token()

        # Store both tokens atomically: if Mongo fails after Redis succeeds,
        # roll back the Redis access token to prevent orphaned tokens.
        try:
            await self.redis.store_access_token(
                jti=jti,
                user_id=user["id"],
                expires_at=access_expires_at,
                token=access_token,
            )
            await self.mongo.save_refresh_token({
                "user_id": user["id"],
                "token_hash": hash_refresh_token(refresh_token),
                "expires_at": refresh_expires_at,
                "user_agent": user_agent,
                "ip_address": ip_address,
            })
        except Exception as exc:
            logger.exception("Failed to issue session for user %s", user["id"])
            try:
                await self.redis.revoke_access_token(jti)
            except Exception:
                logger.warning(
                    "Failed to clean up access token after session issue failure for user %s",
                    user["id"],
                )
            raise AppError(
                status_code=500,
                code="session_create_failed",
                message="Unable to create session. Please try again.",
            ) from exc

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