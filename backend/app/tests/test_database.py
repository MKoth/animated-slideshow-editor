from pathlib import Path

from sqlalchemy import inspect, text

from app.app_factory import AppFactory
from app.config import Settings
from app.database import Database


def _create_legacy_materials_table(settings: Settings) -> Database:
    """Simulate a database written before material definitions carried a shader reference."""
    data_dir = Path(settings.database_url.removeprefix("sqlite:///")).parent
    data_dir.mkdir(parents=True, exist_ok=True)
    database = Database(settings.database_url)
    with database.engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE material_definitions (
                    id VARCHAR(36) PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    description TEXT NOT NULL,
                    tags JSON NOT NULL,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    parameters JSON NOT NULL
                )
                """
            )
        )
    return database


def test_init_schema_adds_new_columns_to_existing_tables(settings: Settings) -> None:
    database = _create_legacy_materials_table(settings)

    database.init_schema()

    with database.engine.begin() as connection:
        columns = {
            column["name"] for column in inspect(connection).get_columns("material_definitions")
        }
    assert "shader_id" in columns


def test_app_boots_and_seeds_on_a_legacy_database(settings: Settings) -> None:
    database = _create_legacy_materials_table(settings)

    app = AppFactory(settings).create()

    with database.engine.begin() as connection:
        count = connection.execute(text("SELECT COUNT(*) FROM material_definitions")).scalar()
    assert count == 1
    assert app.state.material_library is not None


def test_init_schema_is_idempotent_on_a_legacy_database(settings: Settings) -> None:
    database = _create_legacy_materials_table(settings)

    database.init_schema()
    database.init_schema()

    with database.engine.begin() as connection:
        count = len(inspect(connection).get_columns("material_definitions"))
    assert count == 8
