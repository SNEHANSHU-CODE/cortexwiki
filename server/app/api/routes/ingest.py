from fastapi import APIRouter, Depends, Response, File, UploadFile, Form
from bson import ObjectId

from app.api.deps import get_current_user, validate_wiki_id
from app.core.redis import get_redis_store
from app.db.mongo import get_mongo_manager
from app.schemas.ingest import FallbackIngestRequest, IngestData, IngestHistoryItem, WebIngestRequest, YouTubeIngestRequest
from app.services.graph_service import get_graph_service
from app.services.llm import get_llm_service
from app.utils.errors import AppError
from app.utils.logging import get_logger
from app.utils.web import fetch_web_page_content, fetch_youtube_content


router = APIRouter(prefix="/ingest", tags=["ingest"])
logger = get_logger("api.routes.ingest")


async def _check_ingest_rate_limit(user_id: str, wiki_id: str, limit: int = 10, window: int = 60) -> tuple[bool, dict]:
    """
    BUG FIX #21: Simple rate limiting to prevent abuse.
    Limits ingestions to 10 per minute per user.
    BUG FIX #26: Return rate limit headers for client backoff.
    """
    from app.core.redis import get_redis_store
    import time
    redis_store = get_redis_store()

    # Use window-aligned epoch timestamp to avoid rollover edge cases
    now = int(time.time())
    window_start = now - (now % window)
    next_reset = window_start + window
    key = f"rate_limit:ingest:{user_id}:{wiki_id}:{window_start}"

    if redis_store and redis_store.client is not None:
        try:
            current = await redis_store.client.incr(key)
            if current == 1:
                # Set expiration to the remaining seconds in the window
                expire = (next_reset - now) + 1
                await redis_store.client.expire(key, int(expire))

            headers = {
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": str(max(0, limit - current)),
                "X-RateLimit-Reset": str(next_reset),
            }

            if current > limit:
                return False, headers
            return True, headers
        except Exception:
            # If Redis fails, allow the request
            return True, {}
    else:
        return True, {}


async def _validate_wiki(wiki_id: str, user_id: str) -> dict:
    """Ensure wiki exists and belongs to user."""
    wiki = await get_mongo_manager().get_wiki(wiki_id, user_id)
    if not wiki:
        raise AppError(status_code=404, code="wiki_not_found", message="Wiki not found.")
    return wiki


def _build_ingest_response(result: dict) -> IngestData:
    page = result["wiki_page"]
    return IngestData(
        id=page["id"],
        wiki_id=page["wiki_id"],
        title=page["title"],
        source_type=page["source_type"],
        source_url=page["source_url"],
        summary=result["summary"],
        concepts=result["concepts"],
        conflicts=result["conflicts"],
        created_at=page["created_at"],
    )


@router.post("/youtube", response_model=IngestData)
async def ingest_youtube(payload: YouTubeIngestRequest, current_user: dict = Depends(get_current_user), response: Response = None):
    # BUG FIX #5: Validate wiki_id format before processing
    await validate_wiki_id(payload.wiki_id)
    
    # BUG FIX #21: Apply rate limiting
    # BUG FIX #26: Return rate limit headers
    allowed, headers = await _check_ingest_rate_limit(current_user["id"], payload.wiki_id)
    if response:
        for key, value in headers.items():
            response.headers[key] = value
    
    if not allowed:
        raise AppError(
            status_code=429,
            code="ingest_rate_limited",
            message="Too many ingestions. Please wait a minute before trying again.",
        )
    
    await _validate_wiki(payload.wiki_id, current_user["id"])
    source = await fetch_youtube_content(str(payload.url))
    result = await _ingest_source(
        user_id=current_user["id"],
        wiki_id=payload.wiki_id,
        title=source["title"],
        source_type=source["source_type"],
        source_url=source["source_url"],
        raw_content=source["content"],
    )
    return _build_ingest_response(result)


@router.post("/web", response_model=IngestData)
async def ingest_web(payload: WebIngestRequest, current_user: dict = Depends(get_current_user), response: Response = None):
    # BUG FIX #5: Validate wiki_id format before processing
    await validate_wiki_id(payload.wiki_id)
    
    # BUG FIX #21: Apply rate limiting
    # BUG FIX #26: Return rate limit headers
    allowed, headers = await _check_ingest_rate_limit(current_user["id"], payload.wiki_id)
    if response:
        for key, value in headers.items():
            response.headers[key] = value
    
    if not allowed:
        raise AppError(
            status_code=429,
            code="ingest_rate_limited",
            message="Too many ingestions. Please wait a minute before trying again.",
        )
    
    await _validate_wiki(payload.wiki_id, current_user["id"])
    source = await fetch_web_page_content(str(payload.url))
    result = await _ingest_source(
        user_id=current_user["id"],
        wiki_id=payload.wiki_id,
        title=source["title"],
        source_type=source["source_type"],
        source_url=source["source_url"],
        raw_content=source["content"],
    )
    return _build_ingest_response(result)


@router.post("/fallback", response_model=IngestData)
async def ingest_fallback(
    payload: FallbackIngestRequest,
    current_user: dict = Depends(get_current_user),
    response: Response = None,
):
    # BUG FIX #5: Validate wiki_id format before processing
    await validate_wiki_id(payload.wiki_id)
    
    # Apply rate limiting
    allowed, headers = await _check_ingest_rate_limit(current_user["id"], payload.wiki_id)
    if response:
        for key, value in headers.items():
            response.headers[key] = value
            
    if not allowed:
        raise AppError(
            status_code=429,
            code="ingest_rate_limited",
            message="Too many ingestions. Please wait a minute before trying again.",
        )
        
    await _validate_wiki(payload.wiki_id, current_user["id"])
    
    # Generate title using LLM from content
    llm = get_llm_service()
    from urllib.parse import urlparse
    parsed = urlparse(str(payload.url))
    
    title = ""
    try:
        prompt = (
            "Generate a short, concise, and descriptive title (under 60 characters) "
            "for the following document. Do not include quotes or markdown. Just the title text.\n\n"
            f"{payload.content[:1500]}"
        )
        generated_title = await llm.generate_text(prompt=prompt, temperature=0.3, max_output_tokens=30)
        if generated_title:
            title = generated_title.strip().replace('"', '')
    except Exception:
        pass
        
    if not title:
        title = f"Manual Ingest - {parsed.netloc}"
        
    result = await _ingest_source(
        user_id=current_user["id"],
        wiki_id=payload.wiki_id,
        title=title,
        source_type=payload.type,
        source_url=str(payload.url),
        raw_content=payload.content,
    )
    return _build_ingest_response(result)


@router.post("/pdf", response_model=IngestData)
async def ingest_pdf(
    file: UploadFile = File(...),
    wiki_id: str = Form(...),
    current_user: dict = Depends(get_current_user),
    response: Response = None,
):
    # Validate wiki_id format
    await validate_wiki_id(wiki_id)
    
    # Apply rate limiting
    allowed, headers = await _check_ingest_rate_limit(current_user["id"], wiki_id)
    if response:
        for key, value in headers.items():
            response.headers[key] = value
            
    if not allowed:
        raise AppError(
            status_code=429,
            code="ingest_rate_limited",
            message="Too many ingestions. Please wait a minute before trying again.",
        )
        
    await _validate_wiki(wiki_id, current_user["id"])
    
    # Validate file extension / mime type
    filename = file.filename or "document.pdf"
    if not filename.lower().endswith(".pdf"):
        raise AppError(
            status_code=400,
            code="invalid_file_type",
            message="Only PDF files are supported.",
        )
    
    # Enforce 16MB file size limit
    pdf_bytes = await file.read()
    await file.close()
    if len(pdf_bytes) > 16 * 1024 * 1024:
        raise AppError(
            status_code=400,
            code="file_too_large",
            message="File size exceeds the 16MB limit.",
        )
        
    if len(pdf_bytes) == 0:
        raise AppError(
            status_code=400,
            code="file_empty",
            message="The uploaded PDF file is empty.",
        )

    # Extract text from PDF
    from app.utils.pdf import extract_text_from_pdf
    from app.utils.pdfOCRService import OCRError
    
    try:
        extracted_text = extract_text_from_pdf(pdf_bytes, filename=filename)
    except OCRError as exc:
        raise AppError(
            status_code=400,
            code="ocr_failed",
            message=f"OCR processing failed: {str(exc)}",
        )
    except Exception as exc:
        raise AppError(
            status_code=500,
            code="pdf_extraction_failed",
            message=f"Could not extract text from PDF: {str(exc)}",
        )

    # Generate title using LLM
    llm = get_llm_service()
    title = ""
    try:
        prompt = (
            "Generate a short, concise, and descriptive title (under 60 characters) "
            "for the following document. Do not include quotes or markdown. Just the title text.\n\n"
            f"{extracted_text[:1500]}"
        )
        generated_title = await llm.generate_text(prompt=prompt, temperature=0.3, max_output_tokens=30)
        if generated_title:
            title = generated_title.strip().replace('"', '')
    except Exception:
        pass
        
    if not title:
        title = filename.rsplit(".", 1)[0] if "." in filename else filename
        
    # Formulate a unique source_url
    import urllib.parse
    encoded_filename = urllib.parse.quote(filename)
    source_url = f"pdf://{wiki_id}/{encoded_filename}"
    
    # Ingest the source text
    result = await _ingest_source(
        user_id=current_user["id"],
        wiki_id=wiki_id,
        title=title,
        source_type="pdf",
        source_url=source_url,
        raw_content=extracted_text,
    )
    return _build_ingest_response(result)


@router.get("/history", response_model=list[IngestHistoryItem])
async def ingest_history(
    wiki_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    # BUG FIX #5: Validate wiki_id format if provided (use centralized validator)
    if wiki_id:
        await validate_wiki_id(wiki_id)
    
    items = await get_mongo_manager().list_recent_ingestions(
        current_user["id"],
        wiki_id=wiki_id,
        limit=25,
    )
    return [
        IngestHistoryItem(
            id=item["id"],
            wiki_id=item.get("wiki_id"),
            title=item["title"],
            source_type=item["source_type"],
            source_url=item["source_url"],
            summary=item.get("summary", ""),
            created_at=item["created_at"],
        )
        for item in items
    ]


async def _ingest_source(
    *,
    user_id: str,
    wiki_id: str,
    title: str,
    source_type: str,
    source_url: str,
    raw_content: str,
) -> dict:
    """
    Ingest a source with proper locking and atomic error handling.
    
    FIX #1: Use per-wiki lock to prevent master_note race condition
    FIX #2: Rollback wiki_page if graph sync fails (atomic ingestion)
    FIX #4: Check for duplicate source URLs
    FIX #6: Check source count limit
    FIX #13: Validate URL input format and length
    FIX #17: Handle partial graph sync failures
    """
    from app.core.config import settings
    
    # ── VALIDATE URL INPUT ──
    # BUG FIX #6: Validate URL before processing with comprehensive checks
    source_url = source_url.strip()  # Strip whitespace
    if not source_url:
        raise AppError(
            status_code=400,
            code="url_empty",
            message="URL cannot be empty.",
        )
    if len(source_url) > 2048:
        raise AppError(
            status_code=400,
            code="url_too_long",
            message="URL length exceeds 2048 characters.",
        )
    if not source_url.startswith(("http://", "https://")):
        raise AppError(
            status_code=400,
            code="invalid_url_protocol",
            message="URL must start with http:// or https://",
        )
    # BUG FIX #6: Check for null bytes and control characters
    if any(char in source_url for char in ['\x00', '\r', '\n', '\t']):
        raise AppError(
            status_code=400,
            code="url_invalid_characters",
            message="URL contains invalid characters.",
        )
    # BUG FIX #6: SSRF protection - block local IP ranges
    from urllib.parse import urlparse
    parsed_url = urlparse(source_url)
    hostname = parsed_url.hostname or ""
    if hostname in ["localhost", "127.0.0.1", "0.0.0.0"] or hostname.startswith("192.168.") or hostname.startswith("10."):
        raise AppError(
            status_code=400,
            code="url_blocked_local",
            message="Local network URLs are not allowed.",
        )
    
    mongo = get_mongo_manager()
    llm = get_llm_service()
    graph_service = get_graph_service()
    redis_store = get_redis_store()

    # ── CHECK DUPLICATE SOURCE ──
    # BUG FIX #4: Prevent duplicate ingestions
    existing_page = await mongo.check_source_url_exists(wiki_id, user_id, source_url)
    if existing_page:
        logger.info("Source already ingested: source_url=%s, existing_page_id=%s", source_url, existing_page["id"])
        return {
            "wiki_page": existing_page,
            "summary": existing_page.get("summary", ""),
            "concepts": existing_page.get("concepts", []),
            "conflicts": [{"type": "duplicate_source", "message": f"This source was already ingested on {existing_page.get('created_at')}"}],
        }

    # ── CHECK SOURCE COUNT LIMIT ──
    # BUG FIX #6: Prevent excessive sources per wiki
    wiki = await mongo.get_wiki(wiki_id, user_id)
    if wiki and wiki.get("source_count", 0) >= settings.MAX_SOURCES_PER_WIKI:
        raise AppError(
            status_code=429,
            code="wiki_source_limit_exceeded",
            message=f"This wiki has reached the limit of {settings.MAX_SOURCES_PER_WIKI} sources. Delete some sources to add more.",
        )

    # ── ACQUIRE WIKI LOCK ──
    # Prevents concurrent ingestions from overwriting master_note
    wiki_lock = await redis_store.acquire_wiki_ingest_lock(wiki_id)
    
    async with wiki_lock:
        logger.info("Acquired ingest lock for wiki_id=%s", wiki_id)

        # Summarise new source
        summary = await llm.summarize(raw_content)

        # Compound master note: merge new summary into existing wiki note
        wiki = await mongo.get_wiki(wiki_id, user_id)
        existing_note = wiki.get("master_note", "") if wiki else ""
        master_note = await llm.merge_notes(
            existing_note=existing_note,
            new_summary=summary,
            new_title=title,
        )

        # Build graph payload
        concept_nodes, relationships = graph_service.build_graph_payload(
            title=title,
            summary=summary,
            content=raw_content,
        )
        concepts = [node["id"] for node in concept_nodes]
        embedding = await llm.embed_text(f"{title}\n{summary}\n{raw_content[:4000]}")

        # Store raw source
        raw_record = await mongo.store_raw_data({
            "user_id": user_id,
            "wiki_id": wiki_id,
            "title": title,
            "source_type": source_type,
            "source_url": source_url,
            "content": raw_content,
            "summary": summary,
            "concepts": concepts,
        })

        # Store wiki page (source record)
        wiki_page = await mongo.create_wiki_page({
            "user_id": user_id,
            "wiki_id": wiki_id,
            "title": title,
            "summary": summary,
            "content": raw_content,
            "source_type": source_type,
            "source_url": source_url,
            "concepts": concepts,
            "relationships": relationships,
            "embedding": embedding,
            "raw_data_id": raw_record["id"],
        })

        # ── SYNC GRAPH WITH ERROR HANDLING ──
        # FIX #2: If graph sync fails, rollback the wiki_page
        try:
            await graph_service.sync_page_graph(
                user_id=user_id,
                wiki_id=wiki_id,
                page_id=wiki_page["id"],
                nodes=concept_nodes,
                edges=relationships,
            )
            logger.info("Graph synced successfully for page_id=%s", wiki_page["id"])
        except Exception as exc:
            logger.error("Graph sync failed for page_id=%s, rolling back: %s", wiki_page["id"], str(exc))
            # Rollback the wiki page if graph sync fails
            try:
                rollback_success = await mongo.rollback_wiki_page(wiki_page["id"])
                if rollback_success:
                    logger.info("Successfully rolled back wiki_page_id=%s", wiki_page["id"])
                    raise AppError(
                        status_code=500,
                        code="graph_sync_failed_rollback",
                        message="Graph sync failed. Source ingestion was rolled back. Please try again.",
                    )
                else:
                    logger.error("Rollback failed for wiki_page_id=%s", wiki_page["id"])
                    raise AppError(
                        status_code=500,
                        code="graph_sync_failed_no_rollback",
                        message="Graph sync failed and automatic rollback failed. Manual cleanup may be needed.",
                    )
            except AppError:
                raise
            except Exception as rollback_exc:
                logger.error("Unexpected error during rollback: %s", str(rollback_exc))
                raise AppError(
                    status_code=500,
                    code="graph_sync_failed_rollback_error",
                    message="Graph sync and rollback both failed. Please contact support.",
                ) from rollback_exc

        # Update wiki master note + source count
        # Now safe to do because graph sync succeeded
        await mongo.update_wiki_master_note(wiki_id, user_id, master_note)
        logger.info("Updated master_note for wiki_id=%s", wiki_id)

        await mongo.create_agent_log({
            "user_id": user_id,
            "wiki_id": wiki_id,
            "event_type": "ingest",
            "event_name": "source_ingested",
            "details": {
                "title": title,
                "source_type": source_type,
                "concept_count": len(concepts),
                "relationship_count": len(relationships),
            },
        })

        return {
            "wiki_page": wiki_page,
            "summary": summary,
            "concepts": concepts,
            "conflicts": [],
        }