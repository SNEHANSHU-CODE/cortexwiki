from app.utils.logging import get_logger


logger = get_logger("agents.hallucination_guard")


class HallucinationGuardAgent:
    async def run(self, state: dict) -> dict:
        wiki_pages = state.get("wiki_pages", [])
        internet_results = state.get("internet_results", [])
        related_concepts = state.get("related_concepts", [])

        evidence_count = len(wiki_pages) + len(internet_results) + min(len(related_concepts), 3)
        confidence = round(min(0.96, 0.18 + evidence_count * 0.13), 2)
        is_grounded = bool(wiki_pages) or bool(internet_results)
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