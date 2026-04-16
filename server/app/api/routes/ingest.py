from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.schemas.ingest import IngestHistoryItem, IngestResponse, WebIngestRequest, YouTubeIngestRequest
from app.services.graph_service import get_graph_service
from app.services.llm import get_llm_service
from app.utils.web import fetch_web_page_content, fetch_youtube_content
from modules.db.mongo import get_mongo_manager


router = APIRouter(prefix="/ingest", tags=["ingest"])


def _build_ingest_response(result: dict) -> IngestResponse:
    page = result["wiki_page"]
    return IngestResponse(
        id=page["id"],
        title=page["title"],
        source_type=page["source_type"],
        source_url=page["source_url"],
        summary=result["summary"],
        concepts=result["concepts"],
        conflicts=result["conflicts"],
        created_at=page["created_at"],
    )


@router.post("/youtube", response_model=IngestResponse)
async def ingest_youtube(payload: YouTubeIngestRequest, current_user: dict = Depends(get_current_user)):
    source = await fetch_youtube_content(str(payload.url))
    result = await _ingest_source(
        user_id=current_user["id"],
        title=source["title"],
        source_type=source["source_type"],
        source_url=source["source_url"],
        raw_content=source["content"],
    )
    return _build_ingest_response(result)


@router.post("/web", response_model=IngestResponse)
async def ingest_web(payload: WebIngestRequest, current_user: dict = Depends(get_current_user)):
    source = await fetch_web_page_content(str(payload.url))
    result = await _ingest_source(
        user_id=current_user["id"],
        title=source["title"],
        source_type=source["source_type"],
        source_url=source["source_url"],
        raw_content=source["content"],
    )
    return _build_ingest_response(result)


@router.get("/history", response_model=list[IngestHistoryItem])
async def ingest_history(current_user: dict = Depends(get_current_user)):
    items = await get_mongo_manager().list_recent_ingestions(current_user["id"], limit=25)
    return [
        IngestHistoryItem(
            id=item["id"],
            title=item["title"],
            source_type=item["source_type"],
            source_url=item["source_url"],
            summary=item.get("summary", ""),
            created_at=item["created_at"],
        )
        for item in items
    ]


async def _ingest_source(
    *,
    user_id: str,
    title: str,
    source_type: str,
    source_url: str,
    raw_content: str,
) -> dict:
    mongo = get_mongo_manager()
    llm = get_llm_service()
    graph_service = get_graph_service()

    summary = await llm.summarize(raw_content)
    concept_nodes, relationships = graph_service.build_graph_payload(
        title=title,
        summary=summary,
        content=raw_content,
    )
    concepts = [node["id"] for node in concept_nodes]
    embedding = await llm.embed_text(f"{title}\n{summary}\n{raw_content[:4000]}")

    raw_record = await mongo.store_raw_data(
        {
            "user_id": user_id,
            "title": title,
            "source_type": source_type,
            "source_url": source_url,
            "content": raw_content,
            "summary": summary,
            "concepts": concepts,
        }
    )
    wiki_page = await mongo.create_wiki_page(
        {
            "user_id": user_id,
            "title": title,
            "summary": summary,
            "content": raw_content,
            "source_type": source_type,
            "source_url": source_url,
            "concepts": concepts,
            "relationships": relationships,
            "embedding": embedding,
            "raw_data_id": raw_record["id"],
        }
    )

    await graph_service.sync_page_graph(
        user_id=user_id,
        page_id=wiki_page["id"],
        nodes=concept_nodes,
        edges=relationships,
    )

    await mongo.create_agent_log(
        {
            "user_id": user_id,
            "event_type": "ingest",
            "event_name": "source_ingested",
            "details": {
                "title": title,
                "source_type": source_type,
                "concept_count": len(concepts),
                "relationship_count": len(relationships),
            },
        }
    )

    return {
        "wiki_page": wiki_page,
        "summary": summary,
        "concepts": concepts,
        "conflicts": [],
    }