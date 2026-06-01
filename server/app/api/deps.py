from fastapi import Request
from bson import ObjectId

from app.utils.errors import AppError


async def get_current_user(request: Request) -> dict:
    if getattr(request.state, "user", None):
        return request.state.user
    if getattr(request.state, "auth_error", None):
        raise request.state.auth_error
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