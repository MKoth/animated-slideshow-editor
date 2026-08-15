from typing import cast

from fastapi.testclient import TestClient

from app.app_factory import AppFactory
from app.config import Settings
from app.shaders.model import BUILTIN_SHADERS, ShaderDefinition

FRAGMENT_SOURCE = """#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  fragColor = color;
}
"""

VERTEX_SOURCE = (
    "#version 300 es\nin vec2 aPosition;\n"
    "void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }\n"
)

BUILTIN_ID = cast(str, BUILTIN_SHADERS[0]["id"])


def upload_file(filename: str, content: bytes) -> tuple[str, tuple[str, bytes, str]]:
    return ("file", (filename, content, "text/plain"))


def import_shader(
    client: TestClient,
    filename: str = "wash.glsl",
    content: bytes | None = None,
    **overrides: str | list[str],
) -> dict[str, object]:
    response = client.post(
        "/api/shaders/import",
        files=[("file", (filename, content or FRAGMENT_SOURCE.encode(), "text/plain"))],
        data=overrides,
    )
    assert response.status_code == 200
    return cast(dict[str, object], response.json())


def test_import_creates_definition_with_defaults(client: TestClient) -> None:
    shader = import_shader(client)

    assert shader["id"]
    assert shader["name"] == "wash"
    assert shader["description"] == ""
    assert shader["tags"] == []
    assert shader["source"] == FRAGMENT_SOURCE
    assert shader["is_builtin"] is False
    assert shader["default_uniforms"] == []
    assert shader["created_at"]
    assert shader["updated_at"]


def test_import_accepts_name_description_and_tags(client: TestClient) -> None:
    shader = import_shader(
        client,
        name="Ink Wash",
        description="Hand drawn look",
        tags=["art", "watercolor"],
    )

    assert shader["name"] == "Ink Wash"
    assert shader["description"] == "Hand drawn look"
    assert shader["tags"] == ["art", "watercolor"]
    assert shader["source"] == FRAGMENT_SOURCE


def test_import_rejects_vertex_shader_content_with_meaningful_error(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/shaders/import", files=[upload_file("pass.vert", VERTEX_SOURCE.encode())]
    )

    assert response.status_code == 422
    assert "vertex" in response.json()["detail"].lower()


def test_import_rejects_binary_content_with_meaningful_error(client: TestClient) -> None:
    response = client.post(
        "/api/shaders/import",
        files=[upload_file("broken.glsl", b"\xff\xfe\x00\x01binary")],
    )

    assert response.status_code == 422
    assert "text" in response.json()["detail"].lower()


def test_import_with_empty_name_falls_back_to_the_filename_stem(
    client: TestClient,
) -> None:
    response = client.post(
        "/api/shaders/import",
        files=[("file", ("wash.glsl", FRAGMENT_SOURCE.encode(), "text/plain"))],
        data={"name": ""},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "wash"


def test_list_returns_imported_definitions_newest_first(client: TestClient) -> None:
    first = import_shader(client, filename="first.glsl")
    second = import_shader(client, filename="second.glsl")

    body = client.get("/api/shaders").json()

    assert [shader["id"] for shader in body[:2]] == [second["id"], first["id"]]


def test_list_includes_the_seeded_builtins(client: TestClient) -> None:
    body = client.get("/api/shaders").json()

    builtins = {shader["name"] for shader in body if shader["is_builtin"]}

    assert builtins == {"Grayscale", "Sepia", "Glow", "Blur", "Gradient"}


def test_detail_returns_full_definition(client: TestClient) -> None:
    created = import_shader(client)

    response = client.get(f"/api/shaders/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_detail_unknown_id_returns_meaningful_error(client: TestClient) -> None:
    response = client.get("/api/shaders/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_rename_via_put_updates_name_and_bumps_updated_at(client: TestClient) -> None:
    created = import_shader(client)

    response = client.put(f"/api/shaders/{created['id']}", json={"name": "New Name"})

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "New Name"
    assert body["id"] == created["id"]
    assert body["source"] == FRAGMENT_SOURCE
    assert body["updated_at"] >= body["created_at"]


def test_rename_unknown_id_returns_meaningful_error(client: TestClient) -> None:
    response = client.put("/api/shaders/ghost", json={"name": "Renamed"})

    assert response.status_code == 404
    assert "shader ghost not found" in response.json()["detail"]


def test_rename_with_empty_name_is_rejected(client: TestClient) -> None:
    created = import_shader(client)

    response = client.put(f"/api/shaders/{created['id']}", json={"name": ""})

    assert response.status_code == 422


def test_duplicate_copies_definition_under_a_new_id(client: TestClient) -> None:
    source = import_shader(
        client,
        name="Ink Wash",
        description="Hand drawn look",
        tags=["art"],
    )

    response = client.post(
        "/api/shaders/duplicate",
        json={"name": "Ink Wash Copy", "source_id": source["id"]},
    )

    assert response.status_code == 200
    duplicate = response.json()
    assert duplicate["id"] != source["id"]
    assert duplicate["name"] == "Ink Wash Copy"
    assert duplicate["description"] == source["description"]
    assert duplicate["tags"] == source["tags"]
    assert duplicate["source"] == source["source"]
    assert duplicate["is_builtin"] is False


def test_duplicate_unknown_source_returns_meaningful_error(client: TestClient) -> None:
    response = client.post("/api/shaders/duplicate", json={"name": "Copy", "source_id": "ghost"})

    assert response.status_code == 404
    assert "shader ghost not found" in response.json()["detail"]


def test_duplicate_with_empty_name_returns_invalid_payload_error(
    client: TestClient,
) -> None:
    source = import_shader(client)

    response = client.post("/api/shaders/duplicate", json={"name": "", "source_id": source["id"]})

    assert response.status_code == 422


def test_reupload_replaces_the_source_and_preserves_the_id(client: TestClient) -> None:
    created = import_shader(client)
    replacement = FRAGMENT_SOURCE.replace(
        "fragColor = color;", "fragColor = vec4(1.0 - color.rgb, color.a);"
    )

    response = client.put(
        f"/api/shaders/{created['id']}/source",
        files=[upload_file("wash.glsl", replacement.encode())],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == created["id"]
    assert body["name"] == created["name"]
    assert body["source"] == replacement
    assert client.get(f"/api/shaders/{created['id']}").json()["source"] == replacement


def test_reupload_unknown_id_returns_meaningful_error(client: TestClient) -> None:
    response = client.put(
        "/api/shaders/ghost/source",
        files=[upload_file("wash.glsl", FRAGMENT_SOURCE.encode())],
    )

    assert response.status_code == 404
    assert "shader ghost not found" in response.json()["detail"]


def test_reupload_rejects_vertex_shader_content(client: TestClient) -> None:
    created = import_shader(client)

    response = client.put(
        f"/api/shaders/{created['id']}/source",
        files=[upload_file("pass.vert", VERTEX_SOURCE.encode())],
    )

    assert response.status_code == 422
    assert "vertex" in response.json()["detail"].lower()
    assert client.get(f"/api/shaders/{created['id']}").json()["source"] == FRAGMENT_SOURCE


def test_delete_removes_the_definition(client: TestClient) -> None:
    created = import_shader(client)

    response = client.delete(f"/api/shaders/{created['id']}")

    assert response.status_code == 204
    assert client.get(f"/api/shaders/{created['id']}").status_code == 404


def test_delete_unknown_id_returns_meaningful_error(client: TestClient) -> None:
    response = client.delete("/api/shaders/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_delete_never_refuses_for_any_user_definition(client: TestClient) -> None:
    created = import_shader(client)
    client.post("/api/shaders/duplicate", json={"name": "Copy", "source_id": created["id"]})

    response = client.delete(f"/api/shaders/{created['id']}")

    assert response.status_code == 204


def test_delete_builtin_returns_meaningful_error(client: TestClient) -> None:
    response = client.delete(f"/api/shaders/{BUILTIN_ID}")

    assert response.status_code == 409
    assert "built-in" in response.json()["detail"].lower()
    assert client.get(f"/api/shaders/{BUILTIN_ID}").status_code == 200


def test_builtins_can_still_be_renamed_and_updated(client: TestClient) -> None:
    response = client.put(f"/api/shaders/{BUILTIN_ID}", json={"name": "Gray"})

    assert response.status_code == 200
    assert response.json()["name"] == "Gray"


def test_definitions_survive_restart(settings: Settings) -> None:
    first = TestClient(AppFactory(settings).create())
    created = import_shader(
        first,
        name="Ink Wash",
        description="Hand drawn look",
        tags=["art"],
    )

    second = AppFactory(settings).create()
    database = second.state.database

    with database.session() as session:
        stored = session.get(ShaderDefinition, created["id"])

    assert stored is not None
    assert stored.name == "Ink Wash"
    assert stored.description == "Hand drawn look"
    assert stored.tags == ["art"]
    assert stored.source == FRAGMENT_SOURCE
    assert stored.is_builtin is False
    assert stored.created_at is not None
    assert stored.updated_at is not None
