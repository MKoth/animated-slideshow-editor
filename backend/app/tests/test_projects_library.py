import pytest

from app.config import Settings
from app.database import Database
from app.projects.library import ProjectLibrary, ProjectNotFoundError
from app.projects.validation import LessonSummary

from .test_library import naive_utc


@pytest.fixture(autouse=True)
def ensure_schema(settings: Settings) -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    Database(settings.database_url).init_schema()


def summary(project_id: str = "p-1", name: str = "Spanish Lesson") -> LessonSummary:
    return LessonSummary(
        id=project_id,
        name=name,
        description="A lesson",
        author="Ana",
        version=2,
    )


def test_upsert_creates_row_with_server_timestamps(settings: Settings) -> None:
    library = ProjectLibrary(Database(settings.database_url))
    now = naive_utc(2026, 1, 1)

    stored = library.upsert(summary(), blob='{"a": 1}', now=now)

    assert stored.id == "p-1"
    assert stored.created == now
    assert stored.last_modified == now
    assert library.get("p-1").blob == '{"a": 1}'


def test_upsert_existing_id_updates_row_and_last_modified(settings: Settings) -> None:
    library = ProjectLibrary(Database(settings.database_url))
    first = naive_utc(2026, 1, 1)
    second = naive_utc(2026, 1, 2)
    library.upsert(summary(), blob='{"old": true}', now=first)

    updated = library.upsert(summary(name="Renamed"), blob='{"new": true}', now=second)

    assert updated.created == first
    assert updated.last_modified == second
    stored = library.get("p-1")
    assert stored.name == "Renamed"
    assert stored.blob == '{"new": true}'


def test_upsert_twice_keeps_a_single_row(settings: Settings) -> None:
    library = ProjectLibrary(Database(settings.database_url))
    library.upsert(summary(), blob="{}", now=naive_utc(2026, 1, 1))
    library.upsert(summary(), blob="{}", now=naive_utc(2026, 1, 2))

    assert len(library.list()) == 1


def test_list_is_sorted_by_last_modified_newest_first(settings: Settings) -> None:
    library = ProjectLibrary(Database(settings.database_url))
    for day, project_id in enumerate(("oldest", "middle", "newest"), start=1):
        library.upsert(summary(project_id, project_id), blob="{}", now=naive_utc(2026, 1, day))

    assert [row.id for row in library.list()] == ["newest", "middle", "oldest"]


def test_list_order_follows_re_upsert(settings: Settings) -> None:
    library = ProjectLibrary(Database(settings.database_url))
    library.upsert(summary("a", "a"), blob="{}", now=naive_utc(2026, 1, 1))
    library.upsert(summary("b", "b"), blob="{}", now=naive_utc(2026, 1, 2))
    library.upsert(summary("a", "a"), blob="{}", now=naive_utc(2026, 1, 3))

    assert [row.id for row in library.list()] == ["a", "b"]


def test_get_returns_stored_blob_verbatim(settings: Settings) -> None:
    library = ProjectLibrary(Database(settings.database_url))
    blob = '{"project": {"id": "p-1"}, "slides": []}'
    library.upsert(summary(), blob=blob, now=naive_utc(2026, 1, 1))

    assert library.get("p-1").blob == blob


def test_get_unknown_id_raises(settings: Settings) -> None:
    library = ProjectLibrary(Database(settings.database_url))

    with pytest.raises(ProjectNotFoundError):
        library.get("missing")


def test_delete_removes_the_row(settings: Settings) -> None:
    library = ProjectLibrary(Database(settings.database_url))
    library.upsert(summary(), blob="{}", now=naive_utc(2026, 1, 1))

    library.delete("p-1")

    assert library.list() == []
    with pytest.raises(ProjectNotFoundError):
        library.get("p-1")


def test_delete_unknown_id_raises(settings: Settings) -> None:
    library = ProjectLibrary(Database(settings.database_url))

    with pytest.raises(ProjectNotFoundError):
        library.delete("missing")
