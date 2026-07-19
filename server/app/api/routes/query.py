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

    # BUG FIX #27: Validate wiki_id format
    from bson import ObjectId
    if not ObjectId.is_valid(payload.wiki_id):
        raise AppError(status_code=400, code="invalid_wiki_id", message="Invalid wiki ID format.")

    # BUG FIX #13: Verify debug mode is disabled in production environment
    # Check ENVIRONMENT setting instead of non-existent is_production property
    if payload.debug and settings.ENVIRONMENT == "production":
        raise AppError(status_code=400, code="debug_disabled", message="Debug mode not available in production.")

    await _validate_wiki(payload.wiki_id, current_user["id"])

    mongo = get_mongo_manager()
    llm = get_llm_service()
    graph_service = get_graph_service()

    # Save user message
    user_msg_id = uuid.uuid4().hex
    await mongo.save_chat_message(current_user["id"], payload.wiki_id, user_msg_id, "user", payload.question)

    query_embedding = await llm.embed_text(payload.question)

    wiki_pages = await mongo.search_wiki_pages(
        user_id=current_user["id"],
        wiki_id=payload.wiki_id,
        query=payload.question,
        query_embedding=query_embedding,
        limit=5,
    )
    related_concepts = await graph_service.get_related_concepts(
        user_id=current_user["id"],
        wiki_id=payload.wiki_id,
        query=payload.question,
        limit=8,
    )

    if not wiki_pages and not related_concepts:
        if payload.debug:
            return _NO_KNOWLEDGE_RESPONSE.model_copy(
                update={"debug": {"wiki_results": [], "related_concepts": []}}
            )
        return _NO_KNOWLEDGE_RESPONSE

    context_blocks = [
        {
            # BUG FIX #15: Use .get() consistently to handle missing fields gracefully
            "title": page.get("title", "Untitled Source"),
            "source_url": page.get("source_url", ""),
            "summary": page.get("summary", ""),
            "concepts": page.get("concepts", []),
        }
        for page in wiki_pages
    ]
    graph_context = [
        f'{item.get("source", "")} {item.get("relationship", "")} {item.get("target", "")}'
        for item in related_concepts
    ]

    if settings_has_llm():
        char_limit = settings.LLM_MAX_INPUT_TOKENS_CHAT * 4
        truncated_context = str(context_blocks)[:char_limit]

        prompt_content = (
            f"Question: <user_question>{payload.question}</user_question>\n\n"
            f"Knowledge base pages:\n{truncated_context}\n\n"
            f"Graph relationships:\n{graph_context}\n\n"
            "Write a concise, grounded answer."
        )

        answer = await llm.generate_text(
            system_instruction=(
                "You are CortexWiki. Answer only from the provided knowledge base context. "
                "If the context is insufficient, say so plainly. Do not invent facts.\n"
                "At the very end of your response, output exactly 3 suggested follow-up questions formatted like this: [SUGGEST: question 1 | question 2 | question 3]"
            ),
            prompt=prompt_content,
            temperature=0.2,
            max_output_tokens=settings.LLM_MAX_OUTPUT_TOKENS_CHAT,
            primary_provider=settings.LLM_PROVIDER_CHAT,
        )
    else:
        answer = _build_fallback_answer(wiki_pages=wiki_pages, graph_context=graph_context)

    sources = [
        QuerySource(
            # BUG FIX #15: Use .get() to handle missing fields
            title=page.get("title", "Untitled Source"),
            url=page.get("source_url", ""),
            source_type=page.get("source_type", "wiki_page"),
        )
        for page in wiki_pages
    ]
    confidence = round(min(0.96, max([p.get('score', 0.18) for p in wiki_pages], default=0.18)), 2)
    debug = (
        {
            "wiki_results": [page.get("title", "Untitled Source") for page in wiki_pages],
            "related_concepts": graph_context,
            "context_pages": len(context_blocks),
        }
        if payload.debug
        else None
    )

    final_answer = answer.strip()
    # Strip the [SUGGEST: ...] tag before persisting — the tag is for the live response only,
    # not for the stored history shown on chat reload.
    clean_for_db = re.sub(r"\[SUGGEST:.*?\]", "", final_answer, flags=re.DOTALL).strip()
    assistant_msg_id = uuid.uuid4().hex
    await mongo.save_chat_message(current_user["id"], payload.wiki_id, assistant_msg_id, "assistant", clean_for_db, "complete", debug)

    return QueryData(
        answer=final_answer,
        strategy="knowledge_base",
        confidence=confidence,
        is_grounded=True,
        sources=sources,
        debug=debug,
    )


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