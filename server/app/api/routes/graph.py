from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user
from app.db.mongo import get_mongo_manager
from app.schemas.graph import GraphData, GraphEdgeData, GraphNodeData
from app.services.graph_service import get_graph_service
from app.utils.errors import AppError


router = APIRouter(prefix="/graph", tags=["graph"])


async def _validate_wiki(wiki_id: str, user_id: str) -> dict:
    wiki = await get_mongo_manager().get_wiki(wiki_id, user_id)
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Wiki not found.")
    return wiki


@router.get("", response_model=GraphData)
async def get_graph(
    wiki_id: str = Query(..., description="Wiki to fetch graph for"),
    topic: str = Query(default="", max_length=120),
    current_user: dict = Depends(get_current_user),
):
    await _validate_wiki(wiki_id, current_user["id"])

    result = await get_graph_service().get_topic_graph(
        user_id=current_user["id"],
        wiki_id=wiki_id,
        topic=topic,
    )
    return GraphData(
        nodes=[GraphNodeData(**node) for node in result["nodes"]],
        edges=[GraphEdgeData(**edge) for edge in result["edges"]],
    )