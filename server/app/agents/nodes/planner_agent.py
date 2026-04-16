import re

from app.utils.logging import get_logger


logger = get_logger("agents.planner")

# Whole-word match only — avoids false hits like "new" inside "renew" or "knew"
_SEARCH_TERMS = re.compile(
    r"\b(?:breaking|current|latest|new|news|recent|release|today|updated|version)\b"
)


class PlannerAgent:
    async def run(self, state: dict) -> dict:
        question = state["question"].lower()
        needs_internet = state["allow_internet"] or bool(_SEARCH_TERMS.search(question))
        plan = {
            "needs_internet": needs_internet,
            "steps": [
                "planner",
                "retrieval",
                *(["internet_search"] if needs_internet else []),
                "hallucination_guard",
                "answer",
            ],
        }
        state["plan"] = plan
        state["trace"].append({"agent": "planner_agent", "needs_internet": needs_internet})
        logger.info("Planner selected internet=%s", needs_internet)
        return state


_planner_agent = PlannerAgent()


def get_planner_agent() -> PlannerAgent:
    return _planner_agent