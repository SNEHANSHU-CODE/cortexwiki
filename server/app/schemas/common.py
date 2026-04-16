from typing import Any, Generic, TypeVar

from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict


T = TypeVar("T")


class ErrorInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    request_id: str | None = None
    details: Any | None = None


class APIResponse(BaseModel, Generic[T]):
    model_config = ConfigDict(extra="forbid")

    success: bool
    data: T | None = None
    error: ErrorInfo | None = None


def success_response(data: Any) -> dict[str, Any]:
    return {
        "success": True,
        "data": jsonable_encoder(data),
        "error": None,
    }

