from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator

from app.tts.languages import normalize_language_code


class VoicePromptCreate(BaseModel):
    title: str
    instruction: str
    language: str | None = None
    voice: str | None = None
    params: dict[str, Any] | None = None

    @field_validator("language", mode="before")
    @classmethod
    def validate_language(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("language must be a string")
        try:
            return normalize_language_code(v)
        except ValueError as e:
            raise ValueError(str(e)) from e


class VoicePromptUpdate(BaseModel):
    title: str | None = None
    instruction: str | None = None
    language: str | None = None
    voice: str | None = None
    params: dict[str, Any] | None = None

    @field_validator("language", mode="before")
    @classmethod
    def validate_language(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("language must be a string")
        # Allow explicit null via JSON null; empty string means Auto -> None
        # Update can receive null to clear language
        try:
            return normalize_language_code(v)
        except ValueError as e:
            raise ValueError(str(e)) from e


class VoicePromptOut(BaseModel):
    id: str
    title: str
    instruction: str
    language: str | None = None
    voice: str | None = None
    params: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime


def row_to_schema(row: Any) -> VoicePromptOut:
    return VoicePromptOut(
        id=row.id,
        title=row.title,
        instruction=row.instruction,
        language=row.language,
        voice=row.voice,
        params=row.params,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
