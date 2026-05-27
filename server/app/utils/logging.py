import contextvars
import logging
import uuid
from time import perf_counter

from fastapi import Request, Response

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get("")
        return True


def configure_logging(level: str = "INFO") -> None:
    original_factory = logging.getLogRecordFactory()

    def record_factory(*args, **kwargs):
        record = original_factory(*args, **kwargs)
        if not hasattr(record, "request_id"):
            record.request_id = ""
        return record

    logging.setLogRecordFactory(record_factory)

    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(request_id)s | %(message)s",
        force=True,
    )
    request_filter = RequestIdFilter()
    root_logger = logging.getLogger()
    root_logger.addFilter(request_filter)
    for handler in root_logger.handlers:
        handler.addFilter(request_filter)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


async def request_context_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    request_id_var.set(request_id)
    logger = get_logger("http.request")
    started_at = perf_counter()
    response: Response | None = None

    try:
        response = await call_next(request)
        return response
    finally:
        duration_ms = round((perf_counter() - started_at) * 1000, 2)
        logger.info(
            "%s %s -> %s in %sms [%s]",
            request.method,
            request.url.path,
            getattr(response, "status_code", 500),
            duration_ms,
            request_id,
        )
        if response is not None:
            response.headers["X-Request-ID"] = request_id
        request_id_var.set("")
