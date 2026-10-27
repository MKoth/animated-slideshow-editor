import json
import time

from fastapi.testclient import TestClient
from httpx2 import Response

JSON = {"content-type": "application/json"}


def lesson_blob(project_id: str = "p-1", name: str = "Spanish Lesson", version: int = 2) -> str:
    return json.dumps(
        {
            "version": version,
            "project": {
                "id": project_id,
                "name": name,
                "description": "A lesson",
                "author": "Ana",
                "createdAt": "2026-01-01T00:00:00",
                "modifiedAt": "2026-01-01T00:00:00",
                "settings": {},
            },
            "slides": [],
        }
    )


def post_project(client: TestClient, blob: str, expected_status: int = 200) -> Response:
    response = client.post("/api/projects", content=blob, headers=JSON)
    assert response.status_code == expected_status
    return response


def test_post_creates_project_and_fetch_returns_the_blob(
    client: TestClient,
) -> None:
    blob = lesson_blob()
    created = post_project(client, blob)

    assert created.json()["id"] == "p-1"
    assert created.json()["name"] == "Spanish Lesson"

    fetched = client.get("/api/projects/p-1")
    assert fetched.status_code == 200
    assert fetched.text == blob


def test_post_response_returns_full_metadata(client: TestClient) -> None:
    created = post_project(client, lesson_blob()).json()

    assert set(created) == {
        "id",
        "name",
        "description",
        "author",
        "created",
        "lastModified",
        "version",
        "folder_id",
    }
    assert created["description"] == "A lesson"
    assert created["author"] == "Ana"
    assert created["version"] == 2
    assert created["created"].endswith("Z")
    assert created["lastModified"].endswith("Z")
    assert created["folder_id"] is None


def test_stored_blob_equals_posted_json_exactly(client: TestClient) -> None:
    blob = (
        '{\n  "version": 2,\n  "project": {\n    "id": "p-1",\n    "name": "X",\n'
        '    "description": "",\n    "author": ""\n  },\n  "slides": []\n}'
    )
    post_project(client, blob)

    fetched = client.get("/api/projects/p-1")

    assert fetched.text == blob


def test_list_returns_metadata_sorted_by_last_modified_newest_first(
    client: TestClient,
) -> None:
    post_project(client, lesson_blob("p-1", "First"))
    time.sleep(0.01)
    post_project(client, lesson_blob("p-2", "Second"))

    listing = client.get("/api/projects").json()

    assert [item["id"] for item in listing] == ["p-2", "p-1"]
    assert [item["name"] for item in listing] == ["Second", "First"]


def test_list_items_contain_only_id_name_and_last_modified(client: TestClient) -> None:
    post_project(client, lesson_blob())

    item = client.get("/api/projects").json()[0]

    assert set(item) == {"id", "name", "lastModified", "folder_id"}
    assert item["lastModified"].endswith("Z")
    assert item["folder_id"] is None


def test_re_posting_an_id_updates_the_row_and_reorders_the_list(
    client: TestClient,
) -> None:
    post_project(client, lesson_blob("p-1", "First"))
    time.sleep(0.01)
    post_project(client, lesson_blob("p-2", "Second"))
    time.sleep(0.01)
    post_project(client, lesson_blob("p-1", "First, edited"))

    listing = client.get("/api/projects").json()
    assert [item["id"] for item in listing] == ["p-1", "p-2"]
    assert listing[0]["name"] == "First, edited"
    assert client.get("/api/projects/p-1").text == lesson_blob("p-1", "First, edited")


def test_get_unknown_project_returns_meaningful_error(client: TestClient) -> None:
    response = client.get("/api/projects/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_delete_removes_the_project(client: TestClient) -> None:
    post_project(client, lesson_blob())

    response = client.delete("/api/projects/p-1")

    assert response.status_code == 204
    assert client.get("/api/projects/p-1").status_code == 404
    assert client.get("/api/projects").json() == []


def test_delete_does_not_affect_other_projects(client: TestClient) -> None:
    post_project(client, lesson_blob("p-1", "First"))
    post_project(client, lesson_blob("p-2", "Second"))

    client.delete("/api/projects/p-1")

    listing = client.get("/api/projects").json()
    assert [item["id"] for item in listing] == ["p-2"]


def test_delete_unknown_project_returns_meaningful_error(client: TestClient) -> None:
    response = client.delete("/api/projects/does-not-exist")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_download_serves_the_blob_as_a_lesson_attachment(client: TestClient) -> None:
    blob = lesson_blob(name="Spanish Lesson")
    post_project(client, blob)

    response = client.get("/api/projects/p-1/download")

    assert response.status_code == 200
    assert response.text == blob
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment")
    assert disposition.endswith('"Spanish-Lesson.lesson"')


def test_download_unknown_project_returns_meaningful_error(client: TestClient) -> None:
    response = client.get("/api/projects/does-not-exist/download")

    assert response.status_code == 404


def test_non_json_body_is_rejected(client: TestClient) -> None:
    post_project(client, "this is not json", expected_status=400)


def test_invalid_utf8_body_is_rejected(client: TestClient) -> None:
    response = client.post("/api/projects", content=b"\xff\xfe\x00", headers=JSON)

    assert response.status_code == 400


def test_unsupported_version_is_rejected(client: TestClient) -> None:
    post_project(client, lesson_blob(version=3), expected_status=400)


def test_missing_project_is_rejected(client: TestClient) -> None:
    blob = lesson_blob().replace('"project":', '"proj":')
    post_project(client, blob, expected_status=400)


def test_missing_required_fields_are_rejected(client: TestClient) -> None:
    blob = lesson_blob().replace('"name": "Spanish Lesson",', "")
    post_project(client, blob, expected_status=400)


def test_rejected_body_does_not_create_a_project(client: TestClient) -> None:
    client.post(
        "/api/projects",
        content=lesson_blob(version=3),
        headers=JSON,
    )

    assert client.get("/api/projects").json() == []


def _create_folder(client: TestClient, name: str = "Course") -> dict[str, object]:
    response = client.post("/api/project-folders", json={"name": name})
    assert response.status_code == 201, response.text
    payload = response.json()
    assert isinstance(payload, dict)
    return payload


def test_project_folders_crud_flat(client: TestClient) -> None:
    folder = _create_folder(client, "Course A")
    assert folder["name"] == "Course A"

    renamed = client.patch(f"/api/project-folders/{folder['id']}", json={"name": "Course B"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Course B"

    listing = client.get("/api/project-folders").json()
    assert [item["name"] for item in listing] == ["Course B"]

    deleted = client.delete(f"/api/project-folders/{folder['id']}")
    assert deleted.status_code == 204
    assert client.get("/api/project-folders").json() == []


def test_project_folder_names_are_unique_case_insensitive(client: TestClient) -> None:
    _create_folder(client, "Course")

    response = client.post("/api/project-folders", json={"name": "course"})
    assert response.status_code == 409


def test_project_folder_name_validation(client: TestClient) -> None:
    assert client.post("/api/project-folders", json={"name": "  "}).status_code == 422
    assert client.post("/api/project-folders", json={"name": "a/b"}).status_code == 422


def test_post_project_into_folder_and_move_to_root(client: TestClient) -> None:
    folder = _create_folder(client, "Course")
    folder_id = str(folder["id"])

    post_project(client, lesson_blob("p-1", "First"))
    response = client.post(
        "/api/projects?folder_id=" + folder_id,
        content=lesson_blob("p-2", "Second"),
        headers=JSON,
    )
    assert response.status_code == 200
    assert response.json()["folder_id"] == folder_id

    listing = {item["id"]: item for item in client.get("/api/projects").json()}
    assert listing["p-2"]["folder_id"] == folder_id
    assert listing["p-1"]["folder_id"] is None

    moved = client.patch("/api/projects/p-2", json={"folder_id": None})
    assert moved.status_code == 200
    assert moved.json()["folder_id"] is None

    assert client.patch("/api/projects/p-1", json={"folder_id": "missing"}).status_code == 404
    response = client.post(
        "/api/projects?folder_id=missing",
        content=lesson_blob("p-3", "Third"),
        headers=JSON,
    )
    assert response.status_code == 404


def test_re_post_preserves_folder_when_no_query(client: TestClient) -> None:
    folder = _create_folder(client, "Course")
    folder_id = str(folder["id"])
    client.post(
        "/api/projects?folder_id=" + folder_id,
        content=lesson_blob("p-1", "First"),
        headers=JSON,
    )

    response = client.post(
        "/api/projects", content=lesson_blob("p-1", "First, edited"), headers=JSON
    )
    assert response.status_code == 200
    assert response.json()["folder_id"] == folder_id


def test_delete_folder_moves_projects_to_root_by_default(client: TestClient) -> None:
    folder = _create_folder(client, "Course")
    folder_id = str(folder["id"])
    post_project(client, lesson_blob("p-1", "First"))
    client.post(
        "/api/projects?folder_id=" + folder_id,
        content=lesson_blob("p-2", "Second"),
        headers=JSON,
    )

    assert client.delete(f"/api/project-folders/{folder_id}").status_code == 204

    listing = {item["id"]: item for item in client.get("/api/projects").json()}
    assert set(listing) == {"p-1", "p-2"}
    assert listing["p-2"]["folder_id"] is None


def test_delete_folder_with_delete_projects_removes_them(client: TestClient) -> None:
    folder = _create_folder(client, "Course")
    folder_id = str(folder["id"])
    post_project(client, lesson_blob("p-1", "First"))
    client.post(
        "/api/projects?folder_id=" + folder_id,
        content=lesson_blob("p-2", "Second"),
        headers=JSON,
    )

    response = client.delete(f"/api/project-folders/{folder_id}?mode=delete_projects")
    assert response.status_code == 204

    listing = client.get("/api/projects").json()
    assert [item["id"] for item in listing] == ["p-1"]


def test_delete_unknown_folder_returns_404(client: TestClient) -> None:
    assert client.delete("/api/project-folders/does-not-exist").status_code == 404
