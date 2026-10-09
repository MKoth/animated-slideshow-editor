from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, func, select

from app.ai.crypto import decrypt_key, encrypt_key, mask_key
from app.ai.model import (
    AiBoardRevisionRow,
    AiBoardRow,
    AiCalibrationRevisionRow,
    AiCalibrationRow,
    AiConversationRow,
    AiMessageRow,
    AiNarrationRevisionRow,
    AiNarrationRow,
    AiPlanRevisionRow,
    AiPlanRow,
    AiProposalExecutionRow,
    AiProposalRow,
    AiReconciliationRevisionRow,
    AiReconciliationRow,
    AiScenarioRevisionRow,
    AiScenarioRow,
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
            scenario_ids = list(
                session.scalars(
                    select(AiScenarioRow.id).where(AiScenarioRow.project_id == project_id)
                )
            )
            if scenario_ids:
                session.execute(
                    delete(AiScenarioRevisionRow).where(
                        AiScenarioRevisionRow.scenario_id.in_(scenario_ids)
                    )
                )
                session.execute(delete(AiScenarioRow).where(AiScenarioRow.project_id == project_id))
            reconciliation_ids = list(
                session.scalars(
                    select(AiReconciliationRow.id).where(
                        AiReconciliationRow.project_id == project_id
                    )
                )
            )
            if reconciliation_ids:
                session.execute(
                    delete(AiReconciliationRevisionRow).where(
                        AiReconciliationRevisionRow.reconciliation_id.in_(reconciliation_ids)
                    )
                )
                session.execute(
                    delete(AiReconciliationRow).where(AiReconciliationRow.project_id == project_id)
                )
            narration_ids = list(
                session.scalars(
                    select(AiNarrationRow.id).where(AiNarrationRow.project_id == project_id)
                )
            )
            if narration_ids:
                session.execute(
                    delete(AiNarrationRevisionRow).where(
                        AiNarrationRevisionRow.narration_id.in_(narration_ids)
                    )
                )
                session.execute(
                    delete(AiNarrationRow).where(AiNarrationRow.project_id == project_id)
                )
            calibration_ids = list(
                session.scalars(
                    select(AiCalibrationRow.id).where(AiCalibrationRow.project_id == project_id)
                )
            )
            if calibration_ids:
                session.execute(
                    delete(AiCalibrationRevisionRow).where(
                        AiCalibrationRevisionRow.calibration_id.in_(calibration_ids)
                    )
                )
                session.execute(
                    delete(AiCalibrationRow).where(AiCalibrationRow.project_id == project_id)
                )
            board_ids = list(
                session.scalars(select(AiBoardRow.id).where(AiBoardRow.project_id == project_id))
            )
            if board_ids:
                session.execute(
                    delete(AiBoardRevisionRow).where(AiBoardRevisionRow.board_id.in_(board_ids))
                )
                session.execute(delete(AiBoardRow).where(AiBoardRow.project_id == project_id))
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

    # -- action scenarios (Stage A) ----------------------------------------

    def list_scenarios(self, project_id: str) -> list[AiScenarioRow]:
        statement = (
            select(AiScenarioRow)
            .where(AiScenarioRow.project_id == project_id)
            .order_by(AiScenarioRow.updated_at.desc(), AiScenarioRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get_scenario(self, scenario_id: str) -> AiScenarioRow:
        with self._database.session() as session:
            row = session.get(AiScenarioRow, scenario_id)
        if row is None:
            raise KeyError(scenario_id)
        return row

    def list_scenario_revisions(self, scenario_id: str) -> list[AiScenarioRevisionRow]:
        self.get_scenario(scenario_id)
        statement = (
            select(AiScenarioRevisionRow)
            .where(AiScenarioRevisionRow.scenario_id == scenario_id)
            .order_by(AiScenarioRevisionRow.created_at.asc(), AiScenarioRevisionRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def create_scenario(
        self,
        *,
        project_id: str,
        conversation_id: str,
        content: dict[str, object],
        source_request: str,
    ) -> AiScenarioRow:
        import json as _json

        steps = _normalize_scenario_steps(content.get("steps"))
        now = _now()
        scenario_id = str(uuid4())
        with self._database.session() as session:
            conv = session.get(AiConversationRow, conversation_id)
            if conv is None:
                raise AiConversationNotFoundError(conversation_id)
            row = AiScenarioRow(
                id=scenario_id,
                project_id=project_id,
                conversation_id=conversation_id,
                title=str(content.get("title", ""))[:255],
                description=str(content.get("description", "")),
                status="draft",
                steps_json=_json.dumps(steps),
                user_edits_json="{}",
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.add(
                AiScenarioRevisionRow(
                    id=str(uuid4()),
                    scenario_id=scenario_id,
                    source_request=source_request,
                    snapshot_json=_json.dumps(_scenario_snapshot(content, steps)),
                    created_at=now,
                )
            )
            session.commit()
        return self.get_scenario(scenario_id)

    def revise_scenario(
        self,
        scenario_id: str,
        *,
        content: dict[str, object],
        source_request: str,
    ) -> AiScenarioRow:
        import json as _json

        steps = _normalize_scenario_steps(content.get("steps"))
        snapshot = _scenario_snapshot(content, steps)
        with self._database.session() as session:
            row = session.get(AiScenarioRow, scenario_id)
            if row is None:
                raise KeyError(scenario_id)
            row.title = str(content.get("title", row.title))[:255]
            row.description = str(content.get("description", row.description))
            row.steps_json = _json.dumps(steps)
            # Regeneration invalidates any prior acceptance: the author must
            # re-accept the new version before Stage B may read it.
            row.status = "draft"
            row.updated_at = _now()
            session.add(
                AiScenarioRevisionRow(
                    id=str(uuid4()),
                    scenario_id=scenario_id,
                    source_request=source_request,
                    snapshot_json=_json.dumps(snapshot),
                    created_at=_now(),
                )
            )
            session.commit()
        return self.get_scenario(scenario_id)

    def update_scenario_edits(
        self,
        scenario_id: str,
        *,
        title: str | None = None,
        description: str | None = None,
        steps: list[dict[str, object]] | None = None,
    ) -> AiScenarioRow:
        import json as _json

        with self._database.session() as session:
            row = session.get(AiScenarioRow, scenario_id)
            if row is None:
                raise KeyError(scenario_id)
            try:
                loaded_edits: object = _json.loads(row.user_edits_json or "{}")
                user_edits = loaded_edits if isinstance(loaded_edits, dict) else {}
            except (ValueError, TypeError):
                user_edits = {}
            if not isinstance(user_edits, dict):
                user_edits = {}
            current_steps: list[dict[str, object]] = _load_scenario_steps(row.steps_json)

            if title is not None:
                row.title = title[:255]
                user_edits["title"] = title
            if description is not None:
                row.description = description
                user_edits["description"] = description
            if steps is not None:
                by_id = {s.get("id"): s for s in current_steps if isinstance(s.get("id"), str)}
                merged: list[dict[str, object]] = []
                step_fields = user_edits.get("stepFields")
                if not isinstance(step_fields, dict):
                    step_fields = {}
                    user_edits["stepFields"] = step_fields
                for order, patch in enumerate(steps):
                    sid = str(patch.get("id", ""))
                    existing = by_id.get(sid)
                    if existing is None:
                        raise ValueError(f"unknown step id: {sid}")
                    updated = dict(existing)
                    updated["order"] = order
                    override = (
                        dict(step_fields.get(sid, {}))
                        if isinstance(step_fields.get(sid), dict)
                        else {}
                    )
                    if "_oldSpokenLine" not in override and isinstance(
                        existing.get("spokenLine"), str
                    ):
                        override["_oldSpokenLine"] = existing.get("spokenLine")
                    if patch.get("partTag") is not None:
                        tag = patch["partTag"]
                        if tag not in ("intro", "middle", "outro"):
                            raise ValueError("partTag must be intro, middle, or outro")
                        updated["partTag"] = tag
                        override["partTag"] = tag
                    for field in ("spokenLine", "onScreenAction"):
                        if patch.get(field) is not None:
                            updated[field] = patch[field]
                            override[field] = patch[field]
                    if patch.get("assetHints") is not None:
                        hints = patch["assetHints"]
                        if not isinstance(hints, list) or any(
                            not isinstance(h, str) for h in hints
                        ):
                            raise ValueError("assetHints must be a list of names")
                        updated["assetHints"] = [str(h) for h in hints]
                        override["assetHints"] = [str(h) for h in hints]
                    if patch.get("estimatedDurationSec") is not None:
                        updated["estimatedDurationSec"] = patch["estimatedDurationSec"]
                        override["estimatedDurationSec"] = patch["estimatedDurationSec"]
                    merged.append(updated)
                    step_fields[sid] = override
                row.steps_json = _json.dumps(merged)
                user_edits["stepOrder"] = [str(p.get("id", "")) for p in steps]
            row.user_edits_json = _json.dumps(user_edits)
            # Author edits invalidate any prior acceptance: the edited version
            # must be re-accepted before Stage B may read it.
            row.status = "draft"
            row.updated_at = _now()
            session.commit()
        return self.get_scenario(scenario_id)

    def set_scenario_status(self, scenario_id: str, status: str) -> AiScenarioRow:
        if status not in ("draft", "accepted", "rejected"):
            raise ValueError("status must be draft, accepted, or rejected")
        with self._database.session() as session:
            row = session.get(AiScenarioRow, scenario_id)
            if row is None:
                raise KeyError(scenario_id)
            row.status = status
            row.updated_at = _now()
            session.commit()
        return self.get_scenario(scenario_id)

    def get_scenario_user_edits(self, scenario_id: str) -> dict[str, object]:
        import json as _json

        row = self.get_scenario(scenario_id)
        try:
            data: object = _json.loads(row.user_edits_json or "{}")
        except (ValueError, TypeError):
            return {}
        return data if isinstance(data, dict) else {}

    def require_accepted_scenario(self, scenario_id: str) -> AiScenarioRow:
        """Stage B gate: downstream reconciliation reads only accepted versions.

        Raises ValueError on a draft/rejected version so Stage B refuses to run
        until the author explicitly accepts.
        """
        row = self.get_scenario(scenario_id)
        if row.status != "accepted":
            raise ValueError(
                f"scenario {scenario_id} is {row.status} — "
                "accept it before reconciliation (Stage B reads only the accepted version)"
            )
        return row

    def scenario_canonical_json(self, scenario_id: str) -> dict[str, object]:
        """Canonical JSON of the accepted scenario version for Stage B handoff."""
        import json as _json

        row = self.require_accepted_scenario(scenario_id)
        try:
            steps: object = _json.loads(row.steps_json or "[]")
        except (ValueError, TypeError):
            steps = []
        return {
            "id": row.id,
            "projectId": row.project_id,
            "conversationId": row.conversation_id,
            "title": row.title,
            "description": row.description,
            "status": row.status,
            "steps": steps if isinstance(steps, list) else [],
        }

    # -- reconciliations (Stage B) -----------------------------------------

    def list_reconciliations(
        self, project_id: str, scenario_id: str | None = None
    ) -> list[AiReconciliationRow]:
        statement = select(AiReconciliationRow).where(AiReconciliationRow.project_id == project_id)
        if scenario_id:
            statement = statement.where(AiReconciliationRow.scenario_id == scenario_id)
        statement = statement.order_by(
            AiReconciliationRow.updated_at.desc(), AiReconciliationRow.id
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get_reconciliation(self, reconciliation_id: str) -> AiReconciliationRow:
        with self._database.session() as session:
            row = session.get(AiReconciliationRow, reconciliation_id)
        if row is None:
            raise KeyError(reconciliation_id)
        return row

    def list_reconciliation_revisions(
        self, reconciliation_id: str
    ) -> list[AiReconciliationRevisionRow]:
        self.get_reconciliation(reconciliation_id)
        statement = (
            select(AiReconciliationRevisionRow)
            .where(AiReconciliationRevisionRow.reconciliation_id == reconciliation_id)
            .order_by(AiReconciliationRevisionRow.created_at.asc(), AiReconciliationRevisionRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def create_reconciliation(
        self,
        *,
        project_id: str,
        scenario_id: str,
        conversation_id: str,
        title: str,
        verdicts: list[dict[str, object]],
        briefs: list[dict[str, object]],
        source_request: str,
        source_steps: list[dict[str, object]] | None = None,
    ) -> AiReconciliationRow:
        import json as _json

        now = _now()
        reconciliation_id = str(uuid4())
        with self._database.session() as session:
            conv = session.get(AiConversationRow, conversation_id)
            if conv is None:
                raise AiConversationNotFoundError(conversation_id)
            scenario = session.get(AiScenarioRow, scenario_id)
            if scenario is None:
                raise KeyError(scenario_id)
            if scenario.status != "accepted":
                raise ValueError(
                    f"scenario {scenario_id} is {scenario.status} — "
                    "accept it before reconciliation (Stage B reads only the accepted version)"
                )
            if scenario.project_id != project_id:
                raise ValueError("scenario does not belong to this project")
            row = AiReconciliationRow(
                id=reconciliation_id,
                project_id=project_id,
                scenario_id=scenario_id,
                conversation_id=conversation_id,
                title=(title or scenario.title or "")[:255],
                status="draft",
                verdicts_json=_json.dumps(verdicts),
                briefs_json=_json.dumps(briefs),
                decisions_json=_json.dumps({}),
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.add(
                AiReconciliationRevisionRow(
                    id=str(uuid4()),
                    reconciliation_id=reconciliation_id,
                    source_request=source_request,
                    snapshot_json=_json.dumps(
                        {
                            "scenarioId": scenario_id,
                            "steps": list(source_steps or []),
                            "verdicts": verdicts,
                            "briefs": briefs,
                        }
                    ),
                    created_at=now,
                )
            )
            session.commit()
        return self.get_reconciliation(reconciliation_id)

    def record_reconciliation_decision(
        self,
        reconciliation_id: str,
        *,
        step_id: str,
        hint: str,
        decision: str,
        definition_id: str | None = None,
    ) -> AiReconciliationRow:
        import json as _json

        if decision not in ("accept", "reject"):
            raise ValueError("decision must be accept or reject")
        clean_hint = hint.strip()
        if not clean_hint:
            raise ValueError("hint must be a non-empty string")
        if decision == "accept" and not (definition_id or "").strip():
            raise ValueError("accept requires a definitionId (any ranked or alternative candidate)")
        with self._database.session() as session:
            row = session.get(AiReconciliationRow, reconciliation_id)
            if row is None:
                raise KeyError(reconciliation_id)
            try:
                loaded: object = _json.loads(row.decisions_json or "{}")
                decisions = loaded if isinstance(loaded, dict) else {}
            except (ValueError, TypeError):
                decisions = {}
            key = f"{step_id}:{clean_hint}"
            if decision == "accept":
                decisions[key] = {
                    "stepId": step_id,
                    "hint": clean_hint,
                    "decision": "accepted",
                    "definitionId": (definition_id or "").strip(),
                    "updated": _now().isoformat(),
                }
            else:
                decisions[key] = {
                    "stepId": step_id,
                    "hint": clean_hint,
                    "decision": "rejected",
                    "definitionId": None,
                    "updated": _now().isoformat(),
                }
            row.decisions_json = _json.dumps(decisions)
            # A new decision re-opens the gate: the author must re-accept.
            row.status = "draft"
            row.updated_at = _now()
            session.commit()
        return self.get_reconciliation(reconciliation_id)

    def clear_reconciliation_decision(
        self, reconciliation_id: str, *, step_id: str, hint: str
    ) -> AiReconciliationRow:
        import json as _json

        with self._database.session() as session:
            row = session.get(AiReconciliationRow, reconciliation_id)
            if row is None:
                raise KeyError(reconciliation_id)
            try:
                loaded: object = _json.loads(row.decisions_json or "{}")
                decisions = loaded if isinstance(loaded, dict) else {}
            except (ValueError, TypeError):
                decisions = {}
            decisions.pop(f"{step_id}:{hint.strip()}", None)
            row.decisions_json = _json.dumps(decisions)
            row.status = "draft"
            row.updated_at = _now()
            session.commit()
        return self.get_reconciliation(reconciliation_id)

    def update_reconciliation_briefs(
        self,
        reconciliation_id: str,
        *,
        briefs: list[dict[str, object]],
    ) -> AiReconciliationRow:
        import json as _json

        with self._database.session() as session:
            row = session.get(AiReconciliationRow, reconciliation_id)
            if row is None:
                raise KeyError(reconciliation_id)
            try:
                loaded: object = _json.loads(row.briefs_json or "[]")
                current = loaded if isinstance(loaded, list) else []
            except (ValueError, TypeError):
                current = []
            by_id = {b.get("id"): b for b in current if isinstance(b, dict)}
            merged: list[dict[str, object]] = []
            for patch in briefs:
                if not isinstance(patch, dict):
                    continue
                bid = patch.get("id")
                existing = by_id.get(bid)
                if existing is None:
                    raise ValueError(f"unknown brief id: {bid}")
                updated = dict(existing)
                for field in ("prompt", "name", "note"):
                    if patch.get(field) is not None:
                        updated[field] = patch[field]
                variants = patch.get("variants")
                if isinstance(variants, dict):
                    current_variants = (
                        dict(updated["variants"])
                        if isinstance(updated.get("variants"), dict)
                        else {}
                    )
                    for kind in ("detailed", "concise", "stylized"):
                        if isinstance(variants.get(kind), str):
                            current_variants[kind] = variants[kind]
                    updated["variants"] = current_variants
                    if isinstance(patch.get("prompt"), str):
                        pass
                    elif isinstance(variants.get("detailed"), str):
                        updated["prompt"] = variants["detailed"]
                style = patch.get("styleProfile")
                if isinstance(style, dict):
                    updated["styleProfile"] = style
                merged.append(updated)
            # Preserve unpatched briefs in place.
            patched_ids = {p.get("id") for p in briefs if isinstance(p, dict)}
            full = [b for b in current if isinstance(b, dict) and b.get("id") not in patched_ids]
            full.extend(merged)
            # Keep stable order by hint for readability.
            full.sort(key=lambda b: str(b.get("hint", "")))
            row.briefs_json = _json.dumps(full)
            row.status = "draft"
            row.updated_at = _now()
            session.commit()
        return self.get_reconciliation(reconciliation_id)

    def set_reconciliation_status(self, reconciliation_id: str, status: str) -> AiReconciliationRow:
        if status not in ("draft", "accepted", "rejected"):
            raise ValueError("status must be draft, accepted, or rejected")
        with self._database.session() as session:
            row = session.get(AiReconciliationRow, reconciliation_id)
            if row is None:
                raise KeyError(reconciliation_id)
            row.status = status
            row.updated_at = _now()
            session.commit()
        return self.get_reconciliation(reconciliation_id)

    def get_reconciliation_decisions(self, reconciliation_id: str) -> dict[str, object]:
        import json as _json

        row = self.get_reconciliation(reconciliation_id)
        try:
            data: object = _json.loads(row.decisions_json or "{}")
        except (ValueError, TypeError):
            return {}
        return data if isinstance(data, dict) else {}

    def require_accepted_reconciliation(self, reconciliation_id: str) -> AiReconciliationRow:
        """Stage C gate: Prompter work waits on the accepted reconciliation."""
        row = self.get_reconciliation(reconciliation_id)
        if row.status != "accepted":
            raise ValueError(
                f"reconciliation {reconciliation_id} is {row.status} — "
                "accept it before Prompter work (Stage C reads only the accepted version)"
            )
        return row

    def reconciliation_canonical_json(self, reconciliation_id: str) -> dict[str, object]:
        """Accepted mappings + feasibility + briefs for the Stage C handoff."""
        import json as _json

        row = self.require_accepted_reconciliation(reconciliation_id)
        try:
            verdicts: object = _json.loads(row.verdicts_json or "[]")
        except (ValueError, TypeError):
            verdicts = []
        try:
            briefs: object = _json.loads(row.briefs_json or "[]")
        except (ValueError, TypeError):
            briefs = []
        try:
            decisions: object = _json.loads(row.decisions_json or "{}")
        except (ValueError, TypeError):
            decisions = {}
        return {
            "id": row.id,
            "projectId": row.project_id,
            "scenarioId": row.scenario_id,
            "conversationId": row.conversation_id,
            "status": row.status,
            "verdicts": verdicts if isinstance(verdicts, list) else [],
            "briefs": briefs if isinstance(briefs, list) else [],
            "decisions": decisions if isinstance(decisions, dict) else {},
        }

    # -- narrations (Stage C) ------------------------------------------------

    def list_narrations(
        self, project_id: str, reconciliation_id: str | None = None
    ) -> list[AiNarrationRow]:
        statement = select(AiNarrationRow).where(AiNarrationRow.project_id == project_id)
        if reconciliation_id:
            statement = statement.where(AiNarrationRow.reconciliation_id == reconciliation_id)
        statement = statement.order_by(AiNarrationRow.updated_at.desc(), AiNarrationRow.id)
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get_narration(self, narration_id: str) -> AiNarrationRow:
        with self._database.session() as session:
            row = session.get(AiNarrationRow, narration_id)
        if row is None:
            raise KeyError(narration_id)
        return row

    def list_narration_revisions(self, narration_id: str) -> list[AiNarrationRevisionRow]:
        self.get_narration(narration_id)
        statement = (
            select(AiNarrationRevisionRow)
            .where(AiNarrationRevisionRow.narration_id == narration_id)
            .order_by(AiNarrationRevisionRow.created_at.asc(), AiNarrationRevisionRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def create_narration(
        self,
        *,
        project_id: str,
        reconciliation_id: str,
        conversation_id: str,
        title: str,
        parts: list[dict[str, object]],
        seconds_per_character: float,
        default_voice_prompt_id: str | None,
        source_request: str,
    ) -> AiNarrationRow:
        import json as _json

        from app.ai.narrations import layout_parts

        if seconds_per_character <= 0:
            raise ValueError("secondsPerCharacter must be > 0")
        now = _now()
        narration_id = str(uuid4())
        with self._database.session() as session:
            conv = session.get(AiConversationRow, conversation_id)
            if conv is None:
                raise AiConversationNotFoundError(conversation_id)
            reconciliation = session.get(AiReconciliationRow, reconciliation_id)
            if reconciliation is None:
                raise KeyError(reconciliation_id)
            if reconciliation.status != "accepted":
                raise ValueError(
                    f"reconciliation {reconciliation_id} is {reconciliation.status} — "
                    "accept it before Prompter work (Stage C reads only the accepted version)"
                )
            if reconciliation.project_id != project_id:
                raise ValueError("reconciliation does not belong to this project")
            scenario = session.get(AiScenarioRow, reconciliation.scenario_id)
            scenario_id = reconciliation.scenario_id if scenario is not None else ""
            laid_out = layout_parts([dict(p) for p in parts])
            row = AiNarrationRow(
                id=narration_id,
                project_id=project_id,
                reconciliation_id=reconciliation_id,
                scenario_id=scenario_id,
                conversation_id=conversation_id,
                title=(title or reconciliation.title or "")[:255],
                status="draft",
                default_voice_prompt_id=default_voice_prompt_id,
                seconds_per_character=seconds_per_character,
                parts_json=_json.dumps(laid_out),
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.add(
                AiNarrationRevisionRow(
                    id=str(uuid4()),
                    narration_id=narration_id,
                    source_request=source_request,
                    snapshot_json=_json.dumps(
                        {
                            "reconciliationId": reconciliation_id,
                            "parts": laid_out,
                        }
                    ),
                    created_at=now,
                )
            )
            session.commit()
        return self.get_narration(narration_id)

    def _load_narration_parts(self, row: AiNarrationRow) -> list[dict[str, object]]:
        import json as _json

        try:
            loaded: object = _json.loads(row.parts_json or "[]")
        except (ValueError, TypeError):
            return []
        return [dict(p) for p in loaded] if isinstance(loaded, list) else []

    def _store_narration_parts(
        self, narration_id: str, parts: list[dict[str, object]], *, reopen: bool = True
    ) -> AiNarrationRow:
        import json as _json

        from app.ai.narrations import layout_parts

        with self._database.session() as session:
            row = session.get(AiNarrationRow, narration_id)
            if row is None:
                raise KeyError(narration_id)
            row.parts_json = _json.dumps(layout_parts([dict(p) for p in parts]))
            if reopen:
                row.status = "draft"
            row.updated_at = _now()
            session.commit()
        return self.get_narration(narration_id)

    def set_narration_voices(
        self,
        narration_id: str,
        *,
        default_voice_prompt_id: str | None = None,
        update_default: bool = False,
        part_voices: dict[str, str | None] | None = None,
    ) -> AiNarrationRow:
        row = self.get_narration(narration_id)
        parts = self._load_narration_parts(row)
        known_steps = {str(p.get("stepId", "")) for p in parts}
        if part_voices:
            for step_id in part_voices:
                if step_id not in known_steps:
                    raise ValueError(f"unknown narration step id: {step_id}")
        old_default = row.default_voice_prompt_id
        if update_default:
            new_default: str | None = (
                default_voice_prompt_id.strip()
                if isinstance(default_voice_prompt_id, str) and default_voice_prompt_id.strip()
                else None
            )
        else:
            new_default = old_default
        default_changed = update_default and (new_default or None) != (old_default or None)
        for part in parts:
            step_id = str(part.get("stepId", ""))
            override_changed = False
            if part_voices and step_id in part_voices:
                override = part_voices[step_id]
                normalized = (
                    override.strip() if isinstance(override, str) and override.strip() else None
                )
                if normalized != part.get("voicePromptId"):
                    override_changed = True
                part["voicePromptId"] = normalized
            # A voice change invalidates already-generated audio: the embedded
            # take used the old voice, so the part must regenerate before the
            # gate can pass (stale-blocking at build + accept).
            uses_default = part.get("voicePromptId") is None
            if (override_changed or (default_changed and uses_default)) and part.get("status") in (
                "ready",
                "failed",
            ):
                part["status"] = "pending"
                part["stale"] = False
                part["error"] = None
        with self._database.session() as session:
            stored = session.get(AiNarrationRow, narration_id)
            if stored is None:
                raise KeyError(narration_id)
            if update_default:
                stored.default_voice_prompt_id = (
                    default_voice_prompt_id.strip()
                    if isinstance(default_voice_prompt_id, str) and default_voice_prompt_id.strip()
                    else None
                )
            import json as _json

            from app.ai.narrations import layout_parts

            stored.parts_json = _json.dumps(layout_parts(parts))
            stored.status = "draft"
            stored.updated_at = _now()
            session.commit()
        return self.get_narration(narration_id)

    def record_narration_durations(
        self, narration_id: str, audio_durations: dict[str, float]
    ) -> AiNarrationRow:
        """Post-TTS adopt: store measured durations and shift downstream gap-free."""
        from app.ai.narrations import adopt_tts_durations

        row = self.get_narration(narration_id)
        parts = self._load_narration_parts(row)
        adopted = adopt_tts_durations(parts, audio_durations)
        return self._store_narration_parts(narration_id, adopted)

    def report_narration_part_ready(
        self, narration_id: str, *, step_id: str, asset_id: str, audio_duration: float
    ) -> AiNarrationRow:
        clean_asset = asset_id.strip()
        if not clean_asset:
            raise ValueError(
                "assetId must be a non-empty string — embed the WAV first, "
                "then reference the asset id (never inline base64)"
            )
        if not isinstance(audio_duration, (int, float)) or float(audio_duration) <= 0:
            raise ValueError("audioDuration must be > 0")
        row = self.get_narration(narration_id)
        parts = self._load_narration_parts(row)
        matched = False
        for part in parts:
            if str(part.get("stepId", "")) == step_id:
                part["assetId"] = clean_asset
                part["audioDuration"] = float(audio_duration)
                part["status"] = "ready"
                part["stale"] = False
                part["error"] = None
                matched = True
        if not matched:
            raise ValueError(f"unknown narration step id: {step_id}")
        return self._store_narration_parts(narration_id, parts)

    def report_narration_part_failed(
        self, narration_id: str, *, step_id: str, error: str
    ) -> AiNarrationRow:
        row = self.get_narration(narration_id)
        parts = self._load_narration_parts(row)
        matched = False
        for part in parts:
            if str(part.get("stepId", "")) == step_id:
                part["status"] = "failed"
                part["stale"] = True
                part["error"] = error.strip() or "TTS generation failed"
                matched = True
        if not matched:
            raise ValueError(f"unknown narration step id: {step_id}")
        return self._store_narration_parts(narration_id, parts)

    def retry_narration_part(self, narration_id: str, *, step_id: str) -> AiNarrationRow:
        row = self.get_narration(narration_id)
        parts = self._load_narration_parts(row)
        matched = False
        for part in parts:
            if str(part.get("stepId", "")) == step_id:
                part["status"] = "pending"
                part["stale"] = False
                part["error"] = None
                matched = True
        if not matched:
            raise ValueError(f"unknown narration step id: {step_id}")
        return self._store_narration_parts(narration_id, parts)

    def set_narration_status(self, narration_id: str, status: str) -> AiNarrationRow:
        from app.ai.narrations import narration_accept_blockers

        if status not in ("draft", "accepted", "rejected"):
            raise ValueError("status must be draft, accepted, or rejected")
        row = self.get_narration(narration_id)
        if status == "accepted":
            blockers = narration_accept_blockers(self._load_narration_parts(row))
            if blockers:
                raise ValueError("narration is not ready to accept — " + "; ".join(blockers))
        with self._database.session() as session:
            stored = session.get(AiNarrationRow, narration_id)
            if stored is None:
                raise KeyError(narration_id)
            stored.status = status
            stored.updated_at = _now()
            session.commit()
        return self.get_narration(narration_id)

    def require_accepted_narration(self, narration_id: str) -> AiNarrationRow:
        """Stage D/E gate: calibration and board work wait on accepted narration."""
        row = self.get_narration(narration_id)
        if row.status != "accepted":
            raise ValueError(
                f"narration {narration_id} is {row.status} — "
                "accept it before calibration/board work (Stages D/E read only "
                "the accepted version)"
            )
        return row

    def narration_canonical_json(self, narration_id: str) -> dict[str, object]:
        """Accepted PrompterPart timings + audio bindings for the Stage D/E handoff."""
        import json as _json

        row = self.require_accepted_narration(narration_id)
        try:
            parts: object = _json.loads(row.parts_json or "[]")
        except (ValueError, TypeError):
            parts = []
        return {
            "id": row.id,
            "projectId": row.project_id,
            "reconciliationId": row.reconciliation_id,
            "scenarioId": row.scenario_id,
            "conversationId": row.conversation_id,
            "status": row.status,
            "defaultVoicePromptId": row.default_voice_prompt_id,
            "secondsPerCharacter": row.seconds_per_character,
            "parts": parts if isinstance(parts, list) else [],
            "slideDuration": sum(
                float(p.get("audioDuration") or p.get("estimatedDuration") or 0.0)
                for p in (parts if isinstance(parts, list) else [])
                if isinstance(p, dict)
            ),
        }

    # -- calibrations (Stage D) ----------------------------------------------

    def list_calibrations(
        self, project_id: str, narration_id: str | None = None
    ) -> list[AiCalibrationRow]:
        statement = select(AiCalibrationRow).where(AiCalibrationRow.project_id == project_id)
        if narration_id:
            statement = statement.where(AiCalibrationRow.narration_id == narration_id)
        statement = statement.order_by(AiCalibrationRow.updated_at.desc(), AiCalibrationRow.id)
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get_calibration(self, calibration_id: str) -> AiCalibrationRow:
        with self._database.session() as session:
            row = session.get(AiCalibrationRow, calibration_id)
        if row is None:
            raise KeyError(calibration_id)
        return row

    def list_calibration_revisions(self, calibration_id: str) -> list[AiCalibrationRevisionRow]:
        self.get_calibration(calibration_id)
        statement = (
            select(AiCalibrationRevisionRow)
            .where(AiCalibrationRevisionRow.calibration_id == calibration_id)
            .order_by(AiCalibrationRevisionRow.created_at.asc(), AiCalibrationRevisionRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def _load_calibration_timings(self, row: AiCalibrationRow) -> list[dict[str, object]]:
        import json as _json

        try:
            loaded: object = _json.loads(row.timings_json or "[]")
        except (ValueError, TypeError):
            return []
        return [dict(t) for t in loaded] if isinstance(loaded, list) else []

    def _load_calibration_checks(self, row: AiCalibrationRow) -> dict[str, object]:
        import json as _json

        try:
            loaded: object = _json.loads(row.checks_json or "{}")
        except (ValueError, TypeError):
            return {}
        return dict(loaded) if isinstance(loaded, dict) else {}

    def _store_calibration_timings(
        self, calibration_id: str, timings: list[dict[str, object]], *, reopen: bool = True
    ) -> AiCalibrationRow:
        import json as _json

        with self._database.session() as session:
            row = session.get(AiCalibrationRow, calibration_id)
            if row is None:
                raise KeyError(calibration_id)
            row.timings_json = _json.dumps(timings)
            if reopen:
                row.status = "draft"
            row.updated_at = _now()
            session.commit()
        return self.get_calibration(calibration_id)

    def create_calibration(
        self,
        *,
        project_id: str,
        narration_id: str,
        conversation_id: str,
        title: str,
        intro_ref: str,
        outro_ref: str,
        phoneme_map: dict[str, str] | None,
        checks: dict[str, object],
        timings: list[dict[str, object]],
        source_request: str,
    ) -> AiCalibrationRow:
        import json as _json

        from app.ai.calibrations import INTRO_OUTRO_TAGS

        now = _now()
        calibration_id = str(uuid4())
        with self._database.session() as session:
            conv = session.get(AiConversationRow, conversation_id)
            if conv is None:
                raise AiConversationNotFoundError(conversation_id)
            narration = session.get(AiNarrationRow, narration_id)
            if narration is None:
                raise KeyError(narration_id)
            if narration.status != "accepted":
                raise ValueError(
                    f"narration {narration_id} is {narration.status} — "
                    "accept it before calibration/board work (Stages D/E read only "
                    "the accepted version)"
                )
            if narration.project_id != project_id:
                raise ValueError("narration does not belong to this project")
            scenario = session.get(AiScenarioRow, narration.scenario_id)
            scenario_id = narration.scenario_id if scenario is not None else ""
            for timing in timings:
                tag = str(timing.get("partTag", ""))
                if tag not in INTRO_OUTRO_TAGS:
                    raise ValueError(
                        f"part {timing.get('stepId', '?')}: mouth and camera stay on "
                        "intro/outro cat nodes (blackboard middle excluded)"
                    )
            if not timings:
                raise ValueError("no intro/outro steps with spoken lines — nothing to calibrate")
            row = AiCalibrationRow(
                id=calibration_id,
                project_id=project_id,
                narration_id=narration_id,
                scenario_id=scenario_id,
                conversation_id=conversation_id,
                title=(title or narration.title or "")[:255],
                status="draft",
                intro_ref=(intro_ref or "")[:255],
                outro_ref=(outro_ref or "")[:255],
                phoneme_map_json=_json.dumps(dict(phoneme_map or {})),
                checks_json=_json.dumps(checks),
                timings_json=_json.dumps(timings),
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.add(
                AiCalibrationRevisionRow(
                    id=str(uuid4()),
                    calibration_id=calibration_id,
                    source_request=source_request,
                    snapshot_json=_json.dumps(
                        {
                            "narrationId": narration_id,
                            "checks": checks,
                            "timings": timings,
                        }
                    ),
                    created_at=now,
                )
            )
            session.commit()
        return self.get_calibration(calibration_id)

    def _load_calibration_phoneme_map(self, row: AiCalibrationRow) -> dict[str, str]:
        import json as _json

        try:
            loaded: object = _json.loads(row.phoneme_map_json or "{}")
        except (ValueError, TypeError):
            return {}
        if not isinstance(loaded, dict):
            return {}
        return {str(k): str(v) for k, v in loaded.items() if isinstance(v, str) and v.strip()}

    def _mouth_shapes_for_row(self, row: AiCalibrationRow) -> list[str]:
        checks = self._load_calibration_checks(row)
        face = checks.get("faceRig", {})
        if not isinstance(face, dict):
            return []
        shapes = face.get("mouthShapes", [])
        return (
            [s for s in shapes if isinstance(s, str) and s.strip()]
            if isinstance(shapes, list)
            else []
        )

    def record_calibration_words(
        self, calibration_id: str, *, step_id: str, words: list[dict[str, object]]
    ) -> AiCalibrationRow:
        from app.ai.calibrations import OPEN_SHAPE, map_words_to_shapes, validate_aligner_words

        _ = OPEN_SHAPE
        row = self.get_calibration(calibration_id)
        timings = self._load_calibration_timings(row)
        phoneme_map = self._load_calibration_phoneme_map(row)
        mouth_shapes = self._mouth_shapes_for_row(row)
        matched = False
        for timing in timings:
            if str(timing.get("stepId", "")) == step_id:
                spoken = str(timing.get("spokenLine", ""))
                duration = timing.get("audioDuration")
                duration_f = float(duration) if isinstance(duration, (int, float)) else 0.0
                errors = validate_aligner_words(spoken, duration_f, words)
                if errors:
                    raise ValueError("; ".join(errors))
                # Enrich with phoneme/shape so missing rig shapes block the gate
                # (soft-warn-and-skip wired into calibration_accept_blockers).
                enriched = map_words_to_shapes([dict(w) for w in words], phoneme_map)
                missing: list[str] = []
                for entry in enriched:
                    shape = entry.get("shape")
                    if not isinstance(shape, str) or not shape.strip():
                        label = f"phoneme {entry.get('phoneme')} (word {entry.get('word')!r})"
                        if label not in missing:
                            missing.append(label)
                    elif shape not in mouth_shapes:
                        if shape not in missing:
                            missing.append(shape)
                timing["words"] = enriched
                timing["fallback"] = False
                timing["envelope"] = []
                timing["missingShapes"] = missing
                matched = True
        if not matched:
            raise ValueError(f"unknown calibration step id: {step_id}")
        return self._store_calibration_timings(calibration_id, timings)

    def record_calibration_fallback(
        self,
        calibration_id: str,
        *,
        step_id: str,
        peaks: list[int],
        audio_duration: float | None = None,
    ) -> AiCalibrationRow:
        from app.ai.calibrations import OPEN_SHAPE, envelope_coefficients

        row = self.get_calibration(calibration_id)
        timings = self._load_calibration_timings(row)
        mouth_shapes = self._mouth_shapes_for_row(row)
        matched = False
        for timing in timings:
            if str(timing.get("stepId", "")) == step_id:
                duration = audio_duration
                if duration is None:
                    stored = timing.get("audioDuration")
                    duration = float(stored) if isinstance(stored, (int, float)) else 0.0
                envelope = envelope_coefficients(peaks, float(duration))
                timing["audioDuration"] = float(duration)
                timing["words"] = []
                timing["fallback"] = True
                timing["envelope"] = envelope
                timing["missingShapes"] = [] if OPEN_SHAPE in mouth_shapes else [OPEN_SHAPE]
                matched = True
        if not matched:
            raise ValueError(f"unknown calibration step id: {step_id}")
        return self._store_calibration_timings(calibration_id, timings)

    def set_calibration_status(self, calibration_id: str, status: str) -> AiCalibrationRow:
        from app.ai.calibrations import calibration_accept_blockers

        if status not in ("draft", "accepted", "rejected"):
            raise ValueError("status must be draft, accepted, or rejected")
        row = self.get_calibration(calibration_id)
        if status == "accepted":
            blockers = calibration_accept_blockers(
                {
                    "checks": self._load_calibration_checks(row),
                    "timings": self._load_calibration_timings(row),
                }
            )
            if blockers:
                raise ValueError("calibration is not ready to accept — " + "; ".join(blockers))
        with self._database.session() as session:
            stored = session.get(AiCalibrationRow, calibration_id)
            if stored is None:
                raise KeyError(calibration_id)
            stored.status = status
            stored.updated_at = _now()
            session.commit()
        return self.get_calibration(calibration_id)

    def require_accepted_calibration(self, calibration_id: str) -> AiCalibrationRow:
        """Merge gate: assembly reads only the accepted calibration version."""
        row = self.get_calibration(calibration_id)
        if row.status != "accepted":
            raise ValueError(
                f"calibration {calibration_id} is {row.status} — "
                "accept it before the merge (assembly reads only the accepted version)"
            )
        return row

    def calibration_canonical_json(self, calibration_id: str) -> dict[str, object]:
        """Rig-readiness refs + per-part word-timing map + camera keys for the merge."""
        import json as _json

        row = self.require_accepted_calibration(calibration_id)
        try:
            checks: object = _json.loads(row.checks_json or "{}")
        except (ValueError, TypeError):
            checks = {}
        try:
            timings: object = _json.loads(row.timings_json or "[]")
        except (ValueError, TypeError):
            timings = []
        try:
            phoneme_map: object = _json.loads(row.phoneme_map_json or "{}")
        except (ValueError, TypeError):
            phoneme_map = {}
        return {
            "id": row.id,
            "projectId": row.project_id,
            "narrationId": row.narration_id,
            "scenarioId": row.scenario_id,
            "conversationId": row.conversation_id,
            "status": row.status,
            "title": row.title,
            "introRef": row.intro_ref,
            "outroRef": row.outro_ref,
            "phonemeMap": phoneme_map if isinstance(phoneme_map, dict) else {},
            "checks": checks if isinstance(checks, dict) else {},
            "timings": timings if isinstance(timings, list) else [],
        }

    # -- boards (Stage E) ----------------------------------------------------

    def list_boards(self, project_id: str, narration_id: str | None = None) -> list[AiBoardRow]:
        statement = select(AiBoardRow).where(AiBoardRow.project_id == project_id)
        if narration_id:
            statement = statement.where(AiBoardRow.narration_id == narration_id)
        statement = statement.order_by(AiBoardRow.updated_at.desc(), AiBoardRow.id)
        with self._database.session() as session:
            return list(session.scalars(statement))

    def get_board(self, board_id: str) -> AiBoardRow:
        with self._database.session() as session:
            row = session.get(AiBoardRow, board_id)
        if row is None:
            raise KeyError(board_id)
        return row

    def list_board_revisions(self, board_id: str) -> list[AiBoardRevisionRow]:
        self.get_board(board_id)
        statement = (
            select(AiBoardRevisionRow)
            .where(AiBoardRevisionRow.board_id == board_id)
            .order_by(AiBoardRevisionRow.created_at.asc(), AiBoardRevisionRow.id)
        )
        with self._database.session() as session:
            return list(session.scalars(statement))

    def _load_board_parts(self, row: AiBoardRow) -> list[dict[str, object]]:
        # Parts are the accepted narration snapshot, copied at creation so the
        # hard lock stays pinned even if narration is later revised. Stored
        # inside checks_json under "parts" to avoid a new column.
        import json as _json

        try:
            checks: object = _json.loads(row.checks_json or "{}")
        except (ValueError, TypeError):
            return []
        if isinstance(checks, dict):
            parts = checks.get("parts", [])
            if isinstance(parts, list):
                return [dict(p) for p in parts if isinstance(p, dict)]
        return []

    def _load_board_scripts(self, row: AiBoardRow) -> list[dict[str, object]]:
        import json as _json

        try:
            loaded: object = _json.loads(row.scripts_json or "[]")
        except (ValueError, TypeError):
            return []
        return [dict(s) for s in loaded] if isinstance(loaded, list) else []

    def _load_board_footprints(self, row: AiBoardRow) -> list[dict[str, object]]:
        import json as _json

        try:
            loaded: object = _json.loads(row.footprints_json or "[]")
        except (ValueError, TypeError):
            return []
        return [dict(f) for f in loaded] if isinstance(loaded, list) else []

    def _load_board_marks_map(self, row: AiBoardRow) -> dict[str, object]:
        import json as _json

        try:
            loaded: object = _json.loads(row.marks_map_json or "{}")
        except (ValueError, TypeError):
            return {}
        return dict(loaded) if isinstance(loaded, dict) else {}

    def _load_board_checks(self, row: AiBoardRow) -> dict[str, object]:
        import json as _json

        try:
            loaded: object = _json.loads(row.checks_json or "{}")
        except (ValueError, TypeError):
            return {}
        return dict(loaded) if isinstance(loaded, dict) else {}

    def _load_board_diagnostics(self, row: AiBoardRow) -> list[dict[str, object]]:
        import json as _json

        try:
            loaded: object = _json.loads(row.diagnostics_json or "[]")
        except (ValueError, TypeError):
            return []
        return [dict(d) for d in loaded] if isinstance(loaded, list) else []

    def create_board(
        self,
        *,
        project_id: str,
        narration_id: str,
        conversation_id: str,
        title: str,
        scripts: list[dict[str, object]],
        parts: list[dict[str, object]],
        marks_map: dict[str, object],
        scene: dict[str, object],
        source_request: str,
    ) -> AiBoardRow:
        import json as _json

        from app.ai.boards import middle_parts_from_narration

        now = _now()
        board_id = str(uuid4())
        with self._database.session() as session:
            conv = session.get(AiConversationRow, conversation_id)
            if conv is None:
                raise AiConversationNotFoundError(conversation_id)
            narration = session.get(AiNarrationRow, narration_id)
            if narration is None:
                raise KeyError(narration_id)
            if narration.status != "accepted":
                raise ValueError(
                    f"narration {narration_id} is {narration.status} — "
                    "accept it before board work (Stage E reads only the accepted version)"
                )
            if narration.project_id != project_id:
                raise ValueError("narration does not belong to this project")
            scenario = session.get(AiScenarioRow, narration.scenario_id)
            scenario_id = narration.scenario_id if scenario is not None else ""
            # Pin the accepted timing source; raises on unmeasurable parts.
            ordered = middle_parts_from_narration([dict(p) for p in parts])
            if not scripts:
                raise ValueError("no board scripts — author one fresh script per middle slide")
            checks = {"parts": ordered, "scene": dict(scene)}
            row = AiBoardRow(
                id=board_id,
                project_id=project_id,
                narration_id=narration_id,
                scenario_id=scenario_id,
                conversation_id=conversation_id,
                title=(title or narration.title or "")[:255],
                status="draft",
                scripts_json=_json.dumps(scripts),
                footprints_json=_json.dumps([]),
                marks_map_json=_json.dumps(dict(marks_map)),
                checks_json=_json.dumps(checks),
                diagnostics_json=_json.dumps([]),
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.add(
                AiBoardRevisionRow(
                    id=str(uuid4()),
                    board_id=board_id,
                    source_request=source_request,
                    snapshot_json=_json.dumps(
                        {"narrationId": narration_id, "scripts": scripts, "parts": ordered}
                    ),
                    created_at=now,
                )
            )
            session.commit()
        return self.get_board(board_id)

    def update_board_scripts(
        self, board_id: str, *, scripts: list[dict[str, object]]
    ) -> AiBoardRow:
        import json as _json

        if not scripts:
            raise ValueError("no board scripts — author one fresh script per middle slide")
        for index, script in enumerate(scripts):
            if not isinstance(script, dict):
                raise ValueError(f"slide #{index}: script entry is corrupt")  # noqa: TRY004
            if not str(script.get("slideId", "")).strip() and script.get("slideIndex") is None:
                raise ValueError(f"slide #{index}: script needs a slideId or slideIndex")
            if not isinstance(script.get("source"), str) or not str(script.get("source")).strip():
                raise ValueError(f"slide #{index}: script is empty — author it before accepting")
        with self._database.session() as session:
            row = session.get(AiBoardRow, board_id)
            if row is None:
                raise KeyError(board_id)
            row.scripts_json = _json.dumps([dict(s) for s in scripts])
            # New sources invalidate the last compile: footprints must be
            # re-reported before the gate can pass (stale-blocking at build).
            row.footprints_json = _json.dumps([])
            row.diagnostics_json = _json.dumps([])
            row.status = "draft"
            row.updated_at = _now()
            session.add(
                AiBoardRevisionRow(
                    id=str(uuid4()),
                    board_id=board_id,
                    source_request="edit board scripts",
                    snapshot_json=_json.dumps({"scripts": [dict(s) for s in scripts]}),
                    created_at=_now(),
                )
            )
            session.commit()
        return self.get_board(board_id)

    def update_board_scene(
        self,
        board_id: str,
        *,
        cat_nodes: list[str] | None = None,
        camera_keys: list[dict[str, object]] | None = None,
    ) -> AiBoardRow:
        import json as _json

        with self._database.session() as session:
            row = session.get(AiBoardRow, board_id)
            if row is None:
                raise KeyError(board_id)
            try:
                checks: object = _json.loads(row.checks_json or "{}")
            except (ValueError, TypeError):
                checks = {}
            checks_dict = dict(checks) if isinstance(checks, dict) else {}
            scene = checks_dict.get("scene", {})
            scene_dict = dict(scene) if isinstance(scene, dict) else {}
            if cat_nodes is not None:
                scene_dict["catNodes"] = [str(c) for c in cat_nodes]
            if camera_keys is not None:
                scene_dict["cameraKeys"] = [dict(k) for k in camera_keys]
            checks_dict["scene"] = scene_dict
            row.checks_json = _json.dumps(checks_dict)
            row.status = "draft"
            row.updated_at = _now()
            session.add(
                AiBoardRevisionRow(
                    id=str(uuid4()),
                    board_id=board_id,
                    source_request="update board scene",
                    snapshot_json=_json.dumps({"scene": scene_dict}),
                    created_at=_now(),
                )
            )
            session.commit()
        return self.get_board(board_id)

    def report_board_compile(
        self,
        board_id: str,
        *,
        footprints: list[dict[str, object]],
        marks_map: dict[str, object] | None = None,
        diagnostics: list[dict[str, object]] | None = None,
        cat_nodes: list[str] | None = None,
        camera_keys: list[dict[str, object]] | None = None,
    ) -> AiBoardRow:
        import json as _json

        with self._database.session() as session:
            row = session.get(AiBoardRow, board_id)
            if row is None:
                raise KeyError(board_id)
            row.footprints_json = _json.dumps([dict(f) for f in footprints])
            if marks_map is not None:
                row.marks_map_json = _json.dumps(dict(marks_map))
            row.diagnostics_json = _json.dumps([dict(d) for d in (diagnostics or [])])
            try:
                checks: object = _json.loads(row.checks_json or "{}")
            except (ValueError, TypeError):
                checks = {}
            checks_dict = dict(checks) if isinstance(checks, dict) else {}
            scene = checks_dict.get("scene", {})
            scene_dict = dict(scene) if isinstance(scene, dict) else {}
            if cat_nodes is not None:
                scene_dict["catNodes"] = [str(c) for c in cat_nodes]
            if camera_keys is not None:
                scene_dict["cameraKeys"] = [dict(k) for k in camera_keys]
            checks_dict["scene"] = scene_dict
            row.checks_json = _json.dumps(checks_dict)
            row.status = "draft"
            row.updated_at = _now()
            session.add(
                AiBoardRevisionRow(
                    id=str(uuid4()),
                    board_id=board_id,
                    source_request="compile board scripts",
                    snapshot_json=_json.dumps({"footprints": [dict(f) for f in footprints]}),
                    created_at=_now(),
                )
            )
            session.commit()
        return self.get_board(board_id)

    def set_board_status(self, board_id: str, status: str) -> AiBoardRow:
        from app.ai.boards import board_accept_blockers

        if status not in ("draft", "accepted", "rejected"):
            raise ValueError("status must be draft, accepted, or rejected")
        row = self.get_board(board_id)
        if status == "accepted":
            blockers = board_accept_blockers(
                {
                    "parts": self._load_board_parts(row),
                    "scripts": self._load_board_scripts(row),
                    "footprints": self._load_board_footprints(row),
                    "marksMap": self._load_board_marks_map(row),
                    "diagnostics": self._load_board_diagnostics(row),
                    "checks": self._load_board_checks(row),
                }
            )
            if blockers:
                raise ValueError("board is not ready to accept — " + "; ".join(blockers))
        with self._database.session() as session:
            stored = session.get(AiBoardRow, board_id)
            if stored is None:
                raise KeyError(board_id)
            stored.status = status
            stored.updated_at = _now()
            session.commit()
        return self.get_board(board_id)

    def require_accepted_board(self, board_id: str) -> AiBoardRow:
        """Merge gate: assembly reads only the accepted board version."""
        row = self.get_board(board_id)
        if row.status != "accepted":
            raise ValueError(
                f"board {board_id} is {row.status} — "
                "accept it before the merge (assembly reads only the accepted version)"
            )
        return row

    def board_canonical_json(self, board_id: str) -> dict[str, object]:
        """Accepted per-slide scripts + footprints + marks map for the merge."""
        import json as _json

        row = self.require_accepted_board(board_id)
        try:
            scripts: object = _json.loads(row.scripts_json or "[]")
        except (ValueError, TypeError):
            scripts = []
        try:
            footprints: object = _json.loads(row.footprints_json or "[]")
        except (ValueError, TypeError):
            footprints = []
        try:
            marks_map: object = _json.loads(row.marks_map_json or "{}")
        except (ValueError, TypeError):
            marks_map = {}
        try:
            checks: object = _json.loads(row.checks_json or "{}")
        except (ValueError, TypeError):
            checks = {}
        return {
            "id": row.id,
            "projectId": row.project_id,
            "narrationId": row.narration_id,
            "scenarioId": row.scenario_id,
            "conversationId": row.conversation_id,
            "status": row.status,
            "title": row.title,
            "scripts": scripts if isinstance(scripts, list) else [],
            "footprints": footprints if isinstance(footprints, list) else [],
            "marksMap": marks_map if isinstance(marks_map, dict) else {},
            "checks": checks if isinstance(checks, dict) else {},
        }

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


def _load_scenario_steps(raw: str) -> list[dict[str, object]]:
    import json as _json

    try:
        data: object = _json.loads(raw or "[]")
    except (ValueError, TypeError):
        return []
    return data if isinstance(data, list) else []


def _normalize_scenario_steps(raw: object) -> list[dict[str, object]]:
    steps: list[dict[str, object]] = []
    if not isinstance(raw, list):
        return steps
    for order, entry in enumerate(raw):
        if not isinstance(entry, dict):
            continue
        part_tag = str(entry.get("partTag", ""))
        if part_tag not in ("intro", "middle", "outro"):
            continue
        spoken = str(entry.get("spokenLine", ""))
        if not spoken.strip():
            continue
        action = str(entry.get("onScreenAction", ""))
        if not action.strip():
            continue
        hints = entry.get("assetHints", [])
        clean_hints: list[str] = []
        if isinstance(hints, list):
            for hint in hints:
                if isinstance(hint, str) and hint.strip():
                    clean_hints.append(hint.strip())
        step_id = entry.get("id")
        steps.append(
            {
                "id": step_id if isinstance(step_id, str) and step_id else str(uuid4()),
                "order": order,
                "partTag": part_tag,
                "spokenLine": spoken,
                "onScreenAction": action,
                "assetHints": clean_hints,
                "estimatedDurationSec": _safe_float(entry.get("estimatedDurationSec")),
            }
        )
    return steps


def _scenario_snapshot(
    content: dict[str, object], steps: list[dict[str, object]]
) -> dict[str, object]:
    return {
        "title": content.get("title", ""),
        "description": content.get("description", ""),
        "steps": steps,
    }
