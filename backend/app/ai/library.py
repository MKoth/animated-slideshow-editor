from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, func, select

from app.ai.crypto import decrypt_key, encrypt_key, mask_key
from app.ai.model import (
    AiConversationRow,
    AiMessageRow,
    AiPlanRevisionRow,
    AiPlanRow,
    AiProposalExecutionRow,
    AiProposalRow,
    AiSettingsRow,
)
from app.ai.proposals import validate_proposal_commands
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
            plan_ids = list(
                session.scalars(select(AiPlanRow.id).where(AiPlanRow.project_id == project_id))
            )
            if plan_ids:
                session.execute(
                    delete(AiPlanRevisionRow).where(AiPlanRevisionRow.plan_id.in_(plan_ids))
                )
                session.execute(delete(AiPlanRow).where(AiPlanRow.project_id == project_id))
            proposal_ids = list(
                session.scalars(
                    select(AiProposalRow.id).where(AiProposalRow.project_id == project_id)
                )
            )
            if proposal_ids:
                session.execute(
                    delete(AiProposalExecutionRow).where(
                        AiProposalExecutionRow.proposal_id.in_(proposal_ids)
                    )
                )
                session.execute(delete(AiProposalRow).where(AiProposalRow.project_id == project_id))
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

    # -- lesson plans ----------------------------------------------------

    def list_plans(self, project_id: str) -> list[AiPlanRow]:
        statement = (
            select(AiPlanRow)
            .where(AiPlanRow.project_id == project_id)
            .order_by(AiPlanRow.updated_at.desc(), AiPlanRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get_plan(self, plan_id: str) -> AiPlanRow:
        with self._database.session() as session:
            row = session.get(AiPlanRow, plan_id)
        if row is None:
            raise KeyError(plan_id)
        return row

    def list_plan_revisions(self, plan_id: str) -> list[AiPlanRevisionRow]:
        self.get_plan(plan_id)
        statement = (
            select(AiPlanRevisionRow)
            .where(AiPlanRevisionRow.plan_id == plan_id)
            .order_by(AiPlanRevisionRow.created_at.asc(), AiPlanRevisionRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def create_plan(
        self,
        *,
        project_id: str,
        conversation_id: str,
        content: dict[str, object],
        source_request: str,
    ) -> AiPlanRow:
        import json as _json

        slides = _normalize_plan_slides(content.get("slides"))
        now = _now()
        plan_id = str(uuid4())
        with self._database.session() as session:
            # Conversation must exist for project scoping.
            conv = session.get(AiConversationRow, conversation_id)
            if conv is None:
                raise AiConversationNotFoundError(conversation_id)
            row = AiPlanRow(
                id=plan_id,
                project_id=project_id,
                conversation_id=conversation_id,
                title=str(content.get("title", ""))[:255],
                description=str(content.get("description", "")),
                language=str(content.get("language", "en") or "en")[:64],
                estimated_duration_sec=_safe_float(content.get("estimatedDurationSec")),
                learning_objective=str(content.get("learningObjective", "")),
                teaching_strategy=str(content.get("teachingStrategy", "")),
                status="draft",
                slides_json=_json.dumps(slides),
                user_edits_json="{}",
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.add(
                AiPlanRevisionRow(
                    id=str(uuid4()),
                    plan_id=plan_id,
                    source_request=source_request,
                    snapshot_json=_json.dumps(_plan_snapshot(content, slides)),
                    created_at=now,
                )
            )
            session.commit()
        return self.get_plan(plan_id)

    def revise_plan(
        self,
        plan_id: str,
        *,
        content: dict[str, object],
        source_request: str,
    ) -> AiPlanRow:
        import json as _json

        slides = _normalize_plan_slides(content.get("slides"))
        snapshot = _plan_snapshot(content, slides)
        with self._database.session() as session:
            row = session.get(AiPlanRow, plan_id)
            if row is None:
                raise KeyError(plan_id)
            row.title = str(content.get("title", row.title))[:255]
            row.description = str(content.get("description", row.description))
            language = str(content.get("language", row.language) or row.language)
            row.language = language[:64]
            row.estimated_duration_sec = _safe_float(
                content.get("estimatedDurationSec", row.estimated_duration_sec)
            )
            row.learning_objective = str(content.get("learningObjective", row.learning_objective))
            row.teaching_strategy = str(content.get("teachingStrategy", row.teaching_strategy))
            row.slides_json = _json.dumps(slides)
            row.updated_at = _now()
            session.add(
                AiPlanRevisionRow(
                    id=str(uuid4()),
                    plan_id=plan_id,
                    source_request=source_request,
                    snapshot_json=_json.dumps(snapshot),
                    created_at=_now(),
                )
            )
            session.commit()
        return self.get_plan(plan_id)

    def update_plan_edits(
        self,
        plan_id: str,
        *,
        title: str | None = None,
        description: str | None = None,
        language: str | None = None,
        estimated_duration_sec: float | None = None,
        learning_objective: str | None = None,
        teaching_strategy: str | None = None,
        slides: list[dict[str, object]] | None = None,
    ) -> AiPlanRow:
        import json as _json

        with self._database.session() as session:
            row = session.get(AiPlanRow, plan_id)
            if row is None:
                raise KeyError(plan_id)
            try:
                loaded_edits: object = _json.loads(row.user_edits_json or "{}")
                user_edits = loaded_edits if isinstance(loaded_edits, dict) else {}
            except (ValueError, TypeError):
                user_edits = {}
            if not isinstance(user_edits, dict):
                user_edits = {}
            current_slides: list[dict[str, object]] = _load_slides(row.slides_json)

            if title is not None:
                row.title = title[:255]
                user_edits["title"] = title
            if description is not None:
                row.description = description
                user_edits["description"] = description
            if language is not None and language.strip():
                row.language = language.strip()[:64]
                user_edits["language"] = row.language
            if estimated_duration_sec is not None:
                row.estimated_duration_sec = estimated_duration_sec
            if learning_objective is not None:
                row.learning_objective = learning_objective
                user_edits["learningObjective"] = learning_objective
            if teaching_strategy is not None:
                row.teaching_strategy = teaching_strategy
                user_edits["teachingStrategy"] = teaching_strategy
            if slides is not None:
                by_id = {s.get("id"): s for s in current_slides if isinstance(s.get("id"), str)}
                merged: list[dict[str, object]] = []
                slide_fields = user_edits.get("slideFields")
                if not isinstance(slide_fields, dict):
                    slide_fields = {}
                    user_edits["slideFields"] = slide_fields
                for order, patch in enumerate(slides):
                    sid = str(patch.get("id", ""))
                    existing = by_id.get(sid)
                    if existing is None:
                        raise ValueError(f"unknown slide id: {sid}")
                    updated = dict(existing)
                    updated["order"] = order
                    override = (
                        dict(slide_fields.get(sid, {}))
                        if isinstance(slide_fields.get(sid), dict)
                        else {}
                    )
                    if "_oldTitle" not in override and isinstance(existing.get("title"), str):
                        override["_oldTitle"] = existing.get("title")
                    for field in ("title", "goal", "explanation", "suggestedNarration"):
                        if patch.get(field) is not None:
                            updated[field] = patch[field]
                            override[field] = patch[field]
                    if patch.get("estimatedDurationSec") is not None:
                        updated["estimatedDurationSec"] = patch["estimatedDurationSec"]
                        override["estimatedDurationSec"] = patch["estimatedDurationSec"]
                    merged.append(updated)
                    slide_fields[sid] = override
                row.slides_json = _json.dumps(merged)
                user_edits["slideOrder"] = [str(p.get("id", "")) for p in slides]
            row.user_edits_json = _json.dumps(user_edits)
            row.updated_at = _now()
            session.commit()
        return self.get_plan(plan_id)

    def set_plan_status(self, plan_id: str, status: str) -> AiPlanRow:
        if status not in ("draft", "accepted", "rejected"):
            raise ValueError("status must be draft, accepted, or rejected")
        with self._database.session() as session:
            row = session.get(AiPlanRow, plan_id)
            if row is None:
                raise KeyError(plan_id)
            row.status = status
            row.updated_at = _now()
            session.commit()
        return self.get_plan(plan_id)

    def get_user_edits(self, plan_id: str) -> dict[str, object]:
        import json as _json

        row = self.get_plan(plan_id)
        try:
            data: object = _json.loads(row.user_edits_json or "{}")
        except (ValueError, TypeError):
            return {}
        return data if isinstance(data, dict) else {}

    # -- edit proposals --------------------------------------------------

    def list_proposals(self, project_id: str) -> list[AiProposalRow]:
        statement = (
            select(AiProposalRow)
            .where(AiProposalRow.project_id == project_id)
            .order_by(AiProposalRow.updated_at.desc(), AiProposalRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get_proposal(self, proposal_id: str) -> AiProposalRow:
        with self._database.session() as session:
            row = session.get(AiProposalRow, proposal_id)
        if row is None:
            raise KeyError(proposal_id)
        return row

    def list_proposal_executions(self, proposal_id: str) -> list[AiProposalExecutionRow]:
        self.get_proposal(proposal_id)
        statement = (
            select(AiProposalExecutionRow)
            .where(AiProposalExecutionRow.proposal_id == proposal_id)
            .order_by(AiProposalExecutionRow.created_at.asc(), AiProposalExecutionRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def create_proposal(
        self,
        *,
        project_id: str,
        conversation_id: str,
        title: str,
        commands: list[dict[str, object]],
        project_fingerprint: str,
    ) -> AiProposalRow:
        import json as _json

        ok, errors = validate_proposal_commands(commands)
        now = _now()
        proposal_id = str(uuid4())
        with self._database.session() as session:
            conv = session.get(AiConversationRow, conversation_id)
            if conv is None:
                raise AiConversationNotFoundError(conversation_id)
            row = AiProposalRow(
                id=proposal_id,
                project_id=project_id,
                conversation_id=conversation_id,
                title=(title or "")[:255],
                status="validated" if ok else "draft",
                commands_json=_json.dumps(commands),
                validation_json=_json.dumps({"ok": ok, "errors": errors}),
                base_fingerprint=project_fingerprint,
                validated_fingerprint=None,
                dry_run_json=_json.dumps({}),
                selected_indexes_json="[]",
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.commit()
        return self.get_proposal(proposal_id)

    def report_dry_run(
        self,
        proposal_id: str,
        *,
        project_fingerprint: str,
        ok: bool,
        errors: list[dict[str, object]],
        validated_indexes: list[int] | None = None,
    ) -> AiProposalRow:
        import json as _json

        with self._database.session() as session:
            row = session.get(AiProposalRow, proposal_id)
            if row is None:
                raise KeyError(proposal_id)
            row.validated_fingerprint = project_fingerprint
            row.dry_run_json = _json.dumps(
                {
                    "ok": bool(ok),
                    "errors": errors,
                    "validatedIndexes": validated_indexes,
                }
            )
            row.status = "dry_run_ok" if ok else "dry_run_failed"
            row.updated_at = _now()
            session.commit()
        return self.get_proposal(proposal_id)

    def approve_proposal(
        self,
        proposal_id: str,
        *,
        current_fingerprint: str,
        selected_indexes: list[int] | None,
    ) -> tuple[AiProposalRow, list[dict[str, object]]]:
        import json as _json

        with self._database.session() as session:
            row = session.get(AiProposalRow, proposal_id)
            if row is None:
                raise KeyError(proposal_id)
            try:
                validation: object = _json.loads(row.validation_json or "{}")
            except (ValueError, TypeError):
                validation = {}
            if not isinstance(validation, dict) or not validation.get("ok"):
                raise ValueError(
                    "proposal failed server schema validation — "
                    "fix the listed errors and re-validate before approval"
                )
            try:
                dry: object = _json.loads(row.dry_run_json or "{}")
            except (ValueError, TypeError):
                dry = {}
            if not isinstance(dry, dict) or not dry.get("ok"):
                raise LookupError(
                    "client dry-run validate() has not passed — "
                    "run a dry-run against the live engine first"
                )
            if not row.validated_fingerprint:
                raise LookupError(
                    "client dry-run validate() has not passed — "
                    "run a dry-run against the live engine first"
                )
            if current_fingerprint != row.validated_fingerprint:
                raise StaleProposalError(
                    f"stale proposal: project changed since validation "
                    f"(validated at {row.validated_fingerprint}). "
                    "Re-run the dry-run against the live engine, then approve again."
                )
            try:
                commands: object = _json.loads(row.commands_json or "[]")
            except (ValueError, TypeError):
                commands = []
            if not isinstance(commands, list):
                raise ValueError("proposal commands are corrupt")  # noqa: TRY004
            count = len(commands)
            if selected_indexes is None:
                selected = list(range(count))
            else:
                selected = list(selected_indexes)
            if not selected:
                raise ValueError("select at least one command to approve")
            if any(not isinstance(i, int) or i < 0 or i >= count for i in selected):
                raise ValueError("selectedIndexes are out of range")
            validated = dry.get("validatedIndexes")
            if isinstance(validated, list) and validated:
                validated_set = {i for i in validated if isinstance(i, int)}
                outside = [i for i in selected if i not in validated_set]
                if outside:
                    raise ValueError(
                        f"selectedIndexes {outside} were not covered by the passing "
                        "client dry-run — dry-run the full subset against the live "
                        "engine first, then approve again"
                    )
            seen: set[int] = set()
            ordered: list[int] = []
            for i in selected:
                if i not in seen:
                    seen.add(i)
                    ordered.append(i)
            subset = [commands[i] for i in ordered if isinstance(commands[i], dict)]
            row.selected_indexes_json = _json.dumps(ordered)
            row.status = "approved"
            row.updated_at = _now()
            session.commit()
        return self.get_proposal(proposal_id), [dict(c) for c in subset]

    def record_execution(
        self,
        proposal_id: str,
        *,
        history_entry_id: str,
        executed_indexes: list[int],
        success: bool,
        error: str,
    ) -> AiProposalRow:
        import json as _json

        with self._database.session() as session:
            row = session.get(AiProposalRow, proposal_id)
            if row is None:
                raise KeyError(proposal_id)
            if row.status not in ("approved", "executed", "execution_failed"):
                raise ValueError("proposal must be approved before execution can be recorded")
            session.add(
                AiProposalExecutionRow(
                    id=str(uuid4()),
                    proposal_id=proposal_id,
                    executed_indexes_json=_json.dumps(list(executed_indexes)),
                    history_entry_id=history_entry_id,
                    success=bool(success),
                    error=error or "",
                    created_at=_now(),
                )
            )
            row.status = "executed" if success else "execution_failed"
            row.updated_at = _now()
            session.commit()
        return self.get_proposal(proposal_id)


class StaleProposalError(ValueError):
    pass


def _load_slides(raw: str) -> list[dict[str, object]]:
    import json as _json

    try:
        data: object = _json.loads(raw or "[]")
    except (ValueError, TypeError):
        return []
    return data if isinstance(data, list) else []


def _normalize_plan_slides(raw: object) -> list[dict[str, object]]:
    slides: list[dict[str, object]] = []
    if not isinstance(raw, list):
        return slides
    for order, entry in enumerate(raw):
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title", ""))
        if not title.strip():
            continue
        assets: list[dict[str, object]] = []
        raw_assets = entry.get("requiredAssets", [])
        if isinstance(raw_assets, list):
            for asset in raw_assets:
                if not isinstance(asset, dict):
                    continue
                name = str(asset.get("name", ""))
                if not name.strip():
                    continue
                classification = str(asset.get("classification", "missing"))
                if classification not in ("existing", "missing", "optional"):
                    classification = "missing"
                item: dict[str, object] = {"name": name, "classification": classification}
                definition_id = asset.get("definitionId")
                if isinstance(definition_id, str) and definition_id.strip():
                    item["definitionId"] = definition_id
                assets.append(item)
        slide_id = entry.get("id")
        slides.append(
            {
                "id": slide_id if isinstance(slide_id, str) and slide_id else str(uuid4()),
                "order": order,
                "title": title,
                "goal": str(entry.get("goal", "")),
                "estimatedDurationSec": _safe_float(entry.get("estimatedDurationSec")),
                "explanation": str(entry.get("explanation", "")),
                "suggestedNarration": str(entry.get("suggestedNarration", "")),
                "requiredAssets": assets,
                "recommendedMaterials": _safe_str_list(entry.get("recommendedMaterials")),
                "recommendedShaders": _safe_str_list(entry.get("recommendedShaders")),
                "recommendedClips": _safe_str_list(entry.get("recommendedClips")),
            }
        )
    return slides


def _plan_snapshot(
    content: dict[str, object], slides: list[dict[str, object]]
) -> dict[str, object]:
    return {
        "title": content.get("title", ""),
        "description": content.get("description", ""),
        "language": content.get("language", "en"),
        "estimatedDurationSec": content.get("estimatedDurationSec", 0.0),
        "learningObjective": content.get("learningObjective", ""),
        "teachingStrategy": content.get("teachingStrategy", ""),
        "slides": slides,
    }


def _safe_float(value: object) -> float:
    try:
        if value is None:
            return 0.0
        if isinstance(value, (int, float)):
            number = float(value)
        elif isinstance(value, str) and value.strip():
            number = float(value.strip())
        else:
            return 0.0
    except (TypeError, ValueError):
        return 0.0
    return number if number >= 0 else 0.0


def _safe_str_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, (str, int, float))]
