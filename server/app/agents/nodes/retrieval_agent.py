import json
from app.core.config import settings
from app.utils.logging import get_logger

logger = get_logger("agents.retrieval")

_EXPANSION_PROMPT = """
You are a Search Query Expansion Agent.
Analyze the user's question and expand it into a concise, comma-separated list of 3-5 highly relevant search keywords or phrases to improve vector database and graph search results.
Output the result strictly as a JSON object with a single string field "expanded_query".
Example: {"expanded_query": "react hooks, useeffect, state management"}
"""

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
        wiki_id = state.get("wiki_id")
        if not wiki_id or not isinstance(wiki_id, str):
            raise ValueError("RetrievalAgent requires wiki_id in state")

        # Query Expansion
        expanded_question = question
        try:
            response = await self._llm.generate_text(
                prompt=f"Question: {question}",
                system_instruction=_EXPANSION_PROMPT,
                temperature=0.0,
                max_output_tokens=50,
                use_secondary_key=True,
            )
            # BUG-M6 FIX: Use regex instead of hardcoded offsets — handles trailing
            # newlines/spaces after the closing fence that break [7:-3] / [3:-3] slicing.
            import re as _re
            clean_json = response.strip()
            clean_json = _re.sub(r'^```(?:json)?\s*\n?', '', clean_json)
            clean_json = _re.sub(r'\n?```\s*$', '', clean_json).strip()
            
            result = json.loads(clean_json)
            expanded_question = result.get("expanded_query", question)
            logger.info("Expanded query: %s", expanded_question)
        except Exception as e:
            logger.warning(f"Query expansion failed: {str(e)}")

        embedding = await self._llm.embed_text(expanded_question)

        wiki_pages = await self._mongo.search_wiki_pages(
            user_id=state["user_id"],
            wiki_id=wiki_id,
            query=expanded_question,
            query_embedding=embedding,
            limit=settings.QUERY_RESULT_LIMIT,
        )
        related_concepts = await self._graph_service.get_related_concepts(
            user_id=state["user_id"],
            wiki_id=wiki_id,
            query=expanded_question,
            limit=8,
        )

        state["wiki_pages"] = wiki_pages
        state["related_concepts"] = related_concepts
        state["trace"].append(
            {
                "agent": "retrieval_agent",
                "expanded_query": expanded_question,
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