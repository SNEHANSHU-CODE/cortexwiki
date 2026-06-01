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

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, validate_wiki_id
from app.db.mongo import get_mongo_manager
from app.schemas.wikis import WikiCreateRequest, WikiListResponse, WikiResponse, WikiUpdateRequest
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
        source_count=wiki.get("source_count", 0),
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
        wikis=[_to_wiki_response(w) for w in wikis],
        total=len(wikis),
    )


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
    # BUG FIX #5: Validate wiki_id format using centralized validator
    await validate_wiki_id(wiki_id)
    
    """
    Delete wiki and all associated data.
    
    FIX #3: Delete MongoDB first (source of truth), then Neo4j.
    If Neo4j deletion fails, the wiki is already gone from primary store.
    """
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