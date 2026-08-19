from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import assets, clips, health, materials, ping, projects, shaders
from app.assets.importer import AssetImporter
from app.assets.library import AssetLibrary
from app.assets.pipeline import ImagePipeline
from app.assets.storage import AssetStorage
from app.clips.library import ClipLibrary
from app.config import Settings, load_settings
from app.database import Database
from app.errors import register_error_handlers
from app.logging import RequestLoggingMiddleware
from app.materials.library import MaterialLibrary, now_utc
from app.projects.library import ProjectLibrary
from app.shaders.library import ShaderLibrary


class AppFactory:
    """Builds the FastAPI application and registers its modules."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or load_settings()

    def create(self) -> FastAPI:
        app = FastAPI(title="AI Slideshow Editor Backend")
        app.state.settings = self._settings

        storage = AssetStorage(self._settings.data_dir)
        storage.ensure_directories()
        database = Database(self._settings.database_url)
        database.init_schema()
        app.state.database = database
        app.state.asset_importer = AssetImporter(
            database, storage, ImagePipeline(self._settings.max_upload_bytes)
        )
        app.state.asset_library = AssetLibrary(database, storage)
        material_library = MaterialLibrary(database)
        material_library.ensure_seeded(now_utc())
        app.state.material_library = material_library
        shader_library = ShaderLibrary(database)
        shader_library.ensure_seeded(now_utc())
        app.state.shader_library = shader_library
        app.state.project_library = ProjectLibrary(database)
        clip_library = ClipLibrary(database)
        clip_library.ensure_seeded(now_utc())
        app.state.clip_library = clip_library

        app.add_middleware(RequestLoggingMiddleware)
        register_error_handlers(app)
        app.include_router(health.router)
        app.include_router(ping.router)
        app.include_router(assets.router, prefix="/api")
        app.include_router(materials.router, prefix="/api")
        app.include_router(shaders.router, prefix="/api")
        app.include_router(projects.router, prefix="/api")
        app.include_router(clips.router, prefix="/api")
        app.mount(
            "/api/assets/originals",
            StaticFiles(directory=storage.originals_dir),
            name="asset-originals",
        )
        app.mount(
            "/api/assets/thumbnails",
            StaticFiles(directory=storage.thumbnails_dir),
            name="asset-thumbnails",
        )
        return app


def create_app() -> FastAPI:
    return AppFactory().create()
