# ruff: noqa: BLE001
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import (
    assets,
    audio,
    clip_collections,
    clips,
    export,
    health,
    materials,
    ping,
    projects,
    shaders,
    tts,
    voice_prompts,
)
from app.assets.importer import AssetImporter
from app.assets.library import AssetLibrary
from app.assets.pipeline import ImagePipeline
from app.assets.storage import AssetStorage
from app.clip_collections.library import ClipCollectionLibrary
from app.clips.library import ClipLibrary
from app.config import Settings, load_settings
from app.database import Database
from app.errors import register_error_handlers
from app.logging import RequestLoggingMiddleware
from app.materials.library import MaterialLibrary, now_utc
from app.projects.library import ProjectLibrary
from app.shaders.library import ShaderLibrary
from app.voice_prompts.library import VoicePromptLibrary


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
        app.state.clip_collection_library = ClipCollectionLibrary(database)
        app.state.voice_prompt_library = VoicePromptLibrary(database)
        # TTS engine singleton (lazy model load on first generate, cached in app.state like asset_library)
        try:
            from app.tts.engine import MlxNotAvailableError, SineTtsEngine, get_tts_engine

            app.state.tts_engine = get_tts_engine(
                provider=self._settings.tts_provider, model_id=self._settings.tts_model_id
            )
        except MlxNotAvailableError:
            # auto fallback is already handled inside get_tts_engine (returns Sine),
            # but forced mlx should surface 503 at runtime not at startup.
            # Store placeholder that will raise on generate so we can return 503 per-request.
            from app.tts.engine import MlxQwenTtsEngine

            if self._settings.tts_provider == "mlx":
                # Store a lazy mlx engine that will fail with 503 on first use
                app.state.tts_engine = MlxQwenTtsEngine(self._settings.tts_model_id)
            else:
                from app.tts.engine import SineTtsEngine

                app.state.tts_engine = SineTtsEngine()
        except Exception:
            from app.tts.engine import SineTtsEngine

            app.state.tts_engine = SineTtsEngine()

        app.add_middleware(RequestLoggingMiddleware)
        register_error_handlers(app)
        app.include_router(health.router)
        app.include_router(ping.router)
        app.include_router(assets.router, prefix="/api")
        app.include_router(audio.router, prefix="/api")
        app.include_router(materials.router, prefix="/api")
        app.include_router(shaders.router, prefix="/api")
        app.include_router(projects.router, prefix="/api")
        app.include_router(clips.router, prefix="/api")
        app.include_router(clip_collections.router, prefix="/api")
        app.include_router(voice_prompts.router, prefix="/api")
        app.include_router(tts.router, prefix="/api")
        app.include_router(export.router, prefix="/api")
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
