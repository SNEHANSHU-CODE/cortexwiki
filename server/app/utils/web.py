import asyncio
import certifi
import contextvars
import os
import tempfile
from urllib.parse import parse_qs, urlparse
import uuid

import httpx
from bs4 import BeautifulSoup
import yt_dlp

from app.core.config import settings
from app.utils.errors import AppError
from app.utils.text import clean_text
from app.utils.logging import get_logger

logger = get_logger("utils.web")


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


# ── Primary: Supadata API ─────────────────────────────────────────────────────

async def _fetch_transcript_supadata(video_id: str) -> str:
    """
    Primary transcript provider.
    Bypasses datacenter IP blocks via Supadata's proxy infrastructure.
    Docs: https://supadata.ai/documentation/youtube/get-transcript
    """
    if not settings.SUPADATA_API_KEY:
        raise ValueError("SUPADATA_API_KEY not configured")

    from app.core.http import get_http_client
    client = get_http_client()
    response = await client.get(
        "https://api.supadata.ai/v1/youtube/transcript",
        params={"videoId": video_id, "text": "true"},
        headers={"x-api-key": settings.SUPADATA_API_KEY},
    )

    if response.status_code == 404:
        raise AppError(
            status_code=400,
            code="youtube_transcript_unavailable",
            message="This video has no transcript or captions available.",
        )
    if response.status_code == 401:
        raise AppError(status_code=401, code="supadata_unauthorized", message="Supadata API key invalid")
    if response.status_code == 429:
        raise AppError(status_code=429, code="supadata_rate_limited", message="Supadata rate limit reached")

    response.raise_for_status()
    data = response.json()

    content = data.get("content", "")
    if isinstance(content, list):
        content = " ".join(segment.get("text", "") for segment in content)

    if not content or not content.strip():
        raise ValueError("Supadata returned empty transcript")

    return content.strip()


# ── Fallback: youtube-transcript-api + ScraperAPI proxy ──────────────────────

async def _fetch_transcript_scraperapi(video_id: str) -> str:
    """
    Fallback transcript provider.
    Uses youtube-transcript-api routed through ScraperAPI residential proxy.
    Free tier: 1000 requests/month — https://scraperapi.com
    """
    if not settings.SCRAPERAPI_KEY:
        raise ValueError("SCRAPERAPI_KEY not configured")

    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.formatters import TextFormatter

    proxy_url = settings.scraperapi_proxy_url
    proxies = {"https": proxy_url, "http": proxy_url}

    try:
        ctx = contextvars.copy_context()
        transcript_data = await asyncio.wait_for(
            asyncio.to_thread(
                ctx.run,
                YouTubeTranscriptApi.get_transcript,
                video_id,
                proxies=proxies,
            ),
            timeout=settings.HTTP_REQUEST_TIMEOUT,
        )
        transcript = TextFormatter().format_transcript(transcript_data)
    except asyncio.TimeoutError:
        raise AppError(status_code=504, code="youtube_transcript_timeout", message="Transcript fetch timed out")
    except Exception:
        raise AppError(status_code=400, code="youtube_transcript_fetch_failed", message="Unable to retrieve YouTube transcript at this time.")

    if not transcript or not transcript.strip():
        raise ValueError("ScraperAPI fallback returned empty transcript")

    return transcript.strip()


# ── Whisper Fallback ─────────────────────────────────────────────────────────

async def _fetch_transcript_whisper_fallback(video_id: str) -> str:
    """
    Fallback transcript provider.
    Downloads the lowest bitrate audio stream using yt-dlp to save bandwidth,
    uploads it to Groq Whisper API (whisper-large-v3-turbo), and returns the transcription.

    Anti-bot hardening applied:
    - Browser User-Agent to avoid datacenter fingerprinting.
    - PO Token + visitor_data injection (set YT_PO_TOKEN + YT_VISITOR_DATA env vars).
    - Optional Netscape cookie file from YT_COOKIES_BASE64 env var (most effective bypass).
    - Fragment and connection retries for transient network failures.
    - Format fallback chain: worstaudio -> bestaudio/audio -> any.
    """
    if not settings.GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY not configured for Whisper fallback")

    video_url = f"https://www.youtube.com/watch?v={video_id}"
    temp_dir = tempfile.gettempdir()
    run_id = uuid.uuid4().hex[:8]
    outtmpl = os.path.join(temp_dir, f"yt_audio_{video_id}_{run_id}.%(ext)s")
    cookie_file: str | None = None

    # ── Build cookies file from base64 env var (most effective anti-bot bypass) ──
    if settings.YT_COOKIES_BASE64:
        try:
            import base64 as _base64
            cookie_file = os.path.join(temp_dir, f"yt_cookies_{run_id}.txt")
            cookie_bytes = _base64.b64decode(settings.YT_COOKIES_BASE64)
            with open(cookie_file, "wb") as f:
                f.write(cookie_bytes)
            logger.debug("Wrote YouTube cookie file for yt-dlp (%d bytes)", len(cookie_bytes))
        except Exception as exc:
            logger.warning("Failed to decode YT_COOKIES_BASE64, proceeding without cookies: %s", exc)
            cookie_file = None

    ydl_opts: dict = {
        # ── Format: try lowest quality first to minimise bandwidth and download time ──
        # Falls back progressively if worstaudio isn't available.
        "format": "worstaudio/bestaudio[abr<=64]/bestaudio/audio/best",

        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,

        # ── SSL: yt-dlp uses its own stack, not httpx/certifi ────────────────────
        "nocheckcertificate": True,

        # ── Browser impersonation headers ──────────────────────────────────────
        # Prevents YouTube from fingerprinting the request as a headless datacenter client.
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },

        # ── Retry configuration for transient failures ─────────────────────────
        "retries": 3,            # retry info/manifest fetch up to 3 times
        "fragment_retries": 3,   # retry individual audio fragment downloads 3 times
        "socket_timeout": 30,    # bail out after 30s idle instead of hanging indefinitely

        # ── Extractor args: PO Token + visitor data (YouTube bot bypass) ───────
        # Set YT_PO_TOKEN="web.gvs+<base64url_token>" and YT_VISITOR_DATA="<visitor_data>"
        # in your environment variables. yt-dlp passes these to YouTube's API to prove
        # the request originated from a real browser session, bypassing bot-detection.
        # Generate tokens at: https://github.com/iv-org/youtube-po-token-generator
        **(
            {"extractor_args": {
                "youtube": {
                    "po_token": [settings.YT_PO_TOKEN],
                    **({"visitor_data": [settings.YT_VISITOR_DATA]} if settings.YT_VISITOR_DATA else {}),
                }
            }}
            if settings.YT_PO_TOKEN else {}
        ),
    }

    # ── Optional: cookies from env var ────────────────────────────────────────
    if cookie_file:
        ydl_opts["cookiefile"] = cookie_file

    # ── Optional: ScraperAPI proxy for datacenter IP bypass ───────────────────
    if settings.SCRAPERAPI_KEY:
        ydl_opts["proxy"] = settings.scraperapi_proxy_url

    def _download() -> str:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)
            return ydl.prepare_filename(info)

    downloaded_file: str | None = None
    try:
        logger.info("Downloading lowest bitrate audio for video %s using yt-dlp...", video_id)
        downloaded_file = await asyncio.to_thread(_download)
        logger.info("Audio downloaded to %s (size: %d bytes)", downloaded_file, os.path.getsize(downloaded_file))

        # ── Upload to Groq Whisper API ─────────────────────────────────────────
        whisper_url = f"{settings.GROQ_BASE_URL}/audio/transcriptions"
        headers = {"Authorization": f"Bearer {settings.GROQ_API_KEY}"}
        filename = os.path.basename(downloaded_file)

        logger.info("Uploading %s to Groq Whisper API (whisper-large-v3-turbo)...", filename)
        verify_ssl = certifi.where() if settings.OUTBOUND_VERIFY_SSL else False
        async with httpx.AsyncClient(timeout=60.0, verify=verify_ssl) as client:
            with open(downloaded_file, "rb") as f:
                response = await client.post(
                    whisper_url,
                    headers=headers,
                    files={"file": (filename, f, "application/octet-stream")},
                    data={"model": "whisper-large-v3-turbo", "response_format": "json"},
                )

        response.raise_for_status()
        result_json = response.json()
        transcript = result_json.get("text", "")
        if not transcript or not transcript.strip():
            raise ValueError("Groq Whisper API returned empty transcription")

        logger.info("Whisper transcription completed successfully for video %s.", video_id)
        return transcript.strip()

    finally:
        # Clean up audio file
        if downloaded_file and os.path.exists(downloaded_file):
            try:
                os.remove(downloaded_file)
                logger.debug("Deleted temporary audio file: %s", downloaded_file)
            except Exception as e:
                logger.warning("Failed to delete temporary audio file %s: %s", downloaded_file, e)
        # Clean up cookie file
        if cookie_file and os.path.exists(cookie_file):
            try:
                os.remove(cookie_file)
            except Exception:
                pass

# ── Public fetch function ─────────────────────────────────────────────────────


async def fetch_youtube_content(url: str) -> dict:
    video_id = extract_youtube_video_id(url)
    if not video_id:
        raise AppError(
            status_code=400,
            code="invalid_youtube_url",
            message="Invalid YouTube URL.",
        )

    transcript: str | None = None
    last_error: Exception | None = None

    # 1. Try Supadata first — fastest and most reliable provider.
    #    Supadata bypasses YouTube's anti-bot via its own residential proxy infrastructure.
    if transcript is None and settings.SUPADATA_API_KEY:
        try:
            logger.info(f"Attempting to fetch transcript for video {video_id} via Supadata...")
            transcript = await _fetch_transcript_supadata(video_id)
            logger.info(f"Successfully fetched transcript via Supadata for video {video_id}.")
        except Exception as exc:
            logger.warning(f"Supadata transcript fetch failed for video {video_id}: {exc}")
            last_error = exc

    # 2. Fallback: Groq Whisper via yt-dlp audio download.
    #    Used for videos that have no auto-captions/subtitles (Supadata returns 404).
    #    NOTE: ScraperAPI was previously used here via youtube-transcript-api but was
    #    removed — YouTube's anti-bot fingerprints the proxy, causing consistent failures.
    if transcript is None:
        try:
            logger.info(f"Attempting to fetch transcript for video {video_id} via Groq Whisper API...")
            transcript = await _fetch_transcript_whisper_fallback(video_id)
            logger.info(f"Successfully fetched transcript via Groq Whisper for video {video_id}.")
        except Exception as exc:
            logger.warning(f"Groq Whisper transcription failed for video {video_id}: {exc}")
            last_error = exc

    if transcript is None:
        raise AppError(
            status_code=400,
            code="youtube_transcript_unavailable",
            message="Unable to fetch YouTube transcript. Supadata and Whisper both failed.",
        ) from last_error


    # Fetch video title from YouTube page (best-effort)
    title = f"YouTube Video {video_id}"
    try:
        from app.core.http import get_http_client
        client = get_http_client()
        response = await client.get(f"https://www.youtube.com/watch?v={video_id}")
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "html.parser")
            meta_title = soup.find("meta", property="og:title")
            if meta_title and meta_title.get("content"):
                # Sanitize title to strip HTML and truncate to safe length
                raw = meta_title.get("content", "")
                safe = BeautifulSoup(raw, "html.parser").get_text()
                safe = clean_text(safe).strip()
                if safe:
                    title = safe[:200]
    except Exception:
        pass

    return {
        "title": title,
        "content": clean_text(transcript)[: settings.INGEST_MAX_CHARACTERS],
        "source_type": "youtube",
        "source_url": url,
    }


# ── Web page fetch ────────────────────────────────────────────────────────────

async def fetch_web_page_content(url: str) -> dict:
    from app.core.http import get_http_client
    client = get_http_client()
    
    max_redirects = 5
    current_url = url
    
    def is_blocked_ip(target_url: str) -> bool:
        from urllib.parse import urlparse
        import socket
        try:
            parsed = urlparse(target_url)
            hostname = parsed.hostname or ""
            if not hostname:
                return True
            # Block known local names
            if hostname in ["localhost", "127.0.0.1", "0.0.0.0"] or hostname.startswith("192.168.") or hostname.startswith("10.") or hostname.startswith("172.16.") or hostname.startswith("169.254."):
                return True
            # Resolve to IP and check IP
            ip = socket.gethostbyname(hostname)
            if ip in ["127.0.0.1", "0.0.0.0"] or ip.startswith("192.168.") or ip.startswith("10.") or ip.startswith("172.16.") or ip.startswith("169.254."):
                return True
        except Exception:
            pass
        return False

    text_body = ""
    use_scraperapi = False
    scraperapi_err = None

    # 1. Direct fetch attempt
    try:
        for hop in range(max_redirects + 1):
            if is_blocked_ip(current_url):
                raise AppError(
                    status_code=400,
                    code="url_blocked_local",
                    message="Redirect to local network is blocked.",
                )
            
            async with client.stream("GET", current_url, follow_redirects=False) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("Location")
                    if not location:
                        raise AppError(
                            status_code=400,
                            code="web_fetch_failed",
                            message="Redirect response missing Location header.",
                        )
                    from urllib.parse import urljoin
                    current_url = urljoin(current_url, location)
                    continue
                
                # Check for block status codes (e.g. 403 Forbidden, 401 Unauthorized, 429 Rate Limited)
                if response.status_code in (403, 401, 429):
                    if settings.scraperapi_proxy_url:
                        logger.info(f"Direct fetch returned status {response.status_code}. Activating ScraperAPI fallback...")
                        use_scraperapi = True
                        break
                
                response.raise_for_status()
                content_length = response.headers.get("Content-Length")
                max_bytes = settings.INGEST_MAX_CHARACTERS * 10
                if content_length:
                    try:
                        if int(content_length) > max_bytes:
                            raise AppError(
                                status_code=413,
                                code="web_content_too_large",
                                message="Page content is too large to ingest.",
                            )
                    except ValueError:
                        pass

                body_parts = []
                total_bytes = 0
                async for chunk in response.aiter_bytes():
                    total_bytes += len(chunk)
                    if total_bytes > max_bytes:
                        raise AppError(
                            status_code=413,
                            code="web_content_too_large",
                            message="Page content is too large to ingest.",
                        )
                    body_parts.append(chunk)
                text_body = b"".join(body_parts).decode("utf-8", errors="replace")
                break
        else:
            raise AppError(
                status_code=400,
                code="too_many_redirects",
                message="Too many redirect hops.",
            )
    except AppError as e:
        if e.code == "url_blocked_local":
            raise
        if settings.scraperapi_proxy_url:
            logger.info(f"Direct fetch failed with AppError: {e}. Activating ScraperAPI fallback...")
            use_scraperapi = True
        else:
            raise
    except httpx.HTTPError as exc:
        if settings.scraperapi_proxy_url:
            logger.info(f"Direct fetch failed with HTTPError: {exc}. Activating ScraperAPI fallback...")
            use_scraperapi = True
        else:
            raise AppError(
                status_code=400,
                code="web_fetch_failed",
                message="Unable to fetch web page.",
            ) from exc

    # 2. ScraperAPI fallback attempt
    if use_scraperapi:
        try:
            logger.info(f"Fetching web page via ScraperAPI residential proxy: {url}")
            async with httpx.AsyncClient(
                proxy=settings.scraperapi_proxy_url,
                # Use certifi's bundled CA bundle — Render's Python 3.14 environment
                # does not bundle system CA certificates, causing CERTIFICATE_VERIFY_FAILED
                # when TLS-handshaking through the proxy without an explicit CA store.
                verify=certifi.where(),
                timeout=settings.HTTP_REQUEST_TIMEOUT,
            ) as proxy_client:
                response = await proxy_client.get(url, follow_redirects=True)
                response.raise_for_status()
                text_body = response.text
                logger.info("Successfully fetched web page via ScraperAPI!")
        except Exception as exc:
            logger.exception("ScraperAPI web fetch fallback failed")
            scraperapi_err = exc

    if not text_body.strip():
        detail_msg = f" Both direct fetch and ScraperAPI failed: {scraperapi_err}" if scraperapi_err else ""
        raise AppError(
            status_code=400,
            code="web_fetch_failed",
            message=f"Unable to scrape web page content.{detail_msg}",
        )

    try:
        soup = BeautifulSoup(text_body, "html.parser")
        for script in soup(["script", "style", "noscript"]):
            script.decompose()

        title = soup.title.string.strip() if soup.title and soup.title.string else url
        text = clean_text(" ".join(soup.stripped_strings))
    except Exception as exc:
        raise AppError(status_code=400, code="web_parse_failed", message="Failed to parse web page content") from exc

    if not text:
        raise AppError(
            status_code=400,
            code="web_content_empty",
            message="No usable content found on the page.",
        )

    return {
        "title": title,
        "content": text[: settings.INGEST_MAX_CHARACTERS],
        "source_type": "web",
        "source_url": url,
    }


# ── Web search ────────────────────────────────────────────────────────────────

async def _search_duckduckgo(query: str, limit: int) -> list[dict]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://html.duckduckgo.com",
        "Referer": "https://html.duckduckgo.com/",
    }
    data = {"q": query, "b": "", "kl": "us-en"}

    verify_ssl = certifi.where() if settings.OUTBOUND_VERIFY_SSL else False
    async with httpx.AsyncClient(timeout=4.0, verify=verify_ssl, follow_redirects=True) as client:
        response = await client.post("https://html.duckduckgo.com/html/", data=data, headers=headers)
        if response.status_code != 200:
            logger.warning("DuckDuckGo returned status %d (challenge/block)", response.status_code)
            return []

    soup = BeautifulSoup(response.text, "html.parser")
    results: list[dict] = []

    for result in soup.select(".result"):
        anchor = result.select_one(".result__a")
        snippet = result.select_one(".result__snippet")
        if not anchor or not anchor.get("href"):
            continue

        raw_url = anchor["href"]
        # Handle DuckDuckGo redirect wrappers if present (/l/?kh=-1&uddg=...)
        if "uddg=" in raw_url:
            from urllib.parse import unquote
            parsed_uddg = parse_qs(urlparse(raw_url).query).get("uddg")
            url = unquote(parsed_uddg[0]) if parsed_uddg else raw_url
        else:
            url = raw_url

        title = clean_text(anchor.get_text(" ", strip=True))
        description = clean_text(snippet.get_text(" ", strip=True) if snippet else "")

        if not title or not url or not url.startswith("http"):
            continue

        results.append({
            "title": title,
            "url": url,
            "description": description,
            "source_type": "internet",
        })

        if len(results) >= limit:
            break

    return results


async def _search_wikipedia(query: str, limit: int) -> list[dict]:
    """
    Tier 2 Search Fallback: Wikipedia Official API.
    Fast (~150ms), never blocks datacenter IPs, and provides reliable encyclopedic
    grounding for entities, world leaders, definitions, and concepts.
    """
    url = "https://en.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "list": "search",
        "srsearch": query,
        "format": "json",
        "srlimit": limit,
        "utf8": "1",
    }
    headers = {
        "User-Agent": "CortexWiki/1.0 (https://cortexwiki.vercel.app; support@cortexwiki.com)",
    }

    verify_ssl = certifi.where() if settings.OUTBOUND_VERIFY_SSL else False
    async with httpx.AsyncClient(timeout=4.0, verify=verify_ssl, headers=headers) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            logger.warning("Wikipedia search returned status %d", response.status_code)
            return []

        data = response.json()
        search_items = data.get("query", {}).get("search", [])
        results: list[dict] = []

        for item in search_items:
            title = clean_text(item.get("title", ""))
            raw_snippet = item.get("snippet", "")
            snippet = clean_text(BeautifulSoup(raw_snippet, "html.parser").get_text(" ", strip=True))
            slug = title.replace(" ", "_")
            wiki_url = f"https://en.wikipedia.org/wiki/{slug}"

            if not title:
                continue

            results.append({
                "title": title,
                "url": wiki_url,
                "description": snippet,
                "source_type": "internet",
            })

            if len(results) >= limit:
                break

        return results


async def _search_scraperapi(query: str, limit: int) -> list[dict]:
    """Tier 3 Search Fallback: ScraperAPI Structured Google Search."""
    if not settings.SCRAPERAPI_KEY:
        return []

    url = "https://api.scraperapi.com/structured/google/search"
    params = {"api_key": settings.SCRAPERAPI_KEY, "query": query}
    verify_ssl = certifi.where() if settings.OUTBOUND_VERIFY_SSL else False

    async with httpx.AsyncClient(timeout=6.0, verify=verify_ssl) as client:
        response = await client.get(url, params=params)
        if response.status_code != 200:
            return []

        data = response.json()
        results: list[dict] = []
        for item in data.get("organic_results", []):
            title = clean_text(item.get("title", ""))
            link = item.get("link", "")
            snippet = clean_text(item.get("snippet", ""))

            if title and link:
                results.append({
                    "title": title,
                    "url": link,
                    "description": snippet,
                    "source_type": "internet",
                })
            if len(results) >= limit:
                break

        return results


async def search_web(query: str, limit: int | None = None) -> list[dict]:
    """
    Multi-tier resilient web search:
    1. Primary: DuckDuckGo HTML with browser impersonation headers.
    2. Fallback: Wikipedia Official API (fast, datacenter-safe, encyclopedic).
    3. Fallback: ScraperAPI Structured Search (if configured).
    """
    trimmed = query.strip()
    if not trimmed:
        return []

    result_limit = limit or settings.INTERNET_SEARCH_RESULT_LIMIT

    # ── Tier 1: DuckDuckGo ────────────────────────────────────────────────────
    try:
        results = await _search_duckduckgo(trimmed, result_limit)
        if results:
            logger.info("DuckDuckGo search succeeded with %d results", len(results))
            return results
    except Exception as exc:
        logger.warning("DuckDuckGo search attempt failed: %s", exc)

    # ── Tier 2: Wikipedia Search API ──────────────────────────────────────────
    try:
        logger.info("Escalating web search to Tier 2 (Wikipedia Search API) for: %s", trimmed)
        results = await _search_wikipedia(trimmed, result_limit)
        if results:
            logger.info("Wikipedia search succeeded with %d results", len(results))
            return results
    except Exception as exc:
        logger.warning("Wikipedia search attempt failed: %s", exc)

    # ── Tier 3: ScraperAPI Google Search ──────────────────────────────────────
    if settings.SCRAPERAPI_KEY:
        try:
            logger.info("Escalating web search to Tier 3 (ScraperAPI) for: %s", trimmed)
            results = await _search_scraperapi(trimmed, result_limit)
            if results:
                logger.info("ScraperAPI search succeeded with %d results", len(results))
                return results
        except Exception as exc:
            logger.warning("ScraperAPI search attempt failed: %s", exc)

    logger.warning("All web search tiers returned 0 results for query: %s", trimmed)
    return []