import json
from app.utils.logging import get_logger

logger = get_logger("agents.hallucination_guard")

_GUARD_SYSTEM_PROMPT = """
You are the CortexWiki Context Guard. Your job is to determine if the provided context (sources) is sufficient to answer the user's question.
If the context does not contain the answer, output "is_supported": false.
If the context does contain the answer, output "is_supported": true.
Output your decision strictly as a JSON object with a single boolean field "is_supported".
"""

class HallucinationGuardAgent:
    @property
    def _llm(self):
        from app.services.llm import get_llm_service
        return get_llm_service()

    async def run(self, state: dict) -> dict:
        question = state["question"]
        wiki_pages = state.get("wiki_pages", [])
        internet_results = state.get("internet_results", [])
        related_concepts = state.get("related_concepts", [])

        # Build context string
        context_parts = []
        for page in wiki_pages:
            context_parts.append(f"Title: {page.get('title')}\nContent: {page.get('content', '')[:1000]}")
        for res in internet_results:
            context_parts.append(f"Title: {res.get('title')}\nSnippet: {res.get('snippet', '')}")
            
        context_text = "\n---\n".join(context_parts)
        
        is_grounded = False
        if context_text.strip():
            try:
                response = await self._llm.generate_text(
                    prompt=f"Question: {question}\n\nContext:\n{context_text}",
                    system_instruction=_GUARD_SYSTEM_PROMPT,
                    temperature=0.0,
                    max_output_tokens=50,
                    use_secondary_key=True,
                )
                
                # Parse JSON
                clean_json = response.strip()
                if clean_json.startswith("```json"):
                    clean_json = clean_json[7:-3].strip()
                elif clean_json.startswith("```"):
                    clean_json = clean_json[3:-3].strip()
                    
                result = json.loads(clean_json)
                is_grounded = bool(result.get("is_supported", False))
            except Exception as e:
                logger.warning(f"Guard LLM failed, defaulting to False to prevent hallucination. Error: {str(e)}")
                is_grounded = False
        else:
            is_grounded = False

        evidence_count = len(wiki_pages) + len(internet_results) + min(len(related_concepts), 3)
        confidence = 0.95 if is_grounded else 0.10
        warning = None if is_grounded else "insufficient_evidence"

        state["confidence"] = confidence
        state["is_grounded"] = is_grounded
        state["guard"] = {
            "warning": warning,
            "evidence_count": evidence_count,
        }
        state["trace"].append(
            {
                "agent": "hallucination_guard_agent",
                "is_grounded": is_grounded,
                "confidence": confidence,
                "warning": warning,
            }
        )
        logger.info("Guard marked grounded=%s confidence=%.2f", is_grounded, confidence)
        return state


_hallucination_guard_agent = HallucinationGuardAgent()


def get_hallucination_guard_agent() -> HallucinationGuardAgent:
    return _hallucination_guard_agent