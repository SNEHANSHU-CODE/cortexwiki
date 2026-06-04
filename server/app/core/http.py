import httpx
from app.core.config import settings

_async_client: httpx.AsyncClient | None = None

def get_http_client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None:
        limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
        _async_client = httpx.AsyncClient(
            timeout=settings.HTTP_REQUEST_TIMEOUT,
            verify=settings.OUTBOUND_VERIFY_SSL,
            limits=limits,
            headers={"User-Agent": settings.USER_AGENT}
        )
    return _async_client

async def close_http_client():
    global _async_client
    if _async_client is not None:
        await _async_client.aclose()
        _async_client = None
