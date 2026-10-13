import json
import re as _re
from app.utils.logging import get_logger

logger = get_logger("agents.hallucination_guard")

_GUARD_SYSTEM_PROMPT = """
You are the CortexWiki Context Guard. Determine if the provided sources contain relevant information or evidence to answer the user's question.
Each source is prefixed with a unique ID like [WIKI_0] or [WEB_1].

Output a JSON object with exactly these three fields:
{
  "is_supported": true | false,
  "supporting_sources": ["WIKI_0"],
  "debug_confidence_uncalibrated": 0.0
}

Rules:
- "is_supported" must be true if the sources contain relevant facts, concepts, definitions, or evidence to answer the question (or any part of it).
- "is_supported" must be false ONLY if the sources contain NO relevant information whatsoever.
- "supporting_sources" must list the IDs of sources that contain relevant evidence.
- "debug_confidence_uncalibrated" is your estimated confidence as a float from 0.0 to 1.0.

Output raw JSON only. Do not wrap in markdown code fences.
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

        # ── Build context with markup IDs so the LLM can cite specific sources ──
        # Each source is tagged [WIKI_i] or [WEB_i] so the guard can return
        # which source IDs actually contain evidence for the answer.
        context_parts = []
        for i, page in enumerate(wiki_pages):
            content_snippet = (page.get("summary") or page.get("content", ""))[:4000]
            context_parts.append(
                f"[WIKI_{i}] Title: {page.get('title')}\nContent: {content_snippet}"
            )
        for i, res in enumerate(internet_results):
            snippet = res.get("snippet") or res.get("description", "")
            context_parts.append(
                f"[WEB_{i}] Title: {res.get('title')}\nSnippet: {snippet}"
            )

        context_text = "\n---\n".join(context_parts)

        is_grounded = False
        supporting_sources: list[str] = []
        debug_confidence = 0.1

        if context_text.strip():
            try:
                response = await self._llm.generate_text(
                    prompt=f"Question: {question}\n\nSources:\n{context_text}",
                    system_instruction=_GUARD_SYSTEM_PROMPT,
                    # Raised to 500: allows reasoning models (like gpt-oss-20b) to complete
                    # chain-of-thought before emitting structured JSON without truncating.
                    max_output_tokens=500,
                    use_secondary_key=True,
                )

                # Strip markdown fences if the LLM wraps its response
                clean_json = response.strip()
                clean_json = _re.sub(r'^```(?:json)?\s*\n?', '', clean_json)
                clean_json = _re.sub(r'\n?```\s*$', '', clean_json).strip()

                try:
                    result = json.loads(clean_json)
                except Exception:
                    # Match first valid JSON object if model outputs trailing commentary
                    match = _re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', clean_json, _re.DOTALL)
                    if match:
                        result = json.loads(match.group(0))
                    else:
                        raise
                is_grounded = bool(result.get("is_supported", False))
                supporting_sources = result.get("supporting_sources", [])
                debug_confidence = float(
                    result.get("debug_confidence_uncalibrated", 0.9 if is_grounded else 0.1)
                )
            except Exception as e:
                logger.warning(
                    "Guard LLM failed, defaulting to not grounded to prevent hallucination. Error: %s", str(e)
                )
                is_grounded = False
                supporting_sources = []
                debug_confidence = 0.1
        else:
            is_grounded = False

        evidence_count = len(wiki_pages) + len(internet_results) + min(len(related_concepts), 3)
        warning = None if is_grounded else "insufficient_evidence"

        # ── Write to state ────────────────────────────────────────────────────
        # IMPORTANT: the confidence key is intentionally named
        # debug_confidence_uncalibrated to prevent downstream code from routing on it.
        state["debug_confidence_uncalibrated"] = debug_confidence
        state["is_grounded"] = is_grounded
        state["guard"] = {
            "warning": warning,
            "evidence_count": evidence_count,
            # Which specific sources grounded the answer — empty if none
            "supporting_sources": supporting_sources,
        }
        state["trace"].append(
            {
                "agent": "hallucination_guard_agent",
                "is_grounded": is_grounded,
                # Logged for offline analysis only — never used for routing
                "debug_confidence_uncalibrated": debug_confidence,
                "supporting_sources": supporting_sources,
                "warning": warning,
            }
        )
        logger.info(
            "Guard marked grounded=%s sources=%s retry_count=%s",
            is_grounded,
            supporting_sources,
            state.get("guard_retry_count", 0),
        )
        return state


_hallucination_guard_agent = HallucinationGuardAgent()


def get_hallucination_guard_agent() -> HallucinationGuardAgent:
    return _hallucination_guard_agent