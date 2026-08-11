from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from app.app_factory import AppFactory
from app.assets.model import AssetDefinition
from app.config import Settings


def png_bytes(
    width: int = 800, height: int = 400, color: tuple[int, int, int] = (255, 0, 0)
) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def jpeg_bytes(
    width: int = 600, height: int = 300, color: tuple[int, int, int] = (0, 255, 0)
) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="JPEG")
    return buffer.getvalue()


def webp_bytes(
    width: int = 400, height: int = 200, color: tuple[int, int, int] = (0, 0, 255)
) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="WEBP")
    return buffer.getvalue()


def upload_file(
    filename: str, content: bytes, content_type: str
) -> tuple[str, tuple[str, bytes, str]]:
    return ("files", (filename, content, content_type))


def test_upload_creates_definition_with_import_defaults(
    client: TestClient, settings: Settings
) -> None:
    content = png_bytes()

    response = client.post("/api/assets", files=[upload_file("fox.png", content, "image/png")])

    assert response.status_code == 200
    body = response.json()
    assert body["errors"] == []
    assert len(body["created"]) == 1
    definition = body["created"][0]
    assert definition["name"] == "fox"
    assert definition["category"] == "Uncategorized"
    assert definition["description"] == ""
    assert definition["tags"] == []
    assert definition["ai_description"] == ""
    assert definition["original_filename"] == "fox.png"
    assert definition["width"] == 800
    assert definition["height"] == 400
    assert definition["file_size"] == len(content)
    assert definition["aspect_ratio"] == 2.0
    assert definition["default_scale"] == 1.0
    assert definition["default_rotation"] == 0.0
    assert definition["pivot"] == {"x": 0.5, "y": 0.5}
    assert definition["anchors"] == []
    assert definition["import_date"]
    assert definition["original_url"] == f"/api/assets/originals/{definition['id']}.png"
    assert definition["thumbnail_url"] == f"/api/assets/thumbnails/{definition['id']}.png"

    original = settings.data_dir / "assets" / "originals" / f"{definition['id']}.png"
    assert original.read_bytes() == content


def test_upload_accepts_png_jpeg_and_webp_in_one_request(client: TestClient) -> None:
    response = client.post(
        "/api/assets",
        files=[
            upload_file("a.png", png_bytes(), "image/png"),
            upload_file("b.jpg", jpeg_bytes(), "image/jpeg"),
            upload_file("c.webp", webp_bytes(), "image/webp"),
        ],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["errors"] == []
    assert {definition["original_filename"] for definition in body["created"]} == {
        "a.png",
        "b.jpg",
        "c.webp",
    }


def test_upload_sniffs_content_not_declared_content_type(client: TestClient) -> None:
    response = client.post(
        "/api/assets", files=[upload_file("trick.txt", png_bytes(), "text/plain")]
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["created"]) == 1
    assert body["created"][0]["original_filename"] == "trick.txt"


def test_upload_rejects_non_image_with_image_content_type(client: TestClient) -> None:
    response = client.post(
        "/api/assets", files=[upload_file("fake.png", b"just some text", "image/png")]
    )

    body = response.json()
    assert body["created"] == []
    assert len(body["errors"]) == 1
    assert "unsupported" in body["errors"][0]["error"].lower()
    assert body["errors"][0]["filename"] == "fake.png"


def test_upload_rejects_corrupt_file(client: TestClient) -> None:
    corrupt = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

    response = client.post("/api/assets", files=[upload_file("broken.png", corrupt, "image/png")])

    body = response.json()
    assert body["created"] == []
    assert len(body["errors"]) == 1
    assert "corrupt" in body["errors"][0]["error"].lower()


def test_upload_rejects_oversized_file(tmp_path: Path) -> None:
    content = png_bytes(width=10, height=10)
    settings = Settings(
        frontend_url="http://localhost:5173",
        development_mode=False,
        data_dir=tmp_path / "var",
        database_url=f"sqlite:///{tmp_path}/var/library.db",
        max_upload_bytes=len(content) - 1,
    )
    client = TestClient(AppFactory(settings).create())

    response = client.post("/api/assets", files=[upload_file("big.png", content, "image/png")])

    body = response.json()
    assert body["created"] == []
    assert len(body["errors"]) == 1
    assert "exceeds" in body["errors"][0]["error"].lower()


def test_rejected_file_does_not_abort_other_files(client: TestClient) -> None:
    response = client.post(
        "/api/assets",
        files=[
            upload_file("good.png", png_bytes(), "image/png"),
            upload_file("bad.txt", b"nope", "text/plain"),
            upload_file("broken.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, "image/png"),
        ],
    )

    body = response.json()
    assert len(body["created"]) == 1
    assert body["created"][0]["original_filename"] == "good.png"
    assert {error["filename"] for error in body["errors"]} == {"bad.txt", "broken.png"}


def test_thumbnail_is_generated_with_max_256px(client: TestClient, settings: Settings) -> None:
    response = client.post(
        "/api/assets", files=[upload_file("wide.png", png_bytes(800, 400), "image/png")]
    )

    definition = response.json()["created"][0]
    thumbnail = settings.data_dir / "assets" / "thumbnails" / f"{definition['id']}.png"
    assert thumbnail.exists()
    with Image.open(thumbnail) as image:
        assert image.format == "PNG"
        assert image.size == (256, 128)


def test_thumbnail_never_upscales_small_images(client: TestClient, settings: Settings) -> None:
    response = client.post(
        "/api/assets", files=[upload_file("small.png", png_bytes(100, 50), "image/png")]
    )

    definition = response.json()["created"][0]
    thumbnail = settings.data_dir / "assets" / "thumbnails" / f"{definition['id']}.png"
    with Image.open(thumbnail) as image:
        assert image.size == (100, 50)


def test_original_and_thumbnail_are_served(client: TestClient) -> None:
    content = png_bytes()
    response = client.post("/api/assets", files=[upload_file("fox.png", content, "image/png")])
    definition = response.json()["created"][0]

    original = client.get(definition["original_url"])
    assert original.status_code == 200
    assert original.content == content
    assert original.headers["content-type"] == "image/png"

    thumbnail = client.get(definition["thumbnail_url"])
    assert thumbnail.status_code == 200
    assert thumbnail.headers["content-type"] == "image/png"


def test_upload_rejects_non_canonical_category(client: TestClient) -> None:
    response = client.post(
        "/api/assets",
        files=[upload_file("fox.png", png_bytes(), "image/png")],
        data={"categories": "Zombie"},
    )

    body = response.json()
    assert body["created"] == []
    assert len(body["errors"]) == 1
    assert "canonical" in body["errors"][0]["error"].lower()


def test_upload_accepts_canonical_category(client: TestClient) -> None:
    response = client.post(
        "/api/assets",
        files=[upload_file("fox.png", png_bytes(), "image/png")],
        data={"categories": "Character"},
    )

    body = response.json()
    assert len(body["created"]) == 1
    assert body["created"][0]["category"] == "Character"


def test_upload_maps_categories_to_files_in_order(client: TestClient) -> None:
    response = client.post(
        "/api/assets",
        files=[
            upload_file("a.png", png_bytes(), "image/png"),
            upload_file("b.png", png_bytes(), "image/png"),
        ],
        data={"categories": ["Character", "Background"]},
    )

    body = response.json()
    assert body["errors"] == []
    categories = {
        definition["original_filename"]: definition["category"] for definition in body["created"]
    }
    assert categories == {"a.png": "Character", "b.png": "Background"}


def test_upload_rejects_category_count_mismatch(client: TestClient) -> None:
    response = client.post(
        "/api/assets",
        files=[
            upload_file("a.png", png_bytes(), "image/png"),
            upload_file("b.png", png_bytes(), "image/png"),
        ],
        data={"categories": "Character"},
    )

    assert response.status_code == 422


def test_one_request_is_one_transaction(client: TestClient) -> None:
    response = client.post(
        "/api/assets",
        files=[
            upload_file("a.png", png_bytes(), "image/png"),
            upload_file("b.png", png_bytes(100, 50), "image/png"),
        ],
    )

    created = response.json()["created"]
    assert len({definition["import_date"] for definition in created}) == 1


def test_definitions_and_files_survive_restart(settings: Settings) -> None:
    first = TestClient(AppFactory(settings).create())
    response = first.post("/api/assets", files=[upload_file("fox.png", png_bytes(), "image/png")])
    definition = response.json()["created"][0]

    second = AppFactory(settings).create()
    database = second.state.database
    with database.session() as session:
        stored = session.get(AssetDefinition, definition["id"])

    assert stored is not None
    assert stored.name == "fox"
    assert stored.category == "Uncategorized"
    assert stored.original_filename == "fox.png"
    assert stored.width == 800
    assert stored.height == 400
    assert stored.original_path == f"assets/originals/{definition['id']}.png"
    assert stored.thumbnail_path == f"assets/thumbnails/{definition['id']}.png"

    original_file = settings.data_dir / stored.original_path
    thumbnail_file = settings.data_dir / stored.thumbnail_path
    assert original_file.exists()
    assert thumbnail_file.exists()
