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
        import asyncio
        extracted_text = await asyncio.to_thread(extract_text_from_pdf, pdf_bytes, filename=filename)
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

@router.get("/pages", response_model=dict)
async def get_wiki_page_by_url(
    url: str,
    wiki_id: str,
    current_user: dict = Depends(get_current_user),
):
    mongo = get_mongo_manager()
    page = await mongo.check_source_url_exists(wiki_id, current_user["id"], url)
    if not page:
        raise AppError(status_code=404, code="page_not_found", message="Page not found.")
    
    return {
        "id": str(page["_id"]) if "_id" in page else page.get("id"),
        "title": page["title"],
        "content": page.get("content", ""),
        "summary": page.get("summary", ""),
        "source_url": page.get("source_url", ""),
    }

@router.delete("/pages/{page_id}", status_code=204)
async def delete_wiki_page(
    page_id: str,
    current_user: dict = Depends(get_current_user),
):
    from bson import ObjectId
    
    if not ObjectId.is_valid(page_id):
        raise AppError(status_code=400, code="invalid_page_id", message="Invalid page_id format.")
        
    mongo = get_mongo_manager()
    graph_service = get_graph_service()
    llm = get_llm_service()
    redis_store = get_redis_store()
    
    page = await mongo.get_wiki_page(page_id, current_user["id"])
    if not page:
        raise AppError(status_code=404, code="page_not_found", message="Page not found.")
        
    wiki_id = page["wiki_id"]
    
    wiki_lock = await redis_store.acquire_wiki_ingest_lock(wiki_id)
    
    async with wiki_lock:
        deleted_page = await mongo.delete_wiki_page(page_id, current_user["id"])
        if not deleted_page:
            raise AppError(status_code=404, code="page_not_found", message="Page not found.")
            
        try:
            await graph_service.delete_page_graph(
                user_id=current_user["id"],
                wiki_id=wiki_id,
                page_id=page_id,
            )
        except Exception as exc:
            logger.warning("Failed to delete page graph from Neo4j: page_id=%s, error=%s", page_id, str(exc))
            
        try:
            remaining_pages = await mongo.list_wiki_pages(current_user["id"], wiki_id=wiki_id, limit=200)
            if not remaining_pages:
                await mongo.set_wiki_master_note(wiki_id, current_user["id"], "")
            else:
                remaining_pages.sort(key=lambda p: p["created_at"])
                master_note = ""
                for p in remaining_pages:
                    master_note = await llm.merge_notes(
                        existing_note=master_note,
                        new_summary=p["summary"],
                        new_title=p["title"],
                    )
                await mongo.set_wiki_master_note(wiki_id, current_user["id"], master_note)
        except Exception as exc:
            logger.exception("Failed to rebuild master note after page deletion: page_id=%s", page_id)
            
    return Response(status_code=204)




async def _ingest_source(
    *,
    user_id: str,
    wiki_id: str,
    title: str,
    source_type: str,
    source_url: str,
    raw_content: str,
) -> dict:
    from app.services.ingestion_service import get_ingestion_service
    return await get_ingestion_service().ingest_source(
        user_id=user_id,
        wiki_id=wiki_id,
        title=title,
        source_type=source_type,
        source_url=source_url,
        raw_content=raw_content,
    )