from fastapi import Request
from bson import ObjectId

from app.utils.errors import AppError


async def get_current_user(request: Request) -> dict:
    if getattr(request.state, "user", None):
        return request.state.user
    if getattr(request.state, "auth_error", None):
        if isinstance(request.state.auth_error, AppError):
            raise request.state.auth_error
        raise AppError(status_code=401, code="authentication_required", message=str(request.state.auth_error))
    raise AppError(status_code=401, code="authentication_required", message="Authentication required.")


# BUG FIX #5: Centralized wiki_id validation for all routes
async def validate_wiki_id(wiki_id: str) -> str:
    """
    Validates that wiki_id is a valid MongoDB ObjectId format.
    
    Raises AppError with 400 status if invalid.
    Can be used as a FastAPI dependency:
    
        @router.post("")
        async def my_endpoint(wiki_id: str = Depends(validate_wiki_id)):
            ...
    """
    if not wiki_id or not isinstance(wiki_id, str):
        raise AppError(status_code=400, code="invalid_wiki_id", message="wiki_id must be a non-empty string.")
    
    if not ObjectId.is_valid(wiki_id):
        raise AppError(status_code=400, code="invalid_wiki_id", message="Invalid wiki_id format. Must be a valid MongoDB ObjectId.")
    
    return wiki_id


async def verify_content_length(request: Request):
    """
    Validates that the Content-Length header does not exceed the allowed limit (16MB).
    This prevents memory/disk exhaustion before UploadFile spools to disk.
    """
    content_length = request.headers.get("content-length")
    if not content_length:
        raise AppError(status_code=411, code="length_required", message="Content-Length header is required.")
    
    try:
        length = int(content_length)
    except ValueError:
        raise AppError(status_code=400, code="invalid_length", message="Invalid Content-Length header.")
        
    if length > 16 * 1024 * 1024:
        raise AppError(status_code=413, code="payload_too_large", message="File exceeds the 16MB limit.")