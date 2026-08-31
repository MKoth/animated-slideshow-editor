import json

from fastapi.testclient import TestClient


def test_voice_prompt_crud_and_shareability(client: TestClient) -> None:
    # Create
    r = client.post(
        "/api/voice-prompts",
        json={"title": "Warm voice", "instruction": "Speak warmly", "language": "en", "voice": "nova", "params": {"speed": 1.0}},
    )
    assert r.status_code == 201
    created = r.json()
    assert created["title"] == "Warm voice"
    assert created["instruction"] == "Speak warmly"
    assert created["language"] == "en"
    assert created["voice"] == "nova"
    assert created["params"] == {"speed": 1.0}
    pid = created["id"]

    # List – shared across slides (global)
    r2 = client.get("/api/voice-prompts")
    assert r2.status_code == 200
    listing = r2.json()
    assert len(listing) == 1
    assert listing[0]["id"] == pid

    # Get single
    r3 = client.get(f"/api/voice-prompts/{pid}")
    assert r3.status_code == 200
    assert r3.json()["title"] == "Warm voice"

    # Update
    r4 = client.put(f"/api/voice-prompts/{pid}", json={"title": "Warm updated"})
    assert r4.status_code == 200
    assert r4.json()["title"] == "Warm updated"

    # List after update still shared
    r5 = client.get("/api/voice-prompts")
    assert r5.json()[0]["title"] == "Warm updated"

    # Create second prompt
    r6 = client.post("/api/voice-prompts", json={"title": "Second", "instruction": "Second instr"})
    assert r6.status_code == 201
    assert len(client.get("/api/voice-prompts").json()) == 2

    # Delete first
    r7 = client.delete(f"/api/voice-prompts/{pid}")
    assert r7.status_code == 204
    listing_after = client.get("/api/voice-prompts").json()
    assert len(listing_after) == 1
    assert listing_after[0]["title"] == "Second"


def test_voice_prompt_validation(client: TestClient) -> None:
    # Empty title
    r = client.post("/api/voice-prompts", json={"title": "", "instruction": "hi"})
    assert r.status_code == 422
    # Empty instruction
    r2 = client.post("/api/voice-prompts", json={"title": "t", "instruction": "   "})
    assert r2.status_code == 422
    # Unknown id
    r3 = client.get("/api/voice-prompts/does-not-exist")
    assert r3.status_code == 404
    r4 = client.put("/api/voice-prompts/does-not-exist", json={"title": "x"})
    assert r4.status_code == 404
    r5 = client.delete("/api/voice-prompts/does-not-exist")
    assert r5.status_code == 404


def test_voice_prompt_global_shared_not_in_lesson(client: TestClient) -> None:
    # Create prompt globally
    client.post("/api/voice-prompts", json={"title": "Global", "instruction": "instr"})
    # Create a lesson without voice_prompts field
    blob = json.dumps(
        {
            "version": 2,
            "project": {
                "id": "p-1",
                "name": "Lesson",
                "description": "",
                "author": "",
                "createdAt": "2026-01-01T00:00:00",
                "modifiedAt": "2026-01-01T00:00:00",
                "settings": {},
            },
            "slides": [],
        }
    )
    r = client.post("/api/projects", content=blob, headers={"content-type": "application/json"})
    assert r.status_code == 200
    fetched = client.get("/api/projects/p-1")
    assert fetched.status_code == 200
    parsed = json.loads(fetched.text)
    # Lesson should not contain voice_prompts
    assert "voice_prompts" not in json.dumps(parsed)
    assert "voice_prompts" not in fetched.text
    # But prompts still exist globally
    assert len(client.get("/api/voice-prompts").json()) == 1
