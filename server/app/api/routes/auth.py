from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import get_current_user
from app.core.config import settings
from app.schemas.auth import AuthTokenResponse, LoginRequest, LogoutResponse, RegisterRequest, UserResponse
from app.services.auth_service import get_auth_service
from app.utils.errors import AppError


router = APIRouter(prefix="/auth", tags=["auth"])


def _auth_token_response(session: dict) -> AuthTokenResponse:
    return AuthTokenResponse(
        access_token=session["access_token"],
        expires_at=session["access_token_expires_at"],
        user=UserResponse(**session["user"]),
    )


@router.post("/register", response_model=AuthTokenResponse)
async def register(request: Request, payload: RegisterRequest, response: Response):
    auth_service = get_auth_service()
    session = await auth_service.register_user(
        email=payload.email,
        username=payload.username,
        password=payload.password,
        full_name=payload.full_name,
        user_agent=request.headers.get("User-Agent", ""),
        ip_address=request.client.host if request.client else "",
    )
    auth_service.set_refresh_cookie(response, session["refresh_token"], session["refresh_token_expires_at"])
    return _auth_token_response(session)


@router.post("/login", response_model=AuthTokenResponse)
async def login(request: Request, payload: LoginRequest, response: Response):
    auth_service = get_auth_service()
    session = await auth_service.login_user(
        email=payload.email,
        password=payload.password,
        user_agent=request.headers.get("User-Agent", ""),
        ip_address=request.client.host if request.client else "",
    )
    auth_service.set_refresh_cookie(response, session["refresh_token"], session["refresh_token_expires_at"])
    return _auth_token_response(session)


@router.post("/refresh", response_model=AuthTokenResponse)
async def refresh(request: Request, response: Response):
    refresh_token = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise AppError(status_code=401, code="refresh_token_missing", message="Refresh token is missing.")

    auth_service = get_auth_service()
    session = await auth_service.refresh_session(
        refresh_token=refresh_token,
        user_agent=request.headers.get("User-Agent", ""),
        ip_address=request.client.host if request.client else "",
    )
    auth_service.set_refresh_cookie(response, session["refresh_token"], session["refresh_token_expires_at"])
    return _auth_token_response(session)


@router.post("/logout", response_model=LogoutResponse)
async def logout(request: Request, response: Response):
    auth_service = get_auth_service()
    refresh_token = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    user = getattr(request.state, "user", None)
    await auth_service.logout_user(
        user_id=user["id"] if user else None,
        access_token_jti=getattr(request.state, "access_token_jti", None),
        refresh_token=refresh_token,
    )
    auth_service.clear_refresh_cookie(response)
    return LogoutResponse()


@router.get("/me", response_model=UserResponse)
async def me(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        id=current_user["id"],
        email=current_user["email"],
        username=current_user["username"],
        full_name=current_user.get("full_name", ""),
    )