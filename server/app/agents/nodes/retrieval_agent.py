from app.core.config import settings
from app.utils.logging import get_logger


logger = get_logger("agents.retrieval")


class RetrievalAgent:
    @property
    def _mongo(self):
        from app.db.mongo import get_mongo_manager
        return get_mongo_manager()

    @property
    def _graph_service(self):
        from app.services.graph_service import get_graph_service
        return get_graph_service()

    @property
    def _llm(self):
        from app.services.llm import get_llm_service
        return get_llm_service()

    async def run(self, state: dict) -> dict:
        question = state["question"]
        embedding = await self._llm.embed_text(question)

        wiki_pages = await self._mongo.search_wiki_pages(
            user_id=state["user_id"],
            query=question,
            query_embedding=embedding,
            limit=settings.QUERY_RESULT_LIMIT,
        )
        related_concepts = await self._graph_service.get_related_concepts(
            user_id=state["user_id"],
            query=question,
            limit=8,
        )

        state["wiki_pages"] = wiki_pages
        state["related_concepts"] = related_concepts
        state["trace"].append(
            {
                "agent": "retrieval_agent",
                "wiki_pages": len(wiki_pages),
                "related_concepts": len(related_concepts),
            }
        )
        logger.info(
            "Retrieved %s pages and %s graph relationships",
            len(wiki_pages),
            len(related_concepts),
        )
        return state


_retrieval_agent = RetrievalAgent()


def get_retrieval_agent() -> RetrievalAgent:
    return _retrieval_agent