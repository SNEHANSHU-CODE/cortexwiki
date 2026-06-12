import re
from urllib.parse import urlparse
from app.services.graph_service import get_graph_service
from app.services.llm import get_llm_service
from app.db.mongo import get_mongo_manager
from app.core.config import settings
from app.core.redis import get_redis_store
from app.utils.errors import AppError
from app.utils.logging import get_logger

logger = get_logger("services.ingestion")


class IngestionService:
    def __init__(self) -> None:
        pass

    @property
    def mongo(self):
        return get_mongo_manager()

    @property
    def llm(self):
        return get_llm_service()

    @property
    def graph_service(self):
        return get_graph_service()

    @property
    def redis_store(self):
        return get_redis_store()

    async def ingest_source(
        self,
        *,
        user_id: str,
        wiki_id: str,
        title: str,
        source_type: str,
        source_url: str,
        raw_content: str,
    ) -> dict:
        """
        Ingest a source with proper locking, validation, limits, and atomic error handling.
        """
        # ── VALIDATE URL INPUT ──
        source_url = source_url.strip()
        if not source_url:
            raise AppError(
                status_code=400,
                code="url_empty",
                message="URL cannot be empty.",
            )
        if len(source_url) > 2048:
            raise AppError(
                status_code=400,
                code="url_too_long",
                message="URL length exceeds 2048 characters.",
            )
        if source_type != "pdf":
            if not source_url.startswith(("http://", "https://")):
                raise AppError(
                    status_code=400,
                    code="invalid_url_protocol",
                    message="URL must start with http:// or https://",
                )
            if any(char in source_url for char in ['\x00', '\r', '\n', '\t']):
                raise AppError(
                    status_code=400,
                    code="url_invalid_characters",
                    message="URL contains invalid characters.",
                )
            parsed_url = urlparse(source_url)
            hostname = parsed_url.hostname or ""
            if hostname in ["localhost", "127.0.0.1", "0.0.0.0"] or hostname.startswith("192.168.") or hostname.startswith("10."):
                raise AppError(
                    status_code=400,
                    code="url_blocked_local",
                    message="Local network URLs are not allowed.",
                )
        
        # ── CHECK DUPLICATE SOURCE ──
        existing_page = await self.mongo.check_source_url_exists(wiki_id, user_id, source_url)
        if existing_page:
            logger.info("Source already ingested: source_url=%s, existing_page_id=%s", source_url, existing_page["id"])
            return {
                "wiki_page": existing_page,
                "summary": existing_page.get("summary", ""),
                "concepts": existing_page.get("concepts", []),
                "conflicts": [{"type": "duplicate_source", "message": f"This source was already ingested on {existing_page.get('created_at')}"}],
            }

        # ── CHECK SOURCE COUNT LIMIT ──
        wiki = await self.mongo.get_wiki(wiki_id, user_id)
        if wiki and wiki.get("source_count", 0) >= settings.MAX_SOURCES_PER_WIKI:
            raise AppError(
                status_code=429,
                code="wiki_source_limit_exceeded",
                message=f"This wiki has reached the limit of {settings.MAX_SOURCES_PER_WIKI} sources. Delete some sources to add more.",
            )

        # ── ACQUIRE WIKI LOCK ──
        wiki_lock = await self.redis_store.acquire_wiki_ingest_lock(wiki_id)
        
        async with wiki_lock:
            logger.info("Acquired ingest lock for wiki_id=%s", wiki_id)

            # Summarise new source
            summary = await self.llm.summarize(raw_content)

            # Compound master note: merge new summary into existing wiki note
            wiki = await self.mongo.get_wiki(wiki_id, user_id)
            existing_note = wiki.get("master_note", "") if wiki else ""
            master_note = await self.llm.merge_notes(
                existing_note=existing_note,
                new_summary=summary,
                new_title=title,
                raw_content=raw_content,
            )

            # Build graph payload
            concept_nodes, relationships = self.graph_service.build_graph_payload(
                title=title,
                summary=summary,
                content=raw_content,
            )
            concepts = [node["id"] for node in concept_nodes]
            embedding = await self.llm.embed_text(f"{title}\n{summary}\n{raw_content[:4000]}")

            # Store raw source
            raw_record = await self.mongo.store_raw_data({
                "user_id": user_id,
                "wiki_id": wiki_id,
                "title": title,
                "source_type": source_type,
                "source_url": source_url,
                "content": raw_content,
                "summary": summary,
                "concepts": concepts,
            })

            # Store wiki page (source record)
            wiki_page = await self.mongo.create_wiki_page({
                "user_id": user_id,
                "wiki_id": wiki_id,
                "title": title,
                "summary": summary,
                "content": raw_content,
                "source_type": source_type,
                "source_url": source_url,
                "concepts": concepts,
                "relationships": relationships,
                "embedding": embedding,
                "raw_data_id": raw_record["id"],
            })

            # ── SYNC GRAPH WITH ERROR HANDLING ──
            try:
                await self.graph_service.sync_page_graph(
                    user_id=user_id,
                    wiki_id=wiki_id,
                    page_id=wiki_page["id"],
                    nodes=concept_nodes,
                    edges=relationships,
                )
                logger.info("Graph synced successfully for page_id=%s", wiki_page["id"])
            except Exception as exc:
                logger.error("Graph sync failed for page_id=%s, rolling back: %s", wiki_page["id"], str(exc))
                try:
                    rollback_success = await self.mongo.rollback_wiki_page(wiki_page["id"])
                    if rollback_success:
                        logger.info("Successfully rolled back wiki_page_id=%s", wiki_page["id"])
                        raise AppError(
                            status_code=500,
                            code="graph_sync_failed_rollback",
                            message="Graph sync failed. Source ingestion was rolled back. Please try again.",
                        )
                    else:
                        logger.error("Rollback failed for wiki_page_id=%s", wiki_page["id"])
                        raise AppError(
                            status_code=500,
                            code="graph_sync_failed_no_rollback",
                            message="Graph sync failed and automatic rollback failed. Manual cleanup may be needed.",
                        )
                except AppError:
                    raise
                except Exception as rollback_exc:
                    logger.error("Unexpected error during rollback: %s", str(rollback_exc))
                    raise AppError(
                        status_code=500,
                        code="graph_sync_failed_rollback_error",
                        message="Graph sync and rollback both failed. Please contact support.",
                    ) from rollback_exc

            # Update wiki master note + source count
            await self.mongo.update_wiki_master_note(wiki_id, user_id, master_note)
            logger.info("Updated master_note for wiki_id=%s", wiki_id)

            await self.mongo.create_agent_log({
                "user_id": user_id,
                "wiki_id": wiki_id,
                "event_type": "ingest",
                "event_name": "source_ingested",
                "details": {
                    "title": title,
                    "source_type": source_type,
                    "concept_count": len(concepts),
                    "relationship_count": len(relationships),
                },
            })

            return {
                "wiki_page": wiki_page,
                "summary": summary,
                "concepts": concepts,
                "conflicts": [],
            }


ingestion_service = IngestionService()


def get_ingestion_service() -> IngestionService:
    return ingestion_service
