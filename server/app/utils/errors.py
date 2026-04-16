from datetime import UTC, datetime

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.schemas.common import ErrorInfo
from app.utils.logging import get_logger


logger = get_logger("utils.errors")


class AppError(Exception):
    def __init__(self, *, status_code: int, code: str, message: str, details: dict | list | None = None) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(message)


def error_payload(*, request: Request, code: str, message: str, details: dict | list | None = None) -> dict:
    error = ErrorInfo(
        code=code,
        message=message,
        request_id=getattr(request.state, "request_id", None),
        details=details or None,
    )
    return {
        "success": False,
        "data": None,
        "error": {
            **error.model_dump(mode="json"),
            "timestamp": datetime.now(UTC).isoformat(),
        },
    }


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    if exc.status_code >= 500:
        logger.exception("Application error: %s", exc.message)
    else:
        logger.warning("Application error: %s", exc.message)
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(request=request, code=exc.code, message=exc.message, details=exc.details),
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=error_payload(
            request=request,
            code="validation_error",
            message="Request validation failed.",
            details=exc.errors(),
        ),
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception", exc_info=exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=error_payload(
            request=request,
            code="internal_server_error",
            message="An unexpected error occurred.",
        ),
    )
