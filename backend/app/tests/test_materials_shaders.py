"""Material↔shader wiring: assign/remove, uniform append/drop, defaults propagation."""

from typing import Any

from fastapi.testclient import TestClient

from app.materials.model import DEFAULT_MATERIAL_ID

BUILTIN_PARAMETERS = [
    {"key": "tint", "kind": "color", "default": "#ffffff"},
    {"key": "opacityMultiplier", "kind": "number", "default": 1.0},
]

UNIFORM_GLSL = """#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float uIntensity;
uniform vec3 uColor;
uniform bool uEnabled;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  color.rgb = mix(color.rgb, uColor, uIntensity * (uEnabled ? 1.0 : 0.0));
  fragColor = color;
}
"""


def import_shader(client: TestClient, name: str, source: str = UNIFORM_GLSL) -> Any:
    response = client.post(
        "/api/shaders/import",
        files={"file": (f"{name}.glsl", source.encode(), "application/octet-stream")},
        data={"name": name},
    )
    assert response.status_code == 200
    return response.json()


def create_material(client: TestClient, name: str) -> Any:
    response = client.post("/api/materials", json={"name": name})
    assert response.status_code == 200
    return response.json()


def set_uniforms(client: TestClient, shader_id: str, uniforms: list[dict[str, Any]]) -> Any:
    response = client.put(f"/api/shaders/{shader_id}/uniforms", json={"default_uniforms": uniforms})
    assert response.status_code == 200
    return response.json()


def test_material_without_shader_keeps_only_builtin_parameters(client: TestClient) -> None:
    material = create_material(client, "Plain")

    assert material["shader_id"] is None
    assert material["parameters"] == BUILTIN_PARAMETERS


def test_assigning_a_shader_appends_reflected_uniforms_to_the_parameter_list(
    client: TestClient,
) -> None:
    shader = import_shader(client, "Tint Mix")
    set_uniforms(
        client,
        shader["id"],
        [
            {"key": "uIntensity", "kind": "float", "default": 0.5},
            {"key": "uColor", "kind": "vec3", "default": [1.0, 0.0, 0.0]},
            {"key": "uEnabled", "kind": "bool", "default": True},
        ],
    )
    material = create_material(client, "Tinted")

    response = client.put(
        f"/api/materials/{material['id']}/shader", json={"shader_id": shader["id"]}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["shader_id"] == shader["id"]
    assert body["parameters"] == BUILTIN_PARAMETERS + [
        {"key": "uIntensity", "kind": "float", "default": 0.5},
        {"key": "uColor", "kind": "vec3", "default": [1.0, 0.0, 0.0]},
        {"key": "uEnabled", "kind": "bool", "default": True},
    ]


def test_assigning_again_replaces_the_reference_and_the_uniforms(client: TestClient) -> None:
    first = import_shader(client, "First")
    set_uniforms(client, first["id"], [{"key": "uAlpha", "kind": "float", "default": 0.25}])
    second = import_shader(client, "Second")
    set_uniforms(client, second["id"], [{"key": "uRadius", "kind": "float", "default": 4.0}])
    material = create_material(client, "Switchable")
    client.put(f"/api/materials/{material['id']}/shader", json={"shader_id": first["id"]})

    response = client.put(
        f"/api/materials/{material['id']}/shader", json={"shader_id": second["id"]}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["shader_id"] == second["id"]
    assert body["parameters"] == BUILTIN_PARAMETERS + [
        {"key": "uRadius", "kind": "float", "default": 4.0}
    ]


def test_removing_a_shader_drops_the_uniforms_and_keeps_builtins(client: TestClient) -> None:
    shader = import_shader(client, "Tint Mix")
    set_uniforms(client, shader["id"], [{"key": "uIntensity", "kind": "float", "default": 0.5}])
    material = create_material(client, "Tinted")
    client.put(f"/api/materials/{material['id']}/shader", json={"shader_id": shader["id"]})

    response = client.put(f"/api/materials/{material['id']}/shader", json={"shader_id": None})

    assert response.status_code == 200
    body = response.json()
    assert body["shader_id"] is None
    assert body["parameters"] == BUILTIN_PARAMETERS


def test_removing_a_shader_preserves_edited_builtin_defaults(client: TestClient) -> None:
    shader = import_shader(client, "Tint Mix")
    set_uniforms(client, shader["id"], [{"key": "uIntensity", "kind": "float", "default": 0.5}])
    material = create_material(client, "Tinted")
    client.put(f"/api/materials/{material['id']}/shader", json={"shader_id": shader["id"]})
    client.put(
        f"/api/materials/{material['id']}",
        json={"parameters": [{"key": "tint", "kind": "color", "default": "#00ff00"}]},
    )

    response = client.put(f"/api/materials/{material['id']}/shader", json={"shader_id": None})

    assert response.json()["parameters"] == [
        {"key": "tint", "kind": "color", "default": "#00ff00"},
        {"key": "opacityMultiplier", "kind": "number", "default": 1.0},
    ]


def test_assigning_an_unknown_shader_is_rejected(client: TestClient) -> None:
    material = create_material(client, "Tinted")

    response = client.put(f"/api/materials/{material['id']}/shader", json={"shader_id": "ghost"})

    assert response.status_code == 404
    assert "shader ghost not found" in response.json()["detail"]


def test_assigning_a_shader_to_an_unknown_material_is_rejected(client: TestClient) -> None:
    shader = import_shader(client, "Tint Mix")

    response = client.put("/api/materials/ghost/shader", json={"shader_id": shader["id"]})

    assert response.status_code == 404
    assert "material ghost not found" in response.json()["detail"]


def test_assigning_the_default_material_a_shader_is_allowed(client: TestClient) -> None:
    shader = import_shader(client, "Tint Mix")

    response = client.put(
        f"/api/materials/{DEFAULT_MATERIAL_ID}/shader", json={"shader_id": shader["id"]}
    )

    assert response.status_code == 200
    assert response.json()["shader_id"] == shader["id"]


def test_uniform_defaults_flow_into_referencing_materials(client: TestClient) -> None:
    shader = import_shader(client, "Tint Mix")
    set_uniforms(client, shader["id"], [{"key": "uIntensity", "kind": "float", "default": 0.5}])
    material = create_material(client, "Tinted")
    client.put(f"/api/materials/{material['id']}/shader", json={"shader_id": shader["id"]})
    unrelated = create_material(client, "Plain")

    updated = set_uniforms(
        client, shader["id"], [{"key": "uIntensity", "kind": "float", "default": 0.9}]
    )

    assert updated["default_uniforms"] == [{"key": "uIntensity", "kind": "float", "default": 0.9}]
    referencing = client.get(f"/api/materials/{material['id']}").json()
    assert referencing["parameters"] == BUILTIN_PARAMETERS + [
        {"key": "uIntensity", "kind": "float", "default": 0.9}
    ]
    untouched = client.get(f"/api/materials/{unrelated['id']}").json()
    assert untouched["parameters"] == BUILTIN_PARAMETERS
    assert untouched["shader_id"] is None


def test_uniform_defaults_update_rewrites_the_uniform_set(client: TestClient) -> None:
    shader = import_shader(client, "Tint Mix")
    set_uniforms(client, shader["id"], [{"key": "uAlpha", "kind": "float", "default": 0.25}])
    material = create_material(client, "Tinted")
    client.put(f"/api/materials/{material['id']}/shader", json={"shader_id": shader["id"]})

    set_uniforms(client, shader["id"], [{"key": "uRadius", "kind": "float", "default": 4.0}])

    body = client.get(f"/api/materials/{material['id']}").json()
    assert body["parameters"] == BUILTIN_PARAMETERS + [
        {"key": "uRadius", "kind": "float", "default": 4.0}
    ]


def test_uniform_defaults_update_preserves_edited_builtin_defaults(client: TestClient) -> None:
    shader = import_shader(client, "Tint Mix")
    set_uniforms(client, shader["id"], [{"key": "uIntensity", "kind": "float", "default": 0.5}])
    material = create_material(client, "Tinted")
    client.put(f"/api/materials/{material['id']}/shader", json={"shader_id": shader["id"]})
    client.put(
        f"/api/materials/{material['id']}",
        json={"parameters": [{"key": "opacityMultiplier", "kind": "number", "default": 0.7}]},
    )

    set_uniforms(client, shader["id"], [{"key": "uIntensity", "kind": "float", "default": 0.9}])

    body = client.get(f"/api/materials/{material['id']}").json()
    assert body["parameters"] == [
        {"key": "tint", "kind": "color", "default": "#ffffff"},
        {"key": "opacityMultiplier", "kind": "number", "default": 0.7},
        {"key": "uIntensity", "kind": "float", "default": 0.9},
    ]


def test_supported_uniform_kinds_round_trip(client: TestClient) -> None:
    shader = import_shader(client, "Kinds")
    uniforms: list[dict[str, Any]] = [
        {"key": "uFloat", "kind": "float", "default": 0.1},
        {"key": "uInt", "kind": "int", "default": 3},
        {"key": "uBool", "kind": "bool", "default": False},
        {"key": "uVec2", "kind": "vec2", "default": [1.0, 2.0]},
        {"key": "uVec4", "kind": "vec4", "default": [0.0, 0.5, 0.5, 1.0]},
        {"key": "uSampler", "kind": "sampler2D", "default": ""},
    ]
    set_uniforms(client, shader["id"], uniforms)
    material = create_material(client, "Kinds Material")

    response = client.put(
        f"/api/materials/{material['id']}/shader", json={"shader_id": shader["id"]}
    )

    assert response.status_code == 200
    assert response.json()["parameters"] == BUILTIN_PARAMETERS + uniforms


def test_uniform_defaults_update_rejects_reserved_keys(client: TestClient) -> None:
    shader = import_shader(client, "Tint Mix")

    for key in ("uTexture", "tint", "opacityMultiplier"):
        response = client.put(
            f"/api/shaders/{shader['id']}/uniforms",
            json={"default_uniforms": [{"key": key, "kind": "float", "default": 1.0}]},
        )

        assert response.status_code == 422


def test_uniform_defaults_update_rejects_duplicate_and_bad_defaults(client: TestClient) -> None:
    shader = import_shader(client, "Tint Mix")

    duplicate = client.put(
        f"/api/shaders/{shader['id']}/uniforms",
        json={
            "default_uniforms": [
                {"key": "uA", "kind": "float", "default": 1.0},
                {"key": "uA", "kind": "float", "default": 2.0},
            ]
        },
    )
    assert duplicate.status_code == 422

    wrong_kind = client.put(
        f"/api/shaders/{shader['id']}/uniforms",
        json={"default_uniforms": [{"key": "uA", "kind": "color", "default": "#ffffff"}]},
    )
    assert wrong_kind.status_code == 422

    bad_default = client.put(
        f"/api/shaders/{shader['id']}/uniforms",
        json={"default_uniforms": [{"key": "uVec", "kind": "vec3", "default": [1.0, 2.0]}]},
    )
    assert bad_default.status_code == 422


def test_shader_id_survives_backend_restart(client: TestClient) -> None:
    shader = import_shader(client, "Tint Mix")
    set_uniforms(client, shader["id"], [{"key": "uIntensity", "kind": "float", "default": 0.5}])
    material = create_material(client, "Tinted")
    client.put(f"/api/materials/{material['id']}/shader", json={"shader_id": shader["id"]})

    body = client.get(f"/api/materials/{material['id']}").json()

    assert body["shader_id"] == shader["id"]
    assert body["parameters"] == BUILTIN_PARAMETERS + [
        {"key": "uIntensity", "kind": "float", "default": 0.5}
    ]


def test_materials_with_missing_shader_reference_render_unaffected_by_uniform_updates(
    client: TestClient,
) -> None:
    shader = import_shader(client, "Tint Mix")
    set_uniforms(client, shader["id"], [{"key": "uIntensity", "kind": "float", "default": 0.5}])
    material = create_material(client, "Tinted")
    client.put(f"/api/materials/{material['id']}/shader", json={"shader_id": shader["id"]})

    set_uniforms(client, shader["id"], [])

    body = client.get(f"/api/materials/{material['id']}").json()
    assert body["shader_id"] == shader["id"]
    assert body["parameters"] == BUILTIN_PARAMETERS
