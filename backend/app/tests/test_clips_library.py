from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.app_factory import AppFactory
from app.clips.library import ClipDuplicateIDError, ClipNotFoundError
from app.config import Settings


def naive_utc(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, tzinfo=UTC).replace(tzinfo=None)


def test_get_returns_the_created_definition(client: TestClient) -> None:
    response = client.post(
        "/api/clips/library",
        json={"id": "lib-1", "name": "Fade", "duration": 2.0},
    )
    clip_id = response.json()["id"]

    body = client.get(f"/api/clips/library/{clip_id}").json()

    assert body["name"] == "Fade"
    assert body["duration"] == 2.0


def test_get_unknown_id_raises_not_found(settings: Settings) -> None:
    library = AppFactory(settings).create().state.clip_library

    try:
        library.get("ghost")
    except ClipNotFoundError as exc:
        assert exc.args[0] == "ghost"
    else:
        raise AssertionError("expected ClipNotFoundError")


def test_duplicate_clip_id_raises(settings: Settings) -> None:
    library = AppFactory(settings).create().state.clip_library
    now = naive_utc(2026, 1, 1)

    library.create(
        clip_id="dup-test",
        name="Original",
        duration=1.0,
        category=None,
        params=[],
        channels=[],
        channel_animations=None,
        now=now,
    )

    try:
        library.create(
            clip_id="dup-test",
            name="Duplicate",
            duration=2.0,
            category=None,
            params=[],
            channels=[],
            channel_animations=None,
            now=now,
        )
    except ClipDuplicateIDError:
        pass
    else:
        raise AssertionError("expected ClipDuplicateIDError")


def test_delete_removes_only_the_target_clip(client: TestClient) -> None:
    client.post(
        "/api/clips/library",
        json={"id": "del-a", "name": "First", "duration": 1.0},
    )
    client.post(
        "/api/clips/library",
        json={"id": "del-b", "name": "Second", "duration": 1.0},
    )

    response = client.delete("/api/clips/library/del-a")

    assert response.status_code == 204
    remaining = client.get("/api/clips/library").json()
    remaining_ids = [clip["id"] for clip in remaining]
    assert remaining_ids == ["del-b"]


def test_create_with_invalid_duration_at_library_level(settings: Settings) -> None:
    library = AppFactory(settings).create().state.clip_library
    now = naive_utc(2026, 1, 1)

    from app.clips.library import ClipValidationError

    try:
        library.create(
            clip_id="bad-dur",
            name="Bad",
            duration=0.0,
            category=None,
            params=[],
            channels=[],
            channel_animations=None,
            now=now,
        )
    except ClipValidationError:
        pass
    else:
        raise AssertionError("expected ClipValidationError for zero duration")


def test_update_validates_name_not_empty(settings: Settings) -> None:
    library = AppFactory(settings).create().state.clip_library
    now = naive_utc(2026, 1, 1)

    library.create(
        clip_id="upd-validate",
        name="Good",
        duration=1.0,
        category=None,
        params=[],
        channels=[],
        channel_animations=None,
        now=now,
    )

    from app.clips.library import ClipValidationError

    try:
        library.update(
            "upd-validate",
            name="",
            duration=None,
            category=None,
            params=None,
            channels=None,
            channel_animations=None,
            now=now,
        )
    except ClipValidationError:
        pass
    else:
        raise AssertionError("expected ClipValidationError for empty name")


def test_update_validates_duration_positive(settings: Settings) -> None:
    library = AppFactory(settings).create().state.clip_library
    now = naive_utc(2026, 1, 1)

    library.create(
        clip_id="upd-dur-valid",
        name="Good",
        duration=1.0,
        category=None,
        params=[],
        channels=[],
        channel_animations=None,
        now=now,
    )

    from app.clips.library import ClipValidationError

    try:
        library.update(
            "upd-dur-valid",
            name=None,
            duration=-5.0,
            category=None,
            params=None,
            channels=None,
            channel_animations=None,
            now=now,
        )
    except ClipValidationError:
        pass
    else:
        raise AssertionError("expected ClipValidationError for negative duration")


def test_update_requires_at_least_one_field(settings: Settings) -> None:
    library = AppFactory(settings).create().state.clip_library
    now = naive_utc(2026, 1, 1)

    library.create(
        clip_id="upd-no-fields",
        name="Good",
        duration=1.0,
        category=None,
        params=[],
        channels=[],
        channel_animations=None,
        now=now,
    )

    from app.clips.library import ClipValidationError

    try:
        library.update(
            "upd-no-fields",
            name=None,
            duration=None,
            category=None,
            params=None,
            channels=None,
            channel_animations=None,
            now=now,
        )
    except ClipValidationError:
        pass
    else:
        raise AssertionError("expected ClipValidationError for no fields")


def test_list_is_ordered_newest_first(client: TestClient) -> None:
    client.post(
        "/api/clips/library",
        json={"id": "order-a", "name": "First", "duration": 1.0},
    )
    client.post(
        "/api/clips/library",
        json={"id": "order-b", "name": "Second", "duration": 1.0},
    )

    body = client.get("/api/clips/library").json()
    ids = [clip["id"] for clip in body]

    assert ids.index("order-b") < ids.index("order-a")
