from starlette.requests import Request
from starlette.responses import JSONResponse
from app.utils.errors import AppError


async def validate_content_type(request: Request):
    # Only enforce for api endpoints that accept JSON when content-length is present and > 0
    if request.url.path.startswith("/api") and request.method in ("POST", "PUT", "PATCH"):
        if request.url.path.rstrip("/") == "/api/ingest/pdf":
            return None
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > 0:
            ctype = request.headers.get("content-type", "")
            if not ctype or not ctype.startswith("application/json"):
                return JSONResponse(status_code=415, content={"success": False, "error": {"code": "unsupported_media_type", "message": "Content-Type must be application/json"}})
    return None
