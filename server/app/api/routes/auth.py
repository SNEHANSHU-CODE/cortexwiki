from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.otp_store import create_otp, verify_otp
from app.schemas.auth import (
    AuthTokenResponse,
    DeleteAccountRequest,
    LoginRequest,
    LogoutResponse,
    OtpCheckRequest,
    OtpSendRequest,
    OtpVerifyRequest,
    OtpVerifyResetResponse,
    PasswordResetRequest,
    RegisterRequest,
    UserResponse,
)
from app.services.auth_service import get_auth_service
from app.utils.errors import AppError


router = APIRouter(prefix="/auth", tags=["auth"])


def _auth_token_response(session: dict) -> AuthTokenResponse:
    return AuthTokenResponse(
        access_token=session["access_token"],
        expires_at=session["access_token_expires_at"],
        refresh_token=session["refresh_token"],
        refresh_token_expires_at=session["refresh_token_expires_at"],
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
    auth_service.set_access_cookie(response, session["access_token"], session["access_token_expires_at"])
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
    auth_service.set_access_cookie(response, session["access_token"], session["access_token_expires_at"])
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
    auth_service.set_access_cookie(response, session["access_token"], session["access_token_expires_at"])
    auth_service.set_refresh_cookie(response, session["refresh_token"], session["refresh_token_expires_at"])
    return _auth_token_response(session)


@router.post("/logout", response_model=LogoutResponse)
async def logout(request: Request, response: Response, current_user: dict = Depends(get_current_user)):
    auth_service = get_auth_service()
    refresh_token = request.cookies.get(settings.REFRESH_COOKIE_NAME)
    user = current_user
    await auth_service.logout_user(
        user_id=user["id"] if user else None,
        access_token_jti=getattr(request.state, "access_token_jti", None),
        refresh_token=refresh_token,
    )
    auth_service.clear_access_cookie(response)
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


@router.get("/me/usage")
async def me_usage(current_user: dict = Depends(get_current_user)):
    """Return the authenticated user's daily token usage vs enforced limits."""
    from app.db.mongo import get_mongo_manager
    input_used, output_used = await get_mongo_manager().get_user_token_usage(current_user["id"])
    return {
        "daily_input_tokens_used":  input_used,
        "daily_output_tokens_used": output_used,
        "daily_input_limit":        100_000,
        "daily_output_limit":        30_000,
    }


@router.delete("/me", status_code=204)
async def delete_me(
    request: Request,
    response: Response,
    payload: DeleteAccountRequest,
    current_user: dict = Depends(get_current_user),
):
    """Delete the authenticated user's account and all associated data."""
    from app.core.security import verify_password
    from app.db.mongo import get_mongo_manager

    # Re-fetch user to get the password hash
    user = await get_mongo_manager().get_user_by_email(current_user["email"])
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        raise AppError(status_code=401, code="invalid_password", message="Incorrect password. Please try again.")

    auth_service = get_auth_service()
    await auth_service.delete_account(current_user["id"])
    auth_service.clear_access_cookie(response)
    auth_service.clear_refresh_cookie(response)
    return Response(status_code=204)


@router.post("/otp/send")
async def otp_send(payload: OtpSendRequest):
    """
    Generate a 6-digit OTP, store it server-side with a 10-minute TTL,
    and deliver it to the user's email via EmailJS REST API.
    The OTP is never returned to the client.
    """
    from app.db.mongo import get_mongo_manager
    from app.utils.email import send_otp_email

    email = payload.email.lower().strip()

    existing = None  # BUG-C1 FIX: guard against UnboundLocalError if a future purpose skips both if-blocks

    if payload.purpose == "register":
        existing = await get_mongo_manager().get_user_by_email(email)
        if existing:
            raise AppError(status_code=409, code="user_exists", message="An account with this email already exists.")

    if payload.purpose == "reset":
        existing = await get_mongo_manager().get_user_by_email(email)
        if not existing:
            raise AppError(status_code=404, code="user_not_found", message="No account found with this email address.")

    otp = create_otp(email)

    name_to_use = payload.name
    if payload.purpose == "reset" and existing:
        name_to_use = existing.get("full_name") or existing.get("username") or "there"
    elif not name_to_use:
        name_to_use = "there"

    try:
        await send_otp_email(email=email, otp=otp, name=name_to_use)
    except Exception:
        # Log but don't expose delivery errors to client
        from app.utils.logging import get_logger
        get_logger("api.auth").exception("Failed to send OTP email to %s", email)
        raise AppError(
            status_code=503,
            code="email_delivery_failed",
            message="Could not send verification email. Please try again shortly.",
        )

    return {"message": "Verification code sent. Please check your inbox."}


@router.post("/otp/check")
async def otp_check(payload: OtpCheckRequest):
    """
    Check if an OTP is valid without consuming it.
    Used by the frontend to validate the OTP before asking for a new password.
    """
    from app.core.otp_store import check_otp

    if not check_otp(payload.email, payload.otp):
        raise AppError(status_code=400, code="otp_invalid", message="Invalid or expired verification code.")
    
    return {"valid": True}


@router.post("/otp/verify", response_model=AuthTokenResponse | OtpVerifyResetResponse)
async def otp_verify(request: Request, response: Response, payload: OtpVerifyRequest):
    """
    Verify an OTP and complete the action:
    - purpose=register: creates the user account and returns a session.
    - purpose=reset:    verifies OTP and returns a reset_token.
    """
    email = payload.email.lower().strip()

    if not verify_otp(email, payload.otp):
        raise AppError(status_code=400, code="otp_invalid", message="Invalid or expired verification code.")

    auth_service = get_auth_service()

    if payload.purpose == "register":
        if not payload.username or len(payload.username) < 3:
            raise AppError(status_code=422, code="validation_error", message="Username must be at least 3 characters.")
        if not payload.password or len(payload.password) < 8:
            raise AppError(status_code=422, code="validation_error", message="Password must be at least 8 characters.")
        session = await auth_service.register_user(
            email=email,
            username=payload.username,
            password=payload.password,
            full_name=payload.full_name,
            user_agent=request.headers.get("User-Agent", ""),
            ip_address=request.client.host if request.client else "",
        )
        auth_service.set_access_cookie(response, session["access_token"], session["access_token_expires_at"])
        auth_service.set_refresh_cookie(response, session["refresh_token"], session["refresh_token_expires_at"])
        return _auth_token_response(session)

    else:  # reset
        from app.db.mongo import get_mongo_manager
        from app.core.security import create_reset_token
        
        user = await get_mongo_manager().get_user_by_email(email)
        if not user:
            raise AppError(status_code=404, code="user_not_found", message="User not found.")
            
        reset_token = create_reset_token(user_id=user["id"])
        return OtpVerifyResetResponse(reset_token=reset_token)


@router.post("/password-reset", response_model=AuthTokenResponse)
async def password_reset(request: Request, response: Response, payload: PasswordResetRequest):
    from app.core.security import decode_reset_token, hash_password
    from app.db.mongo import get_mongo_manager
    
    # 1. Verify token
    token_data = decode_reset_token(payload.reset_token)
    user_id = token_data["sub"]
    
    # 2. Get user
    mongo = get_mongo_manager()
    user = await mongo.get_user_by_id(user_id)
    if not user:
        raise AppError(status_code=404, code="user_not_found", message="User not found.")
        
    # 3. Update password
    await mongo.update_user(user_id, {"password_hash": hash_password(payload.new_password)})
    
    # 4. Global logout
    auth_service = get_auth_service()
    await auth_service.logout_user(user_id=user_id, access_token_jti=None, refresh_token=None, global_logout=True)
    
    # 5. Issue new session
    session = await auth_service._issue_session(
        user=user,
        user_agent=request.headers.get("User-Agent", ""),
        ip_address=request.client.host if request.client else "",
    )
    auth_service.set_access_cookie(response, session["access_token"], session["access_token_expires_at"])
    auth_service.set_refresh_cookie(response, session["refresh_token"], session["refresh_token_expires_at"])
    return _auth_token_response(session)