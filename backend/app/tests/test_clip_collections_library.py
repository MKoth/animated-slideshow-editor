from fastapi.testclient import TestClient


def test_create_collection_with_category_round_trips(client: TestClient) -> None:
    response = client.post(
        "/api/clip-collections/library",
        json={
            "id": "cat-1",
            "name": "Walk Cycle",
            "category": "  Walk  ",
            "bindings": {"left_hand": "clip-a"},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["category"] == "Walk"

    fetched = client.get("/api/clip-collections/library/cat-1").json()
    assert fetched["category"] == "Walk"


def test_create_collection_without_category_is_uncategorized(client: TestClient) -> None:
    response = client.post(
        "/api/clip-collections/library",
        json={"id": "cat-2", "name": "Legacy", "bindings": {"hand": "clip-a"}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["category"] is None


def test_update_category_and_clear_back_to_uncategorized(client: TestClient) -> None:
    client.post(
        "/api/clip-collections/library",
        json={"id": "cat-3", "name": "Mutable", "bindings": {"hand": "clip-a"}},
    )
    updated = client.put("/api/clip-collections/library/cat-3", json={"category": "Run"})
    assert updated.status_code == 200, updated.text
    assert updated.json()["category"] == "Run"

    # Explicit null clears back to Uncategorized (omitted would leave unchanged).
    cleared = client.put("/api/clip-collections/library/cat-3", json={"category": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["category"] is None


def test_update_without_category_leaves_it_unchanged(client: TestClient) -> None:
    client.post(
        "/api/clip-collections/library",
        json={
            "id": "cat-4",
            "name": "Stable",
            "category": "Dance",
            "bindings": {"hand": "clip-a"},
        },
    )
    updated = client.put("/api/clip-collections/library/cat-4", json={"name": "Stable 2"})
    assert updated.status_code == 200, updated.text
    assert updated.json()["category"] == "Dance"
