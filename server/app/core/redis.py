import asyncio
import json
from datetime import UTC, datetime

from redis.asyncio import Redis

from app.core.config import settings
from app.utils.logging import get_logger


logger = get_logger("core.redis")


class RedisTokenStore:
    def __init__(self) -> None:
        self.client: Redis | None = None
        self.mode = "memory"
        self._memory_tokens: dict[str, tuple[dict, datetime]] = {}
        self._memory_user_index: dict[str, set[str]] = {}
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        if not settings.REDIS_URL:
            logger.warning("REDIS_URL not set — using in-memory access token store")
            return

        try:
            self.client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
            await self.client.ping()
            self.mode = "redis"
            logger.info("Connected to Redis token store")
        except Exception:
            self.client = None
            self.mode = "memory"
            logger.exception("Redis unavailable — falling back to in-memory token store")

    async def close(self) -> None:
        if self.client is not None:
            await self.client.aclose()
        self.client = None

    def _token_key(self, jti: str) -> str:
        return f"{settings.REDIS_ACCESS_TOKEN_PREFIX}:{jti}"

    def _user_key(self, user_id: str) -> str:
        return f"{settings.REDIS_ACCESS_TOKEN_PREFIX}:user:{user_id}"

    async def store_access_token(
        self,
        *,
        jti: str,
        user_id: str,
        expires_at: datetime,
        token: str,
    ) -> None:
        ttl = max(int((expires_at - datetime.now(UTC)).total_seconds()), 1)
        payload = {
            "user_id": user_id,
            "expires_at": expires_at.isoformat(),
            "token": token,
        }

        if self.client is not None:
            token_key = self._token_key(jti)
            user_key = self._user_key(user_id)
            async with self.client.pipeline(transaction=True) as pipe:
                pipe.setex(token_key, ttl, json.dumps(payload))
                pipe.sadd(user_key, jti)
                pipe.expire(user_key, ttl)
                await pipe.execute()
            return

        async with self._lock:
            self._memory_tokens[jti] = (payload, expires_at)
            self._memory_user_index.setdefault(user_id, set()).add(jti)

    async def get_access_token(self, jti: str) -> dict | None:
        if self.client is not None:
            value = await self.client.get(self._token_key(jti))
            return json.loads(value) if value else None

        async with self._lock:
            record = self._memory_tokens.get(jti)
            if not record:
                return None
            payload, expires_at = record
            if expires_at <= datetime.now(UTC):
                self._memory_tokens.pop(jti, None)
                return None
            return payload

    async def revoke_access_token(self, jti: str) -> None:
        if self.client is not None:
            payload_raw = await self.client.get(self._token_key(jti))
            async with self.client.pipeline(transaction=True) as pipe:
                pipe.delete(self._token_key(jti))
                if payload_raw:
                    user_id = json.loads(payload_raw).get("user_id")
                    if user_id:
                        pipe.srem(self._user_key(user_id), jti)
                await pipe.execute()
            return

        async with self._lock:
            record = self._memory_tokens.pop(jti, None)
            if record:
                user_id = record[0].get("user_id")
                if user_id:
                    self._memory_user_index.get(user_id, set()).discard(jti)

    async def revoke_user_tokens(self, user_id: str) -> None:
        if self.client is not None:
            user_key = self._user_key(user_id)
            token_ids = await self.client.smembers(user_key)
            if token_ids:
                async with self.client.pipeline(transaction=True) as pipe:
                    for jti in token_ids:
                        pipe.delete(self._token_key(jti))
                    pipe.delete(user_key)
                    await pipe.execute()
            return

        async with self._lock:
            # Copy the set before iterating to avoid mutation during loop
            token_ids = list(self._memory_user_index.pop(user_id, set()))
            for jti in token_ids:
                self._memory_tokens.pop(jti, None)


_redis_store = RedisTokenStore()


async def initialize_redis() -> None:
    await _redis_store.connect()


async def close_redis() -> None:
    await _redis_store.close()


def get_redis_store() -> RedisTokenStore:
    return _redis_store