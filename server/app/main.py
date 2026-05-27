from contextlib import asynccontextmanager

import socketio
from bson import ObjectId
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.api.routes import auth, graph, ingest, query, wikis
from app.core.config import settings
from app.core.database import close_datastores, initialize_datastores
from app.core.redis import close_redis, get_redis_store, initialize_redis
from app.core.security import decode_access_token
from app.utils.errors import AppError, app_error_handler, generic_exception_handler, validation_exception_handler
from app.utils.logging import configure_logging, get_logger, request_context_middleware
from app.db.mongo import get_mongo_manager


configure_logging(settings.LOG_LEVEL)
logger = get_logger("app.main")


# ── Socket.io server ──────────────────────────────────────────────────────────
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.frontend_origins_list,
    logger=False,
    engineio_logger=False,
)


async def _authenticate_socket(token: str) -> dict | None:
    """Validate Bearer token for Socket.io connections."""
    try:
        payload = decode_access_token(token)
    except AppError as exc:
        logger.warning("Socket auth failed: %s", exc.message)
        return None

    jti = payload["jti"]
    user_id = payload["sub"]

    try:
        token_record = await get_redis_store().get_access_token(jti)
        if not token_record or token_record.get("user_id") != user_id:
            logger.warning("Socket auth: token not in Redis jti=%s", jti)
            return None
        user = await get_mongo_manager().get_user_by_id(user_id)
        if not user:
            logger.warning("Socket auth: user not found user_id=%s", user_id)
        return user
    except Exception:
        logger.exception("Socket auth: unexpected error")
        return None


@sio.event
async def connect(sid, environ, auth):
    """
    BUG FIX #8: Validate and store token for later validation on each message.
    """
    token = (auth or {}).get("token", "")
    if not token:
        raise socketio.exceptions.ConnectionRefusedError("Authentication required.")
    user = await _authenticate_socket(token)
    if not user:
        raise socketio.exceptions.ConnectionRefusedError("Invalid or expired token.")
    
    # Store user AND token for validation on each message
    await sio.save_session(sid, {
        "user": user,
        "token": token,  # BUG FIX #8: Store token for re-validation
    })
    logger.info("Socket connected: sid=%s, user_id=%s", sid, user.get("id"))


@sio.event
async def disconnect(sid):
    logger.info("Socket disconnected: sid=%s", sid)
    pass


@sio.on("ping")
async def handle_ping(sid):
    """
    BUG FIX #20: Handle heartbeat/ping to keep connection alive and verify token.
    """
    # Re-validate token to ensure connection is still valid
    user = await _validate_socket_token(sid)
    if not user:
        await sio.emit("error", {"message": "Token expired. Reconnecting..."}, to=sid)
        return
    
    # Send pong response
    await sio.emit("pong", {"timestamp": int(__import__('time').time() * 1000)}, to=sid)


async def _validate_socket_token(sid: str) -> dict | None:
    """
    BUG FIX #8: Validate token on each message to detect expired/revoked tokens.
    """
    session = await sio.get_session(sid)
    if not session:
        logger.warning("Socket validation: no session for sid=%s", sid)
        return None
    
    token = session.get("token", "")
    user = session.get("user")
    
    if not token or not user:
        logger.warning("Socket validation: missing token/user for sid=%s", sid)
        return None
    
    # Re-validate token against Redis to catch revoked/expired tokens
    try:
        payload = decode_access_token(token)
        jti = payload["jti"]
        token_record = await get_redis_store().get_access_token(jti)
        if not token_record:
            logger.warning("Socket validation: token not in Redis (revoked/expired) sid=%s, user_id=%s", sid, user.get("id"))
            return None
        return user
    except Exception as exc:
        logger.warning("Socket validation failed: %s, sid=%s", str(exc), sid)
        return None


async def _check_socket_query_rate_limit(user_id: str) -> bool:
    """Simple fixed-window rate limiter for socket queries per user.

    Uses Redis when available, otherwise falls back to an in-memory counter
    stored on the RedisTokenStore instance. Window and limit are configurable
    via settings: `SOCKET_RATE_LIMIT_WINDOW` (seconds) and
    `SOCKET_RATE_LIMIT_PER_WINDOW` (count).
    """
    store = get_redis_store()
    window = getattr(settings, "SOCKET_RATE_LIMIT_WINDOW", 60)
    limit = getattr(settings, "SOCKET_RATE_LIMIT_PER_WINDOW", 30)
    key = f"socket:rate:{user_id}"

    # Redis-backed increment with expiry
    try:
        client = store.client
        if client is not None:
            val = await client.incr(key)
            if val == 1:
                await client.expire(key, int(window))
            return val <= limit
    except Exception:
        logger.debug("Redis rate limiter unavailable, falling back to memory")

    # In-memory fixed-window fallback
    now = int(__import__("time").time())
    window_start = now - (now % int(window))
    if not hasattr(store, "_memory_rate_counters"):
        store._memory_rate_counters = {}

    entry = store._memory_rate_counters.get(user_id)
    if not entry or entry[0] != window_start:
        store._memory_rate_counters[user_id] = (window_start, 1)
        return True

    count = entry[1]
    if count >= limit:
        return False
    store._memory_rate_counters[user_id] = (entry[0], count + 1)
    return True


async def _reserve_request_id(user_id: str, request_id: str, ttl: int = 300) -> bool:
    """Reserve a request_id for a user to prevent duplicate processing.

    Returns True if the request_id was successfully reserved (not seen
    recently). Uses Redis when available, otherwise an in-memory set with
    expiry is used on the RedisTokenStore instance.
    """
    if not request_id:
        return True

    store = get_redis_store()
    key = f"socket:req:{user_id}:{request_id}"
    try:
        client = store.client
        if client is not None:
            # SET NX with expiry
            res = await client.set(key, "1", nx=True, ex=int(ttl))
            return bool(res)
    except Exception:
        logger.debug("Redis request-id reservation unavailable, falling back to memory")

    # In-memory fallback
    if not hasattr(store, "_memory_request_ids"):
        store._memory_request_ids = {}

    now = int(__import__("time").time())
    expiry = now + int(ttl)
    existing = store._memory_request_ids.get(key)
    if existing and existing > now:
        return False
    store._memory_request_ids[key] = expiry
    # Clean up expired entries opportunistically
    for k, v in list(store._memory_request_ids.items()):
        if v <= now:
            store._memory_request_ids.pop(k, None)
    return True


@sio.on("query:start")
async def handle_query(sid, data):
    """
    Receives: { requestId, wiki_id, question, debug, allow_internet }
    Emits:    query:started → query:token (N times) → query:complete | query:error
    
    BUG FIX #8: Validate token on each message.
    BUG FIX #9: Validate user context is present and valid.
    """
    # BUG FIX #8: Re-validate token on each message
    user = await _validate_socket_token(sid)
    if not user:
        await sio.emit("query:error", {"message": "Token expired or invalid. Please reconnect."}, to=sid)
        logger.warning("Query rejected: invalid token for sid=%s", sid)
        return
    
    # BUG FIX #9: Ensure user context is complete and valid
    if not user.get("id") or not isinstance(user.get("id"), str):
        await sio.emit("query:error", {"message": "Invalid user context. Please reconnect."}, to=sid)
        logger.warning("Query rejected: invalid user context for sid=%s", sid)
        return

    request_id = (data.get("requestId") or "").strip()
    wiki_id = (data.get("wiki_id") or "").strip()
    question = (data.get("question") or "").strip()
    debug = bool(data.get("debug", False))
    allow_internet = bool(data.get("allow_internet", False))

    # Basic input validation and size bounds
    if request_id:
        import re
        if len(request_id) > 36 or not re.match(r'^[A-Za-z0-9_.-]{1,36}$', request_id):
            await sio.emit("query:error", {"message": "Invalid requestId."}, to=sid)
            return
    if not wiki_id:
        await sio.emit("query:error", {"message": "wiki_id is required."}, to=sid)
        return
    if len(wiki_id) > 64:
        await sio.emit("query:error", {"message": "wiki_id too long."}, to=sid)
        return
    if not ObjectId.is_valid(wiki_id):
        await sio.emit("query:error", {"message": "Invalid wiki_id format."}, to=sid)
        return
    if not question:
        await sio.emit("query:error", {"message": "Question is required."}, to=sid)
        return
    if len(question) > 2000:
        await sio.emit("query:error", {"message": "Question too long."}, to=sid)
        return

    # Reserve request id to avoid duplicate processing
    if request_id:
        reserved = await _reserve_request_id(user["id"], request_id)
        if not reserved:
            await sio.emit("query:error", {"message": "Duplicate requestId."}, to=sid)
            return

    # Rate limit per user for socket queries
    allowed = await _check_socket_query_rate_limit(user["id"])
    if not allowed:
        await sio.emit("query:error", {"message": "Rate limited. Try again later."}, to=sid)
        logger.warning("Query rate limited for user %s sid=%s", user["id"], sid)
        return

    await sio.emit("query:started", {"requestId": request_id, "transport": "socket"}, to=sid)

    try:
        from app.db.mongo import get_mongo_manager
        from app.services.graph_service import get_graph_service
        from app.services.llm import get_llm_service
        from app.utils.text import clean_text

        mongo = get_mongo_manager()
        llm = get_llm_service()
        graph_service = get_graph_service()

        query_embedding = await llm.embed_text(question)
        wiki_pages = await mongo.search_wiki_pages(
            user_id=user["id"],
            wiki_id=wiki_id,
            query=question,
            query_embedding=query_embedding,
            limit=settings.QUERY_RESULT_LIMIT,
        )
        related_concepts = await graph_service.get_related_concepts(
            user_id=user["id"],
            wiki_id=wiki_id,
            query=question,
            limit=8,
        )

        context_blocks = [
            {
                "title": p["title"],
                "source_url": p["source_url"],
                "summary": p.get("summary", ""),
                "concepts": p.get("concepts", []),
            }
            for p in wiki_pages
        ]
        graph_context = [
            f'{item["source"]} {item["relationship"]} {item["target"]}'
            for item in related_concepts
        ]

        if not wiki_pages and not related_concepts:
            answer = "I do not have enough ingested knowledge to answer that yet. Add a source first, then ask again."
        elif settings.GROQ_API_KEY or settings.GEMINI_API_KEY:
            answer_chunks = []
            async for chunk in llm.stream_text(
                system_instruction=(
                    "You are CortexWiki. Answer only from the provided knowledge base context. "
                    "If the context is insufficient, say so plainly. Do not invent facts."
                ),
                prompt=(
                    f"Question: {question}\n\n"
                    f"Knowledge base pages:\n{context_blocks}\n\n"
                    f"Graph relationships:\n{graph_context}\n\n"
                    "Write a concise, grounded answer."
                ),
                temperature=0.2,
                max_output_tokens=420,
            ):
                if chunk:
                    answer_chunks.append(chunk)
                    await sio.emit(
                        "query:token",
                        {"requestId": request_id, "chunk": chunk, "content": "".join(answer_chunks)},
                        to=sid,
                    )
            answer = clean_text("".join(answer_chunks))
        else:
            answer = "No LLM configured."

        sources = [
            {"title": p["title"], "url": p["source_url"], "source_type": p.get("source_type", "wiki_page")}
            for p in wiki_pages
        ]
        confidence = round(min(0.96, max(0.18, 0.4 + (0.1 * len(wiki_pages)) + (0.03 * len(related_concepts)))), 2)

        await sio.emit(
            "query:complete",
            {
                "requestId": request_id,
                "content": answer,
                "metadata": {
                    "answer": answer,
                    "confidence": confidence,
                    "strategy": "hybrid_search" if wiki_pages and related_concepts else "knowledge_base",
                    "is_grounded": bool(wiki_pages),
                    "sources": sources,
                    "debug": {
                        "wiki_results": [p["title"] for p in wiki_pages],
                        "related_concepts": graph_context,
                    } if debug else None,
                },
            },
            to=sid,
        )

    except Exception as exc:
        await sio.emit(
            "query:error",
            {"requestId": request_id, "message": "Unable to generate an answer. Please try again."},
            to=sid,
        )
        logger.exception("Socket query error for user %s", user["id"])


# ── FastAPI app ───────────────────────────────────────────────────────────────

class AuthenticationMiddleware(BaseHTTPMiddleware):
    """Validates Bearer token or access token cookie and attaches user to request.state."""

    # Endpoints that don't require authentication
    PUBLIC_PATHS = {
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/refresh",
        "/api/auth/logout",
        "/health",
        "/api/ping",
    }

    async def dispatch(self, request: Request, call_next) -> Response:
        request.state.user = None
        request.state.access_token_jti = None
        request.state.auth_error = None

        # Skip auth for public routes (exact match)
        path = request.url.path
        if path in self.PUBLIC_PATHS:
            return await call_next(request)

        # Try Bearer token first (for API/WebSocket)
        authorization = request.headers.get("Authorization")
        if authorization and authorization.startswith("Bearer "):
            token = authorization.removeprefix("Bearer ").strip()
            try:
                payload = decode_access_token(token)
                jti = payload["jti"]
                user_id = payload["sub"]

                token_record = await get_redis_store().get_access_token(jti)
                if not token_record or token_record.get("user_id") != user_id:
                    logger.warning("Bearer token validation failed: jti=%s, user_id=%s, token_record=%s", jti, user_id, token_record)
                    raise AppError(
                        status_code=401,
                        code="access_token_invalid",
                        message="Access token expired or revoked.",
                    )

                user = await get_mongo_manager().get_user_by_id(user_id)
                if not user:
                    logger.warning("User not found for Bearer token: user_id=%s", user_id)
                    raise AppError(
                        status_code=401,
                        code="user_not_found",
                        message="Authenticated user no longer exists.",
                    )

                logger.debug("Bearer token authenticated: user_id=%s", user_id)
                request.state.user = user
                request.state.access_token_jti = jti

            except AppError as exc:
                logger.warning("Bearer token error: %s", exc.message)
                request.state.auth_error = exc
            return await call_next(request)

        # Try access token cookie (for browser requests)
        access_token = request.cookies.get(settings.ACCESS_COOKIE_NAME)
        if access_token:
            try:
                payload = decode_access_token(access_token)
                jti = payload["jti"]
                user_id = payload["sub"]

                token_record = await get_redis_store().get_access_token(jti)
                if not token_record or token_record.get("user_id") != user_id:
                    logger.warning("Cookie token validation failed: jti=%s, user_id=%s, token_record=%s, redis_mode=%s", jti, user_id, token_record, get_redis_store().mode)
                    raise AppError(
                        status_code=401,
                        code="access_token_invalid",
                        message="Access token expired or revoked.",
                    )

                user = await get_mongo_manager().get_user_by_id(user_id)
                if not user:
                    logger.warning("User not found for cookie token: user_id=%s", user_id)
                    raise AppError(
                        status_code=401,
                        code="user_not_found",
                        message="Authenticated user no longer exists.",
                    )

                logger.debug("Cookie token authenticated: user_id=%s", user_id)
                request.state.user = user
                request.state.access_token_jti = jti

            except AppError as exc:
                logger.warning("Cookie token error: %s", exc.message)
                request.state.auth_error = exc
        else:
            logger.debug("No cookie token found for path: %s, available cookies: %s", path, list(request.cookies.keys()))

        return await call_next(request)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await initialize_datastores()
    await initialize_redis()
    yield
    await close_redis()
    await close_datastores()


def create_fastapi_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version="1.0.0",
        lifespan=lifespan,
    )

    app.middleware("http")(request_context_middleware)

    # Validate JSON content-type for API endpoints
    from app.middleware.content_type import validate_content_type
    @app.middleware("http")
    async def content_type_middleware(request, call_next):
        res = await validate_content_type(request)
        if res is not None:
            return res
        return await call_next(request)

    app.add_middleware(AuthenticationMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.frontend_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
        expose_headers=["X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    )

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)

    @app.get("/health", tags=["health"])
    async def health_check():
        from app.db.graph import get_graph_manager
        return {
            "status": "ok",
            "service": settings.APP_NAME,
            "environment": settings.ENVIRONMENT,
            "datastores": {
                "mongo": get_mongo_manager().mode,
                "redis": get_redis_store().mode,
                "neo4j": get_graph_manager().mode,
            },
        }

    app.include_router(auth.router, prefix=settings.API_V1_PREFIX)
    app.include_router(ingest.router, prefix=settings.API_V1_PREFIX)
    app.include_router(query.router, prefix=settings.API_V1_PREFIX)
    app.include_router(graph.router, prefix=settings.API_V1_PREFIX)
    app.include_router(wikis.router, prefix=settings.API_V1_PREFIX)

    # Keep server alive
    @app.get("/api/ping")
    @app.head("/api/ping")
    def ping_handler():
        return {"message": "pong"}

    return app


# ── Mount Socket.io onto FastAPI ──────────────────────────────────────────────
fastapi_app = create_fastapi_app()
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)