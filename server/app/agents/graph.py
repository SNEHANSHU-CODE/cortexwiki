"""
app/agents/graph.py

Multi-agent pipeline built with LangGraph.

Architecture:
  planner -> retrieval -> [internet_search] -> hallucination_guard -> answer
                                 ^
                        conditional edge: only if plan.needs_internet
"""

import operator
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.schemas.query import QueryData
from app.utils.logging import get_logger


logger = get_logger("agents.graph")


class AgentState(TypedDict):
    # Input
    user_id: str
    question: str
    wiki_id: str
    debug: bool
    allow_internet: bool
    stream_mode: bool

    # Set by PlannerAgent
    plan: dict[str, Any]

    # Set by RetrievalAgent
    wiki_pages: list[dict]
    related_concepts: list[dict]
    expanded_query: str

    # Set by InternetSearchAgent (optional branch)
    internet_results: list[dict]

    # Retry counter for the guard → internet_search loop.
    # Capped at _MAX_GUARD_RETRIES to prevent GraphRecursionError when search returns 0 results.
    # Using a counter (not a boolean) so the cap is enforced regardless of the failure reason.
    guard_retry_count: int

    # Set by HallucinationGuardAgent
    # IMPORTANT: renamed from "confidence" — the LLM-generated float is not a calibrated
    # probability. Naming it explicitly prevents future code from routing on it by accident.
    debug_confidence_uncalibrated: float
    is_grounded: bool
    guard: dict[str, Any]

    # Set by AnswerAgent
    answer: str
    sources: list[dict]
    strategy: str
    debug_payload: dict[str, Any]

    # Reducer: append trace entries instead of overwrite.
    trace: Annotated[list, operator.add]


def _route_after_retrieval(state: AgentState) -> str:
    """Route to internet search only when planner requires it."""
    if state.get("plan", {}).get("needs_internet"):
        return "internet_search"
    return "hallucination_guard"


class QueryAgentGraph:
    """Thin wrapper around the compiled LangGraph graph."""

    def __init__(self) -> None:
        self._graph = self._build_graph()
        logger.info("LangGraph QueryAgentGraph compiled and ready")

    # Lazy dependency resolution: avoid datastore-bound singleton access at import/init time.
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

    async def _planner_node(self, state: AgentState) -> dict:
        return await self._planner.run(dict(state))

    async def _retrieval_node(self, state: AgentState) -> dict:
        return await self._retrieval.run(dict(state))

    async def _internet_search_node(self, state: AgentState) -> dict:
        return await self._internet_search.run(dict(state))

    async def _hallucination_guard_node(self, state: AgentState) -> dict:
        return await self._hallucination_guard.run(dict(state))

    async def _answer_node(self, state: AgentState) -> dict:
        if state.get("stream_mode"):
            # Skip non-streamed generation in stream mode to avoid duplicate LLM invocation
            from app.agents.nodes.answer_agent import _build_sources
            return {
                "answer": "",
                "sources": _build_sources(dict(state)),
                "strategy": self._answer._derive_strategy(dict(state)),
                "debug_payload": self._answer._build_debug_payload(dict(state)),
            }
        return await self._answer.run(dict(state))

    def _build_graph(self):
        """Construct and compile the LangGraph pipeline."""
        builder = StateGraph(AgentState)

        builder.add_node("planner", self._planner_node)
        builder.add_node("retrieval", self._retrieval_node)
        builder.add_node("internet_search", self._internet_search_node)
        builder.add_node("hallucination_guard", self._hallucination_guard_node)
        builder.add_node("answer", self._answer_node)

        builder.add_edge(START, "planner")
        builder.add_edge("planner", "retrieval")

        builder.add_conditional_edges(
            "retrieval",
            _route_after_retrieval,
            {
                "internet_search": "internet_search",
                "hallucination_guard": "hallucination_guard",
            },
        )

        builder.add_edge("internet_search", "hallucination_guard")
        
        # Maximum number of times the guard can send the graph back to internet_search.
        # A counter (not a boolean flag) is used so the loop terminates regardless of
        # *why* grounding failed — zero results, bad LLM parse, or weak snippets all
        # end up routing to "answer" after this many attempts.
        _MAX_GUARD_RETRIES = 1

        def _route_after_guard(state: AgentState) -> str:
            retries = state.get("guard_retry_count", 0)
            if (
                not state.get("is_grounded", False)
                and state.get("allow_internet", False)
                and retries < _MAX_GUARD_RETRIES
            ):
                return "internet_search"
            return "answer"

        builder.add_conditional_edges(
            "hallucination_guard",
            _route_after_guard,
            {
                "internet_search": "internet_search",
                "answer": "answer",
            },
        )
        builder.add_edge("answer", END)

        return builder.compile()

    def _initial_state(
        self,
        *,
        user_id: str,
        wiki_id: str,
        question: str,
        debug: bool,
        allow_internet: bool,
        stream_mode: bool = False,
    ) -> dict:
        return {
            "user_id": user_id,
            "wiki_id": wiki_id,
            "question": question.strip(),
            "debug": debug,
            "allow_internet": allow_internet,
            "stream_mode": stream_mode,
            "trace": [],
            "plan": {},
            "wiki_pages": [],
            "related_concepts": [],
            "expanded_query": "",
            "internet_results": [],
            "guard_retry_count": 0,
            "guard": {},
            "debug_confidence_uncalibrated": 0.0,
            "is_grounded": False,

            "answer": "",
            "sources": [],
            "strategy": "knowledge_base",
            "debug_payload": {},
        }

    async def run(
        self,
        *,
        user_id: str,
        wiki_id: str,
        question: str,
        debug: bool = False,
        allow_internet: bool = False,
    ) -> QueryData:
        config = {
            "metadata": {
                "user_id": user_id,
                "wiki_id": wiki_id,
                "question": question,
            },
            "tags": ["query_agent", "cortexwiki"],
        }
        final_state = await self._graph.ainvoke(
            self._initial_state(
                user_id=user_id,
                wiki_id=wiki_id,
                question=question,
                debug=debug,
                allow_internet=allow_internet,
                stream_mode=False,
            ),
            config=config,
        )
        return self._to_query_data(final_state)

    async def stream(
        self,
        *,
        user_id: str,
        wiki_id: str,
        question: str,
        debug: bool = False,
        allow_internet: bool = False,
    ):
        accumulated: dict = self._initial_state(
            user_id=user_id,
            wiki_id=wiki_id,
            question=question,
            debug=debug,
            allow_internet=allow_internet,
            stream_mode=True,
        )

        config = {
            "metadata": {
                "user_id": user_id,
                "wiki_id": wiki_id,
                "question": question,
            },
            "tags": ["query_agent", "cortexwiki"],
        }
        async for snapshot in self._graph.astream(accumulated, config=config):
            for node_name, partial in snapshot.items():
                if node_name in ("__start__", "__end__"):
                    continue
                accumulated.update(partial)
                logger.debug("LangGraph node completed: %s", node_name)

        async for event in self._answer.stream(accumulated):
            yield event

    def _to_query_data(self, state: dict) -> QueryData:
        return QueryData(
            answer=state.get("answer", ""),
            # Read from renamed internal state key; map to public API field "confidence"
            confidence=state.get("debug_confidence_uncalibrated", 0.0),
            strategy=state.get("strategy", "knowledge_base"),
            is_grounded=state.get("is_grounded", False),
            sources=state.get("sources", []),
            debug=state.get("debug_payload") if state.get("debug") else None,
        )



_query_agent_graph = QueryAgentGraph()


def get_query_agent_graph() -> QueryAgentGraph:
    return _query_agent_graph
