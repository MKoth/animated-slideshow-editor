from typing import Any, cast

from fastapi.testclient import TestClient

from .test_assets import png_bytes, upload_file


def create_folder(client: TestClient, name: str, parent_id: str | None = None) -> dict[str, Any]:
    payload: dict[str, object] = {"name": name}
    if parent_id is not None:
        payload["parent_id"] = parent_id
    response = client.post("/api/assets/folders", json=payload)
    assert response.status_code == 201, response.text
    return cast(dict[str, Any], response.json())


def upload_to(client: TestClient, filename: str, folder_id: str | None = None) -> dict[str, Any]:
    files = [upload_file(filename, png_bytes(), "image/png")]
    data: dict[str, str] = {}
    if folder_id is not None:
        data = {"folder_id": folder_id}
    response = client.post("/api/assets", files=files, data=data)
    assert response.status_code == 200, response.text
    return cast(dict[str, Any], response.json()["created"][0])


def test_create_and_list_folders(client: TestClient) -> None:
    assert client.get("/api/assets/folders").json() == []
    root = create_folder(client, "Characters")
    child = create_folder(client, "Heroes", root["id"])
    assert child["parent_id"] == root["id"]
    body = client.get("/api/assets/folders").json()
    assert {f["name"] for f in body} == {"Characters", "Heroes"}


def test_duplicate_name_blocked_within_same_parent_but_allowed_across_parents(
    client: TestClient,
) -> None:
    root = create_folder(client, "A")
    other = create_folder(client, "B")
    create_folder(client, "Shared", root["id"])
    dup = client.post("/api/assets/folders", json={"name": "shared", "parent_id": root["id"]})
    assert dup.status_code == 409
    ok = client.post("/api/assets/folders", json={"name": "Shared", "parent_id": other["id"]})
    assert ok.status_code == 201
    dup_root = client.post("/api/assets/folders", json={"name": "A"})
    assert dup_root.status_code == 409


def test_create_folder_validation(client: TestClient) -> None:
    assert client.post("/api/assets/folders", json={"name": "   "}).status_code == 422
    assert (
        client.post("/api/assets/folders", json={"name": "ok", "parent_id": "missing"}).status_code
        == 404
    )
    assert client.post("/api/assets/folders", json={"name": "a/b"}).status_code == 422


def test_rename_folder_and_conflict(client: TestClient) -> None:
    first = create_folder(client, "First")
    create_folder(client, "Second")
    renamed = client.patch(f"/api/assets/folders/{first['id']}", json={"name": "Heroes"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Heroes"
    conflict = client.patch(f"/api/assets/folders/{first['id']}", json={"name": "Second"})
    assert conflict.status_code == 409


def test_move_folder_rejects_cycles(client: TestClient) -> None:
    root = create_folder(client, "Root")
    child = create_folder(client, "Child", root["id"])
    grandchild = create_folder(client, "Grand", child["id"])
    # Into own descendant
    bad = client.patch(f"/api/assets/folders/{root['id']}", json={"parent_id": grandchild["id"]})
    assert bad.status_code == 422
    # Into itself
    self_move = client.patch(f"/api/assets/folders/{child['id']}", json={"parent_id": child["id"]})
    assert self_move.status_code == 422
    # Unknown parent
    missing = client.patch(f"/api/assets/folders/{child['id']}", json={"parent_id": "nope"})
    assert missing.status_code == 404
    # Valid move to root
    ok = client.patch(f"/api/assets/folders/{child['id']}", json={"parent_id": None})
    assert ok.status_code == 200
    assert ok.json()["parent_id"] is None


def test_upload_into_folder_and_filter_listing(client: TestClient) -> None:
    folder = create_folder(client, "Set")
    in_folder = upload_to(client, "fox.png", folder["id"])
    assert in_folder["folder_id"] == folder["id"]
    root_asset = upload_to(client, "bird.png")
    assert root_asset["folder_id"] is None

    scoped = client.get("/api/assets", params={"folder_id": folder["id"]}).json()
    assert [d["id"] for d in scoped] == [in_folder["id"]]
    root_scoped = client.get("/api/assets", params={"folder_id": "root"}).json()
    assert [d["id"] for d in root_scoped] == [root_asset["id"]]
    # Global (no filter) returns both
    assert len(client.get("/api/assets").json()) == 2
    # Search scopes with the folder filter
    searched = client.get("/api/assets", params={"folder_id": folder["id"], "search": "fox"}).json()
    assert [d["id"] for d in searched] == [in_folder["id"]]


def test_upload_to_unknown_folder_returns_404(client: TestClient) -> None:
    response = client.post(
        "/api/assets",
        files=[upload_file("fox.png", png_bytes(), "image/png")],
        data={"folder_id": "missing"},
    )
    assert response.status_code == 404


def test_move_asset_between_folders(client: TestClient) -> None:
    folder = create_folder(client, "Set")
    asset = upload_to(client, "fox.png")
    moved = client.patch(f"/api/assets/{asset['id']}", json={"folder_id": folder["id"]})
    assert moved.status_code == 200
    assert moved.json()["folder_id"] == folder["id"]
    back = client.patch(f"/api/assets/{asset['id']}", json={"folder_id": None})
    assert back.status_code == 200
    assert back.json()["folder_id"] is None
    assert client.patch(f"/api/assets/{asset['id']}", json={"folder_id": "nope"}).status_code == 404
    assert client.patch("/api/assets/missing", json={"folder_id": None}).status_code == 404


def test_delete_folder_moves_contents_to_parent(client: TestClient) -> None:
    root = create_folder(client, "Root")
    child = create_folder(client, "Child", root["id"])
    asset = upload_to(client, "fox.png", child["id"])
    grandchild = create_folder(client, "Grand", child["id"])

    assert client.delete(f"/api/assets/folders/{child['id']}").status_code == 204

    detail = client.get(f"/api/assets/{asset['id']}").json()
    assert detail["folder_id"] == root["id"]
    moved_folder = client.get(f"/api/assets/folders/{grandchild['id']}").json()
    assert moved_folder["parent_id"] == root["id"]
    assert client.get(f"/api/assets/folders/{child['id']}").status_code == 404


def test_delete_root_folder_moves_contents_to_root(client: TestClient) -> None:
    root = create_folder(client, "Root")
    asset = upload_to(client, "fox.png", root["id"])
    assert client.delete(f"/api/assets/folders/{root['id']}").status_code == 204
    assert client.get(f"/api/assets/{asset['id']}").json()["folder_id"] is None


def test_delete_unknown_folder_returns_404(client: TestClient) -> None:
    assert client.delete("/api/assets/folders/missing").status_code == 404


def test_legacy_assets_expose_null_folder_id(client: TestClient) -> None:
    asset = upload_to(client, "fox.png")
    assert asset["folder_id"] is None
