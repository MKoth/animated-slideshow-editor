from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.model import Base


class AiSettingsRow(Base):
    """Singleton server-side provider record. id is always 'singleton'."""

    __tablename__ = "ai_settings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    endpoint: Mapped[str] = mapped_column(String(512), nullable=False)
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    temperature: Mapped[float] = mapped_column(nullable=False, default=0.7)
    max_tokens: Mapped[int] = mapped_column(nullable=False, default=2000)
    streaming: Mapped[bool] = mapped_column(nullable=False, default=True)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    encrypted_key: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiConversationRow(Base):
    """Project-scoped AI chat conversation. Never part of the .lesson file."""

    __tablename__ = "ai_conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiMessageRow(Base):
    """One chat message. Server reconstructs history from storage."""

    __tablename__ = "ai_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    stopped: Mapped[bool] = mapped_column(nullable=False, default=False)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiPlanRow(Base):
    """Lesson Plan proposal: pedagogy settled before building. Never in .lesson."""

    __tablename__ = "ai_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    language: Mapped[str] = mapped_column(String(64), nullable=False, default="en")
    estimated_duration_sec: Mapped[float] = mapped_column(nullable=False, default=0.0)
    learning_objective: Mapped[str] = mapped_column(Text, nullable=False, default="")
    teaching_strategy: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    slides_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    user_edits_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiPlanRevisionRow(Base):
    """One generation of a Lesson Plan with its source request."""

    __tablename__ = "ai_plan_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    plan_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_plans.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_request: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiProposalRow(Base):
    """Canonical AI Edit Proposal: server-validated commands, client dry-run,
    stale-blocking at approval, partial acceptance, execution records."""

    __tablename__ = "ai_proposals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft")
    commands_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    validation_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    base_fingerprint: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    validated_fingerprint: Mapped[str | None] = mapped_column(
        String(255), nullable=True, default=None
    )
    dry_run_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    selected_indexes_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiProposalExecutionRow(Base):
    """One execution attempt of a proposal subset as one Transaction."""

    __tablename__ = "ai_proposal_executions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    proposal_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_proposals.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    executed_indexes_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    history_entry_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    success: Mapped[bool] = mapped_column(nullable=False, default=False)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiScenarioRow(Base):
    """Action Scenario (Stage A): slide-agnostic ordered steps. Never in .lesson.

    Implements R27 ai_action_scenarios record: project-scoped,
    conversation-linked, revision history preserving author edits.
    """

    __tablename__ = "ai_scenarios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    steps_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    user_edits_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiScenarioRevisionRow(Base):
    """One generation of an Action Scenario with its source request."""

    __tablename__ = "ai_scenario_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    scenario_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_scenarios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_request: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiReconciliationRow(Base):
    """Stage B reconciliation: middle-step asset/motion/sound verdicts + briefs.

    Own versioned record with an explicit accept gate; Stage C reads only the
    accepted version. Never part of the .lesson file.
    """

    __tablename__ = "ai_reconciliations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    scenario_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    verdicts_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    briefs_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    decisions_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiReconciliationRevisionRow(Base):
    """One reconciliation run of an Action Scenario version."""

    __tablename__ = "ai_reconciliation_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    reconciliation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_reconciliations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_request: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
