from fastapi import FastAPI

from app.api import health, ping
from app.config import Settings, load_settings
from app.errors import register_error_handlers
from app.logging import RequestLoggingMiddleware


class AppFactory:
    """Builds the FastAPI application and registers its modules."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or load_settings()

    def create(self) -> FastAPI:
        app = FastAPI(title="AI Slideshow Editor Backend")
        app.state.settings = self._settings
        app.add_middleware(RequestLoggingMiddleware)
        register_error_handlers(app)
        app.include_router(health.router)
        app.include_router(ping.router)
        return app


def create_app() -> FastAPI:
    return AppFactory().create()
