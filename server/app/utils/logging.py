import logging
import uuid
from time import perf_counter

from fastapi import Request, Response


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        force=True,
    )


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


async def request_context_middleware(request: Request, call_next):
    request.state.request_id = str(uuid.uuid4())
    logger = get_logger("http.request")
    started_at = perf_counter()

    response: Response = await call_next(request)

    duration_ms = round((perf_counter() - started_at) * 1000, 2)
    logger.info(
        "%s %s -> %s in %sms [%s]",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
        request.state.request_id,
    )
    response.headers["X-Request-ID"] = request.state.request_id
    return response
