import json

import pytest

from app.projects.validation import ProjectValidationError, validate_lesson


def lesson_blob(
    *,
    version: int = 2,
    project: dict[str, object] | None = None,
    slides: list[object] | None = None,
) -> str:
    payload: dict[str, object] = {
        "version": version,
        "project": project
        or {
            "id": "p-1",
            "name": "Spanish Lesson",
            "description": "A lesson",
            "author": "Ana",
            "createdAt": "2026-01-01T00:00:00",
            "modifiedAt": "2026-01-01T00:00:00",
            "settings": {},
        },
        "slides": slides or [],
    }
    return json.dumps(payload)


def test_valid_blob_extracts_metadata() -> None:
    summary = validate_lesson(lesson_blob())

    assert summary.id == "p-1"
    assert summary.name == "Spanish Lesson"
    assert summary.description == "A lesson"
    assert summary.author == "Ana"
    assert summary.version == 2


def test_non_json_text_is_rejected() -> None:
    with pytest.raises(ProjectValidationError, match="JSON"):
        validate_lesson("this is not json")


def test_json_that_is_not_an_object_is_rejected() -> None:
    with pytest.raises(ProjectValidationError):
        validate_lesson("[1, 2, 3]")


def test_unsupported_version_is_rejected() -> None:
    with pytest.raises(ProjectValidationError, match="version"):
        validate_lesson(lesson_blob(version=3))


def test_missing_version_is_rejected() -> None:
    blob = lesson_blob().replace('"version": 2,', "")
    with pytest.raises(ProjectValidationError, match="version"):
        validate_lesson(blob)


def test_missing_project_is_rejected() -> None:
    blob = lesson_blob().replace('"project":', '"proj":')
    with pytest.raises(ProjectValidationError, match="project"):
        validate_lesson(blob)


def test_missing_id_is_rejected() -> None:
    blob = lesson_blob(project={"name": "X", "description": "", "author": ""})
    with pytest.raises(ProjectValidationError, match="id"):
        validate_lesson(blob)


def test_empty_id_is_rejected() -> None:
    blob = lesson_blob(project={"id": "", "name": "X", "description": "", "author": ""})
    with pytest.raises(ProjectValidationError, match="id"):
        validate_lesson(blob)


def test_missing_name_is_rejected() -> None:
    blob = lesson_blob(project={"id": "p-1", "description": "", "author": ""})
    with pytest.raises(ProjectValidationError, match="name"):
        validate_lesson(blob)


def test_empty_name_is_rejected() -> None:
    blob = lesson_blob(project={"id": "p-1", "name": "", "description": "", "author": ""})
    with pytest.raises(ProjectValidationError, match="name"):
        validate_lesson(blob)


def test_non_string_description_is_rejected() -> None:
    blob = lesson_blob(project={"id": "p-1", "name": "X", "description": 7, "author": ""})
    with pytest.raises(ProjectValidationError, match="description"):
        validate_lesson(blob)


def test_non_string_author_is_rejected() -> None:
    blob = lesson_blob(project={"id": "p-1", "name": "X", "description": "", "author": None})
    with pytest.raises(ProjectValidationError, match="author"):
        validate_lesson(blob)


def test_empty_description_and_author_are_accepted() -> None:
    blob = lesson_blob(project={"id": "p-1", "name": "X", "description": "", "author": ""})
    summary = validate_lesson(blob)

    assert summary.description == ""
    assert summary.author == ""
