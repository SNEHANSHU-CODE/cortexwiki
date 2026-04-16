from fastapi import Request

from app.utils.errors import AppError


async def get_current_user(request: Request) -> dict:
    if getattr(request.state, "user", None):
        return request.state.user
    if getattr(request.state, "auth_error", None):
        raise request.state.auth_error
    raise AppError(status_code=401, code="authentication_required", message="Authentication required.")