from datetime import datetime

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
    password: str = Field(min_length=8, max_length=128)