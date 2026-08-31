from datetime import datetime
from typing import Any

from pydantic import BaseModel


class VoicePromptCreate(BaseModel):
    title: str
    instruction: str
    language: str | None = None
    voice: str | None = None
    params: dict[str, Any] | None = None


class VoicePromptUpdate(BaseModel):
    title: str | None = None
    instruction: str | None = None
    language: str | None = None
    voice: str | None = None
    params: dict[str, Any] | None = None


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
