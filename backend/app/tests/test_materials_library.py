from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.config import Settings
from app.database import Database
from app.materials.library import MaterialNotFoundError
from app.materials.model import MaterialDefinition


def naive_utc(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, tzinfo=UTC).replace(tzinfo=None)


def seed_material(database: Database, name: str, created_at: datetime) -> str:
    material_id = str(uuid4())
    with database.session() as session:
        session.add(
            MaterialDefinition(
                id=material_id,
                name=name,
                created_at=created_at,
                updated_at=created_at,
            )
        )
        session.commit()
    return material_id


def test_get_returns_the_seeded_definition(client: TestClient, settings: Settings) -> None:
    database = Database(settings.database_url)
    material_id = seed_material(database, "Gold", naive_utc(2026, 1, 1))

    body = client.get(f"/api/materials/{material_id}").json()

    assert body["name"] == "Gold"
    assert body["parameters"] == [
        {"key": "tint", "kind": "color", "default": "#ffffff"},
        {"key": "opacityMultiplier", "kind": "number", "default": 1.0},
    ]


def test_get_unknown_id_raises_not_found(settings: Settings) -> None:
    from app.app_factory import AppFactory

    library = AppFactory(settings).create().state.material_library

    try:
        library.get("ghost")
    except MaterialNotFoundError as exc:
        assert exc.args[0] == "ghost"
    else:
        raise AssertionError("expected MaterialNotFoundError")


def test_delete_removes_only_the_target_material(client: TestClient, settings: Settings) -> None:
    database = Database(settings.database_url)
    first = seed_material(database, "First", naive_utc(2026, 1, 1))
    second = seed_material(database, "Second", naive_utc(2026, 1, 2))

    response = client.delete(f"/api/materials/{first}")

    assert response.status_code == 204
    remaining = client.get("/api/materials").json()
    assert [material["id"] for material in remaining] == [second]
    with database.session() as session:
        assert session.get(MaterialDefinition, first) is None
        assert session.get(MaterialDefinition, second) is not None
