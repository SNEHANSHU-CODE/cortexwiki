"""
app/agents/graph.py

Multi-agent pipeline built with LangGraph.

Architecture:
  planner -> retrieval -> [internet_search] -> hallucination_guard -> answer
                                 ^
                        conditional edge: only if plan.needs_internet

LangGraph concepts used:
  - StateGraph           : defines the graph with typed state
  - AgentState           : TypedDict with Annotated reducers for safe merging
  - add_node             : registers each agent as a named node
  - add_edge             : fixed transitions between nodes
  - add_conditional_edges: branches based on planner output
  - compile()            : produces an executable CompiledStateGraph
  - ainvoke / astream    : async execution
"""

import operator
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.schemas.query import QueryData
from app.utils.logging import get_logger


logger = get_logger("agents.graph")


# ── State Schema ──────────────────────────────────────────────────────────────
# TypedDict gives LangGraph a schema to validate and merge state between nodes.
# Annotated[list, operator.add] is a "reducer":
#   instead of overwriting, LangGraph APPENDS each node's trace entries.

class AgentState(TypedDict):
    # Input
    user_id: str
    question: str
    debug: bool
    allow_internet: bool

    # Set by PlannerAgent
    plan: dict[str, Any]

    # Set by RetrievalAgent
    wiki_pages: list[dict]
    related_concepts: list[dict]

    # Set by InternetSearchAgent (optional branch)
    internet_results: list[dict]

    # Set by HallucinationGuardAgent
    confidence: float
    is_grounded: bool
    guard: dict[str, Any]

    # Set by AnswerAgent
    answer: str
    sources: list[dict]
    strategy: str
    debug_payload: dict[str, Any]

    # Reducer: operator.add means LangGraph appends rather than overwrites
    trace: Annotated[list, operator.add]


# ── Routing Function ───────────────────────────────────────────────────────────

def _route_after_retrieval(state: AgentState) -> str:
    """
    Conditional edge function — called after retrieval node.
    LangGraph calls this with current state and uses the return value
    to look up the next node in the edges map.
    """
    if state.get("plan", {}).get("needs_internet"):
        return "internet_search"
    return "hallucination_guard"


# ── Node Functions ─────────────────────────────────────────────────────────────
# Each node is an async function: (AgentState) -> partial dict.
# LangGraph merges the returned dict into state — nodes return ONLY what changed.
# Agents are imported lazily to avoid init-time datastore dependency.

async def _planner_node(state: AgentState) -> dict:
    from app.agents.nodes.planner_agent import get_planner_agent
    return await get_planner_agent().run(dict(state))


async def _retrieval_node(state: AgentState) -> dict:
    from app.agents.nodes.retrieval_agent import get_retrieval_agent
    return await get_retrieval_agent().run(dict(state))


async def _internet_search_node(state: AgentState) -> dict:
    from app.agents.nodes.internet_search_agent import get_internet_search_agent
    return await get_internet_search_agent().run(dict(state))


async def _hallucination_guard_node(state: AgentState) -> dict:
    from app.agents.nodes.hallucination_guard_agent import get_hallucination_guard_agent
    return await get_hallucination_guard_agent().run(dict(state))


async def _answer_node(state: AgentState) -> dict:
    from app.agents.nodes.answer_agent import get_answer_agent
    return await get_answer_agent().run(dict(state))


# ── Graph Builder ──────────────────────────────────────────────────────────────

def _build_graph():
    """
    Constructs and compiles the LangGraph StateGraph.

    Graph topology:
      START
        -> planner
        -> retrieval
        -> [conditional]
              "internet_search"     -> internet_search -> hallucination_guard
              "hallucination_guard" -> hallucination_guard
        -> answer
        -> END
    """
    builder = StateGraph(AgentState)

    # Register all nodes
    builder.add_node("planner",             _planner_node)
    builder.add_node("retrieval",           _retrieval_node)
    builder.add_node("internet_search",     _internet_search_node)
    builder.add_node("hallucination_guard", _hallucination_guard_node)
    builder.add_node("answer",              _answer_node)

    # Fixed edges: always execute in order
    builder.add_edge(START,     "planner")
    builder.add_edge("planner", "retrieval")

    # Conditional edge after retrieval:
    # _route_after_retrieval(state) returns a string key,
    # LangGraph maps it to the actual node name via the dict below.
    builder.add_conditional_edges(
        "retrieval",
        _route_after_retrieval,
        {
            "internet_search":     "internet_search",
            "hallucination_guard": "hallucination_guard",
        },
    )

    builder.add_edge("internet_search",     "hallucination_guard")
    builder.add_edge("hallucination_guard", "answer")
    builder.add_edge("answer",              END)

    return builder.compile()


# ── Public Interface ───────────────────────────────────────────────────────────

class QueryAgentGraph:
    """
    Thin wrapper around the compiled LangGraph graph.
    Exposes run() and stream() — interface unchanged from the rest of the codebase.
    """

    def __init__(self) -> None:
        # Graph is compiled once at startup — reused for every request
        self._graph = _build_graph()
        logger.info("LangGraph QueryAgentGraph compiled and ready")

    def _initial_state(
        self,
        *,
        user_id: str,
        question: str,
        debug: bool,
        allow_internet: bool,
    ) -> dict:
        """Builds the full initial state dict passed into the graph."""
        return {
            "user_id": user_id,
            "question": question.strip(),
            "debug": debug,
            "allow_internet": allow_internet,
            "trace": [],
            "plan": {},
            "wiki_pages": [],
            "related_concepts": [],
            "internet_results": [],
            "guard": {},
            "confidence": 0.0,
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
        question: str,
        debug: bool = False,
        allow_internet: bool = False,
    ) -> QueryData:
        """
        Executes the full agent pipeline and returns a QueryData result.
        ainvoke() runs all nodes to completion, returns final merged state.
        """
        final_state = await self._graph.ainvoke(
            self._initial_state(
                user_id=user_id,
                question=question,
                debug=debug,
                allow_internet=allow_internet,
            )
        )
        return self._to_query_data(final_state)

    async def stream(
        self,
        *,
        user_id: str,
        question: str,
        debug: bool = False,
        allow_internet: bool = False,
    ):
        """
        Streams the answer word-by-word.

        LangGraph astream() yields state snapshots after each node completes.
        We collect state through all pipeline nodes, then delegate word-level
        streaming to AnswerAgent.stream() which uses Gemini token streaming.
        """
        accumulated: dict = self._initial_state(
            user_id=user_id,
            question=question,
            debug=debug,
            allow_internet=allow_internet,
        )

        # astream yields {node_name: partial_state} after each node
        async for snapshot in self._graph.astream(accumulated):
            for node_name, partial in snapshot.items():
                if node_name in ("__start__", "__end__"):
                    continue
                accumulated.update(partial)
                logger.debug("LangGraph node completed: %s", node_name)

        # Answer node already ran via astream — but for true word-by-word
        # streaming we re-stream from AnswerAgent using the complete state
        # (all context is now in accumulated: wiki_pages, guard, plan, etc.)
        from app.agents.nodes.answer_agent import get_answer_agent
        async for event in get_answer_agent().stream(accumulated):
            yield event

    def _to_query_data(self, state: dict) -> QueryData:
        return QueryData(
            answer=state.get("answer", ""),
            confidence=state.get("confidence", 0.0),
            strategy=state.get("strategy", "knowledge_base"),
            is_grounded=state.get("is_grounded", False),
            sources=state.get("sources", []),
            debug=state.get("debug_payload") if state.get("debug") else None,
        )


_query_agent_graph = QueryAgentGraph()


def get_query_agent_graph() -> QueryAgentGraph:
    return _query_agent_graph