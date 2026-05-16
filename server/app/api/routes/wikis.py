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

from app.api.deps import get_current_user
from app.db.mongo import get_mongo_manager
from app.schemas.wikis import WikiCreateRequest, WikiListResponse, WikiResponse, WikiUpdateRequest
from app.services.graph_service import get_graph_service
from app.utils.errors import AppError


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
    # Delete graph nodes first (Neo4j), then MongoDB data
    await get_graph_service().delete_wiki_graph(
        user_id=current_user["id"],
        wiki_id=wiki_id,
    )
    deleted = await get_mongo_manager().delete_wiki(wiki_id, current_user["id"])
    if not deleted:
        raise AppError(status_code=404, code="wiki_not_found", message="Wiki not found.")