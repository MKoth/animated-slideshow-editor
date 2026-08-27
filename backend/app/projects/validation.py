import json
from dataclasses import dataclass


class ProjectValidationError(ValueError):
    """Raised when a posted lesson blob fails shallow server-side validation."""


@dataclass(frozen=True)
class LessonSummary:
    """The metadata columns derived from a posted lesson blob."""

    id: str
    name: str
    description: str
    author: str
    version: int


SUPPORTED_VERSION = 2


def validate_lesson(text: str) -> LessonSummary:
    """Parse a lesson blob and derive its metadata; rejects malformed input."""
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ProjectValidationError("the body must be well-formed JSON") from exc
    if not isinstance(payload, dict):
        raise ProjectValidationError("the body must be a JSON object")

    version = payload.get("version")
    if version != SUPPORTED_VERSION:
        raise ProjectValidationError(
            f"unsupported version {version!r}; only version {SUPPORTED_VERSION} is supported"
        )

    project = payload.get("project")
    if not isinstance(project, dict):
        raise ProjectValidationError("the body must contain a project object")
    project_id = _required_string(project, "id", "project id")
    name = _required_string(project, "name", "project name")
    description = _required_string(project, "description", "project description", allow_empty=True)
    author = _required_string(project, "author", "project author", allow_empty=True)
    return LessonSummary(
        id=project_id, name=name, description=description, author=author, version=version
    )


def _required_string(
    project: dict[str, object], key: str, label: str, *, allow_empty: bool = False
) -> str:
    value = project.get(key)
    if not isinstance(value, str) or (not allow_empty and value == ""):
        requirement = "non-empty string" if not allow_empty else "string"
        raise ProjectValidationError(f"the {label} must be a {requirement}")
    return value
