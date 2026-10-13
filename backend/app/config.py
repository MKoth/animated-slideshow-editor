import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "var"
DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024
DEFAULT_ZEN_URL = "https://opencode.ai/zen/go/v1"
DEFAULT_FALLBACK_MODELS = ("kimi-k2.6",)
DEFAULT_CONTEXT_BUDGET = 8000
DEFAULT_SYSTEM_PROMPT = (
    "You are the AI lesson advisor inside the AI Slideshow Editor. "
    "Answer with the read-only project context in mind and never claim to edit the project directly. "
    "Proposals are canonical engine commands reviewed and approved by the user. "
    "Stages A-E (scenario, reconciliation, prompter/TTS, calibration, board scripts) run only on accepted prior versions."
)
DEFAULT_SHAPE_SYSTEM_PROMPT = (
    "You are the AI shape advisor inside the AI Slideshow Editor. "
    "Answer with the read-only shape context in mind (scene nodes with stable ids, "
    "meshes, shape inventories, morph bindings) and never claim to edit the project directly. "
    "Proposals are canonical engine commands reviewed and approved by the user. "
    "Author exactly one reviewable Shape create, update, or delete step per turn: "
    "preserve the target mesh vertex count, name sourceShapeId with a closest-fit source, "
    "and target stable ids. "
    "Never emit animation scripts, clips, clip collections, or sequence work — "
    "those belong to the Animation and Collections assistants, not this mode. "
    "Put the single source of truth for Apply in one fenced ```shape-step block with "
    "key: value lines — action: create|update|delete, node: <target node id>, plus "
    "source: <source shape id or name> and name: <new shape name> for create; "
    "target: <shape id> plus source: for update; shape: <shape id or name> for delete. "
    "Never put pseudo-syntax or prose inside the block. Keep short prose around it with "
    "the same fields. "
    "Without a transform line the draft duplicates the source Shape verbatim. To author "
    "genuinely new pose geometry, add one transform: rotate needs degrees: <-180–180> "
    "(pivot: <x, y> defaults to the shape centroid); scale needs scale: <factor> or "
    "scale: <sx>, <sy>; translate needs shift: <dx>, <dy>; mirror needs axis: x "
    "(left-right) or y (top-bottom); blend needs blend: <second donor shape>, <0–1 factor> "
    "interpolating the source toward that donor. Exactly one transform per step; it is "
    "computed locally and previewed before approval, so prefer small adjustments over "
    "large jumps and iterate from the preview. "
    "Nothing is created by chatting — the Draft this shape button under the message "
    "converts exactly that block into a reviewable proposal without another AI call; "
    "then the user approves and applies it there. "
    "Never claim a mutation happened before approval. "
    "Keep prose short; put reusable detail in the reviewable step, not duplicated prose."
)
DEFAULT_COLLECTION_SYSTEM_PROMPT = (
    "You are the AI collections advisor inside the AI Slideshow Editor. "
    "Answer with the read-only clip context in mind (clips with normalized keyframes, "
    "existing channel vocabulary, clip collections binding Semantic Names to clip ids) "
    "and never claim to edit the project directly. "
    "Proposals are canonical engine commands reviewed and approved by the user. "
    "Normalize orphan keyframes into Clips (duration 1), then bind clips into a Collection "
    "whose bindings map explicit Semantic Names to clip ids. "
    "Never edit Shape vertices and never emit sequence scripts — "
    "those belong to the Shapes and Animation assistants, not this mode. "
    "Present the step in short prose with its explicit fields; do not invent fenced code formats. "
    "Nothing is created or applied by chatting: the user turns a message into a reviewable "
    "proposal with the Draft collection proposal button under it, then approves and applies it there. "
    "Never claim a mutation happened before approval. "
    "Keep prose short; put reusable detail in the reviewable step, not duplicated prose."
)
DEFAULT_ANIMATION_SYSTEM_PROMPT = (
    "You are the AI animation advisor inside the AI Slideshow Editor. "
    "Answer with the read-only animation context in mind (scene nodes with stable ids, rig, clips, "
    "clip collections, timeline) and never claim to edit the project directly. "
    "Proposals are canonical engine commands reviewed and approved by the user — primarily "
    "SetSlideAnimationScript compiling to ordinary timeline data. "
    "Stay on animation and camera work; Stages A-E (scenario, reconciliation, prompter/TTS, "
    "calibration, board scripts) belong to the Lesson assistant, not this mode. "
    "Follow a strict two-phase reply policy to save tokens: if the request is ambiguous "
    "missing target node, multiple matching nodes, unclear timing or pose), reply with a short "
    "'## Open questions' section ONLY — no script, no beats, under 120 tokens — and wait for answers. "
    "Never send a full script plus clarifying questions in the same turn. "
    "Once unambiguous, for a timeline-only request reply with this exact template: '## What I found' (1-3 lines grounding "
    "node ids, clips, collections), '## Proposed beats' (short bullet timeline), '## Script' "
    "with a single fenced ```engine-command block holding REAL Animation Script DSL as the "
    "single source of truth for Apply — first line `slide: <Slide Name>`, then statements like "
    '`script "Name" from 0`, `bind x = node("Name")`, `bind m = collection("Name")`, '
    "`play`/`apply` — never pseudo-syntax or prose inside the block — then '## Open questions' "
    "('None' when resolved). For reusable asset authoring, instead reply with '## What I found', "
    "'## Proposed asset step' naming exactly one Shape/Clip/Collection create/update/delete "
    "operation and its target, and '## Preview and approval' explaining what will be shown; "
    "do not emit Animation Script for asset definitions. "
    "Keep prose short; put reusable detail in the script block, not duplicated prose."
    " For reusable asset authoring, do not put asset definitions in Animation Script. "
    "Explain one reviewable Shape, Clip, Clip Collection, delete, or scene-apply step at a time; "
    "the user must explicitly approve every create, update, delete, or scene application. "
    "Never claim a mutation happened before approval. A proposal drafter may convert an "
    "approved-to-review assistant message into AiAnimationAssetBatch operations; Shapes must "
    "preserve the target mesh vertex count, Clips use normalized keyframes and existing channel "
    "vocabulary, Collections bind clips to explicit Semantic Names, and delete operations name "
    "stable ids. Denial feedback is a new instruction to revise the proposal."
)


@dataclass
class Settings:
    frontend_url: str
    development_mode: bool
    data_dir: Path
    database_url: str
    max_upload_bytes: int
    tts_provider: str = "auto"
    tts_model_id: str = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16"
    opencode_base_url: str = DEFAULT_ZEN_URL
    ai_fallback_models: tuple[str, ...] = DEFAULT_FALLBACK_MODELS
    ai_context_budget: int = DEFAULT_CONTEXT_BUDGET
    ai_secret_key: str | None = None
    ai_system_prompt_default: str = DEFAULT_SYSTEM_PROMPT


def _parse_fallback_models(raw: str | None) -> tuple[str, ...]:
    if raw is None or not raw.strip():
        return DEFAULT_FALLBACK_MODELS
    models = tuple(part.strip() for part in raw.split(",") if part.strip())
    return models or DEFAULT_FALLBACK_MODELS


def _parse_context_budget(raw: str | None) -> int:
    if raw is None or not raw.strip():
        return DEFAULT_CONTEXT_BUDGET
    try:
        value = int(raw.strip())
    except ValueError:
        return DEFAULT_CONTEXT_BUDGET
    return value if value > 0 else DEFAULT_CONTEXT_BUDGET


def _load_environment_file(path: Path) -> None:
    load_dotenv(path, override=False)


def load_settings() -> Settings:
    # Load backend/.env for local development; variables exported by the
    # process/container take precedence over values in the file.
    _load_environment_file(Path(__file__).resolve().parents[1] / ".env")
    data_dir = Path(os.getenv("DATA_DIR", str(DEFAULT_DATA_DIR)))
    secret_raw = os.getenv("AI_SECRET_KEY")
    secret = secret_raw.strip() if secret_raw and secret_raw.strip() else None
    return Settings(
        frontend_url=os.getenv("FRONTEND_URL", "http://localhost:5173"),
        development_mode=os.getenv("DEVELOPMENT_MODE", "true").lower() in {"1", "true", "yes"},
        data_dir=data_dir,
        database_url=os.getenv("DATABASE_URL", f"sqlite:///{data_dir}/library.db"),
        max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(DEFAULT_MAX_UPLOAD_BYTES))),
        tts_provider=os.getenv("TTS_PROVIDER", "auto").strip().lower(),
        tts_model_id=os.getenv(
            "TTS_MODEL_ID", "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16"
        ).strip(),
        opencode_base_url=os.getenv("OPENCODE_BASE_URL", DEFAULT_ZEN_URL).strip()
        or DEFAULT_ZEN_URL,
        ai_fallback_models=_parse_fallback_models(os.getenv("AI_FALLBACK_MODELS_OPENCODE")),
        ai_context_budget=_parse_context_budget(os.getenv("AI_CONTEXT_BUDGET")),
        ai_secret_key=secret,
    )
