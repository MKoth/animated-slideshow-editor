from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.assets.model import AssetDefinition
from app.config import Settings
from app.database import Database

from .test_assets import png_bytes, upload_file


def naive_utc(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, tzinfo=UTC).replace(tzinfo=None)


def seed_definition(database: Database, name: str, imported_at: datetime) -> str:
    asset_id = str(uuid4())
    with database.session() as session:
        session.add(
            AssetDefinition(
                id=asset_id,
                name=name,
                category="Uncategorized",
                original_filename=f"{name}.png",
                import_date=imported_at,
                width=100,
                height=50,
                file_size=1024,
                aspect_ratio=2.0,
                original_path=f"assets/originals/{asset_id}.png",
                thumbnail_path=f"assets/thumbnails/{asset_id}.png",
            )
        )
        session.commit()
    return asset_id


def seed_names(database: Database, names: list[str], start: datetime | None = None) -> None:
    start = start or naive_utc(2026, 1, 1)
    for index, name in enumerate(names):
        seed_definition(database, name, start.replace(hour=index))


def test_list_returns_all_definitions(client: TestClient, settings: Settings) -> None:
    database = Database(settings.database_url)
    first = seed_definition(database, "fox", naive_utc(2026, 1, 1))
    second = seed_definition(database, "bird", naive_utc(2026, 1, 2))

    response = client.get("/api/assets")

    assert response.status_code == 200
    body = response.json()
    assert {definition["id"] for definition in body} == {first, second}
    assert {definition["name"] for definition in body} == {"fox", "bird"}


def test_search_matches_name_substring_case_insensitively(
    client: TestClient, settings: Settings
) -> None:
    database = Database(settings.database_url)
    seed_names(database, ["Red Fox", "Blue Bird", "Green Tree"])

    assert {d["name"] for d in client.get("/api/assets", params={"search": "red"}).json()} == {
        "Red Fox"
    }
    assert {d["name"] for d in client.get("/api/assets", params={"search": "BIRD"}).json()} == {
        "Blue Bird"
    }
    assert {d["name"] for d in client.get("/api/assets", params={"search": "r"}).json()} == {
        "Red Fox",
        "Blue Bird",
        "Green Tree",
    }
    assert client.get("/api/assets", params={"search": "zebra"}).json() == []


def test_sort_by_name_in_both_directions(client: TestClient, settings: Settings) -> None:
    database = Database(settings.database_url)
    seed_names(database, ["apple", "banana", "cherry"])

    ascending = client.get("/api/assets", params={"sort": "name", "order": "asc"}).json()
    assert [definition["name"] for definition in ascending] == ["apple", "banana", "cherry"]

    descending = client.get("/api/assets", params={"sort": "name", "order": "desc"}).json()
    assert [definition["name"] for definition in descending] == ["cherry", "banana", "apple"]


def test_sort_by_import_date_in_both_directions(client: TestClient, settings: Settings) -> None:
    database = Database(settings.database_url)
    seed_names(database, ["oldest", "middle", "newest"])

    ascending = client.get("/api/assets", params={"sort": "import_date", "order": "asc"}).json()
    assert [definition["name"] for definition in ascending] == ["oldest", "middle", "newest"]

    descending = client.get("/api/assets", params={"sort": "import_date", "order": "desc"}).json()
    assert [definition["name"] for definition in descending] == ["newest", "middle", "oldest"]


def test_default_order_is_newest_first(client: TestClient, settings: Settings) -> None:
    database = Database(settings.database_url)
    seed_names(database, ["oldest", "middle", "newest"])

    body = client.get("/api/assets").json()

    assert [definition["name"] for definition in body] == ["newest", "middle", "oldest"]


def test_search_combines_with_sort(client: TestClient, settings: Settings) -> None:
    database = Database(settings.database_url)
    seed_names(database, ["Red Apple", "Red Banana", "Blue Cherry"])

    body = client.get(
        "/api/assets", params={"search": "red", "sort": "name", "order": "desc"}
    ).json()

    assert [definition["name"] for definition in body] == ["Red Banana", "Red Apple"]


def test_detail_returns_full_definition_with_urls(client: TestClient) -> None:
    content = png_bytes()
    uploaded = client.post(
        "/api/assets", files=[upload_file("fox.png", content, "image/png")]
    ).json()["created"][0]

    response = client.get(f"/api/assets/{uploaded['id']}")

    assert response.status_code == 200
    assert response.json() == uploaded


def test_detail_unknown_id_returns_meaningful_error(client: TestClient) -> None:
    response = client.get("/api/assets/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_delete_removes_record_and_files(client: TestClient, settings: Settings) -> None:
    content = png_bytes()
    uploaded = client.post(
        "/api/assets", files=[upload_file("fox.png", content, "image/png")]
    ).json()["created"][0]
    asset_id = uploaded["id"]

    response = client.delete(f"/api/assets/{asset_id}")

    assert response.status_code == 204
    assert client.get(f"/api/assets/{asset_id}").status_code == 404
    database = Database(settings.database_url)
    with database.session() as session:
        assert session.get(AssetDefinition, asset_id) is None
    assert not (settings.data_dir / "assets" / "originals" / f"{asset_id}.png").exists()
    assert not (settings.data_dir / "assets" / "thumbnails" / f"{asset_id}.png").exists()


def test_delete_unknown_id_returns_meaningful_error(client: TestClient) -> None:
    response = client.delete("/api/assets/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_delete_does_not_affect_other_assets(client: TestClient) -> None:
    first = client.post(
        "/api/assets", files=[upload_file("fox.png", png_bytes(), "image/png")]
    ).json()["created"][0]
    second = client.post(
        "/api/assets", files=[upload_file("bird.png", png_bytes(), "image/png")]
    ).json()["created"][0]

    client.delete(f"/api/assets/{first['id']}")

    remaining = client.get("/api/assets").json()
    assert [definition["id"] for definition in remaining] == [second["id"]]


def test_invalid_sort_and_order_are_rejected(client: TestClient) -> None:
    assert client.get("/api/assets", params={"sort": "bogus"}).status_code == 422
    assert client.get("/api/assets", params={"order": "sideways"}).status_code == 422
