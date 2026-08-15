from typing import cast

from fastapi.testclient import TestClient

from app.app_factory import AppFactory
from app.config import Settings
from app.materials.model import DEFAULT_MATERIAL_ID, MaterialDefinition

BUILTIN_PARAMETERS = [
    {"key": "tint", "kind": "color", "default": "#ffffff"},
    {"key": "opacityMultiplier", "kind": "number", "default": 1.0},
]


def create_material(
    client: TestClient, name: str = "Red Slime", **overrides: object
) -> dict[str, object]:
    body: dict[str, object] = {"name": name, **overrides}
    response = client.post("/api/materials", json=body)
    assert response.status_code == 200
    return cast(dict[str, object], response.json())


def test_create_from_defaults_carries_built_in_parameters(client: TestClient) -> None:
    material = create_material(client, "Red Slime")

    assert material["id"]
    assert material["name"] == "Red Slime"
    assert material["description"] == ""
    assert material["tags"] == []
    assert material["parameters"] == BUILTIN_PARAMETERS
    assert material["created_at"]
    assert material["updated_at"]
    assert str(material["updated_at"]) >= str(material["created_at"])


def test_create_accepts_description_tags_and_custom_parameters(client: TestClient) -> None:
    material = create_material(
        client,
        "Gold",
        description="Shiny",
        tags=["metal", "premium"],
        parameters=[
            {"key": "shininess", "kind": "number", "default": 0.8},
            {"key": "glowColor", "kind": "color", "default": "#ffaa00"},
        ],
    )

    assert material["description"] == "Shiny"
    assert material["tags"] == ["metal", "premium"]
    assert material["parameters"] == BUILTIN_PARAMETERS + [
        {"key": "shininess", "kind": "number", "default": 0.8},
        {"key": "glowColor", "kind": "color", "default": "#ffaa00"},
    ]


def test_create_honors_custom_built_in_defaults(client: TestClient) -> None:
    material = create_material(
        client,
        "Tinted",
        parameters=[
            {"key": "tint", "kind": "color", "default": "#ff0000"},
            {"key": "opacityMultiplier", "kind": "number", "default": 0.5},
        ],
    )

    assert material["parameters"] == [
        {"key": "tint", "kind": "color", "default": "#ff0000"},
        {"key": "opacityMultiplier", "kind": "number", "default": 0.5},
    ]


def test_duplicate_copies_definition_under_a_new_id(client: TestClient) -> None:
    source = create_material(
        client,
        "Gold",
        description="Shiny",
        tags=["metal"],
        parameters=[
            {"key": "tint", "kind": "color", "default": "#ffaa00"},
            {"key": "shininess", "kind": "number", "default": 0.8},
        ],
    )

    duplicate = create_material(client, "Gold Copy", source_id=source["id"])

    assert duplicate["id"] != source["id"]
    assert duplicate["name"] == "Gold Copy"
    assert duplicate["description"] == source["description"]
    assert duplicate["tags"] == source["tags"]
    assert duplicate["parameters"] == source["parameters"]
    assert client.get(f"/api/materials/{source['id']}").json() == source


def test_duplicate_unknown_source_returns_meaningful_error(client: TestClient) -> None:
    response = client.post("/api/materials", json={"name": "Copy", "source_id": "ghost"})

    assert response.status_code == 404
    assert "material ghost not found" in response.json()["detail"]


def test_duplicate_with_empty_name_returns_invalid_payload_error(client: TestClient) -> None:
    source = create_material(client, "Gold")

    response = client.post("/api/materials", json={"name": "", "source_id": source["id"]})

    assert response.status_code == 422


def test_duplicate_with_extra_fields_is_rejected(client: TestClient) -> None:
    source = create_material(client, "Gold")

    response = client.post(
        "/api/materials",
        json={
            "name": "Copy",
            "source_id": source["id"],
            "parameters": [{"key": "tint", "kind": "color", "default": "#ff0000"}],
        },
    )

    assert response.status_code == 422
    assert "duplicate" in response.json()["detail"]


def test_list_returns_all_definitions_newest_first(client: TestClient) -> None:
    first = create_material(client, "First")
    second = create_material(client, "Second")

    body = client.get("/api/materials").json()

    listed = [material["id"] for material in body if material["id"] != DEFAULT_MATERIAL_ID]
    assert listed == [second["id"], first["id"]]


def test_detail_returns_full_definition(client: TestClient) -> None:
    created = create_material(client, "Gold")

    response = client.get(f"/api/materials/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_detail_unknown_id_returns_meaningful_error(client: TestClient) -> None:
    response = client.get("/api/materials/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_rename_via_put_updates_name_and_bumps_updated_at(client: TestClient) -> None:
    created = create_material(client, "Old Name")

    response = client.put(f"/api/materials/{created['id']}", json={"name": "New Name"})

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "New Name"
    assert body["id"] == created["id"]
    assert body["parameters"] == BUILTIN_PARAMETERS
    assert body["updated_at"] >= body["created_at"]


def test_update_defaults_including_tint_and_opacity(client: TestClient) -> None:
    created = create_material(client, "Gold")

    response = client.put(
        f"/api/materials/{created['id']}",
        json={
            "description": "Updated",
            "tags": ["new"],
            "parameters": [
                {"key": "tint", "kind": "color", "default": "#00ff00"},
                {"key": "opacityMultiplier", "kind": "number", "default": 0.75},
                {"key": "glowColor", "kind": "color", "default": "#0000ff"},
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["description"] == "Updated"
    assert body["tags"] == ["new"]
    assert body["parameters"] == [
        {"key": "tint", "kind": "color", "default": "#00ff00"},
        {"key": "opacityMultiplier", "kind": "number", "default": 0.75},
        {"key": "glowColor", "kind": "color", "default": "#0000ff"},
    ]


def test_update_ensures_built_ins_when_parameters_omit_them(client: TestClient) -> None:
    created = create_material(client, "Gold")

    response = client.put(
        f"/api/materials/{created['id']}",
        json={"parameters": [{"key": "extra", "kind": "number", "default": 2.0}]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["parameters"] == BUILTIN_PARAMETERS + [
        {"key": "extra", "kind": "number", "default": 2.0}
    ]


def test_update_unknown_id_returns_meaningful_error(client: TestClient) -> None:
    response = client.put("/api/materials/ghost", json={"name": "Renamed"})

    assert response.status_code == 404
    assert "material ghost not found" in response.json()["detail"]


def test_update_with_no_fields_is_rejected(client: TestClient) -> None:
    created = create_material(client, "Gold")

    response = client.put(f"/api/materials/{created['id']}", json={})

    assert response.status_code == 422


def test_create_with_empty_name_is_rejected(client: TestClient) -> None:
    response = client.post("/api/materials", json={"name": ""})

    assert response.status_code == 422


def test_create_with_unknown_parameter_kind_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/materials",
        json={"name": "Bad", "parameters": [{"key": "x", "kind": "vector", "default": 1.0}]},
    )

    assert response.status_code == 422


def test_create_with_duplicate_parameter_keys_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/materials",
        json={
            "name": "Bad",
            "parameters": [
                {"key": "x", "kind": "number", "default": 1.0},
                {"key": "x", "kind": "number", "default": 2.0},
            ],
        },
    )

    assert response.status_code == 422


def test_create_with_malformed_color_default_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/materials",
        json={"name": "Bad", "parameters": [{"key": "tint", "kind": "color", "default": "red"}]},
    )

    assert response.status_code == 422


def test_create_with_non_numeric_number_default_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/materials",
        json={
            "name": "Bad",
            "parameters": [{"key": "gain", "kind": "number", "default": "loud"}],
        },
    )

    assert response.status_code == 422


def test_create_with_out_of_range_opacity_multiplier_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/materials",
        json={
            "name": "Bad",
            "parameters": [{"key": "opacityMultiplier", "kind": "number", "default": 1.5}],
        },
    )

    assert response.status_code == 422


def test_built_in_kind_is_enforced_on_create(client: TestClient) -> None:
    response = client.post(
        "/api/materials",
        json={"name": "Bad", "parameters": [{"key": "tint", "kind": "number", "default": 1.0}]},
    )

    assert response.status_code == 422


def test_list_includes_the_seeded_default_material(client: TestClient) -> None:
    body = client.get("/api/materials").json()

    default = next(material for material in body if material["id"] == DEFAULT_MATERIAL_ID)

    assert default["name"] == "Default Material"
    assert default["parameters"] == BUILTIN_PARAMETERS


def test_delete_default_material_returns_meaningful_error(client: TestClient) -> None:
    response = client.delete(f"/api/materials/{DEFAULT_MATERIAL_ID}")

    assert response.status_code == 409
    assert "default" in response.json()["detail"].lower()
    assert client.get(f"/api/materials/{DEFAULT_MATERIAL_ID}").status_code == 200


def test_delete_removes_the_definition(client: TestClient) -> None:
    created = create_material(client, "Gold")

    response = client.delete(f"/api/materials/{created['id']}")

    assert response.status_code == 204
    assert client.get(f"/api/materials/{created['id']}").status_code == 404


def test_delete_unknown_id_returns_meaningful_error(client: TestClient) -> None:
    response = client.delete("/api/materials/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_delete_never_refuses_for_any_definition(client: TestClient) -> None:
    created = create_material(client, "Gold")
    client.post("/api/materials", json={"name": "Silver", "source_id": created["id"]})

    response = client.delete(f"/api/materials/{created['id']}")

    assert response.status_code == 204


def test_definitions_survive_restart(settings: Settings) -> None:
    first = TestClient(AppFactory(settings).create())
    created = create_material(
        first,
        "Gold",
        description="Shiny",
        tags=["metal"],
        parameters=[{"key": "tint", "kind": "color", "default": "#ffaa00"}],
    )

    second = AppFactory(settings).create()
    database = second.state.database
    with database.session() as session:
        stored = session.get(MaterialDefinition, created["id"])

    assert stored is not None
    assert stored.name == "Gold"
    assert stored.description == "Shiny"
    assert stored.tags == ["metal"]
    assert stored.parameters == [
        {"key": "tint", "kind": "color", "default": "#ffaa00"},
        {"key": "opacityMultiplier", "kind": "number", "default": 1.0},
    ]
    assert stored.created_at is not None
    assert stored.updated_at is not None
