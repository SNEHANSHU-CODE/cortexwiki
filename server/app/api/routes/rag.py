"""
app/api/routes/rag.py

RAG (Retrieval-Augmented Generation) pipeline admin endpoints.

Routes:
  GET  /api/rag/status             → Embedding pipeline progress (total / processed / pending)
  POST /api/rag/reset-and-reembed  → Clear stale embeddings and re-embed all pages at current dimensions

Background:
  The MongoDB Atlas $vectorSearch index must match the embedding model's output
  dimensions. If the model changed (e.g. from 768-dim to 3072-dim gemini-embedding-001),
  all existing embeddings become stale. These endpoints allow an admin to reset the
  pipeline without touching the database manually.

  IMPORTANT: After calling POST /api/rag/reset-and-reembed, the Atlas vector index
  (vector_index) must also be recreated with numDimensions: 3072. See the project
  README for the Atlas UI steps to recreate the index.
"""

import asyncio
from fastapi import APIRouter, BackgroundTasks, Depends

from app.api.deps import get_current_user
from app.db.mongo import get_mongo_manager
from app.services.llm import get_llm_service
from app.utils.logging import get_logger

router = APIRouter(prefix="/rag", tags=["rag"])
logger = get_logger("api.routes.rag")


# ── GET /api/rag/status ───────────────────────────────────────────────────────

@router.get("/status")
async def rag_status(current_user: dict = Depends(get_current_user)) -> dict:
    """
    Returns the embedding pipeline status for the current user.

    Response shape:
        {
            "sources": { "total": 10, "processed": 8, "pending": 2 },
            "embeddings": { "total_chunks": 8 }
        }

    Poll this endpoint after calling POST /api/rag/reset-and-reembed to track
    re-embedding progress. When pending reaches 0, the pipeline is complete.
    """
    mongo = get_mongo_manager()
    return await mongo.rag_status(user_id=current_user["id"])


# ── POST /api/rag/reset-and-reembed ──────────────────────────────────────────

async def _reembed_all_pages(user_id: str) -> None:
    """
    Background task: iterate over all pages without a valid embedding and
    re-generate them using the current embedding model (gemini-embedding-001,
    3072-dim). Pages are processed one-by-one to avoid overwhelming the Gemini
    API rate limit.
    """
    mongo = get_mongo_manager()
    llm = get_llm_service()

    logger.info("RAG re-embed job started for user_id=%s", user_id)
    batch_size = 50
    total_updated = 0
    total_failed = 0

    while True:
        pages = await mongo.rag_list_pages_without_embedding(limit=batch_size)
        if not pages:
            break

        for page in pages:
            page_id = page.get("id")
            title = page.get("title", "")
            summary = page.get("summary", "")
            content = page.get("content", "")

            try:
                # Build the same text representation used at ingest time
                embed_text = f"{title}\n{summary}\n{content[:4000]}"
                embedding = await llm.embed_text(embed_text)
                await mongo.rag_update_page_embedding(page_id, embedding)
                total_updated += 1
                logger.debug(
                    "Re-embedded page_id=%s title=%r (dim=%d)",
                    page_id, title, len(embedding),
                )
            except Exception as exc:
                total_failed += 1
                logger.warning(
                    "Failed to re-embed page_id=%s title=%r: %s",
                    page_id, title, exc,
                )

            # Small delay to respect Gemini embedding API rate limits
            await asyncio.sleep(0.1)

        # If we got fewer pages than the batch size, we're done
        if len(pages) < batch_size:
            break

    logger.info(
        "RAG re-embed job finished for user_id=%s: updated=%d failed=%d",
        user_id, total_updated, total_failed,
    )


@router.post("/reset-and-reembed")
async def rag_reset_and_reembed(
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Reset all stale embeddings and re-embed every wiki page at the current
    embedding model's dimensions (3072-dim for gemini-embedding-001).

    Steps performed:
      1. Strip the `embedding` field from all wiki_pages for this user.
      2. Kick off a background task that re-generates embeddings page-by-page.

    IMPORTANT: Before calling this endpoint, you MUST recreate the Atlas
    vector_index with numDimensions: 3072. Otherwise the re-embedded vectors
    will still fail to match the index dimensions.

    Returns:
        {
            "embeddings_cleared": 42,
            "pipeline_triggered": true,
            "message": "..."
        }

    Poll GET /api/rag/status to track progress.
    """
    mongo = get_mongo_manager()

    # Step 1 — Clear all stale embeddings for this user
    embeddings_cleared = await mongo.rag_clear_embeddings(user_id=current_user["id"])
    logger.info(
        "RAG reset: cleared %d stale embeddings for user_id=%s",
        embeddings_cleared, current_user["id"],
    )

    # Step 2 — Schedule background re-embedding job
    background_tasks.add_task(_reembed_all_pages, current_user["id"])

    return {
        "embeddings_cleared": embeddings_cleared,
        "pipeline_triggered": True,
        "message": (
            f"Cleared {embeddings_cleared} stale embeddings. "
            "Re-embedding is running in the background. "
            "Poll GET /api/rag/status to track progress."
        ),
    }
