from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.schemas.query import QueryData, QueryRequest, QuerySource
from app.services.graph_service import get_graph_service
from app.services.llm import get_llm_service
from app.utils.text import clean_text
from app.db.mongo import get_mongo_manager


router = APIRouter(prefix="/query", tags=["query"])

_NO_KNOWLEDGE_RESPONSE = QueryData(
    answer="I do not have enough ingested knowledge to answer that yet. Add a source first, then ask again.",
    strategy="knowledge_base",
    confidence=0.18,
    is_grounded=False,
    sources=[],
)


@router.post("", response_model=QueryData)
async def query(payload: QueryRequest, current_user: dict = Depends(get_current_user)):
    mongo = get_mongo_manager()
    llm = get_llm_service()
    graph_service = get_graph_service()

    query_embedding = await llm.embed_text(payload.question)
    wiki_pages = await mongo.search_wiki_pages(
        user_id=current_user["id"],
        query=payload.question,
        query_embedding=query_embedding,
        limit=5,
    )
    related_concepts = await graph_service.get_related_concepts(
        user_id=current_user["id"],
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
            "title": page["title"],
            "source_url": page["source_url"],
            "summary": page.get("summary", ""),
            "concepts": page.get("concepts", []),
        }
        for page in wiki_pages
    ]
    graph_context = [
        f'{item["source"]} {item["relationship"]} {item["target"]}'
        for item in related_concepts
    ]

    if getattr(llm, "api_key", None):
        answer = await llm.generate_text(
            system_instruction=(
                "You are CortexWiki. Answer only from the provided knowledge base context. "
                "If the context is insufficient, say so plainly. Do not invent facts."
            ),
            prompt=(
                f"Question: {payload.question}\n\n"
                f"Knowledge base pages:\n{context_blocks}\n\n"
                f"Graph relationships:\n{graph_context}\n\n"
                "Write a concise, grounded answer."
            ),
            temperature=0.2,
            max_output_tokens=360,
        )
    else:
        answer = _build_fallback_answer(wiki_pages=wiki_pages, graph_context=graph_context)

    sources = [
        QuerySource(
            title=page["title"],
            url=page["source_url"],
            source_type=page.get("source_type", "wiki_page"),
        )
        for page in wiki_pages
    ]
    confidence = round(min(0.96, 0.4 + (0.1 * len(wiki_pages)) + (0.03 * len(related_concepts))), 2)
    debug = (
        {
            "wiki_results": [page["title"] for page in wiki_pages],
            "related_concepts": graph_context,
            "context_pages": len(context_blocks),
        }
        if payload.debug
        else None
    )

    return QueryData(
        answer=clean_text(answer),
        strategy="knowledge_base",
        confidence=confidence,
        is_grounded=True,
        sources=sources,
        debug=debug,
    )


def _build_fallback_answer(*, wiki_pages: list[dict], graph_context: list[str]) -> str:
    parts: list[str] = []

    if wiki_pages:
        lead_page = wiki_pages[0]
        parts.append(lead_page.get("summary") or f"The strongest matching source is {lead_page['title']}.")
        if len(wiki_pages) > 1:
            related_titles = ", ".join(page["title"] for page in wiki_pages[1:3])
            parts.append(f"Related ingested sources include {related_titles}.")

    if graph_context:
        parts.append(f"Connected concepts in the graph include {'; '.join(graph_context[:3])}.")

    return " ".join(parts) or "I found matching knowledge, but not enough grounded detail to answer cleanly yet."