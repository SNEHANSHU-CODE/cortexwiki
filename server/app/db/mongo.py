import copy
import uuid
from datetime import UTC, datetime

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING

from app.core.config import settings
from app.utils.logging import get_logger
from app.utils.text import cosine_similarity, keyword_score, slugify


logger = get_logger("app.db.mongo")


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
            "wikis": {},          # new
        }

    async def connect(self) -> None:
        if not settings.MONGO_URI:
            logger.warning("MONGO_URI not set, using in-memory Mongo fallback")
            return
        try:
            self.client = AsyncIOMotorClient(
                settings.MONGO_URI,
                serverSelectionTimeoutMS=5000,
                maxPoolSize=settings.MONGO_MAX_POOL_SIZE,
                minPoolSize=settings.MONGO_MIN_POOL_SIZE,
            )
            await self.client.admin.command("ping")
            self.database = self.client[settings.MONGO_DB_NAME]
            await self._ensure_indexes()
            self.mode = "mongo"
            logger.info("Connected to MongoDB")
        except Exception:
            if self.client is not None:
                self.client.close()
            self.client = None
            self.database = None
            self.mode = "memory"
            logger.exception("MongoDB unavailable, using in-memory fallback")

    async def disconnect(self) -> None:
        if self.client is not None:
            self.client.close()
        self.client = None
        self.database = None

    async def _safe_create_index(self, collection, keys: list, **kwargs) -> None:
        """
        Create an index, handling IndexKeySpecsConflict (MongoDB error code 86).
        This occurs when an index with the same key pattern already exists but
        with different options (e.g. a non-unique index that should now be unique).
        We drop the old index and recreate it with the desired spec.
        """
        from pymongo.errors import OperationFailure
        try:
            await collection.create_index(keys, **kwargs)
        except OperationFailure as exc:
            if exc.code == 86:
                index_name = "_".join(f"{field}_{direction}" for field, direction in keys)
                logger.warning(
                    "Index conflict on %s (%s) — dropping old index and recreating.",
                    collection.name, index_name,
                )
                try:
                    await collection.drop_index(index_name)
                except Exception as drop_exc:
                    logger.error("Failed to drop conflicting index %s: %s", index_name, drop_exc)
                    raise
                await collection.create_index(keys, **kwargs)
            else:
                raise

    async def _ensure_indexes(self) -> None:
        if self.database is None:
            return
        await self._safe_create_index(self.database.users, [("email", ASCENDING)], unique=True)
        await self._safe_create_index(self.database.users, [("username", ASCENDING)], unique=True)
        await self._safe_create_index(self.database.refresh_tokens, [("token_hash", ASCENDING)], unique=True)
        await self._safe_create_index(self.database.refresh_tokens, [("user_id", ASCENDING)])
        await self._safe_create_index(self.database.refresh_tokens, [("expires_at", ASCENDING)], expireAfterSeconds=0)
        await self._safe_create_index(self.database.wikis, [("user_id", ASCENDING), ("created_at", ASCENDING)])
        await self._safe_create_index(self.database.wiki_pages, [("user_id", ASCENDING), ("wiki_id", ASCENDING), ("slug", ASCENDING)], unique=True)
        await self._safe_create_index(self.database.wiki_pages, [("user_id", ASCENDING), ("wiki_id", ASCENDING), ("source_url", ASCENDING)])
        await self._safe_create_index(self.database.raw_data, [("user_id", ASCENDING), ("wiki_id", ASCENDING), ("created_at", ASCENDING)])
        await self._safe_create_index(self.database.raw_data, [("wiki_id", ASCENDING), ("user_id", ASCENDING), ("source_url", ASCENDING)], unique=True)
        await self._safe_create_index(self.database.agent_logs, [("user_id", ASCENDING), ("wiki_id", ASCENDING), ("event_type", ASCENDING), ("created_at", ASCENDING)])
        await self._safe_create_index(self.database.wiki_pages, [("wiki_id", ASCENDING), ("source_url", ASCENDING)])

    def _copy(self, document: dict | None) -> dict | None:
        return copy.deepcopy(document) if document else None

    def _normalize(self, document: dict | None) -> dict | None:
        if not document:
            return None
        normalized = dict(document)
        if "_id" in normalized:
            normalized["id"] = str(normalized.pop("_id"))
        return normalized

    def _sanitize_id(self, value: str) -> str | None:
        """Basic sanitizer for user-provided identifier strings (wiki_id, ids).

        Returns the stripped string or None if invalid. Disallow null bytes and
        leading '$' which can be used in Mongo query operators.
        """
        if value is None:
            return None
        if not isinstance(value, str):
            return None
        val = value.strip()
        if not val:
            return None
        if "\x00" in val or val.startswith("$"):
            return None
        return val

    # ── Users ─────────────────────────────────────────────────────────────────

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
            "input_tokens_used": 0,
            "output_tokens_used": 0,
        }
        if self.database is not None:
            from pymongo.errors import DuplicateKeyError
            try:
                result = await self.database.users.insert_one(document)
                return await self.get_user_by_id(str(result.inserted_id))
            except DuplicateKeyError as exc:
                err_msg = str(exc).lower()
                if "email" in err_msg:
                    raise ValueError("Email already exists") from exc
                if "username" in err_msg:
                    raise ValueError("Username already exists") from exc
                raise ValueError("User already exists") from exc
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
                await self.database.users.update_one(
                    {"_id": ObjectId(user_id)},
                    {"$set": {"last_login_at": now, "updated_at": now}},
                )
            except Exception:
                return
            return
        if user_id in self._memory["users"]:
            self._memory["users"][user_id]["last_login_at"] = now
            self._memory["users"][user_id]["updated_at"] = now

    async def get_user_token_usage(self, user_id: str) -> tuple[int, int]:
        """Get (daily_input_tokens_used, daily_output_tokens_used) for a user, resetting if date has changed."""
        user = await self.get_user_by_id(user_id)
        if not user:
            return 0, 0
        
        from datetime import datetime, UTC
        today_str = datetime.now(UTC).date().isoformat()
        
        # If the tracking date is not today, the daily count is effectively 0
        if user.get("token_usage_date") != today_str:
            return 0, 0
            
        return user.get("daily_input_tokens_used", 0), user.get("daily_output_tokens_used", 0)

    async def increment_user_token_usage(self, user_id: str, input_tokens: int, output_tokens: int) -> None:
        """Increment user token usage, tracking both daily limits and lifetime totals."""
        from datetime import datetime, UTC
        from bson import ObjectId
        
        now = datetime.now(UTC)
        today_str = now.date().isoformat()
        
        if self.database is not None:
            try:
                await self.database.users.update_one(
                    {"_id": ObjectId(user_id)},
                    [
                        {
                            "$set": {
                                "token_usage_date": today_str,
                                "daily_input_tokens_used": {
                                    "$add": [
                                        {"$cond": [{"$ne": ["$token_usage_date", today_str]}, 0, {"$ifNull": ["$daily_input_tokens_used", 0]}]},
                                        input_tokens
                                    ]
                                },
                                "daily_output_tokens_used": {
                                    "$add": [
                                        {"$cond": [{"$ne": ["$token_usage_date", today_str]}, 0, {"$ifNull": ["$daily_output_tokens_used", 0]}]},
                                        output_tokens
                                    ]
                                },
                                "input_tokens_used": {"$add": [{"$ifNull": ["$input_tokens_used", 0]}, input_tokens]},
                                "output_tokens_used": {"$add": [{"$ifNull": ["$output_tokens_used", 0]}, output_tokens]},
                                "updated_at": now
                            }
                        }
                    ]
                )
            except Exception:
                pass
            return
        user = self._memory["users"].get(user_id)
        if user:
            user["input_tokens_used"] = user.get("input_tokens_used", 0) + input_tokens
            user["output_tokens_used"] = user.get("output_tokens_used", 0) + output_tokens
            if user.get("token_usage_date") != today_str:
                user["token_usage_date"] = today_str
                user["daily_input_tokens_used"] = input_tokens
                user["daily_output_tokens_used"] = output_tokens
            else:
                user["daily_input_tokens_used"] = user.get("daily_input_tokens_used", 0) + input_tokens
                user["daily_output_tokens_used"] = user.get("daily_output_tokens_used", 0) + output_tokens
            user["updated_at"] = now

    # ── Refresh Tokens ────────────────────────────────────────────────────────

    async def save_refresh_token(self, payload: dict) -> dict:
        now = datetime.now(UTC)
        document = {**payload, "created_at": now, "updated_at": now, "revoked": False}
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

    async def revoke_refresh_token_if_active(self, token_hash: str) -> bool:
        """Atomically revoke a refresh token only if it is currently active and not expired. Returns True if successfully revoked."""
        now = datetime.now(UTC)
        if self.database is not None:
            res = await self.database.refresh_tokens.update_one(
                {"token_hash": token_hash, "revoked": False, "expires_at": {"$gt": now}},
                {"$set": {"revoked": True, "updated_at": now}}
            )
            return res.modified_count > 0
        for token in self._memory["refresh_tokens"].values():
            expires_at = token["expires_at"]
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)
            if token["token_hash"] == token_hash and not token["revoked"] and expires_at > now:
                token["revoked"] = True
                token["updated_at"] = now
                return True
        return False

    async def revoke_user_refresh_tokens(self, user_id: str) -> None:
        now = datetime.now(UTC)
        if self.database is not None:
            await self.database.refresh_tokens.update_many({"user_id": user_id}, {"$set": {"revoked": True, "updated_at": now}})
            return
        for token in self._memory["refresh_tokens"].values():
            if token["user_id"] == user_id:
                token["revoked"] = True
                token["updated_at"] = now

    async def cleanup_expired_refresh_tokens(self) -> None:
        """Delete refresh tokens that have expired (30 days have passed)."""
        now = datetime.now(UTC)
        if self.database is not None:
            await self.database.refresh_tokens.delete_many({"expires_at": {"$lt": now}})
            return
        # Clean up in-memory tokens
        expired_ids = [
            token_id for token_id, token in self._memory["refresh_tokens"].items()
            if token["expires_at"] < now
        ]
        for token_id in expired_ids:
            del self._memory["refresh_tokens"][token_id]

    # ── Wikis ─────────────────────────────────────────────────────────────────

    async def create_wiki(self, payload: dict) -> dict:
        now = datetime.now(UTC)
        name = payload["name"].strip()
        if not name:
            raise ValueError("Wiki name is required.")
        document = {
            "user_id": payload["user_id"],
            "name": name,
            "description": payload.get("description", "").strip(),
            "master_note": "",          # compounds over time as sources are added
            "source_count": 0,
            "version": 1,
            "created_at": now,
            "updated_at": now,
            "last_ingested_at": None,
        }
        if self.database is not None:
            result = await self.database.wikis.insert_one(document)
            stored = await self.database.wikis.find_one({"_id": result.inserted_id})
            return self._normalize(stored)
        document["id"] = str(uuid.uuid4())
        self._memory["wikis"][document["id"]] = document
        return self._copy(document)

    async def get_wiki(self, wiki_id: str, user_id: str) -> dict | None:
        if self.database is not None:
            from bson import ObjectId
            try:
                doc = await self.database.wikis.find_one({"_id": ObjectId(wiki_id), "user_id": user_id})
            except Exception:
                return None
            return self._normalize(doc)
        wiki = self._memory["wikis"].get(wiki_id)
        if wiki and wiki["user_id"] == user_id:
            return self._copy(wiki)
        return None

    async def list_wikis(self, user_id: str, limit: int = 100) -> list[dict]:
        if self.database is not None:
            cursor = self.database.wikis.find({"user_id": user_id}).sort("created_at", -1)
            return [self._normalize(w) for w in await cursor.to_list(length=limit)]
        items = [self._copy(w) for w in self._memory["wikis"].values() if w["user_id"] == user_id]
        items.sort(key=lambda x: x["created_at"], reverse=True)
        return items[:limit]

    async def update_wiki(self, wiki_id: str, user_id: str, payload: dict) -> dict | None:
        now = datetime.now(UTC)
        update_fields = {k: v for k, v in payload.items() if k in {"name", "description"}}
        if "name" in update_fields:
            update_fields["name"] = update_fields["name"].strip()
            if not update_fields["name"]:
                raise ValueError("Wiki name cannot be empty.")
        if "description" in update_fields:
            update_fields["description"] = update_fields["description"].strip()
        update_fields["updated_at"] = now
        if self.database is not None:
            from bson import ObjectId
            # Atomically apply update and increment optimistic `version` counter
            await self.database.wikis.update_one(
                {"_id": ObjectId(wiki_id), "user_id": user_id},
                {"$set": update_fields, "$inc": {"version": 1}},
            )
            return await self.get_wiki(wiki_id, user_id)
        wiki = self._memory["wikis"].get(wiki_id)
        if wiki and wiki["user_id"] == user_id:
            wiki.update(update_fields)
            return self._copy(wiki)
        return None

    async def delete_wiki(self, wiki_id: str, user_id: str) -> bool:
        """Delete wiki and all associated data."""
        if self.database is not None:
            from bson import ObjectId
            try:
                async with await self.client.start_session() as session:
                    async with session.start_transaction():
                        result = await self.database.wikis.delete_one({"_id": ObjectId(wiki_id), "user_id": user_id}, session=session)
                        if result.deleted_count == 0:
                            return False
                        # Cascade delete all wiki data
                        await self.database.wiki_pages.delete_many({"wiki_id": wiki_id, "user_id": user_id}, session=session)
                        await self.database.raw_data.delete_many({"wiki_id": wiki_id, "user_id": user_id}, session=session)
                        # Also remove agent logs and any other wiki-scoped artifacts
                        try:
                            await self.database.agent_logs.delete_many({"wiki_id": wiki_id, "user_id": user_id}, session=session)
                        except Exception:
                            # Non-fatal: continue even if agent_logs removal fails
                            logger.debug("Failed to remove agent_logs for wiki_id=%s", wiki_id)
            except Exception:
                return False
            return True
        if wiki_id in self._memory["wikis"] and self._memory["wikis"][wiki_id]["user_id"] == user_id:
            del self._memory["wikis"][wiki_id]
            self._memory["wiki_pages"] = {k: v for k, v in self._memory["wiki_pages"].items() if v.get("wiki_id") != wiki_id}
            self._memory["raw_data"] = {k: v for k, v in self._memory["raw_data"].items() if v.get("wiki_id") != wiki_id}
            # Remove in-memory agent_logs for this wiki
            self._memory["agent_logs"] = {k: v for k, v in self._memory["agent_logs"].items() if v.get("wiki_id") != wiki_id}
            return True
        return False

    async def update_wiki_master_note(self, wiki_id: str, user_id: str, master_note: str) -> None:
        """Update the compounded master note and increment source count.
        
        BUG FIX #6: Truncate master_note if it exceeds max length.
        """
        from app.core.config import settings
        
        # Truncate master note if it exceeds max length
        truncated_note = master_note
        if len(master_note) > settings.MASTER_NOTE_MAX_LENGTH:
            truncated_note = master_note[:settings.MASTER_NOTE_MAX_LENGTH - 3].rsplit(" ", 1)[0] + "..."
        
        now = datetime.now(UTC)
        if self.database is not None:
            from bson import ObjectId
            try:
                # Use atomic update to modify master_note and bump source_count + version
                await self.database.wikis.update_one(
                    {"_id": ObjectId(wiki_id), "user_id": user_id},
                    {"$set": {"master_note": truncated_note, "updated_at": now, "last_ingested_at": now},
                     "$inc": {"source_count": 1, "version": 1}},
                )
            except Exception:
                pass
            return
        wiki = self._memory["wikis"].get(wiki_id)
        if wiki and wiki["user_id"] == user_id:
            wiki["master_note"] = truncated_note
            wiki["updated_at"] = now
            wiki["last_ingested_at"] = now
            wiki["source_count"] = wiki.get("source_count", 0) + 1

    async def rollback_wiki_page(self, wiki_page_id: str) -> bool:
        """Delete a wiki page and decrement source count. Used for rollback on graph sync failure."""
        if self.database is not None:
            from bson import ObjectId
            try:
                # Get the page to find its wiki_id
                page = await self.database.wiki_pages.find_one({"_id": ObjectId(wiki_page_id)})
                if not page:
                    return False
                # Delete the page
                await self.database.wiki_pages.delete_one({"_id": ObjectId(wiki_page_id)})
                # Delete raw_data to prevent orphans
                if "raw_data_id" in page:
                    await self.database.raw_data.delete_one({"_id": ObjectId(page["raw_data_id"])})
                # Decrement source count
                await self.database.wikis.update_one(
                    {"_id": ObjectId(page["wiki_id"])},
                    {"$inc": {"source_count": -1}},
                )
                return True
            except Exception:
                return False
        # Memory mode rollback
        if wiki_page_id in self._memory["wiki_pages"]:
            page = self._memory["wiki_pages"].pop(wiki_page_id)
            if "raw_data_id" in page:
                self._memory["raw_data"].pop(page["raw_data_id"], None)
            if page["wiki_id"] in self._memory["wikis"]:
                wiki = self._memory["wikis"][page["wiki_id"]]
                wiki["source_count"] = max(0, wiki.get("source_count", 0) - 1)
            return True
        return False

    async def get_wiki_page(self, page_id: str, user_id: str) -> dict | None:
        """Retrieve a wiki page by ID and user_id."""
        if self.database is not None:
            from bson import ObjectId
            try:
                doc = await self.database.wiki_pages.find_one({"_id": ObjectId(page_id), "user_id": user_id})
                return self._normalize(doc)
            except Exception:
                return None
        page = self._memory["wiki_pages"].get(page_id)
        if page and page["user_id"] == user_id:
            return self._copy(page)
        return None

    async def delete_wiki_page(self, page_id: str, user_id: str) -> dict | None:
        """Delete a wiki page and its raw data, decrement the wiki source count. Returns deleted page."""
        page = await self.get_wiki_page(page_id, user_id)
        if not page:
            return None
            
        wiki_id = page["wiki_id"]
        source_url = page["source_url"]
        
        if self.database is not None:
            from bson import ObjectId
            try:
                result = await self.database.wiki_pages.delete_one({"_id": ObjectId(page_id), "user_id": user_id})
                if result.deleted_count == 0:
                    return None
                
                await self.database.raw_data.delete_one({"wiki_id": wiki_id, "user_id": user_id, "source_url": source_url})
                
                await self.database.wikis.update_one(
                    {"_id": ObjectId(wiki_id), "user_id": user_id},
                    {"$inc": {"source_count": -1}, "$set": {"updated_at": datetime.now(UTC)}}
                )
            except Exception:
                return None
            return page
            
        if page_id in self._memory["wiki_pages"]:
            self._memory["wiki_pages"].pop(page_id)
            raw_id_to_delete = None
            for rid, rdata in self._memory["raw_data"].items():
                if rdata.get("wiki_id") == wiki_id and rdata.get("user_id") == user_id and rdata.get("source_url") == source_url:
                    raw_id_to_delete = rid
                    break
            if raw_id_to_delete:
                self._memory["raw_data"].pop(raw_id_to_delete)
                
            if wiki_id in self._memory["wikis"]:
                wiki = self._memory["wikis"][wiki_id]
                wiki["source_count"] = max(0, wiki.get("source_count", 0) - 1)
                wiki["updated_at"] = datetime.now(UTC)
            return page
        return None

    async def set_wiki_master_note(self, wiki_id: str, user_id: str, master_note: str) -> None:
        """Set the compounded master note without changing the source count."""
        from app.core.config import settings
        
        truncated_note = master_note[:settings.MASTER_NOTE_MAX_LENGTH]
        if len(master_note) > settings.MASTER_NOTE_MAX_LENGTH:
            truncated_note = truncated_note.rsplit(" ", 1)[0] + "..."
            
        now = datetime.now(UTC)
        if self.database is not None:
            from bson import ObjectId
            try:
                await self.database.wikis.update_one(
                    {"_id": ObjectId(wiki_id), "user_id": user_id},
                    {"$set": {"master_note": truncated_note, "updated_at": now},
                     "$inc": {"version": 1}},
                )
            except Exception:
                pass
            return
        wiki = self._memory["wikis"].get(wiki_id)
        if wiki and wiki["user_id"] == user_id:
            wiki["master_note"] = truncated_note
            wiki["updated_at"] = now

    # ── Raw Data ──────────────────────────────────────────────────────────────

    async def store_raw_data(self, payload: dict) -> dict:
        now = datetime.now(UTC)
        document = {**payload, "created_at": now, "updated_at": now}
        if self.database is not None:
            result = await self.database.raw_data.insert_one(document)
            stored = await self.database.raw_data.find_one({"_id": result.inserted_id})
            return self._normalize(stored)
        document["id"] = str(uuid.uuid4())
        self._memory["raw_data"][document["id"]] = document
        return self._copy(document)

    # ── Wiki Pages ────────────────────────────────────────────────────────────

    async def check_source_url_exists(self, wiki_id: str, user_id: str, source_url: str) -> dict | None:
        """Check if a source URL already exists in this wiki. Return the existing page if found."""
        wiki_id = self._sanitize_id(wiki_id)
        query = {"wiki_id": wiki_id, "user_id": user_id, "source_url": source_url}
        if self.database is not None:
            return self._normalize(await self.database.wiki_pages.find_one(query))
        for page in self._memory["wiki_pages"].values():
            if (page.get("wiki_id") == wiki_id and 
                page.get("user_id") == user_id and 
                page.get("source_url") == source_url):
                return self._copy(page)
        return None

    async def create_wiki_page(self, payload: dict) -> dict:
        slug = slugify(payload["title"])
        user_id = payload["user_id"]
        wiki_id = self._sanitize_id(payload.get("wiki_id"))
        
        import re
        version_pattern = re.compile(rf"^{re.escape(slug)}(-v\d+)?$")
        matching_pages = []
        
        if self.database is not None:
            query = {
                "user_id": user_id,
                "slug": {"$regex": rf"^{re.escape(slug)}(-v\d+)?$"}
            }
            if wiki_id:
                query["wiki_id"] = wiki_id
            cursor = self.database.wiki_pages.find(query)
            async for doc in cursor:
                matching_pages.append(self._normalize(doc))
        else:
            for page in self._memory["wiki_pages"].values():
                if (page.get("user_id") == user_id and 
                    (not wiki_id or page.get("wiki_id") == wiki_id) and 
                    version_pattern.match(page.get("slug", ""))):
                    matching_pages.append(self._copy(page))
                
        version = max([page.get("version", 1) for page in matching_pages], default=0) + 1
        
        if version > 1:
            slug = f"{slug}-v{version}"

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

    async def list_wiki_pages(self, user_id: str, *, wiki_id: str | None = None, limit: int = 50) -> list[dict]:
        query: dict = {"user_id": user_id}
        wiki_id = self._sanitize_id(wiki_id)
        if wiki_id:
            query["wiki_id"] = wiki_id
        if self.database is not None:
            cursor = self.database.wiki_pages.find(query).sort("created_at", -1).limit(limit)
            return [self._normalize(item) for item in await cursor.to_list(length=limit)]
        items = [
            self._copy(item) for item in self._memory["wiki_pages"].values()
            if item["user_id"] == user_id and (not wiki_id or item.get("wiki_id") == wiki_id)
        ]
        items.sort(key=lambda item: item["created_at"], reverse=True)
        return items[:limit]

    async def list_recent_ingestions(self, user_id: str, *, wiki_id: str | None = None, limit: int = 20, offset: int = 0) -> list[dict]:
        query: dict = {"user_id": user_id}
        wiki_id = self._sanitize_id(wiki_id)
        if wiki_id:
            query["wiki_id"] = wiki_id
        if self.database is not None:
            cursor = self.database.raw_data.find(query).sort("created_at", -1).skip(offset).limit(limit)
            return [self._normalize(item) for item in await cursor.to_list(length=limit)]
        items = [
            self._copy(item) for item in self._memory["raw_data"].values()
            if item["user_id"] == user_id and (not wiki_id or item.get("wiki_id") == wiki_id)
        ]
        items.sort(key=lambda item: item["created_at"], reverse=True)
        return items[offset:offset+limit]

    async def search_wiki_pages(
        self,
        *,
        user_id: str,
        query: str,
        query_embedding: list[float],
        wiki_id: str | None = None,
        limit: int = 5,
    ) -> list[dict]:
        wiki_id = self._sanitize_id(wiki_id)
        pages = await self.list_wiki_pages(user_id=user_id, wiki_id=wiki_id, limit=200)
        scored: list[dict] = []
        for page in pages:
            searchable = " ".join([
                page.get("title", ""),
                page.get("summary", ""),
                page.get("content", ""),
                " ".join(page.get("concepts", [])),
            ])
            vector_score = cosine_similarity(query_embedding, page.get("embedding", []))
            lexical_score = keyword_score(query, searchable)
            score = (0.7 * vector_score) + (0.3 * lexical_score)
            if score > 0:
                scored.append({**page, "score": round(score, 4)})
        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored[:limit]

    async def count_wiki_pages(self, user_id: str, wiki_id: str | None = None) -> int:
        wiki_id = self._sanitize_id(wiki_id)
        query: dict = {"user_id": user_id}
        if wiki_id:
            query["wiki_id"] = wiki_id
        if self.database is not None:
            return await self.database.wiki_pages.count_documents(query)
        return sum(
            1 for item in self._memory["wiki_pages"].values()
            if item["user_id"] == user_id and (not wiki_id or item.get("wiki_id") == wiki_id)
        )

    # ── Agent Logs ────────────────────────────────────────────────────────────

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