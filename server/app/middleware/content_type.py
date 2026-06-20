from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from app.utils.errors import AppError


class ContentTypeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only enforce for api endpoints that accept JSON when content-length is present and > 0
        if request.url.path.startswith("/api") and request.method in ("POST", "PUT", "PATCH"):
            content_length = request.headers.get("content-length", "0")
            if content_length != "0" and int(content_length) > 0:
                if request.url.path.rstrip("/").endswith("/ingest/pdf"):
                    return await call_next(request)
                ctype = request.headers.get("content-type", "")
                if not ctype or not ctype.startswith("application/json"):
                    return JSONResponse(status_code=415, content={"success": False, "error": {"code": "unsupported_media_type", "message": "Content-Type must be application/json"}})
        return await call_next(request)
