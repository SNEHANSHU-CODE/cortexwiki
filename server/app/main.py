from contextlib import asynccontextmanager

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
from modules.db.mongo import get_mongo_manager


configure_logging(settings.LOG_LEVEL)


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

    # Middleware order matters: added last = outermost layer.
    # Execution order: CORS → Auth → request_context
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
        from modules.db.graph import get_graph_manager

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


app = create_fastapi_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=settings.DEBUG)