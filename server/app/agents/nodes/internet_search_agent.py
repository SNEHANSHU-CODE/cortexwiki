from app.core.config import settings
from app.utils.logging import get_logger
from app.utils.web import search_web


logger = get_logger("agents.internet_search")


class InternetSearchAgent:
    async def run(self, state: dict) -> dict:
        results = await search_web(state["question"], limit=settings.INTERNET_SEARCH_RESULT_LIMIT)
        state["internet_results"] = results
        state["trace"].append({"agent": "internet_search_agent", "results": len(results)})
        logger.info("Internet search returned %s results", len(results))
        return state


_internet_search_agent = InternetSearchAgent()


def get_internet_search_agent() -> InternetSearchAgent:
    return _internet_search_agent