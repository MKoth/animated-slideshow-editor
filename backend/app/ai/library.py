from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, func, select

from app.ai.crypto import decrypt_key, encrypt_key, mask_key
from app.ai.model import AiConversationRow, AiMessageRow, AiSettingsRow
from app.config import DEFAULT_CONTEXT_BUDGET, DEFAULT_SYSTEM_PROMPT, DEFAULT_ZEN_URL, Settings
from app.database import Database


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class AiSecretMissingError(RuntimeError):
    pass


class AiConversationNotFoundError(KeyError):
    pass


class AiLibrary:
    """I own the singleton provider record plus project-scoped conversations."""

    def __init__(self, database: Database, settings: Settings) -> None:
        self._database = database
        self._settings = settings

    # -- settings -----------------------------------------------------

    def get_settings_view(self) -> dict[str, object]:
        row = self._get_or_seed_settings_row()
        plaintext = self._decrypt_or_none(row.encrypted_key)
        return {
            "endpoint": row.endpoint,
            "model": row.model,
            "temperature": row.temperature,
            "maxTokens": row.max_tokens,
            "streaming": bool(row.streaming),
            "systemPrompt": row.system_prompt,
            "keyMasked": mask_key(plaintext),
            "hasKey": bool(plaintext),
        }

    def get_settings_raw(self) -> tuple[AiSettingsRow, str | None]:
        row = self._get_or_seed_settings_row()
        return row, self._decrypt_or_none(row.encrypted_key)

    def update_settings(
        self,
        *,
        endpoint: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        streaming: bool | None = None,
        system_prompt: str | None = None,
        api_key: str | None = None,
    ) -> dict[str, object]:
        if api_key is not None and api_key != "" and not self._settings.ai_secret_key:
            raise AiSecretMissingError("AI_SECRET_KEY is not set — cannot save the provider key")
        with self._database.session() as session:
            row = session.get(AiSettingsRow, "singleton")
            if row is None:
                row = self._seed_row(session)
            if endpoint is not None:
                row.endpoint = endpoint.strip() or row.endpoint
            if model is not None:
                row.model = model.strip() or row.model
            if temperature is not None:
                row.temperature = temperature
            if max_tokens is not None:
                row.max_tokens = max_tokens
            if streaming is not None:
                row.streaming = streaming
            if system_prompt is not None:
                row.system_prompt = system_prompt
            if api_key is not None and api_key != "":
                secret = self._settings.ai_secret_key
                assert secret is not None
                row.encrypted_key = encrypt_key(api_key, secret)
            row.updated_at = _now()
            session.commit()
        return self.get_settings_view()

    def _decrypt_or_none(self, ciphertext: str | None) -> str | None:
        if not ciphertext:
            return None
        secret = self._settings.ai_secret_key
        if not secret:
            return None
        try:
            return decrypt_key(ciphertext, secret)
        except ValueError:
            return None

    def _get_or_seed_settings_row(self) -> AiSettingsRow:
        with self._database.session() as session:
            row = session.get(AiSettingsRow, "singleton")
            if row is None:
                row = self._seed_row(session)
                session.commit()
        # Re-fetch detached-safe copy
        with self._database.session() as session:
            fetched = session.get(AiSettingsRow, "singleton")
            assert fetched is not None
            return fetched

    def _seed_row(self, session: object) -> AiSettingsRow:
        from sqlalchemy.orm import Session as OrmSession

        assert isinstance(session, OrmSession)
        fallback_model = (
            self._settings.ai_fallback_models[0]
            if self._settings.ai_fallback_models
            else "anthropic/claude-sonnet-4-5"
        )
        row = AiSettingsRow(
            id="singleton",
            endpoint=self._settings.opencode_base_url or DEFAULT_ZEN_URL,
            model=fallback_model,
            temperature=0.7,
            max_tokens=2000,
            streaming=True,
            system_prompt=self._settings.ai_system_prompt_default or DEFAULT_SYSTEM_PROMPT,
            encrypted_key=None,
            updated_at=_now(),
        )
        session.add(row)
        session.flush()
        return row

    # -- conversations -------------------------------------------------

    def list_conversations(self, project_id: str) -> list[AiConversationRow]:
        statement = (
            select(AiConversationRow)
            .where(AiConversationRow.project_id == project_id)
            .order_by(AiConversationRow.updated_at.desc(), AiConversationRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def create_conversation(self, project_id: str, title: str | None = None) -> AiConversationRow:
        with self._database.session() as session:
            count = session.scalar(
                select(func.count())
                .select_from(AiConversationRow)
                .where(AiConversationRow.project_id == project_id)
            )
            number = int(count or 0) + 1
            clean = title.strip() if title and title.strip() else f"Conversation {number}"
            now = _now()
            row = AiConversationRow(
                id=str(uuid4()),
                project_id=project_id,
                title=clean[:255],
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.commit()
            created_id = row.id
        return self.get_conversation(created_id)

    def get_conversation(self, conversation_id: str) -> AiConversationRow:
        with self._database.session() as session:
            row = session.get(AiConversationRow, conversation_id)
        if row is None:
            raise AiConversationNotFoundError(conversation_id)
        return row

    def rename_conversation(self, conversation_id: str, title: str) -> AiConversationRow:
        clean = title.strip()
        if not clean:
            raise ValueError("title must be a non-empty string")
        with self._database.session() as session:
            row = session.get(AiConversationRow, conversation_id)
            if row is None:
                raise AiConversationNotFoundError(conversation_id)
            row.title = clean[:255]
            row.updated_at = _now()
            session.commit()
        return self.get_conversation(conversation_id)

    def delete_conversation(self, conversation_id: str) -> None:
        with self._database.session() as session:
            row = session.get(AiConversationRow, conversation_id)
            if row is None:
                raise AiConversationNotFoundError(conversation_id)
            session.execute(
                delete(AiMessageRow).where(AiMessageRow.conversation_id == conversation_id)
            )
            session.delete(row)
            session.commit()

    def delete_by_project(self, project_id: str) -> None:
        with self._database.session() as session:
            ids = list(
                session.scalars(
                    select(AiConversationRow.id).where(AiConversationRow.project_id == project_id)
                )
            )
            if ids:
                session.execute(delete(AiMessageRow).where(AiMessageRow.conversation_id.in_(ids)))
                session.execute(
                    delete(AiConversationRow).where(AiConversationRow.project_id == project_id)
                )
                session.commit()

    # -- messages ------------------------------------------------------

    def list_messages(self, conversation_id: str) -> list[AiMessageRow]:
        # Ensure conversation exists for 404 semantics
        self.get_conversation(conversation_id)
        statement = (
            select(AiMessageRow)
            .where(AiMessageRow.conversation_id == conversation_id)
            .order_by(AiMessageRow.created_at.asc(), AiMessageRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def append_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        *,
        stopped: bool = False,
        error_code: str | None = None,
    ) -> AiMessageRow:
        if role not in ("user", "assistant"):
            raise ValueError("role must be user or assistant")
        # Touch conversation for ordering
        with self._database.session() as session:
            conv = session.get(AiConversationRow, conversation_id)
            if conv is None:
                raise AiConversationNotFoundError(conversation_id)
            now = _now()
            row = AiMessageRow(
                id=str(uuid4()),
                conversation_id=conversation_id,
                role=role,
                content=content,
                stopped=stopped,
                error_code=error_code,
                created_at=now,
            )
            session.add(row)
            conv.updated_at = now
            session.commit()
            created_id = row.id
        return self.get_message(created_id)

    def get_message(self, message_id: str) -> AiMessageRow:
        with self._database.session() as session:
            row = session.get(AiMessageRow, message_id)
        if row is None:
            raise KeyError(message_id)
        return row

    def update_message_content(
        self,
        message_id: str,
        content: str,
        *,
        stopped: bool | None = None,
        error_code: str | None = None,
    ) -> AiMessageRow:
        with self._database.session() as session:
            row = session.get(AiMessageRow, message_id)
            if row is None:
                raise KeyError(message_id)
            row.content = content
            if stopped is not None:
                row.stopped = stopped
            if error_code is not None:
                row.error_code = error_code
            conv = session.get(AiConversationRow, row.conversation_id)
            if conv is not None:
                conv.updated_at = _now()
            session.commit()
        return self.get_message(message_id)

    def replace_last_assistant(self, conversation_id: str) -> AiMessageRow | None:
        """Return the terminal assistant message for regenerate (latest only).

        Regenerate replaces the last assistant message only — if the conversation
        currently ends with a user message there is no terminal assistant to
        replace, so return None and let the caller create a fresh one.
        """
        messages = self.list_messages(conversation_id)
        if messages and messages[-1].role == "assistant":
            return messages[-1]
        return None

    @property
    def context_budget(self) -> int:
        budget = getattr(self._settings, "ai_context_budget", DEFAULT_CONTEXT_BUDGET)
        return budget if isinstance(budget, int) and budget > 0 else DEFAULT_CONTEXT_BUDGET
