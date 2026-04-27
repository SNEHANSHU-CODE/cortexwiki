"""
app/services/llm.py

LLM provider strategy:
  - generate_text : Groq (primary) → Gemini (fallback) → static fallback
  - stream_text   : Groq (primary) → Gemini (fallback) → word-chunked fallback
  - embed_text    : Gemini only (Groq has no embedding API) → hash fallback
  - summarize     : uses generate_text (inherits provider strategy)
"""

import hashlib
import json
import re

import httpx

from app.core.config import settings
from app.utils.logging import get_logger
from app.utils.text import chunk_words, clean_text, split_sentences


logger = get_logger("services.llm")

# Groq API is OpenAI-compatible — same request/response shape
_GROQ_CHAT_URL = f"{settings.GROQ_BASE_URL}/chat/completions"

# Gemini REST endpoints
_GEMINI_GENERATE_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models"
    f"/{settings.GEMINI_MODEL}:generateContent"
)
_GEMINI_STREAM_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models"
    f"/{settings.GEMINI_MODEL}:streamGenerateContent"
)

_GEMINI_EMBED_MODEL = (
    settings.GEMINI_EMBEDDING_MODEL
    if settings.GEMINI_EMBEDDING_MODEL.startswith("models/")
    else f"models/{settings.GEMINI_EMBEDDING_MODEL}"
)
_GEMINI_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta"
    f"/{_GEMINI_EMBED_MODEL}:embedContent"
)


class LLMService:
    """
    Unified LLM service.

    Provider priority:
      Text  → Groq first, Gemini on failure, static fallback if both absent/fail
      Embed → Gemini only, hash fallback if absent/fail
    """

    # ── Public API ────────────────────────────────────────────────────────────

    async def generate_text(
        self,
        *,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.3,
        max_output_tokens: int = 1024,
    ) -> str:
        # 1. Try Groq
        if settings.GROQ_API_KEY:
            result = await self._groq_generate(
                prompt=prompt,
                system_instruction=system_instruction,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            )
            if result:
                return result

        # 2. Try Gemini
        if settings.GEMINI_API_KEY:
            result = await self._gemini_generate(
                prompt=prompt,
                system_instruction=system_instruction,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            )
            if result:
                return result

        # 3. Static fallback
        return self._fallback_generate(prompt)

    async def stream_text(
        self,
        *,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.3,
        max_output_tokens: int = 1024,
    ):
        # 1. Try Groq streaming
        if settings.GROQ_API_KEY:
            groq_ok = False
            async for chunk in self._groq_stream(
                prompt=prompt,
                system_instruction=system_instruction,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            ):
                groq_ok = True
                yield chunk
            if groq_ok:
                return

        # 2. Try Gemini streaming
        if settings.GEMINI_API_KEY:
            gemini_ok = False
            async for chunk in self._gemini_stream(
                prompt=prompt,
                system_instruction=system_instruction,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            ):
                gemini_ok = True
                yield chunk
            if gemini_ok:
                return

        # 3. Word-chunked static fallback
        for chunk in chunk_words(self._fallback_generate(prompt)):
            yield chunk

    async def embed_text(self, text: str) -> list[float]:
        """Gemini is the sole embedding provider — Groq has no embedding API."""
        if not text:
            return []

        if settings.GEMINI_API_KEY:
            result = await self._gemini_embed(text)
            if result:
                return result

        return self._fallback_embedding(text)

    async def summarize(self, text: str) -> str:
        if not text:
            return ""
        prompt = (
            "Summarize the following material for an enterprise knowledge base. "
            "Keep it grounded, factual, and concise.\n\n"
            f"{text[:8000]}"
        )
        return clean_text(
            await self.generate_text(prompt=prompt, temperature=0.2, max_output_tokens=300)
        )

    # ── Groq ──────────────────────────────────────────────────────────────────

    async def _groq_generate(
        self,
        *,
        prompt: str,
        system_instruction: str | None,
        temperature: float,
        max_output_tokens: int,
    ) -> str:
        messages = self._build_openai_messages(prompt, system_instruction)
        payload = {
            "model": settings.GROQ_MODEL,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_output_tokens,
            "stream": False,
        }
        try:
            async with httpx.AsyncClient(
                timeout=40.0, verify=settings.OUTBOUND_VERIFY_SSL
            ) as client:
                response = await client.post(
                    _GROQ_CHAT_URL,
                    json=payload,
                    headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
                )
                response.raise_for_status()
                data = response.json()
                text = data["choices"][0]["message"]["content"]
                logger.info("Groq generate OK (model=%s)", settings.GROQ_MODEL)
                return clean_text(text)
        except (httpx.HTTPError, KeyError, IndexError):
            logger.exception("Groq generate failed — falling back to Gemini")
            return ""

    async def _groq_stream(
        self,
        *,
        prompt: str,
        system_instruction: str | None,
        temperature: float,
        max_output_tokens: int,
    ):
        messages = self._build_openai_messages(prompt, system_instruction)
        payload = {
            "model": settings.GROQ_MODEL,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_output_tokens,
            "stream": True,
        }
        try:
            async with httpx.AsyncClient(
                timeout=None, verify=settings.OUTBOUND_VERIFY_SSL
            ) as client:
                async with client.stream(
                    "POST",
                    _GROQ_CHAT_URL,
                    json=payload,
                    headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
                ) as response:
                    response.raise_for_status()
                    async for raw_line in response.aiter_lines():
                        line = raw_line.strip()
                        if not line.startswith("data:"):
                            continue
                        data_str = line.removeprefix("data:").strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            delta = json.loads(data_str)["choices"][0]["delta"].get("content", "")
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue
                        if delta:
                            yield delta
            logger.info("Groq stream OK (model=%s)", settings.GROQ_MODEL)
        except (httpx.HTTPError, json.JSONDecodeError):
            logger.exception("Groq stream failed — falling back to Gemini")

    # ── Gemini ────────────────────────────────────────────────────────────────

    async def _gemini_generate(
        self,
        *,
        prompt: str,
        system_instruction: str | None,
        temperature: float,
        max_output_tokens: int,
    ) -> str:
        payload = {
            "contents": [{"parts": self._build_gemini_parts(prompt, system_instruction)}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_output_tokens,
            },
        }
        try:
            async with httpx.AsyncClient(
                timeout=40.0, verify=settings.OUTBOUND_VERIFY_SSL
            ) as client:
                response = await client.post(
                    _GEMINI_GENERATE_URL,
                    json=payload,
                    params={"key": settings.GEMINI_API_KEY},
                )
                response.raise_for_status()
                text = self._extract_gemini_text(response.json())
                logger.info("Gemini generate OK (model=%s)", settings.GEMINI_MODEL)
                return text
        except httpx.HTTPError:
            logger.exception("Gemini generate failed — using static fallback")
            return ""

    async def _gemini_stream(
        self,
        *,
        prompt: str,
        system_instruction: str | None,
        temperature: float,
        max_output_tokens: int,
    ):
        payload = {
            "contents": [{"parts": self._build_gemini_parts(prompt, system_instruction)}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_output_tokens,
            },
        }
        previous_text = ""
        try:
            async with httpx.AsyncClient(
                timeout=None, verify=settings.OUTBOUND_VERIFY_SSL
            ) as client:
                async with client.stream(
                    "POST",
                    _GEMINI_STREAM_URL,
                    json=payload,
                    params={"key": settings.GEMINI_API_KEY, "alt": "sse"},
                ) as response:
                    response.raise_for_status()
                    async for raw_line in response.aiter_lines():
                        line = raw_line.strip()
                        if not line.startswith("data:"):
                            continue
                        try:
                            chunk_text = self._extract_gemini_text(
                                json.loads(line.removeprefix("data:").strip())
                            )
                        except json.JSONDecodeError:
                            continue
                        if not chunk_text:
                            continue
                        delta = (
                            chunk_text[len(previous_text):]
                            if chunk_text.startswith(previous_text)
                            else chunk_text
                        )
                        previous_text = chunk_text
                        if delta:
                            yield delta
            logger.info("Gemini stream OK (model=%s)", settings.GEMINI_MODEL)
        except (httpx.HTTPError, json.JSONDecodeError):
            logger.exception("Gemini stream failed — using static fallback")

    async def _gemini_embed(self, text: str) -> list[float]:
        payload = {
            "model": _GEMINI_EMBED_MODEL,
            "content": {"parts": [{"text": text[:4000]}]},
        }
        try:
            async with httpx.AsyncClient(
                timeout=30.0, verify=settings.OUTBOUND_VERIFY_SSL
            ) as client:
                response = await client.post(
                    _GEMINI_EMBED_URL,
                    json=payload,
                    params={"key": settings.GEMINI_API_KEY},
                )
                response.raise_for_status()
                values = response.json().get("embedding", {}).get("values", [])
                return values or []
        except httpx.HTTPError:
            logger.exception("Gemini embed failed — using hash fallback")
            return []

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _build_openai_messages(
        prompt: str, system_instruction: str | None
    ) -> list[dict]:
        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})
        messages.append({"role": "user", "content": prompt})
        return messages

    @staticmethod
    def _build_gemini_parts(
        prompt: str, system_instruction: str | None
    ) -> list[dict]:
        parts = []
        if system_instruction:
            parts.append({"text": system_instruction})
        parts.append({"text": prompt})
        return parts

    @staticmethod
    def _extract_gemini_text(data: dict) -> str:
        candidates = data.get("candidates", [])
        if not candidates:
            return ""
        parts = candidates[0].get("content", {}).get("parts", [])
        return clean_text(" ".join(p.get("text", "") for p in parts if p.get("text")))

    def _fallback_generate(self, prompt: str) -> str:
        sentences = split_sentences(prompt)
        if not sentences:
            return "No content available."
        if len(sentences) == 1:
            return sentences[0][:600]
        return " ".join(sentences[-4:])[:1200]

    def _fallback_embedding(self, text: str, dimensions: int = 128) -> list[float]:
        vector = [0.0] * dimensions
        for token in re.findall(r"[a-zA-Z0-9]{2,}", text.lower()):
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = digest[0] % dimensions
            sign = 1 if digest[1] % 2 == 0 else -1
            vector[index] += sign * (1 + (digest[2] / 255))
        return vector


_llm_service = LLMService()


def get_llm_service() -> LLMService:
    return _llm_service
