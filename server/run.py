"""
run.py — server entrypoint (lives in server/)

app.main:app now points to the socketio.ASGIApp wrapper which mounts
both Socket.io (/socket.io/) and FastAPI (all other routes).
"""

import os
import sys
from pathlib import Path

_SERVER_DIR = str(Path(__file__).resolve().parent)

if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

existing = os.environ.get("PYTHONPATH", "")
if _SERVER_DIR not in existing.split(os.pathsep):
    os.environ["PYTHONPATH"] = (
        f"{_SERVER_DIR}{os.pathsep}{existing}" if existing else _SERVER_DIR
    )

import uvicorn
from app.core.config import settings


def _banner() -> str:
    display_host = "localhost" if settings.HOST == "0.0.0.0" else settings.HOST
    base = f"http://{display_host}:{settings.PORT}"
    name = settings.APP_NAME
    env  = settings.ENVIRONMENT.upper()
    sep  = "=" * 52
    return (
        f"\n  {sep}\n"
        f"  {name:^52}\n"
        f"  {'[ ' + env + ' ]':^52}\n"
        f"  {sep}\n"
        f"  Server   {base}\n"
        f"  Docs     {base}/docs\n"
        f"  Redoc    {base}/redoc\n"
        f"  Health   {base}/health\n"
        f"  Socket   ws://{display_host}:{settings.PORT}/socket.io/\n"
        f"  {sep}\n"
    )


if __name__ == "__main__":
    print(_banner())

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower(),
        workers=1 if settings.DEBUG else None,
    )