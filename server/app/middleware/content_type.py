from starlette.requests import Request
from starlette.responses import JSONResponse
from app.utils.errors import AppError


async def validate_content_type(request: Request):
    # Only enforce for api endpoints that accept JSON
    if request.url.path.startswith("/api") and request.method in ("POST", "PUT", "PATCH"):
        ctype = request.headers.get("content-type", "")
        if not ctype or not ctype.startswith("application/json"):
            return JSONResponse(status_code=415, content={"success": False, "error": {"code": "unsupported_media_type", "message": "Content-Type must be application/json"}})
    return None
