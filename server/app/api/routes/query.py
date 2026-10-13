import re
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.mongo import get_mongo_manager
from app.schemas.query import QueryData, QueryRequest, QuerySource
from app.services.graph_service import get_graph_service
from app.services.llm import get_llm_service
from app.utils.errors import AppError
from app.utils.text import clean_text
import uuid


router = APIRouter(prefix="/query", tags=["query"])

_NO_KNOWLEDGE_RESPONSE = QueryData(
    answer="I do not have enough ingested knowledge to answer that yet. Add a source to this wiki first, then ask again.",
    strategy="knowledge_base",
    confidence=0.18,
    is_grounded=False,
    sources=[],
)


async def _validate_wiki(wiki_id: str, user_id: str) -> dict:
    wiki = await get_mongo_manager().get_wiki(wiki_id, user_id)
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Wiki not found.")
    return wiki


def settings_has_llm() -> bool:
    from app.core.config import settings
    return bool(settings.GROQ_API_KEY or settings.GEMINI_API_KEY)


@router.post("", response_model=QueryData)
async def query(payload: QueryRequest, current_user: dict = Depends(get_current_user)):
    # wiki_id is required — every query is scoped to a wiki
    if not payload.wiki_id:
        raise AppError(status_code=400, code="wiki_id_required", message="wiki_id is required.")

    # Validate wiki_id format
    from bson import ObjectId
    if not ObjectId.is_valid(payload.wiki_id):
        raise AppError(status_code=400, code="invalid_wiki_id", message="Invalid wiki ID format.")

    # In production, silently ignore debug metadata rather than rejecting the request with a 400 error.
    debug_enabled = payload.debug and settings.ENVIRONMENT != "production"

    await _validate_wiki(payload.wiki_id, current_user["id"])

    # Set user context variable for token usage tracking
    from app.services.llm import user_id_ctx
    user_id_ctx.set(current_user["id"])

    mongo = get_mongo_manager()

    # Save user message
    user_msg_id = uuid.uuid4().hex
    await mongo.save_chat_message(current_user["id"], payload.wiki_id, user_msg_id, "user", payload.question)

    from app.agents.graph import get_query_agent_graph
    agent_graph = get_query_agent_graph()

    result = await agent_graph.run(
        user_id=current_user["id"],
        wiki_id=payload.wiki_id,
        question=payload.question,
        debug=debug_enabled,
        allow_internet=payload.allow_internet,
    )

    assistant_msg_id = uuid.uuid4().hex
    await mongo.save_chat_message(
        current_user["id"],
        payload.wiki_id,
        assistant_msg_id,
        "assistant",
        result.answer,
        "complete",
        result.debug,
    )

    return result


@router.get("/history")
async def get_history(wiki_id: str, current_user: dict = Depends(get_current_user)):
    from bson import ObjectId
    if not ObjectId.is_valid(wiki_id):
        raise AppError(status_code=400, code="invalid_wiki_id", message="Invalid wiki ID format.")
    await _validate_wiki(wiki_id, current_user["id"])
    
    mongo = get_mongo_manager()
    history = await mongo.get_chat_history(current_user["id"], wiki_id)
    return {"messages": history}


@router.delete("/history", status_code=204)
async def delete_history(wiki_id: str, current_user: dict = Depends(get_current_user)):
    from bson import ObjectId
    if not ObjectId.is_valid(wiki_id):
        raise AppError(status_code=400, code="invalid_wiki_id", message="Invalid wiki ID format.")
    await _validate_wiki(wiki_id, current_user["id"])
    
    mongo = get_mongo_manager()
    await mongo.delete_chat_history(current_user["id"], wiki_id)
    return None

def _build_fallback_answer(*, wiki_pages: list[dict], graph_context: list[str]) -> str:
    parts: list[str] = []
    if wiki_pages:
        lead_page = wiki_pages[0]
        # BUG FIX #15: Handle missing fields gracefully
        lead_title = lead_page.get("title", "ingested source")
        lead_summary = lead_page.get("summary", "")
        parts.append(lead_summary or f"The strongest matching source is {lead_title}.")
        if len(wiki_pages) > 1:
            # BUG FIX #15: Use .get() for all field accesses
            related_titles = ", ".join(page.get("title", "Untitled") for page in wiki_pages[1:3])
            parts.append(f"Related ingested sources include {related_titles}.")
    if graph_context:
        parts.append(f"Connected concepts in the graph include {'; '.join(graph_context[:3])}.")
    return " ".join(parts) or "I found matching knowledge, but not enough grounded detail to answer cleanly yet."