from typing import cast

from fastapi.testclient import TestClient

from app.app_factory import AppFactory
from app.clips.model import BUILTIN_CLIP_NAMES, ClipDefinition
from app.config import Settings


def create_clip(
    client: TestClient,
    clip_id: str = "clip-001",
    name: str = "Fade In",
    duration: float = 2.0,
    **overrides: object,
) -> dict[str, object]:
    body: dict[str, object] = {
        "id": clip_id,
        "name": name,
        "duration": duration,
        **overrides,
    }
    response = client.post("/api/clips/library", json=body)
    assert response.status_code == 200
    return cast(dict[str, object], response.json())


def test_create_clip_with_minimal_fields(client: TestClient) -> None:
    clip = create_clip(client)

    assert clip["id"] == "clip-001"
    assert clip["name"] == "Fade In"
    assert clip["duration"] == 2.0
    assert clip["category"] is None
    assert clip["params"] == []
    assert clip["channels"] == []
    assert clip["channelAnimations"] is None
    assert clip["created_at"]
    assert clip["updated_at"]


def test_create_clip_with_all_fields(client: TestClient) -> None:
    clip = create_clip(
        client,
        clip_id="custom-id",
        name="Scale Bounce",
        duration=3.5,
        category="motion",
        params=[
            {"key": "amplitude", "label": "Amplitude", "kind": "number", "default": 1.0},
        ],
        channels=[
            {"property": "scaleX", "paramKey": "amplitude", "linkMode": "multiply"},
        ],
        channel_animations={"scaleX": {"keyframes": []}},
    )

    assert clip["id"] == "custom-id"
    assert clip["name"] == "Scale Bounce"
    assert clip["duration"] == 3.5
    assert clip["category"] == "motion"
    assert clip["params"] == [
        {"key": "amplitude", "label": "Amplitude", "kind": "number", "default": 1.0},
    ]
    assert clip["channels"] == [
        {"property": "scaleX", "paramKey": "amplitude", "linkMode": "multiply"},
    ]
    assert clip["channelAnimations"] == {"scaleX": {"keyframes": []}}


def test_create_duplicate_clip_id_returns_conflict(client: TestClient) -> None:
    create_clip(client, clip_id="dup-id")

    response = client.post(
        "/api/clips/library",
        json={"id": "dup-id", "name": "Another", "duration": 1.0},
    )

    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_create_with_empty_name_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/clips/library",
        json={"id": "x", "name": "", "duration": 1.0},
    )

    assert response.status_code == 422


def test_create_with_negative_duration_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/clips/library",
        json={"id": "x", "name": "Bad", "duration": -1.0},
    )

    assert response.status_code == 422


def test_list_returns_all_library_clips_newest_first(client: TestClient) -> None:
    first = create_clip(client, clip_id="c1", name="First")
    second = create_clip(client, clip_id="c2", name="Second")

    body = client.get("/api/clips/library").json()
    listed_ids = [clip["id"] for clip in body]

    assert listed_ids[0] == second["id"]
    assert listed_ids[1] == first["id"]
    assert len(listed_ids) == 2 + len(BUILTIN_CLIP_NAMES)


def test_list_empty_library(client: TestClient) -> None:
    body = client.get("/api/clips/library").json()
    assert len(body) == len(BUILTIN_CLIP_NAMES)


def test_detail_returns_full_definition(client: TestClient) -> None:
    created = create_clip(client, clip_id="detail-test", name="Zoom")

    response = client.get("/api/clips/library/detail-test")

    assert response.status_code == 200
    assert response.json() == created


def test_detail_unknown_id_returns_not_found(client: TestClient) -> None:
    response = client.get("/api/clips/library/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


def test_update_name_via_put(client: TestClient) -> None:
    created = create_clip(client, clip_id="upd-1", name="Old Name")

    response = client.put(
        "/api/clips/library/upd-1",
        json={"name": "New Name"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "New Name"
    assert body["id"] == created["id"]
    assert body["updated_at"] >= body["created_at"]


def test_update_duration(client: TestClient) -> None:
    create_clip(client, clip_id="upd-dur", name="Fast", duration=1.0)

    response = client.put(
        "/api/clips/library/upd-dur",
        json={"duration": 5.0},
    )

    assert response.status_code == 200
    assert response.json()["duration"] == 5.0


def test_update_multiple_fields(client: TestClient) -> None:
    create_clip(client, clip_id="upd-multi", name="Orig", duration=2.0)

    response = client.put(
        "/api/clips/library/upd-multi",
        json={
            "name": "Updated",
            "duration": 4.0,
            "category": "transition",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Updated"
    assert body["duration"] == 4.0
    assert body["category"] == "transition"


def test_update_params_replaces_full_list(client: TestClient) -> None:
    create_clip(
        client,
        clip_id="upd-params",
        name="With Params",
        duration=1.0,
        params=[
            {"key": "a", "label": "A", "kind": "number", "default": 1.0},
        ],
    )

    response = client.put(
        "/api/clips/library/upd-params",
        json={
            "params": [
                {"key": "b", "label": "B", "kind": "number", "default": 2.0},
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["params"] == [
        {"key": "b", "label": "B", "kind": "number", "default": 2.0},
    ]


def test_update_channels_replaces_full_list(client: TestClient) -> None:
    create_clip(
        client,
        clip_id="upd-channels",
        name="With Channels",
        duration=1.0,
        channels=[
            {"property": "x", "paramKey": "a"},
        ],
    )

    response = client.put(
        "/api/clips/library/upd-channels",
        json={
            "channels": [
                {"property": "y"},
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    channels = body["channels"]
    assert len(channels) == 1
    assert channels[0]["property"] == "y"


def test_update_unknown_id_returns_not_found(client: TestClient) -> None:
    response = client.put(
        "/api/clips/library/ghost",
        json={"name": "Nope"},
    )

    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


def test_update_with_no_fields_is_rejected(client: TestClient) -> None:
    created = create_clip(client, clip_id="upd-empty", name="X")

    response = client.put(f"/api/clips/library/{created['id']}", json={})

    assert response.status_code == 422


def test_update_with_empty_name_is_rejected(client: TestClient) -> None:
    created = create_clip(client, clip_id="upd-bad-name", name="X")

    response = client.put(
        f"/api/clips/library/{created['id']}",
        json={"name": ""},
    )

    assert response.status_code == 422


def test_update_with_negative_duration_is_rejected(client: TestClient) -> None:
    created = create_clip(client, clip_id="upd-bad-dur", name="X")

    response = client.put(
        f"/api/clips/library/{created['id']}",
        json={"duration": -1.0},
    )

    assert response.status_code == 422


def test_delete_removes_the_clip(client: TestClient) -> None:
    create_clip(client, clip_id="del-1", name="ToDelete")

    response = client.delete("/api/clips/library/del-1")

    assert response.status_code == 204
    assert client.get("/api/clips/library/del-1").status_code == 404


def test_delete_unknown_id_returns_not_found(client: TestClient) -> None:
    response = client.delete("/api/clips/library/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


def test_id_is_stable_across_create_read_update(client: TestClient) -> None:
    clip_id = "stable-id-123"
    create_clip(client, clip_id=clip_id, name="V1")

    read_response = client.get(f"/api/clips/library/{clip_id}")
    assert read_response.json()["id"] == clip_id

    updated = client.put(f"/api/clips/library/{clip_id}", json={"name": "V2"})
    assert updated.json()["id"] == clip_id

    read_again = client.get(f"/api/clips/library/{clip_id}")
    assert read_again.json()["id"] == clip_id


def test_definitions_survive_restart(settings: Settings) -> None:
    first = TestClient(AppFactory(settings).create())
    create_clip(
        first,
        clip_id="restart-clip",
        name="Persistent",
        duration=3.0,
        category="test",
        params=[
            {"key": "speed", "label": "Speed", "kind": "number", "default": 1.5},
        ],
        channels=[
            {"property": "opacity", "paramKey": "speed"},
        ],
    )

    second = AppFactory(settings).create()
    database = second.state.database
    with database.session() as session:
        stored = session.get(ClipDefinition, "restart-clip")

    assert stored is not None
    assert stored.name == "Persistent"
    assert stored.duration == 3.0
    assert stored.category == "test"
    assert stored.params == [
        {"key": "speed", "label": "Speed", "kind": "number", "default": 1.5},
    ]
    assert stored.channels == [
        {"property": "opacity", "paramKey": "speed"},
    ]
    assert stored.created_at is not None
    assert stored.updated_at is not None
