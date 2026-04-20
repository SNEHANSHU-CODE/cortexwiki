import copy
import uuid
from datetime import UTC, datetime

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING

from app.core.config import settings
from app.utils.logging import get_logger
from app.utils.text import cosine_similarity, keyword_score, slugify


logger = get_logger("modules.db.mongo")


class MongoManager:
    def __init__(self) -> None:
        self.client: AsyncIOMotorClient | None = None
        self.database = None
        self.mode = "memory"
        self._memory = {
            "users": {},
            "refresh_tokens": {},
            "raw_data": {},
            "wiki_pages": {},
            "agent_logs": {},
        }

    async def connect(self) -> None:
        if not settings.MONGO_URI:
            logger.warning("MONGO_URI not set, using in-memory Mongo fallback")
            return

        try:
            self.client = AsyncIOMotorClient(settings.MONGO_URI, serverSelectionTimeoutMS=5000)
            await self.client.admin.command("ping")
            self.database = self.client[settings.MONGO_DB_NAME]
            await self._ensure_indexes()
            self.mode = "mongo"
            logger.info("Connected to MongoDB")
        except Exception:
            self.client = None
            self.database = None
            self.mode = "memory"
            logger.exception("MongoDB unavailable, using in-memory fallback")

    async def disconnect(self) -> None:
        if self.client is not None:
            self.client.close()
        self.client = None
        self.database = None

    async def _ensure_indexes(self) -> None:
        if self.database is None:
            return
        await self.database.users.create_index([("email", ASCENDING)], unique=True)
        await self.database.users.create_index([("username", ASCENDING)], unique=True)
        await self.database.refresh_tokens.create_index([("token_hash", ASCENDING)], unique=True)
        await self.database.refresh_tokens.create_index([("user_id", ASCENDING)])
        await self.database.wiki_pages.create_index([("user_id", ASCENDING), ("slug", ASCENDING)])
        await self.database.raw_data.create_index([("user_id", ASCENDING), ("created_at", ASCENDING)])
        await self.database.agent_logs.create_index([("user_id", ASCENDING), ("created_at", ASCENDING)])

    def _copy(self, document: dict | None) -> dict | None:
        return copy.deepcopy(document) if document else None

    def _normalize(self, document: dict | None) -> dict | None:
        if not document:
            return None
        normalized = dict(document)
        if "_id" in normalized:
            normalized["id"] = str(normalized.pop("_id"))
        return normalized

    async def create_user(self, payload: dict) -> dict:
        now = datetime.now(UTC)
        document = {
            "email": payload["email"].lower(),
            "username": payload["username"].lower(),
            "full_name": payload.get("full_name", "").strip(),
            "password_hash": payload["password_hash"],
            "created_at": now,
            "updated_at": now,
            "last_login_at": None,
        }

        if self.database is not None:
            result = await self.database.users.insert_one(document)
            return await self.get_user_by_id(str(result.inserted_id))

        if await self.get_user_by_email(document["email"]):
            raise ValueError("Email already exists")
        if await self.get_user_by_username(document["username"]):
            raise ValueError("Username already exists")
        document["id"] = str(uuid.uuid4())
        self._memory["users"][document["id"]] = document
        return self._copy(document)

    async def get_user_by_email(self, email: str) -> dict | None:
        if self.database is not None:
            return self._normalize(await self.database.users.find_one({"email": email.lower()}))
        for user in self._memory["users"].values():
            if user["email"] == email.lower():
                return self._copy(user)
        return None

    async def get_user_by_username(self, username: str) -> dict | None:
        if self.database is not None:
            return self._normalize(await self.database.users.find_one({"username": username.lower()}))
        for user in self._memory["users"].values():
            if user["username"] == username.lower():
                return self._copy(user)
        return None

    async def get_user_by_id(self, user_id: str) -> dict | None:
        if self.database is not None:
            from bson import ObjectId

            try:
                return self._normalize(await self.database.users.find_one({"_id": ObjectId(user_id)}))
            except Exception:
                return None
        return self._copy(self._memory["users"].get(user_id))

    async def update_user_login(self, user_id: str) -> None:
        now = datetime.now(UTC)
        if self.database is not None:
            from bson import ObjectId

            try:
                await self.database.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"last_login_at": now, "updated_at": now}})
            except Exception:
                return
            return
        if user_id in self._memory["users"]:
            self._memory["users"][user_id]["last_login_at"] = now
            self._memory["users"][user_id]["updated_at"] = now

    async def save_refresh_token(self, payload: dict) -> dict:
        document = {**payload, "created_at": datetime.now(UTC), "updated_at": datetime.now(UTC), "revoked": False}
        if self.database is not None:
            result = await self.database.refresh_tokens.insert_one(document)
            stored = await self.database.refresh_tokens.find_one({"_id": result.inserted_id})
            return self._normalize(stored)
        document["id"] = str(uuid.uuid4())
        self._memory["refresh_tokens"][document["id"]] = document
        return self._copy(document)

    async def find_refresh_token(self, token_hash: str) -> dict | None:
        if self.database is not None:
            record = await self.database.refresh_tokens.find_one({"token_hash": token_hash, "revoked": False})
            return self._normalize(record)
        for token in self._memory["refresh_tokens"].values():
            if token["token_hash"] == token_hash and not token["revoked"]:
                return self._copy(token)
        return None

    async def revoke_refresh_token(self, token_hash: str) -> None:
        now = datetime.now(UTC)
        if self.database is not None:
            await self.database.refresh_tokens.update_many({"token_hash": token_hash}, {"$set": {"revoked": True, "updated_at": now}})
            return
        for token in self._memory["refresh_tokens"].values():
            if token["token_hash"] == token_hash:
                token["revoked"] = True
                token["updated_at"] = now

    async def revoke_user_refresh_tokens(self, user_id: str) -> None:
        now = datetime.now(UTC)
        if self.database is not None:
            await self.database.refresh_tokens.update_many({"user_id": user_id}, {"$set": {"revoked": True, "updated_at": now}})
            return
        for token in self._memory["refresh_tokens"].values():
            if token["user_id"] == user_id:
                token["revoked"] = True
                token["updated_at"] = now

    async def store_raw_data(self, payload: dict) -> dict:
        document = {**payload, "created_at": datetime.now(UTC), "updated_at": datetime.now(UTC)}
        if self.database is not None:
            result = await self.database.raw_data.insert_one(document)
            stored = await self.database.raw_data.find_one({"_id": result.inserted_id})
            return self._normalize(stored)
        document["id"] = str(uuid.uuid4())
        self._memory["raw_data"][document["id"]] = document
        return self._copy(document)

    async def create_wiki_page(self, payload: dict) -> dict:
        slug = slugify(payload["title"])
        existing_pages = await self.list_wiki_pages(payload["user_id"], limit=200)
        matching_versions = [page for page in existing_pages if page["slug"] == slug]
        version = max([page.get("version", 1) for page in matching_versions], default=0) + 1

        document = {
            **payload,
            "slug": slug,
            "version": version,
            "created_at": datetime.now(UTC),
            "updated_at": datetime.now(UTC),
        }
        if self.database is not None:
            result = await self.database.wiki_pages.insert_one(document)
            stored = await self.database.wiki_pages.find_one({"_id": result.inserted_id})
            return self._normalize(stored)
        document["id"] = str(uuid.uuid4())
        self._memory["wiki_pages"][document["id"]] = document
        return self._copy(document)

    async def list_recent_ingestions(self, user_id: str, limit: int = 20) -> list[dict]:
        if self.database is not None:
            cursor = self.database.raw_data.find({"user_id": user_id}).sort("created_at", -1).limit(limit)
            return [self._normalize(item) for item in await cursor.to_list(length=limit)]
        items = [self._copy(item) for item in self._memory["raw_data"].values() if item["user_id"] == user_id]
        items.sort(key=lambda item: item["created_at"], reverse=True)
        return items[:limit]

    async def list_wiki_pages(self, user_id: str, limit: int = 50) -> list[dict]:
        if self.database is not None:
            cursor = self.database.wiki_pages.find({"user_id": user_id}).sort("created_at", -1).limit(limit)
            return [self._normalize(item) for item in await cursor.to_list(length=limit)]
        items = [self._copy(item) for item in self._memory["wiki_pages"].values() if item["user_id"] == user_id]
        items.sort(key=lambda item: item["created_at"], reverse=True)
        return items[:limit]

    async def count_wiki_pages(self, user_id: str) -> int:
        if self.database is not None:
            return await self.database.wiki_pages.count_documents({"user_id": user_id})
        return sum(1 for item in self._memory["wiki_pages"].values() if item["user_id"] == user_id)

    async def search_wiki_pages(self, *, user_id: str, query: str, query_embedding: list[float], limit: int = 5) -> list[dict]:
        pages = await self.list_wiki_pages(user_id=user_id, limit=200)
        scored: list[dict] = []
        for page in pages:
            searchable = " ".join(
                [
                    page.get("title", ""),
                    page.get("summary", ""),
                    page.get("content", ""),
                    " ".join(page.get("concepts", [])),
                ]
            )
            vector_score = cosine_similarity(query_embedding, page.get("embedding", []))
            lexical_score = keyword_score(query, searchable)
            score = (0.7 * vector_score) + (0.3 * lexical_score)
            if score > 0:
                scored.append({**page, "score": round(score, 4)})
        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored[:limit]

    async def create_agent_log(self, payload: dict) -> dict:
        document = {**payload, "created_at": datetime.now(UTC)}
        if self.database is not None:
            result = await self.database.agent_logs.insert_one(document)
            stored = await self.database.agent_logs.find_one({"_id": result.inserted_id})
            return self._normalize(stored)
        document["id"] = str(uuid.uuid4())
        self._memory["agent_logs"][document["id"]] = document
        return self._copy(document)


mongo_manager = MongoManager()


async def connect_to_mongo() -> None:
    await mongo_manager.connect()


async def close_mongo_connection() -> None:
    await mongo_manager.disconnect()


def get_mongo_manager() -> MongoManager:
    return mongo_manager
