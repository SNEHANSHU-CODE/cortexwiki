from typing import Any

from app.schemas.query import QueryData
from app.utils.logging import get_logger


logger = get_logger("agents.graph")


class QueryAgentGraph:
    """
    Orchestrates the agent pipeline:
      planner → retrieval → [internet_search] → hallucination_guard → answer
    Agents are resolved lazily to avoid init-time dependency on datastores.
    """

    @property
    def _planner(self):
        from app.agents.nodes.planner_agent import get_planner_agent
        return get_planner_agent()

    @property
    def _retrieval(self):
        from app.agents.nodes.retrieval_agent import get_retrieval_agent
        return get_retrieval_agent()

    @property
    def _internet_search(self):
        from app.agents.nodes.internet_search_agent import get_internet_search_agent
        return get_internet_search_agent()

    @property
    def _hallucination_guard(self):
        from app.agents.nodes.hallucination_guard_agent import get_hallucination_guard_agent
        return get_hallucination_guard_agent()

    @property
    def _answer(self):
        from app.agents.nodes.answer_agent import get_answer_agent
        return get_answer_agent()

    async def run(self, *, user_id: str, question: str, debug: bool = False, allow_internet: bool = False) -> QueryData:
        state = await self._prepare_state(
            user_id=user_id,
            question=question,
            debug=debug,
            allow_internet=allow_internet,
        )
        state = await self._answer.run(state)
        return self._to_query_data(state)

    async def stream(self, *, user_id: str, question: str, debug: bool = False, allow_internet: bool = False):
        state = await self._prepare_state(
            user_id=user_id,
            question=question,
            debug=debug,
            allow_internet=allow_internet,
        )
        async for event in self._answer.stream(state):
            yield event

    async def _prepare_state(
        self,
        *,
        user_id: str,
        question: str,
        debug: bool,
        allow_internet: bool,
    ) -> dict[str, Any]:
        state: dict[str, Any] = {
            "user_id": user_id,
            "question": question.strip(),
            "debug": debug,
            "allow_internet": allow_internet,
            "trace": [],
            "internet_results": [],
        }

        state = await self._planner.run(state)
        state = await self._retrieval.run(state)

        if state.get("plan", {}).get("needs_internet"):
            state = await self._internet_search.run(state)

        state = await self._hallucination_guard.run(state)
        return state

    def _to_query_data(self, state: dict[str, Any]) -> QueryData:
        return QueryData(
            answer=state["answer"],
            confidence=state["confidence"],
            strategy=state["strategy"],
            is_grounded=state["is_grounded"],
            sources=state["sources"],
            debug=state.get("debug_payload") if state.get("debug") else None,
        )


_query_agent_graph = QueryAgentGraph()


def get_query_agent_graph() -> QueryAgentGraph:
    return _query_agent_graph