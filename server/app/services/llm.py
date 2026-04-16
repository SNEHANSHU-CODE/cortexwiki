import hashlib
import json
import re
from typing import Any

import httpx

from app.core.config import settings
from app.utils.logging import get_logger
from app.utils.text import chunk_words, clean_text, split_sentences


logger = get_logger("services.llm")


class LLMService:
    def __init__(self) -> None:
        self.api_key = settings.GEMINI_API_KEY

    async def generate_text(
        self,
        *,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.3,
        max_output_tokens: int = 1024,
    ) -> str:
        if not self.api_key:
            return self._fallback_generate(prompt)

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.GEMINI_MODEL}:generateContent"
        parts = []
        if system_instruction:
            parts.append({"text": system_instruction})
        parts.append({"text": prompt})

        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_output_tokens,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=40.0, verify=settings.OUTBOUND_VERIFY_SSL) as client:
                response = await client.post(url, json=payload, params={"key": self.api_key})
                response.raise_for_status()
        except httpx.HTTPError:
            logger.exception("Gemini text generation failed, using fallback")
            return self._fallback_generate(prompt)

        data = response.json()
        text = self._extract_text(data)
        return text or self._fallback_generate(prompt)

    async def embed_text(self, text: str) -> list[float]:
        if not text:
            return []
        if not self.api_key:
            return self._fallback_embedding(text)

        url = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent"
        payload = {
            "model": f"models/{settings.GEMINI_EMBEDDING_MODEL}",
            "content": {"parts": [{"text": text[:4000]}]},
        }
        try:
            async with httpx.AsyncClient(timeout=30.0, verify=settings.OUTBOUND_VERIFY_SSL) as client:
                response = await client.post(url, json=payload, params={"key": self.api_key})
                response.raise_for_status()
                body = response.json()
        except httpx.HTTPError:
            logger.exception("Gemini embedding failed, using fallback hash embedding")
            return self._fallback_embedding(text)

        values = body.get("embedding", {}).get("values")
        return values or self._fallback_embedding(text)

    async def summarize(self, text: str) -> str:
        if not text:
            return ""
        prompt = (
            "Summarize the following material for an enterprise knowledge base. "
            "Keep it grounded, factual, and concise.\n\n"
            f"{text[:8000]}"
        )
        summary = await self.generate_text(prompt=prompt, temperature=0.2, max_output_tokens=300)
        return clean_text(summary)

    async def stream_text(
        self,
        *,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.3,
        max_output_tokens: int = 1024,
    ):
        if not self.api_key:
            fallback_text = self._fallback_generate(prompt)
            for chunk in chunk_words(fallback_text):
                yield chunk
            return

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.GEMINI_MODEL}:streamGenerateContent"
        parts = []
        if system_instruction:
            parts.append({"text": system_instruction})
        parts.append({"text": prompt})

        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_output_tokens,
            },
        }

        previous_text = ""

        try:
            async with httpx.AsyncClient(timeout=None, verify=settings.OUTBOUND_VERIFY_SSL) as client:
                async with client.stream(
                    "POST",
                    url,
                    json=payload,
                    params={"key": self.api_key, "alt": "sse"},
                ) as response:
                    response.raise_for_status()

                    async for raw_line in response.aiter_lines():
                        line = raw_line.strip()
                        if not line.startswith("data:"):
                            continue

                        chunk_text = self._extract_text(json.loads(line.removeprefix("data:").strip()))
                        if not chunk_text:
                            continue

                        delta = chunk_text
                        if chunk_text.startswith(previous_text):
                            delta = chunk_text[len(previous_text) :]

                        previous_text = chunk_text
                        if delta:
                            yield delta
            return
        except (httpx.HTTPError, json.JSONDecodeError):
            logger.exception("Gemini streaming failed, using buffered fallback stream")

        buffered_text = await self.generate_text(
            prompt=prompt,
            system_instruction=system_instruction,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )
        for chunk in chunk_words(buffered_text):
            yield chunk

    def _extract_text(self, data: dict) -> str:
        candidates = data.get("candidates", [])
        if not candidates:
            return ""
        parts = candidates[0].get("content", {}).get("parts", [])
        chunks = [part.get("text", "") for part in parts if part.get("text")]
        return clean_text(" ".join(chunks))

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


llm_service = LLMService()


def get_llm_service() -> LLMService:
    return llm_service
