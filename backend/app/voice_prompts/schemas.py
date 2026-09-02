from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.tts.languages import normalize_language_code
from app.tts.registry import normalize_model_id, normalize_provider


class VoicePromptCreate(BaseModel):
    title: str
    instruction: str
    language: str | None = None
    voice: str | None = None
    params: dict[str, Any] | None = None
    modelId: str | None = Field(default=None, alias="modelId")
    provider: str | None = None

    model_config = {"populate_by_name": True}

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

    @field_validator("modelId", mode="before")
    @classmethod
    def validate_model_id(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("modelId must be a string")
        try:
            return normalize_model_id(v)
        except ValueError as e:
            raise ValueError(str(e)) from e

    @field_validator("provider", mode="before")
    @classmethod
    def validate_provider(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("provider must be a string")
        try:
            return normalize_provider(v)
        except ValueError as e:
            raise ValueError(str(e)) from e


class VoicePromptUpdate(BaseModel):
    title: str | None = None
    instruction: str | None = None
    language: str | None = None
    voice: str | None = None
    params: dict[str, Any] | None = None
    modelId: str | None = Field(default=None, alias="modelId")
    provider: str | None = None

    model_config = {"populate_by_name": True}

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

    @field_validator("modelId", mode="before")
    @classmethod
    def validate_model_id(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("modelId must be a string")
        # allow explicit clearing via null – empty string treated as null
        if isinstance(v, str) and v.strip() == "":
            return None
        try:
            return normalize_model_id(v)
        except ValueError as e:
            raise ValueError(str(e)) from e

    @field_validator("provider", mode="before")
    @classmethod
    def validate_provider(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("provider must be a string")
        if isinstance(v, str) and v.strip() == "":
            return None
        try:
            return normalize_provider(v)
        except ValueError as e:
            raise ValueError(str(e)) from e


class VoicePromptOut(BaseModel):
    id: str
    title: str
    instruction: str
    language: str | None = None
    voice: str | None = None
    params: dict[str, Any] | None = None
    modelId: str | None = Field(default=None, alias="modelId")
    provider: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"populate_by_name": True}


def row_to_schema(row: Any) -> VoicePromptOut:
    # Support both new columns and legacy params fallback for modelId/provider stored inside params
    model_id_val = getattr(row, "model_id", None)
    provider_val = getattr(row, "provider", None)
    # Legacy: if columns are None but params contains modelId/provider, surface those for backwards compat
    if model_id_val is None and isinstance(getattr(row, "params", None), dict):
        legacy_mid = row.params.get("modelId") if isinstance(row.params, dict) else None
        if isinstance(legacy_mid, str) and legacy_mid.strip():
            try:
                from app.tts.registry import normalize_model_id as _norm_mid

                _norm_mid(legacy_mid)
                model_id_val = legacy_mid
            except Exception:
                pass
    if provider_val is None and isinstance(getattr(row, "params", None), dict):
        legacy_prov = row.params.get("provider") if isinstance(row.params, dict) else None
        if isinstance(legacy_prov, str) and legacy_prov.strip():
            try:
                from app.tts.registry import normalize_provider as _norm_prov

                _norm_prov(legacy_prov)
                provider_val = legacy_prov.strip().lower()
            except Exception:
                pass
    return VoicePromptOut(
        id=row.id,
        title=row.title,
        instruction=row.instruction,
        language=row.language,
        voice=row.voice,
        params=row.params,
        modelId=model_id_val,
        provider=provider_val,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
