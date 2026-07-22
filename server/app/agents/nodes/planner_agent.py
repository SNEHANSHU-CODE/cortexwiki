import json
from app.utils.logging import get_logger

logger = get_logger("agents.planner")

_PLANNER_SYSTEM_PROMPT = """
You are the CortexWiki Planner Agent. Your job is to analyze the user's question and determine if it requires searching the live internet to answer correctly.
Output your decision strictly as a JSON object with a single boolean field "needs_internet".
Examples:
User: "What is the capital of France?" -> {"needs_internet": false}
User: "What is the latest news on OpenAI?" -> {"needs_internet": true}
User: "Summarize the document I uploaded." -> {"needs_internet": false}
User: "Who won the superbowl yesterday?" -> {"needs_internet": true}
"""

class PlannerAgent:
    @property
    def _llm(self):
        from app.services.llm import get_llm_service
        return get_llm_service()

    async def run(self, state: dict) -> dict:
        question = state["question"]
        allow_internet = state.get("allow_internet", False)

        needs_internet = False
        if allow_internet:
            try:
                response = await self._llm.generate_text(
                    prompt=f"User question: {question}",
                    system_instruction=_PLANNER_SYSTEM_PROMPT,
                    temperature=0.0,
                    max_output_tokens=50,
                    use_secondary_key=True,
                )
                
                # Parse JSON, handling potential markdown code blocks
                # BUG-M6 FIX: Use regex instead of hardcoded offsets — handles trailing
                # newlines/spaces after the closing fence that break [7:-3] / [3:-3] slicing.
                import re as _re
                clean_json = response.strip()
                clean_json = _re.sub(r'^```(?:json)?\s*\n?', '', clean_json)
                clean_json = _re.sub(r'\n?```\s*$', '', clean_json).strip()
                    
                result = json.loads(clean_json)
                needs_internet = bool(result.get("needs_internet", False))
            except Exception as e:
                logger.warning(f"Planner LLM failed, defaulting to False. Error: {str(e)}")
                needs_internet = False

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