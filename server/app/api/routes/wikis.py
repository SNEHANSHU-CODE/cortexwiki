"""
app/api/routes/wikis.py

Wiki management endpoints.

A wiki is a named knowledge namespace. All sources, pages, graph nodes,
and the compounded master note belong to exactly one wiki.

Routes:
  POST   /api/wikis          → create a new wiki
  GET    /api/wikis          → list all wikis for current user
  GET    /api/wikis/:id      → get a single wiki (includes master_note)
  PATCH  /api/wikis/:id      → rename or update description
  DELETE /api/wikis/:id      → delete wiki + all its data (cascade)
"""

from fastapi import APIRouter, Depends, Response, Query

from app.api.deps import get_current_user, validate_wiki_id
from app.db.mongo import get_mongo_manager
from app.services.llm import get_llm_service
from app.core.config import settings
import json
import re
import httpx
import asyncio
from app.schemas.wikis import WikiCreateRequest, WikiListResponse, WikiResponse, WikiSummaryResponse, WikiUpdateRequest
from app.services.graph_service import get_graph_service
from app.utils.errors import AppError
from app.utils.logging import get_logger


router = APIRouter(prefix="/wikis", tags=["wikis"])


def _to_wiki_response(wiki: dict) -> WikiResponse:
    return WikiResponse(
        id=wiki["id"],
        user_id=wiki["user_id"],
        name=wiki["name"],
        description=wiki.get("description", ""),
        master_note=wiki.get("master_note", ""),
        is_public=wiki.get("is_public", False),
        slug=wiki.get("slug"),
        source_count=wiki.get("source_count", 0),
        visits=wiki.get("visits", 0),
        likes=wiki.get("likes", 0),
        created_at=wiki["created_at"],
        updated_at=wiki["updated_at"],
        last_ingested_at=wiki.get("last_ingested_at"),
    )


def _to_wiki_summary_response(wiki: dict) -> WikiSummaryResponse:
    return WikiSummaryResponse(
        id=wiki["id"],
        user_id=wiki["user_id"],
        name=wiki["name"],
        description=wiki.get("description", ""),
        master_note_excerpt=wiki.get("master_note_excerpt", wiki.get("master_note", "")[:300]),
        is_public=wiki.get("is_public", False),
        slug=wiki.get("slug"),
        source_count=wiki.get("source_count", 0),
        visits=wiki.get("visits", 0),
        likes=wiki.get("likes", 0),
        created_at=wiki["created_at"],
        updated_at=wiki["updated_at"],
        last_ingested_at=wiki.get("last_ingested_at"),
    )


@router.post("", response_model=WikiResponse, status_code=201)
async def create_wiki(
    payload: WikiCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    wiki = await get_mongo_manager().create_wiki({
        "user_id": current_user["id"],
        "name": payload.name,
        "description": payload.description,
    })
    return _to_wiki_response(wiki)


@router.get("", response_model=WikiListResponse)
async def list_wikis(current_user: dict = Depends(get_current_user)):
    wikis = await get_mongo_manager().list_wikis(current_user["id"])
    return WikiListResponse(
        wikis=[_to_wiki_summary_response(w) for w in wikis],
        total=len(wikis),
    )


from pydantic import BaseModel
class WikiPublicToggleRequest(BaseModel):
    is_public: bool


@router.patch("/{wiki_id}/public", response_model=WikiResponse)
async def toggle_wiki_public(
    wiki_id: str,
    payload: WikiPublicToggleRequest,
    current_user: dict = Depends(get_current_user),
):
    await validate_wiki_id(wiki_id)
    wiki = await get_mongo_manager().update_wiki_public_status(wiki_id, current_user["id"], payload.is_public)
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Wiki not found.")
    return _to_wiki_response(wiki)


@router.get("/public", response_model=WikiListResponse)
async def search_public_wikis(
    search: str = Query("", description="Search term for public wikis"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=100, description="Number of records to return"),
    sort_by: str = Query("newest", description="Sorting criteria (newest, popular, likes, relevant)")
):
    wikis, total = await get_mongo_manager().search_public_wikis(search=search, skip=skip, limit=limit, sort_by=sort_by)
    return WikiListResponse(
        wikis=[_to_wiki_summary_response(w) for w in wikis],
        total=total,
    )


@router.get("/public/{slug}", response_model=WikiResponse)
async def get_public_wiki_by_slug(slug: str):
    wiki = await get_mongo_manager().get_public_wiki_by_slug(slug)
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Public wiki not found.")
    return _to_wiki_response(wiki)


@router.post("/public/{slug}/like", response_model=WikiResponse)
async def like_public_wiki_by_slug(slug: str):
    wiki = await get_mongo_manager().increment_public_wiki_likes(slug)
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Public wiki not found.")
    return _to_wiki_response(wiki)

@router.post("/public/{slug}/visit", response_model=WikiResponse)
async def visit_public_wiki_by_slug(slug: str):
    wiki = await get_mongo_manager().increment_public_wiki_visits(slug)
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Public wiki not found.")
    return _to_wiki_response(wiki)


@router.get("/{wiki_id}", response_model=WikiResponse)
async def get_wiki(
    wiki_id: str,
    current_user: dict = Depends(get_current_user),
):
    # BUG FIX #5: Validate wiki_id format using centralized validator
    await validate_wiki_id(wiki_id)

    wiki = await get_mongo_manager().get_wiki(wiki_id, current_user["id"])
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Wiki not found.")
    return _to_wiki_response(wiki)


@router.patch("/{wiki_id}", response_model=WikiResponse)
async def update_wiki(
    wiki_id: str,
    payload: WikiUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    # BUG FIX #5: Validate wiki_id format using centralized validator
    await validate_wiki_id(wiki_id)

    # Build only the fields that were actually provided
    update_data = payload.model_dump(exclude_none=True)
    if not update_data:
        raise AppError(status_code=400, code="no_fields", message="No fields provided to update.")

    wiki = await get_mongo_manager().update_wiki(wiki_id, current_user["id"], update_data)
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Wiki not found.")
    return _to_wiki_response(wiki)


@router.delete("/{wiki_id}", status_code=204)
async def delete_wiki(
    wiki_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Delete wiki and all associated data.

    FIX #3: Delete MongoDB first (source of truth), then Neo4j.
    If Neo4j deletion fails, the wiki is already gone from primary store.
    """
    # BUG FIX #5: Validate wiki_id format using centralized validator
    await validate_wiki_id(wiki_id)

    mongo = get_mongo_manager()
    graph_service = get_graph_service()
    logger = get_logger("api.routes.wikis")

    # Verify wiki exists and belongs to user before attempting deletion
    wiki = await mongo.get_wiki(wiki_id, current_user["id"])
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Wiki not found.")

    # ── DELETE FROM MONGODB FIRST (PRIMARY STORE) ──
    try:
        deleted = await mongo.delete_wiki(wiki_id, current_user["id"])
        if not deleted:
            raise AppError(status_code=404, code="wiki_not_found", message="Wiki not found.")
    except AppError:
        raise
    except Exception as exc:
        raise AppError(
            status_code=500,
            code="wiki_deletion_failed",
            message="Failed to delete wiki from database.",
        ) from exc

    # ── DELETE FROM NEO4J (SECONDARY STORE) ──
    # Failure here doesn't prevent the response since wiki is already deleted from MongoDB
    try:
        await graph_service.delete_wiki_graph(
            user_id=current_user["id"],
            wiki_id=wiki_id,
        )
    except Exception as exc:
        # Log the error but don't fail the request
        # The wiki is already deleted from MongoDB (source of truth)
        logger.warning("Failed to delete wiki graph from Neo4j: wiki_id=%s, error=%s", wiki_id, str(exc))

    return Response(status_code=204)

@router.post("/{wiki_id}/mcq")
async def generate_mcq(
    wiki_id: str,
    current_user: dict = Depends(get_current_user),
    mongo=Depends(get_mongo_manager),
):
    wiki = await mongo.get_wiki(wiki_id, current_user["id"])
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Wiki not found.")

    text = wiki.get("master_note") or wiki.get("summary") or wiki.get("description") or ""
    if not text:
        raise AppError(status_code=400, code="no_content", message="Wiki has no content to quiz.")

    import random
    char_limit = settings.QUIZ_MAX_INPUT_TOKENS * 4
    if len(text) > char_limit:
        start_idx = random.randint(0, len(text) - char_limit)
        truncated_text = text[start_idx : start_idx + char_limit]
    else:
        truncated_text = text

    prompt = (
        f"Generate 5 high-quality Multiple Choice Questions based on this text:\n\n{truncated_text}\n\n"
        "Return the output as a strict JSON array of objects EXACTLY in this format, with no markdown code blocks:\n"
        '[\n'
        '  {\n'
        '    "q": "Question text here?",\n'
        '    "options": ["Option A", "Option B", "Option C", "Option D"],\n'
        '    "answer": 2\n'
        '  }\n'
        ']\n'
        '"answer" must be the integer index (0, 1, 2, or 3) of the correct option.'
    )

    api_key = settings.QUIZ_API_KEY or settings.GROQ_API_KEY
    if not api_key:
        raise AppError(status_code=500, code="config_error", message="No Quiz API key configured.")

    payload = {
        "model": settings.QUIZ_MODEL,
        "messages": [
            {"role": "system", "content": "You are a JSON-only API. Output raw JSON array and nothing else."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2,
        "max_tokens": settings.QUIZ_TOKEN_LIMIT
    }

    max_retries = 3
    base_delay = 1.0

    result = ""
    last_exception = None

    async with httpx.AsyncClient() as client:
        for attempt in range(max_retries):
            try:
                response = await client.post(
                    f"{settings.GROQ_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json=payload,
                    timeout=settings.LLM_REQUEST_TIMEOUT
                )
                response.raise_for_status()
                data = response.json()
                result = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                break  # Success, exit the retry loop
            except httpx.HTTPStatusError as exc:
                last_exception = exc
                # Only retry on 429 Too Many Requests or 5xx Server Errors
                if exc.response.status_code not in (429, 500, 502, 503, 504):
                    raise AppError(status_code=500, code="llm_error", message=f"Quiz API failed: {str(exc)}")
                
                if attempt < max_retries - 1:
                    await asyncio.sleep(base_delay * (2 ** attempt))  # Exponential backoff: 1s, 2s
            except Exception as exc:
                last_exception = exc
                if attempt < max_retries - 1:
                    await asyncio.sleep(base_delay * (2 ** attempt))
        else:
            # If the loop finishes without breaking, all retries failed
            raise AppError(status_code=500, code="llm_error", message=f"Quiz API failed after {max_retries} attempts: {str(last_exception)}")
    
    match = re.search(r'\[.*\]', result, re.DOTALL)
    if match:
        result = match.group(0)
    
    try:
        mcqs = json.loads(result.strip())
        return {"mcqs": mcqs}
    except json.JSONDecodeError:
        raise AppError(status_code=500, code="llm_error", message="Failed to generate multiple choice questions.")
