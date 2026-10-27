from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.model import Base


class AiSettingsRow(Base):
    """Singleton server-side provider record. id is always 'singleton'."""

    __tablename__ = "ai_settings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    endpoint: Mapped[str] = mapped_column(String(512), nullable=False)
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    temperature: Mapped[float] = mapped_column(nullable=False, default=0.7)
    max_tokens: Mapped[int] = mapped_column(nullable=False, default=8000)
    streaming: Mapped[bool] = mapped_column(nullable=False, default=True)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    encrypted_key: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiConversationRow(Base):
    """Project-scoped AI chat conversation. Never part of the .lesson file.

    Slide assistants (script mode) scope a conversation to one slide via
    slide_id; project assistants leave it null.
    """

    __tablename__ = "ai_conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    mode: Mapped[str | None] = mapped_column(String(16), nullable=True, default=None)
    # Slide basis (script assistant): nullable so older databases backfill via ADD COLUMN.
    slide_id: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)
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
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # Scenario versioned edits (issue #462): per-message version links live
    # server-side with the project-scoped Conversation and never in the
    # portable file. Nullable so older databases backfill via ADD COLUMN.
    scenario_intent: Mapped[str | None] = mapped_column(String(16), nullable=True, default=None)
    scenario_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)
    scenario_summary: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    scenario_touched_steps_json: Mapped[str | None] = mapped_column(
        Text, nullable=True, default=None
    )


class AiProposalRow(Base):
    """Canonical AI Edit Proposal: server-validated commands, client dry-run,
    stale-blocking at approval, partial acceptance, execution records."""

    __tablename__ = "ai_proposals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    message_id: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)
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
    rejection_feedback: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
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


class AiScenarioMarkdownVersionRow(Base):
    """One append-only scenario markdown version (issue #462).

    Version list semantics mirror the portable `ScenarioSectionJSON` versions
    but these rows live server-side with the project-scoped Conversation and
    never in the portable file. Per-message links ride `AiMessageRow`.
    """

    __tablename__ = "ai_scenario_markdown_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    message_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("ai_messages.id", ondelete="CASCADE"),
        nullable=True,
        default=None,
        index=True,
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    touched_steps_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    base_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiScenarioMarkdownPointerRow(Base):
    """Per-project active + accepted markdown version pointers.

    Active (issue #462) is the latest draft: last-writer-wins, moving on
    every create/restore. Accepted (issue #466) is the stable downstream
    snapshot: set only by explicit accept, never moving on draft writes.
    Downstream reconciliation reads the accepted snapshot, never the
    active draft — so newer drafts are never silently ignored and
    unreviewed edits are never consumed.
    """

    __tablename__ = "ai_scenario_markdown_pointers"

    project_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    active_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)
    accepted_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiScenarioMarkdownAuditRow(Base):
    """Proposal-bypass audit entry for every markdown apply/restore (issue #462).

    Markdown iteration skips the AI Edit Proposal gates (no schema check, dry
    run, fingerprint, subset approve, or executions log) because doc writes are
    revertible text. Each apply still records this entry carrying version id,
    summary, touched steps, and timestamp. Concurrency is last-writer-wins.
    """

    __tablename__ = "ai_scenario_markdown_audits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    message_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("ai_messages.id", ondelete="CASCADE"),
        nullable=True,
        default=None,
    )
    version_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    touched_steps_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    operation: Mapped[str] = mapped_column(
        String(64), nullable=False, default="markdown-version-apply"
    )
    concurrency: Mapped[str] = mapped_column(String(32), nullable=False, default="last-writer-wins")


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


class AiNarrationRow(Base):
    """Stage C narration: verbatim Prompter fill + queued TTS batch state.

    Own versioned record with an explicit accept gate; Stages D/E read only
    the accepted version. Per-part TTS status lives here as record state
    (pending/ready/failed + stale flag) — the persisted PrompterPart status
    in the project stays stale|-absent only. Never part of the .lesson file.
    """

    __tablename__ = "ai_narrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    reconciliation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    scenario_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    default_voice_prompt_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, default=None
    )
    seconds_per_character: Mapped[float] = mapped_column(nullable=False, default=0.1)
    parts_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiNarrationRevisionRow(Base):
    """One narration fill of an accepted reconciliation version."""

    __tablename__ = "ai_narration_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    narration_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_narrations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_request: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiCalibrationRow(Base):
    """Stage D calibration: verify-only triple check + phoneme-timed mouth map.

    Own versioned record with an explicit accept gate; the merge reads only
    the accepted version. Verify-only: the record measures pregen audio,
    face-rig readiness, and camera framing — it never creates Shapes, never
    rewrites audio bytes, never rebinds morphs. Per-part mouth timing is
    either backend forced-alignment word timings mapped through the rig-local
    phoneme-to-Shape map or a clearly marked waveform-peaks envelope fallback
    driving a single Open coefficient. Never part of the .lesson file.
    """

    __tablename__ = "ai_calibrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    narration_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    scenario_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    intro_ref: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    outro_ref: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    phoneme_map_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    checks_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    timings_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiCalibrationRevisionRow(Base):
    """One calibration run of an accepted narration version."""

    __tablename__ = "ai_calibration_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    calibration_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_calibrations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_request: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiBoardRow(Base):
    """Stage E board scripts: hard-locked blackboard Animation Scripts.

    Own versioned record with an explicit accept gate; the merge reads only
    the accepted version. One fresh script per middle slide from zero with
    marks at each PrompterPart boundary; compiled footprints plus the
    marks-to-part map ride the record. Never part of the .lesson file.
    """

    __tablename__ = "ai_boards"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    narration_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    scenario_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    scripts_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    footprints_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    marks_map_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    checks_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    diagnostics_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AiBoardRevisionRow(Base):
    """One board authoring run of an accepted narration version."""

    __tablename__ = "ai_board_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    board_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_boards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_request: Mapped[str] = mapped_column(Text, nullable=False, default="")
    snapshot_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
