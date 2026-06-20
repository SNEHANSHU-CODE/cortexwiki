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
import contextvars
import hashlib
import json
import re
import time

import httpx

from app.core.config import settings
from app.utils.errors import AppError
from app.utils.logging import get_logger
from app.utils.text import chunk_words, clean_text, split_sentences
from langsmith import traceable
from langsmith.run_helpers import get_current_run_tree


logger = get_logger("services.llm")
user_id_ctx = contextvars.ContextVar("user_id_ctx", default=None)


import threading

class _ExternalApiCircuitBreaker:
    def __init__(self, threshold: int, reset_seconds: int) -> None:
        self.threshold = threshold
        self.reset_seconds = reset_seconds
        self._state: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()

    async def is_open(self, name: str) -> bool:
        with self._lock:
            count, last_failure = self._state.get(name, (0, 0.0))
            if count >= self.threshold and time.monotonic() - last_failure < self.reset_seconds:
                return True
            if time.monotonic() - last_failure >= self.reset_seconds:
                self._state.pop(name, None)
            return False

    async def record_success(self, name: str) -> None:
        with self._lock:
            self._state.pop(name, None)

    async def record_failure(self, name: str) -> None:
        with self._lock:
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

    @staticmethod
    def estimate_tokens(text: str) -> int:
        if not text:
            return 0
        # Approx 1 token per 3.8 characters for standard English text
        return max(1, int(len(text) / 3.8))

    async def check_token_limits(self, user_id: str) -> None:
        """Check if user has exceeded their daily token usage limits."""
        from app.db.mongo import get_mongo_manager
        mongo = get_mongo_manager()
        input_used, output_used = await mongo.get_user_token_usage(user_id)
        
        # Enforce limits: Input 1 Lakh (100,000) and Output 30K (30,000) daily
        if input_used >= 100000:
            raise AppError(
                status_code=429,
                code="input_token_limit_exceeded",
                message="Your account has exceeded the daily input token usage limit (100,000 tokens/day). Please try again tomorrow.",
            )
        if output_used >= 30000:
            raise AppError(
                status_code=429,
                code="output_token_limit_exceeded",
                message="Your account has exceeded the daily output token usage limit (30,000 tokens/day). Please try again tomorrow.",
            )

    # ── Public API ────────────────────────────────────────────────────────────

    @traceable(run_type="chain", name="CortexWiki Generate Text")
    async def generate_text(
        self,
        *,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.3,
        max_output_tokens: int = settings.LLM_MAX_OUTPUT_TOKENS,
        primary_provider: str = "groq",
    ) -> str:
        user_id = user_id_ctx.get()
        if user_id:
            await self.check_token_limits(user_id)

        providers = ["groq", "gemini"] if primary_provider == "groq" else ["gemini", "groq"]

        for provider in providers:
            if provider == "groq" and settings.GROQ_API_KEY:
                result = await self._groq_generate(
                    prompt=prompt,
                    system_instruction=system_instruction,
                    temperature=temperature,
                    max_output_tokens=max_output_tokens,
                )
                if result:
                    return result
            elif provider == "gemini" and settings.GEMINI_API_KEY:
                result = await self._gemini_generate(
                    prompt=prompt,
                    system_instruction=system_instruction,
                    temperature=temperature,
                    max_output_tokens=max_output_tokens,
                )
                if result:
                    return result

        if not settings.GROQ_API_KEY and not settings.GEMINI_API_KEY:
            result = self._fallback_generate(prompt)
        else:
            raise AppError(
                status_code=503,
                code="llm_unavailable",
                message="All AI providers are currently unavailable or overloaded. Please try again later.",
            )
            
        prompt_tok = self.estimate_tokens(prompt) + (self.estimate_tokens(system_instruction) if system_instruction else 0)
        completion_tok = self.estimate_tokens(result)
        run_tree = get_current_run_tree()
        if run_tree:
            run_tree.metadata.update({
                "token_usage": {
                    "prompt_tokens": prompt_tok,
                    "completion_tokens": completion_tok,
                    "total_tokens": prompt_tok + completion_tok
                }
            })
        if user_id:
            from app.db.mongo import get_mongo_manager
            await get_mongo_manager().increment_user_token_usage(user_id, prompt_tok, completion_tok)
        return result

    @traceable(run_type="chain", name="CortexWiki Stream Text")
    async def stream_text(
        self,
        *,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.3,
        max_output_tokens: int = settings.LLM_MAX_OUTPUT_TOKENS,
        primary_provider: str = "groq",
    ):
        user_id = user_id_ctx.get()
        if user_id:
            await self.check_token_limits(user_id)

        accumulated = []
        providers = ["groq", "gemini"] if primary_provider == "groq" else ["gemini", "groq"]

        try:
            for provider in providers:
                if provider == "groq" and settings.GROQ_API_KEY:
                    groq_ok = False
                    async for chunk in self._groq_stream(
                        prompt=prompt,
                        system_instruction=system_instruction,
                        temperature=temperature,
                        max_output_tokens=max_output_tokens,
                    ):
                        groq_ok = True
                        if chunk:
                            accumulated.append(chunk)
                        yield chunk
                    if groq_ok:
                        prompt_tokens = self.estimate_tokens(prompt) + (self.estimate_tokens(system_instruction) if system_instruction else 0)
                        completion_tokens = self.estimate_tokens("".join(accumulated))
                        run_tree = get_current_run_tree()
                        if run_tree:
                            run_tree.metadata.update({
                                "token_usage": {
                                    "prompt_tokens": prompt_tokens,
                                    "completion_tokens": completion_tokens,
                                    "total_tokens": prompt_tokens + completion_tokens
                                }
                            })
                        if user_id:
                            from app.db.mongo import get_mongo_manager
                            await get_mongo_manager().increment_user_token_usage(user_id, prompt_tokens, completion_tokens)
                        return

                elif provider == "gemini" and settings.GEMINI_API_KEY:
                    gemini_ok = False
                    async for chunk in self._gemini_stream(
                        prompt=prompt,
                        system_instruction=system_instruction,
                        temperature=temperature,
                        max_output_tokens=max_output_tokens,
                    ):
                        gemini_ok = True
                        if chunk:
                            accumulated.append(chunk)
                        yield chunk
                    if gemini_ok:
                        prompt_tokens = self.estimate_tokens(prompt) + (self.estimate_tokens(system_instruction) if system_instruction else 0)
                        completion_tokens = self.estimate_tokens("".join(accumulated))
                        run_tree = get_current_run_tree()
                        if run_tree:
                            run_tree.metadata.update({
                                "token_usage": {
                                    "prompt_tokens": prompt_tokens,
                                    "completion_tokens": completion_tokens,
                                    "total_tokens": prompt_tokens + completion_tokens
                                }
                            })
                        if user_id:
                            from app.db.mongo import get_mongo_manager
                            await get_mongo_manager().increment_user_token_usage(user_id, prompt_tokens, completion_tokens)
                        return

            if not settings.GROQ_API_KEY and not settings.GEMINI_API_KEY:
                for chunk in chunk_words(self._fallback_generate(prompt)):
                    if chunk:
                        accumulated.append(chunk)
                    yield chunk
            else:
                raise AppError(
                    status_code=503,
                    code="llm_unavailable",
                    message="All AI providers are currently unavailable or overloaded. Please try again later.",
                )
                
            prompt_tokens = self.estimate_tokens(prompt) + (self.estimate_tokens(system_instruction) if system_instruction else 0)
            completion_tokens = self.estimate_tokens("".join(accumulated))
            run_tree = get_current_run_tree()
            if run_tree:
                run_tree.metadata.update({
                    "token_usage": {
                        "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens,
                        "total_tokens": prompt_tokens + completion_tokens
                    }
                })
            if user_id:
                from app.db.mongo import get_mongo_manager
                await get_mongo_manager().increment_user_token_usage(user_id, prompt_tokens, completion_tokens)
        except Exception as exc:
            prompt_tokens = self.estimate_tokens(prompt) + (self.estimate_tokens(system_instruction) if system_instruction else 0)
            completion_tokens = self.estimate_tokens("".join(accumulated))
            run_tree = get_current_run_tree()
            if run_tree:
                run_tree.metadata.update({
                    "token_usage": {
                        "prompt_tokens": prompt_tokens,
                        "completion_tokens": completion_tokens,
                        "total_tokens": prompt_tokens + completion_tokens
                    }
                })
            if user_id:
                try:
                    from app.db.mongo import get_mongo_manager
                    await get_mongo_manager().increment_user_token_usage(user_id, prompt_tokens, completion_tokens)
                except Exception:
                    pass
            raise exc

    @traceable(run_type="embedding", name="CortexWiki Embed Text")
    async def embed_text(self, text: str) -> list[float]:
        """
        Generate embedding for text with caching support.
        
        BUG FIX #22: Cache embeddings to reduce API calls and improve performance.
        """
        if not text:
            return []
        
        user_id = user_id_ctx.get()
        if user_id:
            await self.check_token_limits(user_id)
        
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
        if redis_store and redis_store.client:
            try:
                cached = await redis_store.client.get(cache_key)
                if cached:
                    logger.debug("Cache hit for embedding: %s", cache_key)
                    run_tree = get_current_run_tree()
                    if run_tree:
                        run_tree.metadata.update({
                            "cached": True,
                            "token_usage": {
                                "prompt_tokens": 0,
                                "completion_tokens": 0,
                                "total_tokens": 0
                            }
                        })
                    # Cached as JSON string
                    return json.loads(cached)
            except Exception as exc:
                logger.debug("Embedding cache lookup failed: %s", str(exc))
        
        # Generate new embedding
        if settings.GEMINI_API_KEY:
            result = await self._gemini_embed(text)
            if result:
                # Cache the embedding for 24 hours (86400 seconds)
                if redis_store and redis_store.client:
                    try:
                        await redis_store.client.setex(
                            cache_key,
                            86400,
                            json.dumps(result),
                        )
                        logger.debug("Cached embedding: %s", cache_key)
                    except Exception as exc:
                        logger.warning("Failed to cache embedding: %s", str(exc))
                input_tokens = self.estimate_tokens(text)
                run_tree = get_current_run_tree()
                if run_tree:
                    run_tree.metadata.update({
                        "cached": False,
                        "token_usage": {
                            "prompt_tokens": input_tokens,
                            "completion_tokens": 0,
                            "total_tokens": input_tokens
                        }
                    })
                if user_id:
                    from app.db.mongo import get_mongo_manager
                    await get_mongo_manager().increment_user_token_usage(user_id, input_tokens, 0)
                return result
        
        # Fallback embedding
        embedding = self._fallback_embedding(text)
        input_tokens = self.estimate_tokens(text)
        run_tree = get_current_run_tree()
        if run_tree:
            run_tree.metadata.update({
                "cached": False,
                "token_usage": {
                    "prompt_tokens": input_tokens,
                    "completion_tokens": 0,
                    "total_tokens": input_tokens
                }
            })
        if user_id:
            from app.db.mongo import get_mongo_manager
            await get_mongo_manager().increment_user_token_usage(user_id, input_tokens, 0)
        return embedding

    @traceable(run_type="chain", name="CortexWiki Summarize")
    async def summarize(self, text: str) -> str:
        if not text:
            return ""

        # Approximate tokens to characters (1 token ~= 4 chars)
        primary_char_limit = settings.LLM_MAX_INPUT_TOKENS_INGESTION * 4
        primary_text = text[:primary_char_limit]

        # 1. Attempt primary model for ingestion
        if settings.GEMINI_API_KEY:
            if not await _api_circuit_breaker.is_open("gemini"):
                try:
                    prompt = (
                        "Summarize the following material for an enterprise knowledge base.\n\n"
                        "=== CRITICAL DIRECTIVES ===\n"
                        "1. STRUCTURE: Organize the summary using appropriate Markdown headers where relevant (e.g. '## Overview', '## Key Components', '## Benefits').\n"
                        "2. LISTS & TABLES: Format any lists cleanly using standard Markdown bullet points ('- ') or numbered lists ('1. '). If there is structured data, use Markdown Tables.\n"
                        "3. RICH MARKDOWN: Leverage **bolding** for emphasis, `inline code` for technical jargon, and > blockquotes for key quotes.\n"
                        "4. STYLE: Keep it factual, grounded, concise, and professional.\n"
                        "5. NO CHITCHAT: Output only the raw structured Markdown text.\n\n"
                        "=== MATERIAL ===\n"
                        f"{primary_text}"
                    )
                    logger.info("Attempting ingestion summarization (len=%d chars) via %s", len(primary_text), settings.LLM_PROVIDER_INGESTION)
                    summary = await self.generate_text(
                        prompt=prompt,
                        temperature=0.2,
                        max_output_tokens=settings.LLM_MAX_OUTPUT_TOKENS,
                        primary_provider=settings.LLM_PROVIDER_INGESTION,
                    )
                    # Check if generate_text fell back to static fallback or worked
                    if summary and not ("=== CRITICAL DIRECTIVES ===" in summary or "NO CHITCHAT" in summary):
                        return summary.strip()
                except Exception as e:
                    logger.warning("Gemini ingestion summarization failed, falling back to Groq: %s", str(e))

        # 2. Fallback chunk summarization
        fallback_char_limit = settings.LLM_FALLBACK_MAX_INPUT_TOKENS_INGESTION * 4
        fallback_text = text[:fallback_char_limit]
        
        logger.info("Using fallback for ingestion summarization (truncated len=%d chars)", len(fallback_text))
        chunk_size = 4096
        chunks = [fallback_text[i:i+chunk_size] for i in range(0, len(fallback_text), chunk_size)]
        
        chunk_summaries = []
        for idx, chunk in enumerate(chunks):
            chunk_prompt = (
                f"Summarize the following section of a larger document (Part {idx+1}/{len(chunks)}) for an enterprise knowledge base.\n\n"
                "=== MATERIAL ===\n"
                f"{chunk}"
            )
            # Use Groq for fallback chunk summarization
            chunk_summary = await self.generate_text(
                prompt=chunk_prompt,
                system_instruction="You are a precise summarization assistant.",
                temperature=0.2,
                max_output_tokens=settings.LLM_FALLBACK_MAX_OUTPUT_TOKENS,
                primary_provider="groq",
            )
            if chunk_summary:
                chunk_summaries.append(chunk_summary.strip())
        
        if not chunk_summaries:
            return "No content available."

        combined_summaries = "\n\n".join(chunk_summaries)
        merge_prompt = (
            "Summarize and merge the following section summaries into a single cohesive, highly structured summary for an enterprise knowledge base.\n\n"
            "=== CRITICAL DIRECTIVES ===\n"
            "1. STRUCTURE: Organize the summary using appropriate Markdown headers where relevant (e.g. '## Overview', '## Key Components', '## Benefits').\n"
            "2. LISTS & TABLES: Format any lists cleanly using standard Markdown bullet points ('- ') or numbered lists ('1. '). If there is structured data, use Markdown Tables.\n"
            "3. RICH MARKDOWN: Leverage **bolding** for emphasis, `inline code` for technical jargon, and > blockquotes for key quotes.\n"
            "4. STYLE: Keep it factual, grounded, concise, and professional.\n"
            "5. NO CHITCHAT: Output only the raw structured Markdown text.\n\n"
            "=== SECTION SUMMARIES ===\n"
            f"{combined_summaries}"
        )
        
        merged_summary = await self.generate_text(
            prompt=merge_prompt,
            temperature=0.2,
            max_output_tokens=settings.LLM_MAX_OUTPUT_TOKENS,
            primary_provider="groq",
        )
        return merged_summary.strip()

    @traceable(run_type="chain", name="CortexWiki Merge Notes")
    async def merge_notes(
        self,
        *,
        existing_note: str,
        new_summary: str,
        new_title: str,
        raw_content: str = "",
    ) -> str:
        """
        Compound an existing master note with a new source summary.
        If no existing note yet, the new summary is structured into the first master note.
        The result is a single unified note — not a list of separate summaries.
        """
        # Ensure we always write a detailed, comprehensive, and exhaustive master note
        compression_instruction = (
            "Write a highly detailed, comprehensive, and exhaustive master note. "
            "Do not compress or summarize heavily; preserve specific examples, key definitions, "
            "detailed explanations, and all facts from both the existing note and the new source."
        )

        existing_note_to_use = existing_note.strip() if existing_note.strip() else "(No existing note. This is the first source.)"

        prompt = (
            "You are maintaining a unified, compounded, and highly structured knowledge note for a wiki, "
            "designed in the style of a world-class Google NotebookLM study guide.\n\n"
            "=== INPUTS ===\n"
            f"EXISTING MASTER NOTE:\n{existing_note_to_use}\n\n"
            f"NEW SOURCE TITLE: {new_title}\n"
            f"NEW SOURCE SUMMARY:\n{new_summary}\n\n"
            "=== STRATEGY ===\n"
            f"{compression_instruction}\n\n"
            "=== CRITICAL DIRECTIVES ===\n"
            "1. STRUCTURE & FORMATTING: Your output MUST be formatted as a single unified Markdown document with the following specific sections. Use clear headings (h2, i.e., '##') for each section:\n"
            "   - ## 📌 Document Overview: A cohesive, high-level paragraph summarizing the domain and overall subject matter covered by the wiki. Synthesize the new source details into this overview.\n"
            "   - ## 🔑 Key Concepts & Definitions: A glossary of critical terms, definitions, acronyms, or concepts from all sources. Update and expand this glossary with any new concepts from the new source. Keep it sorted or neatly organized with bold terms (e.g. '- **Term**: Definition').\n"
            "   - ## 📑 Core Themes & Detailed Synthesis: Group the knowledge into logical thematic sections. Use a single level-3 heading (e.g. '### Theme Name') for each theme. Deeply synthesize the facts, examples, explanations, and data. Never duplicate section names.\n"
            "   - ## 📊 Data & Comparisons (If Applicable): If there are structured comparisons, statistics, or metrics, format them cleanly using Markdown Tables.\n"
            "   - ## ❓ Frequently Asked Questions (FAQ): A grounded Q&A section consisting of 3-5 high-value questions and detailed answers directly answered by the source texts. Update or add new questions relevant to the new source.\n\n"
            "2. RICH MARKDOWN: You MUST leverage rich Markdown effectively (GFM supported). Use **bolding** for emphasis, `inline code` for technical terms, > blockquotes for important excerpts, and Markdown tables for any structured data. Use task lists (- [ ]) for action items.\n"
            "3. KNOWLEDGE PRESERVATION: Do NOT skip, omit, or lose any details, facts, or concepts from the EXISTING MASTER NOTE. Integrate the NEW SOURCE information into this structure by merging matching themes, expanding the concepts glossary, updating the overview, and adding/updating the FAQs.\n"
            "4. NO SEPARATE LISTING: Do not list sources separately or create a simple concatenation of summaries. Integrate all information into the unified structure above.\n"
            "5. DETAIL PRESERVATION: Provide an exhaustive, comprehensive synthesis of all details. Expand existing sections with new insights and detailed descriptions, rather than shortening them. Do not write a summarized or condensed version; ensure the output is long, thorough, and highly detailed.\n"
            "6. NO INTRO/OUTRO: Output ONLY the raw Markdown note. Do not include any introductory remarks (e.g., 'Here is the updated note:') or concluding remarks."
        )
        
        # Pull dynamic limits from settings
        max_tokens = settings.LLM_MAX_OUTPUT_TOKENS
        
        merged = await self.generate_text(
            prompt=prompt,
            temperature=0.2,
            max_output_tokens=max_tokens,
            primary_provider=settings.LLM_PROVIDER_INGESTION, # Dynamic primary model for ingestion
        )
        
        # Check if output is the static prompt slice fallback (outage protection)
        is_fallback = False
        if merged:
            if "NO INTRO/OUTRO" in merged or "NO SEPARATE LISTING" in merged:
                is_fallback = True

        if not merged or not merged.strip() or is_fallback:
            return existing_note if existing_note.strip() else new_summary.strip()
        return merged.strip()

    # ── Groq ──────────────────────────────────────────────────────────────────

    @traceable(run_type="llm", name="Groq Llama Generation")
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
            from app.core.http import get_http_client
            client = get_http_client()
            response = await client.post(
                _GROQ_CHAT_URL,
                json=payload,
                headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
                timeout=settings.LLM_REQUEST_TIMEOUT,
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
            
            usage = data.get("usage", {})
            prompt_tok = usage.get("prompt_tokens") or self.estimate_tokens(prompt) + (self.estimate_tokens(system_instruction) if system_instruction else 0)
            completion_tok = usage.get("completion_tokens") or self.estimate_tokens(text)
            
            run_tree = get_current_run_tree()
            if run_tree:
                run_tree.metadata.update({
                    "token_usage": {
                        "prompt_tokens": prompt_tok,
                        "completion_tokens": completion_tok,
                        "total_tokens": prompt_tok + completion_tok
                    }
                })

            user_id = user_id_ctx.get()
            if user_id:
                from app.db.mongo import get_mongo_manager
                await get_mongo_manager().increment_user_token_usage(user_id, prompt_tok, completion_tok)
            return text.strip()
        except (httpx.HTTPError, KeyError, IndexError) as exc:
            await _api_circuit_breaker.record_failure("groq")
            logger.warning("Groq generate failed: %s — falling back to Gemini", str(exc))
            return ""
        except Exception:
            await _api_circuit_breaker.record_failure("groq")
            logger.exception("Unexpected error in Groq generate")
            return ""

    @traceable(run_type="llm", name="Groq Llama Streaming")
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
            from app.core.http import get_http_client
            client = get_http_client()
            async with client.stream(
                "POST",
                _GROQ_CHAT_URL,
                json=payload,
                headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
                timeout=settings.LLM_STREAM_TIMEOUT,
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

    @traceable(run_type="llm", name="Gemini Flash Generation")
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
            from app.core.http import get_http_client
            client = get_http_client()
            response = await client.post(
                _GEMINI_GENERATE_URL,
                json=payload,
                params={"key": settings.GEMINI_API_KEY},
                timeout=settings.LLM_REQUEST_TIMEOUT,
            )
            response.raise_for_status()
            data = response.json()
            text = self._extract_gemini_text(data)
            await _api_circuit_breaker.record_success("gemini")
            logger.info("Gemini generate OK (model=%s)", settings.GEMINI_MODEL)
            
            usage = data.get("usageMetadata", {})
            prompt_tok = usage.get("promptTokenCount") or self.estimate_tokens(prompt) + (self.estimate_tokens(system_instruction) if system_instruction else 0)
            completion_tok = usage.get("candidatesTokenCount") or self.estimate_tokens(text)
            
            run_tree = get_current_run_tree()
            if run_tree:
                run_tree.metadata.update({
                    "token_usage": {
                        "prompt_tokens": prompt_tok,
                        "completion_tokens": completion_tok,
                        "total_tokens": prompt_tok + completion_tok
                    }
                })

            user_id = user_id_ctx.get()
            if user_id:
                from app.db.mongo import get_mongo_manager
                await get_mongo_manager().increment_user_token_usage(user_id, prompt_tok, completion_tok)
            return text
        except httpx.HTTPError as exc:
            await _api_circuit_breaker.record_failure("gemini")
            logger.exception("Gemini generate failed — using static fallback: %s", str(exc))
            return ""

    @traceable(run_type="llm", name="Gemini Flash Streaming")
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
            from app.core.http import get_http_client
            client = get_http_client()
            async with client.stream(
                "POST",
                _GEMINI_STREAM_URL,
                json=payload,
                params={"key": settings.GEMINI_API_KEY, "alt": "sse"},
                timeout=settings.LLM_STREAM_TIMEOUT,
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
            from app.core.http import get_http_client
            client = get_http_client()
            response = await client.post(
                _GEMINI_EMBED_URL,
                json=payload,
                params={"key": settings.GEMINI_API_KEY},
                timeout=settings.LLM_REQUEST_TIMEOUT,
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
        return " ".join(p.get("text", "") for p in parts if p.get("text")).strip()

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