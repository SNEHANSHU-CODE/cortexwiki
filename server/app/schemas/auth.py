from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    email: EmailStr
    username: str
    full_name: str = ""


class AuthTokenResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    refresh_token: str
    refresh_token_expires_at: datetime
    user: UserResponse


class LogoutResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    logged_out: bool = True


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    username: str = Field(min_length=3, max_length=40)
    full_name: str = Field(default="", max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(max_length=128)


class OtpSendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    name: str = Field(default="", max_length=120)
    purpose: Literal["register", "reset"]


class OtpCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    otp: str = Field(min_length=6, max_length=6)


class OtpVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    otp: str = Field(min_length=6, max_length=6)
    purpose: Literal["register", "reset"]
    # For register
    username: str = Field(default="", max_length=40)
    full_name: str = Field(default="", max_length=120)
    password: str = Field(default="", max_length=128)


class OtpVerifyResetResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reset_token: str


class PasswordResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reset_token: str
    new_password: str = Field(min_length=8, max_length=128)


class DeleteAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(max_length=128)