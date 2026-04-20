from fastapi import APIRouter, Depends, Query

from app.api.deps import get_current_user
from app.schemas.graph import GraphData, GraphEdgeData, GraphNodeData
from app.services.graph_service import get_graph_service


router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("", response_model=GraphData)
async def get_graph(
    topic: str = Query(default="", max_length=120),
    current_user: dict = Depends(get_current_user),
):
    result = await get_graph_service().get_topic_graph(
        user_id=current_user["id"],
        topic=topic,
    )
    return GraphData(
        nodes=[GraphNodeData(**node) for node in result["nodes"]],
        edges=[GraphEdgeData(**edge) for edge in result["edges"]],
    )