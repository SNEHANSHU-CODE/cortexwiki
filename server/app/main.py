from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.api.routes import auth, graph, ingest, query
from app.core.config import settings
from app.core.database import close_datastores, initialize_datastores
from app.core.redis import close_redis, get_redis_store, initialize_redis
from app.core.security import decode_access_token
from app.utils.errors import AppError, app_error_handler, generic_exception_handler, validation_exception_handler
from app.utils.logging import configure_logging, request_context_middleware
from app.db.mongo import get_mongo_manager


configure_logging(settings.LOG_LEVEL)


# ── Socket.io server ──────────────────────────────────────────────────────────
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.FRONTEND_ORIGINS,
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
    token = (auth or {}).get("token", "")
    if not token:
        raise socketio.exceptions.ConnectionRefusedError("Authentication required.")
    user = await _authenticate_socket(token)
    if not user:
        raise socketio.exceptions.ConnectionRefusedError("Invalid or expired token.")
    await sio.save_session(sid, {"user": user})


@sio.event
async def disconnect(sid):
    pass


@sio.on("query:start")
async def handle_query(sid, data):
    """
    Receives: { requestId, question, debug, allow_internet }
    Emits:    query:started → query:token (N times) → query:complete | query:error
    """
    session = await sio.get_session(sid)
    user = session.get("user")
    if not user:
        await sio.emit("query:error", {"message": "Not authenticated."}, to=sid)
        return

    request_id = data.get("requestId", "")
    question = data.get("question", "").strip()
    debug = data.get("debug", False)

    if not question:
        await sio.emit("query:error", {"message": "Question is required."}, to=sid)
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
            query=question,
            query_embedding=query_embedding,
            limit=settings.QUERY_RESULT_LIMIT,
        )
        related_concepts = await graph_service.get_related_concepts(
            user_id=user["id"],
            query=question,
            limit=8,
        )

        # Build context
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

        # Generate and stream answer token by token
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
        confidence = round(min(0.96, 0.4 + (0.1 * len(wiki_pages)) + (0.03 * len(related_concepts))), 2)

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
            {"requestId": request_id, "message": str(exc) or "Internal server error."},
            to=sid,
        )


# ── FastAPI app ───────────────────────────────────────────────────────────────

class AuthenticationMiddleware(BaseHTTPMiddleware):
    """Validates Bearer token and attaches user to request.state."""

    async def dispatch(self, request: Request, call_next) -> Response:
        request.state.user = None
        request.state.access_token_jti = None
        request.state.auth_error = None

        authorization = request.headers.get("Authorization")
        if authorization and authorization.startswith("Bearer "):
            token = authorization.removeprefix("Bearer ").strip()
            try:
                payload = decode_access_token(token)
                jti = payload["jti"]
                user_id = payload["sub"]

                token_record = await get_redis_store().get_access_token(jti)
                if not token_record or token_record.get("user_id") != user_id:
                    raise AppError(
                        status_code=401,
                        code="access_token_invalid",
                        message="Access token expired or revoked.",
                    )

                user = await get_mongo_manager().get_user_by_id(user_id)
                if not user:
                    raise AppError(
                        status_code=401,
                        code="user_not_found",
                        message="Authenticated user no longer exists.",
                    )

                request.state.user = user
                request.state.access_token_jti = jti

            except AppError as exc:
                request.state.auth_error = exc

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
    app.add_middleware(AuthenticationMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.FRONTEND_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
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

    return app


# ── Mount Socket.io onto FastAPI ──────────────────────────────────────────────
# socketio.ASGIApp wraps both: Socket.io at /socket.io/ and FastAPI everywhere else
fastapi_app = create_fastapi_app()
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)