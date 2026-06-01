"""
app/services/llm.py

LLM provider strategy:
  - generate_text : Groq (primary) → Gemini (fallback) → static fallback
  - stream_text   : Groq (primary) → Gemini (fallback) → word-chunked fallback
  - embed_text    : Gemini only (Groq has no embedding API) → hash fallback
  - summarize     : uses generate_text
  - merge_notes   : compounds existing master note with new source summary
"""

import asyncio
import hashlib
import json
import re
import time

import httpx

from app.core.config import settings
from app.utils.logging import get_logger
from app.utils.text import chunk_words, clean_text, split_sentences


logger = get_logger("services.llm")


class _ExternalApiCircuitBreaker:
    def __init__(self, threshold: int, reset_seconds: int) -> None:
        self.threshold = threshold
        self.reset_seconds = reset_seconds
        self._state: dict[str, tuple[int, float]] = {}
        self._lock = asyncio.Lock()

    async def is_open(self, name: str) -> bool:
        async with self._lock:
            count, last_failure = self._state.get(name, (0, 0.0))
            if count >= self.threshold and time.monotonic() - last_failure < self.reset_seconds:
                return True
            if time.monotonic() - last_failure >= self.reset_seconds:
                self._state.pop(name, None)
            return False

    async def record_success(self, name: str) -> None:
        async with self._lock:
            self._state.pop(name, None)

    async def record_failure(self, name: str) -> None:
        async with self._lock:
            count, last_failure = self._state.get(name, (0, time.monotonic()))
            now = time.monotonic()
            if now - last_failure >= self.reset_seconds:
                count = 1
            else:
                count += 1
            self._state[name] = (count, now)


_api_circuit_breaker = _ExternalApiCircuitBreaker(
    settings.EXTERNAL_API_FAILURE_THRESHOLD,
    settings.EXTERNAL_API_CIRCUIT_RESET_SECONDS,
)

_GROQ_CHAT_URL = f"{settings.GROQ_BASE_URL}/chat/completions"

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
    f"https://generativelanguage.googleapis.com/v1beta"
    f"/{_GEMINI_EMBED_MODEL}:embedContent"
)


class LLMService:

    # ── Public API ────────────────────────────────────────────────────────────

    async def generate_text(
        self,
        *,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.3,
        max_output_tokens: int = 1024,
    ) -> str:
        if settings.GROQ_API_KEY:
            result = await self._groq_generate(
                prompt=prompt,
                system_instruction=system_instruction,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            )
            if result:
                return result
        if settings.GEMINI_API_KEY:
            result = await self._gemini_generate(
                prompt=prompt,
                system_instruction=system_instruction,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            )
            if result:
                return result
        return self._fallback_generate(prompt)

    async def stream_text(
        self,
        *,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.3,
        max_output_tokens: int = 1024,
    ):
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
        for chunk in chunk_words(self._fallback_generate(prompt)):
            yield chunk

    async def embed_text(self, text: str) -> list[float]:
        """
        Generate embedding for text with caching support.
        
        BUG FIX #22: Cache embeddings to reduce API calls and improve performance.
        """
        if not text:
            return []
        
        # BUG FIX #22: Check embedding cache in Redis
        redis_store = None
        try:
            from app.core.redis import get_redis_store
            redis_store = get_redis_store()
        except Exception:
            pass
        
        # Create cache key from text signature (length + SHA256) to reduce collision risk
        text_hash = hashlib.sha256(text.encode()).hexdigest()
        cache_key = f"embedding:{len(text)}:{text_hash}"
        
        # Try to get cached embedding
        if redis_store:
            try:
                cached = await redis_store.get(cache_key)
                if cached:
                    logger.debug("Cache hit for embedding: %s", cache_key)
                    # Cached as JSON string
                    return json.loads(cached)
            except Exception as exc:
                logger.debug("Embedding cache lookup failed: %s", str(exc))
        
        # Generate new embedding
        if settings.GEMINI_API_KEY:
            result = await self._gemini_embed(text)
            if result:
                # Cache the embedding for 24 hours (86400 seconds)
                if redis_store:
                    try:
                        await redis_store.setex(
                            cache_key,
                            86400,
                            json.dumps(result),
                        )
                        logger.debug("Cached embedding: %s", cache_key)
                    except Exception as exc:
                        logger.warning("Failed to cache embedding: %s", str(exc))
                return result
        
        # Fallback embedding
        embedding = self._fallback_embedding(text)
        # Cache fallback embedding too
        if redis_store and embedding:
            try:
                await redis_store.setex(
                    cache_key,
                    86400,
                    json.dumps(embedding),
                )
            except Exception:
                pass
        return embedding

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

    async def merge_notes(self, *, existing_note: str, new_summary: str, new_title: str) -> str:
        """
        Compound an existing master note with a new source summary.
        If no existing note yet, the new summary becomes the first note.
        The result is a single unified note — not a list of separate summaries.
        """
        if not existing_note.strip():
            return clean_text(new_summary)

        prompt = (
            "You are maintaining a unified knowledge note for a wiki.\n\n"
            f"EXISTING NOTE:\n{existing_note}\n\n"
            f"NEW SOURCE TITLE: {new_title}\n"
            f"NEW SOURCE SUMMARY:\n{new_summary}\n\n"
            "Task: Merge the new source knowledge into the existing note. "
            "Do NOT list sources separately. "
            "Write a single cohesive note that compounds both sets of knowledge together. "
            "Preserve important details from both. "
            "Remove redundancy. Keep it concise and grounded."
        )
        merged = await self.generate_text(
            prompt=prompt,
            temperature=0.2,
            max_output_tokens=600,
        )
        return clean_text(merged) or existing_note

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
        if await _api_circuit_breaker.is_open("groq"):
            logger.warning("Groq circuit breaker open — skipping GROQ request")
            return ""

        try:
            limits = httpx.Limits(max_keepalive_connections=10, max_connections=50)
            async with httpx.AsyncClient(timeout=settings.LLM_REQUEST_TIMEOUT, verify=settings.OUTBOUND_VERIFY_SSL, limits=limits, headers={"User-Agent": settings.USER_AGENT}) as client:
                response = await client.post(
                    _GROQ_CHAT_URL,
                    json=payload,
                    headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
                )
                response.raise_for_status()
                data = response.json()
                # BUG FIX #11: Defensive access to nested response fields
                text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                if not text:
                    logger.warning("Empty response from Groq")
                    await _api_circuit_breaker.record_failure("groq")
                    return ""
                await _api_circuit_breaker.record_success("groq")
                logger.info("Groq generate OK (model=%s)", settings.GROQ_MODEL)
                return clean_text(text)
        except (httpx.HTTPError, KeyError, IndexError) as exc:
            await _api_circuit_breaker.record_failure("groq")
            logger.warning("Groq generate failed: %s — falling back to Gemini", str(exc))
            return ""
        except Exception:
            await _api_circuit_breaker.record_failure("groq")
            logger.exception("Unexpected error in Groq generate")
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
        if await _api_circuit_breaker.is_open("groq"):
            logger.warning("Groq circuit breaker open — skipping GROQ stream")
            return

        try:
            limits = httpx.Limits(max_keepalive_connections=10, max_connections=50)
            async with httpx.AsyncClient(timeout=settings.LLM_STREAM_TIMEOUT, verify=settings.OUTBOUND_VERIFY_SSL, limits=limits) as client:
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
                            # BUG FIX #11: Defensive access to nested response fields
                            delta = json.loads(data_str).get("choices", [{}])[0].get("delta", {}).get("content", "")
                        except (json.JSONDecodeError, KeyError, IndexError, ValueError) as exc:
                            logger.debug("Failed to parse Groq stream chunk: %s", str(exc))
                            continue
                        if delta:
                            yield delta
            logger.info("Groq stream OK (model=%s)", settings.GROQ_MODEL)
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            await _api_circuit_breaker.record_failure("groq")
            logger.exception("Groq stream failed — falling back to Gemini: %s", str(exc))

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
            "generationConfig": {"temperature": temperature, "maxOutputTokens": max_output_tokens},
        }
        if await _api_circuit_breaker.is_open("gemini"):
            logger.warning("Gemini circuit breaker open — skipping Gemini generate")
            return ""

        try:
            limits = httpx.Limits(max_keepalive_connections=10, max_connections=50)
            async with httpx.AsyncClient(timeout=settings.LLM_REQUEST_TIMEOUT, verify=settings.OUTBOUND_VERIFY_SSL, limits=limits, headers={"User-Agent": settings.USER_AGENT}) as client:
                response = await client.post(
                    _GEMINI_GENERATE_URL,
                    json=payload,
                    params={"key": settings.GEMINI_API_KEY},
                )
                response.raise_for_status()
                text = self._extract_gemini_text(response.json())
                await _api_circuit_breaker.record_success("gemini")
                logger.info("Gemini generate OK (model=%s)", settings.GEMINI_MODEL)
                return text
        except httpx.HTTPError as exc:
            await _api_circuit_breaker.record_failure("gemini")
            logger.exception("Gemini generate failed — using static fallback: %s", str(exc))
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
            "generationConfig": {"temperature": temperature, "maxOutputTokens": max_output_tokens},
        }
        previous_text = ""
        try:
            limits = httpx.Limits(max_keepalive_connections=10, max_connections=50)
            async with httpx.AsyncClient(timeout=settings.LLM_STREAM_TIMEOUT, verify=settings.OUTBOUND_VERIFY_SSL, limits=limits) as client:
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
                        delta = chunk_text[len(previous_text):] if chunk_text.startswith(previous_text) else chunk_text
                        previous_text = chunk_text
                        if delta:
                            yield delta
            logger.info("Gemini stream OK (model=%s)", settings.GEMINI_MODEL)
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            await _api_circuit_breaker.record_failure("gemini")
            logger.exception("Gemini stream failed — using static fallback: %s", str(exc))

    async def _gemini_embed(self, text: str) -> list[float]:
        payload = {
            "model": _GEMINI_EMBED_MODEL,
            "content": {"parts": [{"text": text[:4000]}]},
        }
        if await _api_circuit_breaker.is_open("gemini"):
            logger.warning("Gemini circuit breaker open — skipping Gemini embedding request")
            return []

        try:
            limits = httpx.Limits(max_keepalive_connections=10, max_connections=50)
            async with httpx.AsyncClient(timeout=settings.LLM_REQUEST_TIMEOUT, verify=settings.OUTBOUND_VERIFY_SSL, limits=limits) as client:
                response = await client.post(
                    _GEMINI_EMBED_URL,
                    json=payload,
                    params={"key": settings.GEMINI_API_KEY},
                )
                response.raise_for_status()
                values = response.json().get("embedding", {}).get("values", [])
                await _api_circuit_breaker.record_success("gemini")
                return values or []
        except httpx.HTTPError as exc:
            await _api_circuit_breaker.record_failure("gemini")
            logger.exception("Gemini embed failed — using hash fallback: %s", str(exc))
            return []

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _build_openai_messages(prompt: str, system_instruction: str | None) -> list[dict]:
        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})
        messages.append({"role": "user", "content": prompt})
        return messages

    @staticmethod
    def _build_gemini_parts(prompt: str, system_instruction: str | None) -> list[dict]:
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