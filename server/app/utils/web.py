import asyncio
from urllib.parse import parse_qs, urlparse

import httpx
from bs4 import BeautifulSoup
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import TextFormatter

from app.core.config import settings
from app.utils.errors import AppError
from app.utils.text import clean_text


def extract_youtube_video_id(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.netloc in {"youtu.be", "www.youtu.be"}:
        return parsed.path.strip("/") or None
    if "youtube.com" in parsed.netloc:
        if parsed.path == "/watch":
            return parse_qs(parsed.query).get("v", [None])[0]
        if parsed.path.startswith("/embed/"):
            return parsed.path.split("/embed/")[-1]
    return None


async def fetch_youtube_content(url: str) -> dict:
    video_id = extract_youtube_video_id(url)
    if not video_id:
        raise AppError(status_code=400, code="invalid_youtube_url", message="Invalid YouTube URL.")

    try:
        transcript_data = await asyncio.to_thread(YouTubeTranscriptApi.get_transcript, video_id)
        transcript = TextFormatter().format_transcript(transcript_data)
    except Exception as exc:
        raise AppError(status_code=400, code="youtube_transcript_unavailable", message="Unable to fetch YouTube transcript.") from exc

    title = f"YouTube Video {video_id}"
    try:
        async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": settings.USER_AGENT}, verify=settings.OUTBOUND_VERIFY_SSL) as client:
            response = await client.get(f"https://www.youtube.com/watch?v={video_id}")
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, "html.parser")
                meta_title = soup.find("meta", property="og:title")
                if meta_title and meta_title.get("content"):
                    title = meta_title["content"].strip()
    except Exception:
        pass

    return {
        "title": title,
        "content": clean_text(transcript)[: settings.INGEST_MAX_CHARACTERS],
        "source_type": "youtube",
        "source_url": url,
    }


async def fetch_web_page_content(url: str) -> dict:
    try:
        async with httpx.AsyncClient(
            timeout=20.0,
            headers={"User-Agent": settings.USER_AGENT},
            follow_redirects=True,
            verify=settings.OUTBOUND_VERIFY_SSL,
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise AppError(status_code=400, code="web_fetch_failed", message="Unable to fetch web page.") from exc

    soup = BeautifulSoup(response.text, "html.parser")
    for script in soup(["script", "style", "noscript"]):
        script.decompose()

    title = soup.title.string.strip() if soup.title and soup.title.string else url
    text = clean_text(" ".join(soup.stripped_strings))
    if not text:
        raise AppError(status_code=400, code="web_content_empty", message="No usable content found on the page.")

    return {
        "title": title,
        "content": text[: settings.INGEST_MAX_CHARACTERS],
        "source_type": "web",
        "source_url": url,
    }


async def search_web(query: str, limit: int | None = None) -> list[dict]:
    if not query.strip():
        return []

    result_limit = limit or settings.INTERNET_SEARCH_RESULT_LIMIT

    try:
        async with httpx.AsyncClient(
            timeout=20.0,
            headers={"User-Agent": settings.USER_AGENT},
            follow_redirects=True,
            verify=settings.OUTBOUND_VERIFY_SSL,
        ) as client:
            response = await client.post(
                settings.INTERNET_SEARCH_ENDPOINT,
                data={"q": query},
            )
            response.raise_for_status()
    except httpx.HTTPError:
        return []

    soup = BeautifulSoup(response.text, "html.parser")
    results: list[dict] = []

    for result in soup.select(".result"):
        anchor = result.select_one(".result__a")
        snippet = result.select_one(".result__snippet")
        if not anchor or not anchor.get("href"):
            continue

        title = clean_text(anchor.get_text(" ", strip=True))
        url = anchor["href"]
        description = clean_text(snippet.get_text(" ", strip=True) if snippet else "")

        if not title or not url:
            continue

        results.append(
            {
                "title": title,
                "url": url,
                "description": description,
                "source_type": "internet",
            }
        )

        if len(results) >= result_limit:
            break

    return results
