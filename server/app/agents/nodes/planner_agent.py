import json
from app.utils.logging import get_logger

logger = get_logger("agents.planner")

_PLANNER_SYSTEM_PROMPT = """
You are the CortexWiki Planner Agent. A user is querying a specialized personal wiki/workspace that contains private ingested study materials and uploaded notes.
The user has enabled internet search capability.

Your job is to decide whether answering the user's question requires searching the public internet or external web knowledge.
Output your decision strictly as a JSON object with a single boolean field "needs_internet":
{
  "needs_internet": true | false
}

Rules:
1. Output {"needs_internet": false} if the user is explicitly asking about internal wiki notes or uploaded documents:
   - "Summarize this document / wiki page"
   - "What do the notes say about X?"
   - "Explain the architecture from my uploaded paper"
2. Output {"needs_internet": true} if the question asks for external facts, real-world entities, public leaders, external technologies, comparative benchmarks, or general world knowledge that would not be confined to private uploaded study notes:
   - "Who is the PM of India?" -> {"needs_internet": true}
   - "Compare Qdrant vs Chroma vs Milvus" -> {"needs_internet": true}
   - "What are the latest updates on OpenAI?" -> {"needs_internet": true}
   - "What is the capital of France?" -> {"needs_internet": true}

Output raw JSON only. Do not wrap in markdown code fences.
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
                    max_output_tokens=500,
                    use_secondary_key=True,
                )
                
                # Parse JSON, handling potential markdown code blocks
                # BUG-M6 FIX: Use regex instead of hardcoded offsets — handles trailing
                # newlines/spaces after the closing fence that break [7:-3] / [3:-3] slicing.
                import re as _re
                clean_json = response.strip()
                clean_json = _re.sub(r'^```(?:json)?\s*\n?', '', clean_json)
                clean_json = _re.sub(r'\n?```\s*$', '', clean_json).strip()
                    
                try:
                    result = json.loads(clean_json)
                except Exception:
                    match = _re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', clean_json, _re.DOTALL)
                    if match:
                        result = json.loads(match.group(0))
                    else:
                        raise
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