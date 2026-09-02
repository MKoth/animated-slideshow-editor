from datetime import datetime
from uuid import uuid4

from sqlalchemy import select

from app.database import Database
from app.voice_prompts.model import VoicePrompt


class VoicePromptNotFoundError(KeyError):
    """Raised when a voice prompt id does not exist."""


class VoicePromptLibrary:
    """I list, fetch, create, update, and delete voice prompt records."""

    def __init__(self, database: Database) -> None:
        self._database = database

    def list(self) -> list[VoicePrompt]:
        statement = select(VoicePrompt).order_by(VoicePrompt.created_at.asc(), VoicePrompt.id)
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get(self, prompt_id: str) -> VoicePrompt:
        with self._database.session() as session:
            row = session.get(VoicePrompt, prompt_id)
        if row is None:
            raise VoicePromptNotFoundError(prompt_id)
        return row

    def create(
        self,
        title: str,
        instruction: str,
        language: str | None = None,
        voice: str | None = None,
        params: dict[str, object] | None = None,
        model_id: str | None = None,
        provider: str | None = None,
        now: datetime | None = None,
        prompt_id: str | None = None,
    ) -> VoicePrompt:
        from datetime import UTC

        current = now or datetime.now(UTC).replace(tzinfo=None)
        pid = prompt_id or str(uuid4())
        # Also store modelId/provider inside params for legacy forward-compatibility if provided
        effective_params = dict(params) if isinstance(params, dict) else None
        if model_id is not None or provider is not None:
            if effective_params is None or not isinstance(effective_params, dict):
                effective_params = {}
            # keep params in sync for future recall via params as spec says
            if model_id is not None:
                effective_params["modelId"] = model_id
            if provider is not None:
                effective_params["provider"] = provider
        row = VoicePrompt(
            id=pid,
            title=title,
            instruction=instruction,
            language=language,
            voice=voice,
            params=effective_params if effective_params is not None else params,
            model_id=model_id,
            provider=provider,
            created_at=current,
            updated_at=current,
        )
        with self._database.session() as session:
            session.add(row)
            session.commit()
        return self.get(pid)

    def update(
        self,
        prompt_id: str,
        patch: dict[str, object],
        now: datetime | None = None,
    ) -> VoicePrompt:
        from datetime import UTC

        current = now or datetime.now(UTC).replace(tzinfo=None)
        with self._database.session() as session:
            row = session.get(VoicePrompt, prompt_id)
            if row is None:
                raise VoicePromptNotFoundError(prompt_id)
            if "title" in patch:
                row.title = patch["title"]  # type: ignore[assignment]
            if "instruction" in patch:
                row.instruction = patch["instruction"]  # type: ignore[assignment]
            if "language" in patch:
                row.language = patch["language"]  # type: ignore[assignment]
            if "voice" in patch:
                row.voice = patch["voice"]  # type: ignore[assignment]
            if "params" in patch:
                row.params = patch["params"]  # type: ignore[assignment]
            if "model_id" in patch:
                row.model_id = patch["model_id"]  # type: ignore[assignment]
            if "provider" in patch:
                row.provider = patch["provider"]  # type: ignore[assignment]
            # keep params in sync if model_id/provider updated
            if "model_id" in patch or "provider" in patch:
                current_params = row.params if isinstance(row.params, dict) else {}
                if not isinstance(current_params, dict):
                    current_params = {}
                new_params = dict(current_params)
                if "model_id" in patch:
                    if patch["model_id"] is None:
                        new_params.pop("modelId", None)
                    else:
                        new_params["modelId"] = patch["model_id"]
                if "provider" in patch:
                    if patch["provider"] is None:
                        new_params.pop("provider", None)
                    else:
                        new_params["provider"] = patch["provider"]
                # Only update if changed and not empty? Keep empty dict as None? Preserve original empty logic
                if new_params:
                    row.params = new_params  # type: ignore[assignment]
                else:
                    # if original was None keep None unless model/provider added then keep containing?
                    if row.params is not None or "model_id" in patch or "provider" in patch:
                        # if params becomes empty and original was None, keep None for cleanliness
                        if current_params or new_params:
                            row.params = new_params if new_params else None  # type: ignore[assignment]
            row.updated_at = current  # type: ignore[assignment]
            session.commit()
        return self.get(prompt_id)

    def delete(self, prompt_id: str) -> None:
        with self._database.session() as session:
            row = session.get(VoicePrompt, prompt_id)
            if row is None:
                raise VoicePromptNotFoundError(prompt_id)
            session.delete(row)
            session.commit()
