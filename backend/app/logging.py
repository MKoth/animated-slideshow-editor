import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Logs every request as `METHOD /path status duration_ms`."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        logger = logging.getLogger("app.request")
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.error("%s %s 500 %.0fms", request.method, request.url.path, duration_ms)
            raise
        duration_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "%s %s %d %.0fms", request.method, request.url.path, response.status_code, duration_ms
        )
        return response
