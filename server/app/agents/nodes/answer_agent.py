import asyncio

from app.core.config import settings
from app.utils.logging import get_logger
from app.utils.text import chunk_words, clean_text


logger = get_logger("agents.answer")

_SYSTEM_INSTRUCTION = (
    "You are CortexWiki. Answer using the supplied evidence only. "
    "Prefer internal knowledge base context, then use internet evidence if present. "
    "If evidence is weak, say so plainly."
)

_NO_EVIDENCE_MESSAGE = (
    "I do not have enough grounded evidence to answer that yet. "
    "Ingest a source first or allow internet search."
)


def _build_sources(state: dict) -> list[dict]:
    internal = [
        {
            "title": page["title"],
            "url": page["source_url"],
            "source_type": page.get("source_type", "wiki_page"),
        }
        for page in state.get("wiki_pages", [])
    ]
    external = [
        {
            "title": result["title"],
            "url": result["url"],
            "source_type": result.get("source_type", "internet"),
        }
        for result in state.get("internet_results", [])
    ]

    seen: set[tuple] = set()
    deduped: list[dict] = []
    for source in [*internal, *external]:
        key = (source["title"], source["url"])
        if key not in seen:
            seen.add(key)
            deduped.append(source)
    return deduped


class AnswerAgent:
    @property
    def _llm(self):
        from app.services.llm import get_llm_service
        return get_llm_service()

    async def run(self, state: dict) -> dict:
        answer = await self._generate_answer_text(state)
        state["answer"] = answer
        state["sources"] = _build_sources(state)
        state["strategy"] = self._derive_strategy(state)
        state["debug_payload"] = self._build_debug_payload(state)
        state["trace"].append({"agent": "answer_agent", "strategy": state["strategy"]})
        logger.info("Answer generated with strategy=%s", state["strategy"])
        return state

    async def stream(self, state: dict):
        state["sources"] = _build_sources(state)
        state["strategy"] = self._derive_strategy(state)
        state["debug_payload"] = self._build_debug_payload(state)

        yield {
            "type": "start",
            "data": {
                "strategy": state["strategy"],
                "is_grounded": state["is_grounded"],
            },
        }

        answer_chunks: list[str] = []
        async for chunk in self._stream_answer_text(state):
            answer_chunks.append(chunk)
            yield {"type": "chunk", "delta": chunk}

        state["answer"] = clean_text("".join(answer_chunks))
        state["trace"].append({"agent": "answer_agent", "strategy": state["strategy"], "streamed": True})

        yield {
            "type": "complete",
            "data": {
                "answer": state["answer"],
                "confidence": state["confidence"],
                "strategy": state["strategy"],
                "is_grounded": state["is_grounded"],
                "sources": state["sources"],
                "debug": state["debug_payload"] if state.get("debug") else None,
            },
        }

    async def _generate_answer_text(self, state: dict) -> str:
        if not state["is_grounded"]:
            return _NO_EVIDENCE_MESSAGE

        answer = await self._llm.generate_text(
            system_instruction=_SYSTEM_INSTRUCTION,
            prompt=self._build_prompt(state),
            temperature=0.2,
            max_output_tokens=420,
        )
        return clean_text(answer) or "I found evidence, but not enough clear detail to answer confidently."

    async def _stream_answer_text(self, state: dict):
        if not state["is_grounded"]:
            for chunk in chunk_words(_NO_EVIDENCE_MESSAGE):
                yield chunk
                await asyncio.sleep(settings.STREAM_CHUNK_DELAY_MS / 1000)
            return

        async for chunk in self._llm.stream_text(
            system_instruction=_SYSTEM_INSTRUCTION,
            prompt=self._build_prompt(state),
            temperature=0.2,
            max_output_tokens=420,
        ):
            if chunk:
                yield chunk

    def _build_prompt(self, state: dict) -> str:
        wiki_context = [
            {
                "title": page["title"],
                "summary": page.get("summary", ""),
                "concepts": page.get("concepts", []),
                "source_url": page["source_url"],
            }
            for page in state.get("wiki_pages", [])
        ]
        graph_context = [
            f'{item["source"]} {item["relationship"]} {item["target"]}'
            for item in state.get("related_concepts", [])
        ]
        internet_context = [
            {
                "title": result["title"],
                "description": result.get("description", ""),
                "url": result["url"],
            }
            for result in state.get("internet_results", [])
        ]

        return (
            f"Question: {state['question']}\n\n"
            f"Internal knowledge base evidence: {wiki_context}\n\n"
            f"Graph relationships: {graph_context}\n\n"
            f"Internet evidence: {internet_context}\n\n"
            "Produce a concise answer with grounded claims only."
        )

    def _derive_strategy(self, state: dict) -> str:
        has_internet = bool(state.get("internet_results"))
        has_wiki = bool(state.get("wiki_pages"))
        if has_internet and has_wiki:
            return "hybrid_search"
        if has_internet:
            return "internet_search"
        return "knowledge_base"

    def _build_debug_payload(self, state: dict) -> dict:
        return {
            "plan": state.get("plan", {}),
            "trace": state.get("trace", []),
            "wiki_results": [page["title"] for page in state.get("wiki_pages", [])],
            "related_concepts": [
                f'{item["source"]} {item["relationship"]} {item["target"]}'
                for item in state.get("related_concepts", [])
            ],
            "internet_results": [r["title"] for r in state.get("internet_results", [])],
            "guard": state.get("guard", {}),
        }


_answer_agent = AnswerAgent()


def get_answer_agent() -> AnswerAgent:
    return _answer_agent