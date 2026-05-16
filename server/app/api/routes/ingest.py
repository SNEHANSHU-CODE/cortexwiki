from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.db.mongo import get_mongo_manager
from app.schemas.ingest import IngestData, IngestHistoryItem, WebIngestRequest, YouTubeIngestRequest
from app.services.graph_service import get_graph_service
from app.services.llm import get_llm_service
from app.utils.errors import AppError
from app.utils.web import fetch_web_page_content, fetch_youtube_content


router = APIRouter(prefix="/ingest", tags=["ingest"])


async def _validate_wiki(wiki_id: str, user_id: str) -> dict:
    """Ensure wiki exists and belongs to user."""
    wiki = await get_mongo_manager().get_wiki(wiki_id, user_id)
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Wiki not found.")
    return wiki


def _build_ingest_response(result: dict) -> IngestData:
    page = result["wiki_page"]
    return IngestData(
        id=page["id"],
        wiki_id=page["wiki_id"],
        title=page["title"],
        source_type=page["source_type"],
        source_url=page["source_url"],
        summary=result["summary"],
        concepts=result["concepts"],
        conflicts=result["conflicts"],
        created_at=page["created_at"],
    )


@router.post("/youtube", response_model=IngestData)
async def ingest_youtube(payload: YouTubeIngestRequest, current_user: dict = Depends(get_current_user)):
    await _validate_wiki(payload.wiki_id, current_user["id"])
    source = await fetch_youtube_content(str(payload.url))
    result = await _ingest_source(
        user_id=current_user["id"],
        wiki_id=payload.wiki_id,
        title=source["title"],
        source_type=source["source_type"],
        source_url=source["source_url"],
        raw_content=source["content"],
    )
    return _build_ingest_response(result)


@router.post("/web", response_model=IngestData)
async def ingest_web(payload: WebIngestRequest, current_user: dict = Depends(get_current_user)):
    await _validate_wiki(payload.wiki_id, current_user["id"])
    source = await fetch_web_page_content(str(payload.url))
    result = await _ingest_source(
        user_id=current_user["id"],
        wiki_id=payload.wiki_id,
        title=source["title"],
        source_type=source["source_type"],
        source_url=source["source_url"],
        raw_content=source["content"],
    )
    return _build_ingest_response(result)


@router.get("/history", response_model=list[IngestHistoryItem])
async def ingest_history(
    wiki_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    items = await get_mongo_manager().list_recent_ingestions(
        current_user["id"],
        wiki_id=wiki_id,
        limit=25,
    )
    return [
        IngestHistoryItem(
            id=item["id"],
            wiki_id=item.get("wiki_id"),
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
    wiki_id: str,
    title: str,
    source_type: str,
    source_url: str,
    raw_content: str,
) -> dict:
    mongo = get_mongo_manager()
    llm = get_llm_service()
    graph_service = get_graph_service()

    # Summarise new source
    summary = await llm.summarize(raw_content)

    # Compound master note: merge new summary into existing wiki note
    wiki = await mongo.get_wiki(wiki_id, user_id)
    existing_note = wiki.get("master_note", "") if wiki else ""
    master_note = await llm.merge_notes(
        existing_note=existing_note,
        new_summary=summary,
        new_title=title,
    )

    # Build graph payload
    concept_nodes, relationships = graph_service.build_graph_payload(
        title=title,
        summary=summary,
        content=raw_content,
    )
    concepts = [node["id"] for node in concept_nodes]
    embedding = await llm.embed_text(f"{title}\n{summary}\n{raw_content[:4000]}")

    # Store raw source
    raw_record = await mongo.store_raw_data({
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
    wiki_page = await mongo.create_wiki_page({
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

    # Update wiki master note + source count
    await mongo.update_wiki_master_note(wiki_id, user_id, master_note)

    # Sync graph — scoped to wiki
    await graph_service.sync_page_graph(
        user_id=user_id,
        wiki_id=wiki_id,
        page_id=wiki_page["id"],
        nodes=concept_nodes,
        edges=relationships,
    )

    await mongo.create_agent_log({
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