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
        now: datetime | None = None,
        prompt_id: str | None = None,
    ) -> VoicePrompt:
        from datetime import UTC

        current = now or datetime.now(UTC).replace(tzinfo=None)
        pid = prompt_id or str(uuid4())
        row = VoicePrompt(
            id=pid,
            title=title,
            instruction=instruction,
            language=language,
            voice=voice,
            params=params,
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
