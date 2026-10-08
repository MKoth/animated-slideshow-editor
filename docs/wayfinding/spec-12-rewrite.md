# Spec 12 — AI

Spec for Phase 12 — AI of the AI Slideshow Editor: a multi-step lesson agent over an opencode.ai single-provider transport, specified against the project's nowadays state (Prompter + local Qwen3-TTS, Animation Script, ImportSlides-style merge, phoneme-timed mouth). This body replaces the previous Steps 18–20 chat/planner/commands contract in place; `docs/steps/step18.md`, `step19.md`, `step20.md` are archived (already removed from the tree — no files to move).

## Goal

The AI as a gated multi-step lesson agent: a **chat advisor** (context-aware conversation, no project access), a **lesson planner** (reviewable storyboard proposals that never touch the project), an **action scenario** (structured step-by-step outline, explicitly accepted), a **reconciler** (middle steps checked against library + animatable surface, with image-gen briefs for the missing), a **prompter/TTS filler** (agent fills PrompterParts, per-part local voice, user rerecord), a **calibrator** (verify-only voice/face-rig/camera check + phoneme-timed mouth on the pregenerated intro/outro), a **blackboard author** (per-slide Animation Scripts hard-synced to prompter audio), and a **project assembler** (new project uniting pregenerated intro/outro with the generated middle via one undoable merge command). Every AI capability proxies through the backend; the AI never modifies the project directly or on its own authority, and every stage runs only on the accepted output of the previous one.

## Scope

**In**
- AI Chat: dockable AI panel, multi-conversation chat, SSE streaming, stop/regenerate, markdown + syntax highlighting, conversation search, read-only project context, single-provider AI settings (opencode.ai), error handling, server-side persistence.
- Lesson planning: lesson-plan model, storyboard generation, asset/material/shader/clip planning, proposal viewer, editable plan, revision loop, acceptance (stores only). No direct plan-to-slides build — the plan feeds the Action Scenario pipeline below.
- Stage A — Action Scenario: structured, slide-agnostic step record (spoken lines, on-screen actions, bare asset hints, rough durations, intro/middle/outro tags), revision history, explicit accept gate.
- Stage B — Reconciliation: middle-steps-only check against the library (Spec 13 Discovery Run reuse) + animatable surface (clips, collections, built-ins, params, script verbs), 4-state motion feasibility, sfx/music hints only, auto-drafted provider-agnostic image-gen briefs feeding the Spec 13 Generation Workflow, own record + accept gate.
- Stage C — Prompter fill + local TTS: agent fills PrompterParts from the accepted reconciliation, estimate-then-adopt-TTS timing, per-part queued server-side generation through the existing local TTS engine, asset-id command refs, per-part `stale` gating, fully manual rerecord with the existing modals.
- Stage D — Calibration + phoneme-timed mouth: verify-only triple check (voice reuse, face-rig readiness, intro/outro camera framing), backend forced-alignment word timings (peaks-envelope fallback), user-owned mouth Shapes with agent-written `morphCoefficient` tracks only, intro/outro scope, explicit accept feeding merge.
- Stage E — Blackboard middle: one fresh Animation Script per middle slide (`from=0`, marks at PrompterPart bounds), hard-locked to Stage C times, script-created text/table + reveal/mark/wipe verbs, cat absent, static camera, own record + accept gate.
- Project ops + merge: agent create/open/duplicate, new assembled project (duplicate-middle base, intro → middle → outro), single undoable `ImportSlidesCommand` (full id remap, union-by-id dedup, first-keeps suffix collisions).
- Single-provider transport: opencode.ai Zen gateway only, one paid `chat/completions` model, `response_format=json_schema` structured output, Zen SSE proxied as our SSE, Fernet-encrypted server-side key with masked-tail reads, live catalog with env fallback, Zen-mapped conversation-local errors.
- New canonical engine command: `DuplicateNodeCommand` (retained). New canonical engine command: `ImportSlidesCommand` (this rewrite).
- AI settings, conversations, lesson plans, action scenarios, reconciliations, stage versions, and AI proposals persist in backend SQLite (project-scoped except the global settings singleton); keys encrypted at rest.
- Frontend deps arrive with this spec: `react-markdown`, `remark-gfm`, `shiki`. Backend deps arrive with this spec: `cryptography` (Fernet key encryption), `httpx` (Zen calls). Explicitly NOT added: `langchain`, `langgraph`, `langchain-openai`, `langchain-ollama` — stages call Zen `chat/completions` directly.

**Out**
- Any automatic/background/autonomous AI execution, multi-agent workflows — future placeholders.
- Tool calling / function calling beyond structured output, long-term AI memory, vision input to any AI step — out (no vision anywhere, as in Spec 13).
- Direct in-editor image generation — out (Spec 13 owns the orchestration-only pipeline: wizard + external tool + import + playground + Metadata Assistant).
- Voice-clone consent / custom-voice policy for the local TTS CustomVoice model — open policy, explicitly NOT decided here (see R57). The spec assumes one reusable voice prompt for the middle by default; whose voice may be cloned and what consent UX gates it is a future effort.
- Extra stages beyond A–E (preview/QA pass over the assembled three-part video, export-readiness check) — future effort, not this rewrite.
- Asset-definition creation, shader editing, fullscreen-shader assignment by AI — out of the proposal surface (v1).
- Shader commands, `SetVisibilityCommand`, `ReparentNodeCommand`, text-content editing beyond creation + word-level replace/split — out of the v1 surface.
- Undo/redo (Ctrl+Z) — Spec 14 (Polish). This spec's executor guarantees atomicity via rollback, not user-facing undo.
- A dedicated AI history panel — Spec 14. v1 shows proposal records in the AI panel.
- Conversation archive, multi-user, per-user accounts, mobile — out (web-only, single-user backend).
- "Add Tracks" in the AI command surface — dropped (resolved by Spec 04: three fixed lanes).

## Steps covered

| Step | Name | Source |
|---|---|---|
| 18 | AI Assistant (Chat Foundation) | `docs/steps/step18.md` (archived) |
| 19 | AI Lesson Planning & Storyboard Generation | `docs/steps/step19.md` (archived) |
| 20 | AI Command Execution | `docs/steps/step20.md` (archived) |

Steps 18–20 supply the phase scope; the stage pipeline (A–E + project ops) is how this rewrite implements it. The previous R-numbering is superseded — the R-map below is the audit trail from the old contract to this one.

## R-map (previous Spec 12 → this rewrite)

| Old | Fate |
|---|---|
| R1 AI panel, R2 conversation model, R3 management, R4 messages, R5 UI state | Survive → R1–R5 unchanged |
| R6 transport | Rewritten → R6 (endpoint list extended, `GET /ai/models` drops `?provider=`, stage records added) |
| R7 streaming | Rewritten → R7 (Zen SSE proxied as our SSE, tolerant client) |
| R8 stop, R9 regenerate, R10 markdown, R11 search | Survive → R8–R11 unchanged |
| R12 context snapshot | Survives → R12 (stages check live library/clip names from it; no shape change) |
| R13 token budget | Survives → R13 unchanged (server-side, oldest-first, context never dropped) |
| R14 settings, R15 keys, R16 providers, R17 errors (Ollama+OpenRouter) | Deleted as written → replaced by R14–R17 (single opencode.ai record, Zen-mapped errors) |
| R18 not-commands | Survives, extended → R18 (new stage records are store + API, never engine commands, never `.lesson`) |
| R19 plan model, R21 plan persistence, R22 viewer, R23 editable, R24 revision, R26 acceptance | Survive → R19–R24 (Lesson Plan stays the pedagogical proposal) |
| R20 plan generation, R29 proposal generation (LangGraph workflows) | Rewritten → R20/R46 (direct Zen `chat/completions` + `response_format=json_schema`, no LangChain/LangGraph) |
| R25 asset classification | Survives, scoped → R25 (planning-time LLM classification only; library-search reconciliation is Stage B / Spec 13) |
| R27 build-slides-from-plan | Superseded → deleted as a shortcut; all middle construction goes through Stages A–E + merge (R42–R45) |
| R28 proposal model, R32 server validation, R33 dry-run, R34 staleness, R35 review UI, R36 partial acceptance, R37 transactional execution, R38 execution record, R39 AI history | Survive → R46–R54 (surface extended per R47, machinery unchanged) |
| R30 command surface | Extended → R47 (old slide/scene/material/animation lists retained; prompter/audio/`ImportSlidesCommand`/`morphCoefficient` added; v1 exclusions kept) |
| R31 `DuplicateNodeCommand` | Survives → R48 unchanged |
| R40 safety rules | Rewritten, extended → R55 (stage-specific nevers added) |
| R41 performance | Survives → R56 (batch TTS queued server-side, SSE progress reuses `/ai/chat`) |

## Requirements

### Chat (Steps 18–20 foundation, retained)

**R1 — AI panel.** A dockable panel toggled from the toolbar's "AI Assistant" button (Spec 01 R20). Layout: conversation list → messages → input. Resizable and dockable beside the existing panels; dock state and size persist in localStorage (UI-prefs pattern, Spec 04 R9). In degraded mode (no backend) the panel opens to an "AI unavailable" state with all controls disabled (Web runtime decision).

**R2 — Conversation model.** A conversation: id, title, created, modified, ordered messages. Project-scoped: belongs to the project id, cascade-deleted with the project, never in the `.lesson` file (Spec 05 R12: editor state is not in the file). Multiple conversations per project.

**R3 — Conversation management.** From the panel's list: create (default title "Conversation N"), inline rename, delete (no confirmation — mirrors Spec 05's instant-delete stance), instant switching (under 100 ms for typical conversations). No archive in v1 (decided).

**R4 — Message model.** A message: id, role (`user` | `assistant`), content, timestamp. User messages and assistant messages persist server-side as the conversation's message list; the server reconstructs history from storage on every request (the client never re-sends history).

**R5 — UI state.** Active conversation id and the draft input are UI prefs: localStorage, keyed per project, never in `.lesson`, never sent to the backend.

**R6 — AI transport.** All AI traffic goes through the backend — the only place the provider key exists. Endpoint surface (Spec 01 R10 ApiClient pattern; no CORS middleware in dev — Vite proxy, Spec 01 R9; production same-origin):

- `GET /ai/conversations?projectId=` → list (id, title, modified).
- `POST /ai/conversations` → create.
- `PATCH /ai/conversations/{id}` → rename.
- `DELETE /ai/conversations/{id}` → delete (cascades messages).
- `GET /ai/conversations/{id}/messages` → full message list (paginated; UI loads lazily for long chats).
- `POST /ai/chat` → streams an assistant reply over SSE (R7). Body: `{conversationId, message, mode: "send" | "regenerate", context}`. `send` appends the user message and generates; `regenerate` re-runs the last user message and **replaces** the last assistant message. The user message is persisted by the server on receipt; the assistant message is persisted incrementally as the stream progresses. Stage progress (e.g. per-part TTS batch) reuses this SSE stream — no separate progress endpoints.
- `GET /ai/settings`, `PUT /ai/settings` → the AI settings record (R14/R15).
- `GET /ai/models` → the single-provider model list (R16). No `?provider=` query.
- `POST /ai/plan`, `PATCH /ai/plans/{id}`, `POST /ai/plans/{id}/accept`, `POST /ai/plans/{id}/reject` → lesson plans (R19–R24).
- `POST /ai/scenarios`, `PATCH /ai/scenarios/{id}`, `POST /ai/scenarios/{id}/accept`, `POST /ai/scenarios/{id}/reject` → Action Scenarios (Stage A).
- `POST /ai/reconcile` (body `{projectId, scenarioId}`), `GET /ai/reconciliations/{id}`, `POST /ai/reconciliations/{id}/accept`, `POST /ai/reconciliations/{id}/reject` → Stage B record + gate. Briefs ride the reconciliation record (no separate brief endpoints); the Spec 13 Generation Workflow entry (`POST /ai/workflows`) consumes them.
- Stage C runs on the proposals transport (no new endpoints): prompter/TTS proposals are ordinary `POST /ai/proposals` with the extended surface (R47); per-part progress streams over `POST /ai/chat` SSE.
- `POST /ai/calibrations`, `GET /ai/calibrations/{id}`, `POST /ai/calibrations/{id}/accept` → Stage D record + gate (timing map rides the record).
- `POST /ai/board-scripts`, `GET /ai/board-scripts/{id}`, `POST /ai/board-scripts/{id}/accept` → Stage E record + gate (per-slide scripts + marks-to-part map ride the record).
- `POST /ai/proposals`, `GET /ai/proposals?projectId=`, `POST /ai/proposals/{id}/status` → proposals incl. Stage C/E content and the merge command (R46–R54).
- Spec 13 endpoints (`POST /ai/discover`, `GET /ai/discoveries/{id}`, decisions, history, `POST /ai/prompts`, `POST /ai/metadata-suggest`, workflows) are unchanged and reused by Stage B — this spec adds none of them.

**R7 — Streaming.** `POST /ai/chat` responds with `text/event-stream` (SSE). The backend calls Zen with `stream:true` and proxies Zen's SSE as our own events (`start`, `token`, `done`, `error`) through a tolerant client (non-standard chunks must not break the stream). The UI renders tokens as they arrive; the UI never blocks (rendering and virtualized markdown (R10) run off the main interaction path).

**R8 — Stop.** A "Stop" button (visible while streaming) closes the client's SSE connection; the backend aborts the Zen stream. The partial response is preserved — persisted as-is as the assistant message. A stopped message is distinguishable (a "stopped" marker) but remains in history.

**R9 — Regenerate.** A "Regenerate" action on the last assistant message re-runs generation (R6 mode `regenerate`) replacing that message with the new stream. Works after stop, after errors, and on the latest message only.

**R10 — Markdown rendering.** Assistant messages render as Markdown: headings, lists, tables, quotes, links, code blocks, inline code — via `react-markdown` + `remark-gfm`; code blocks are syntax-highlighted with `shiki` for TypeScript, GLSL, Python, JSON, and Markdown. Long conversations render virtually (windowed message list); switching conversations is instantaneous (R3).

**R11 — Conversation search.** A search box over the conversation list filters instantly (client-side) by conversation title, user-message text, and assistant-message text, across loaded conversations. No backend search endpoint in v1 (decided).

**R12 — Context snapshot.** Before each chat/plan/scenario/proposal request, the client assembles a **Context Snapshot** from the engine read API (Spec 02 R18) and UI stores — never from internal mutation paths: project name; active slide name + duration; slide list (names, order); scene hierarchy of the active slide (node names + ids, camera marked); selected objects; material and shader names; animation clip names; asset-library names (Spec 03 store). The snapshot is read-only, regenerated per request, never serialized into the conversation, never into `.lesson`. A snapshot assembles in well under 50 ms for typical projects. Stage B checks library/clip names live against this snapshot; no shape change is needed for the stages.

**R13 — Token budget.** The backend composes the prompt as: system prompt (R14) → context block (R12) → message history (oldest first) → current message, and trims the **oldest history first** to fit `AI_CONTEXT_BUDGET` tokens (backend env, default 8000). Trimming never splits a message mid-way and never drops the context block. The budget uses the provider's tokenizer when available, else a documented character approximation. The budget is server-side only — the client does no token math.

### Single provider (replaces old R14–R17)

**R14 — AI Settings (single provider).** One global server-side SQLite record `ai_settings` (singleton row, no per-project settings — single user, no auth). Fields: `endpoint` (default `https://opencode.ai/zen/v1`, overridable), `model` (single Zen chat/completions model id), `temperature`, `maxTokens`, `streaming` (bool), `systemPrompt` (textarea, seeded default describing the editor domain + the Stage A–E multi-step agent + proposal allowlist; user-replaceable). No `provider` field, no per-provider key slots, no keyless path. Env: `OPENCODE_BASE_URL` (settings endpoint defaults from it), `AI_FALLBACK_MODELS_OPENCODE` (comma-separated single-provider fallback list, at least one paid chat/completions default), `AI_CONTEXT_BUDGET` (R13, default 8000), `AI_SECRET_KEY` (required — R15). `config.py` gains these; nothing else in `config.py` changes. UI: the same "AI Settings" dialog under the AI menu. Fields: endpoint (advanced text), key (password input showing only the masked tail as placeholder), model dropdown (from `GET /ai/models`), temperature, max tokens, streaming toggle, system prompt textarea. Saving with an empty key field keeps the existing key. Reads return the masked tail only. Style Profiles (Spec 13) remain Spec 13-owned, stored alongside — not columns of the provider fields; this spec duplicates no Style Profile UI.

**R15 — Keys & security.** The provider key never leaves the backend, never enters the browser's JS bundle or network traffic. Entered in the Settings UI → `PUT /ai/settings` over the same origin (dev: Vite proxy) → Fernet-encrypted at rest (secret from `AI_SECRET_KEY`) → reads return only the masked tail (e.g. `••••••••k3yX`). Saving without `AI_SECRET_KEY` set fails with a clear server error. A saved key is replaced only on non-empty submit.

**R16 — Model list + family-routing rule.** `GET /ai/models` proxies the Zen catalog (`GET <endpoint>/models` with the stored Bearer key) and returns model ids. On unreachable provider, missing key, or any proxy failure → falls back to `AI_FALLBACK_MODELS_OPENCODE`. The selected model is validated against live-or-fallback before use (live when reachable); mismatch blocks the request with a conversation-local "model no longer listed — reselect" message (Zen IDs/endpoints/prices rotate). Default selection is the one paid chat/completions model from the fallback list. Family-routing rule (pinned): the backend always calls Zen `POST /chat/completions` (OpenAI-compatible JSON + `response_format=json_schema` structured output + SSE). No `/responses` / `/messages` / `/models/<id>` branching in this spec; a different family requires a spec amendment.

**R17 — Error taxonomy.** Shell retained: every failure surfaces as a user-friendly message *inside the conversation* with a retry/regenerate action, never loses history; partial-stream content is kept (R8 semantics); regenerate replaces the last assistant message only (R9). Mapping (backend→Zen direct, our SSE proxies Zen SSE as `start/token/done/error`):
- No key saved → "No API key saved — open AI Settings and save your opencode.ai key" (links Settings), retry.
- Zen 401 (CreditsError / insufficient balance / invalid key) → "Key invalid or credits exhausted — check key / top up" + server-side ops log, retry.
- Zen 402 (CreditLimitExceeded) → distinct "Credit limit exceeded — top up and retry" message.
- Zen 429 (usage/rate) → "Rate-limited — wait and retry" notice, retry.
- Zen 400 InvalidRequestError, Zen 5xx, network/timeout, malformed/unparseable content → "Provider error — retry" with retry.

**R18 — Not commands.** Conversations, plans, action scenarios, reconciliations, stage versions, and proposals are editor-side data, not project data: their state lives in frontend Zustand stores + the backend API, **never** as engine command types, never in the execution log (Spec 02 R42), never in `.lesson` (Spec 05 R12). No `CreateConversationCommand` / `SendMessageCommand` / `CreateLessonPlanCommand` / `ExecuteAIProposalCommand` family is introduced; orchestration follows the Spec 03/05 pattern (library ops and persistence flows are API + store). Executing a proposal dispatches only the canonical engine commands it contains (R52). Frontend store events (ConversationCreated, StreamingStarted, ProposalStatusChanged, …) follow the Spec 04 store-event pattern.

### Lesson planning (Step 19, retained)

**R19 — Lesson plan model.** A lesson plan: id, project id, title, description, language, estimated duration, learning objective, teaching strategy, acceptance state (`draft` | `accepted` | `rejected`), and an ordered list of slide proposals. Each slide proposal: title, goal, estimated duration, explanation, suggested narration, required assets (each classified `existing` | `missing` | `optional`, with a name and, for existing, the library definition id), recommended materials, recommended shaders, recommended animation clips (referencing existing clip names where possible). The Lesson Plan stays the pedagogical proposal; the Action Scenario (Stage A) is the downstream executable outline linked through project/conversation — not merged into the plan.

**R20 — Plan generation.** `POST /ai/plan` (body: `{projectId, request, context, conversationId}`) generates a plan as structured output via a direct Zen `chat/completions` call with `response_format=json_schema` (no LangChain/LangGraph workflow — those deps are never added). The response is the plan plus a conversational narration message appended to the conversation. Generation runs asynchronously from the UI (a generating state in the plan view); the UI never blocks.

**R21 — Plan persistence.** Plans, revisions (each regeneration with its source request), user edits (R22), and acceptance state persist in backend SQLite, project-scoped, restored on reload, cascade-deleted with the project, never in `.lesson`. This revision-history pattern (source request stored, user edits preserved across revisions unless explicitly changed) is the template for all stage records.

**R22 — Proposal viewer.** In the AI panel, a plan renders as sections: Lesson Overview (title, description, language, duration, objective, strategy) → Slides (each: title, goal, duration, explanation, narration) → Assets (per slide, classified existing/missing/optional) → Materials & Shaders (recommendations) → Animations (recommended clips) → Missing Resources (the missing assets roll-up). The viewer is read-only except for the editable fields (R23). Spec 13's "Reconcile assets" action lives in this viewer (Spec 13 R1) — this spec builds no second reconciliation UI.

**R23 — Editable plan.** The user may edit, before acceptance: lesson title, slide order (reorder), slide duration, teaching strategy, slide descriptions. Edits are stored as user edits (R21) and preserved across revisions unless the revision explicitly changes them (revision prompts carry the user edits as context).

**R24 — Revision loop.** Follow-up chat messages regenerate the plan (R20 with the prior plan + user edits as context). "Accepted decisions preserved where possible" — the system prompt instructs the model to keep prior accepted content unless the user requests a change. The same loop applies to Action Scenario versions (R26).

**R25 — Asset classification (planning-time only).** The AI classifies each required asset existing/missing/optional against the asset-library names in the context snapshot. That classification is the LLM's planning-time judgment; library-search reconciliation against the same model (scored Discovery Runs, accept/reject/replace decisions) is owned by Stage B reusing Spec 13 Step 25 — this spec builds no search. Missing assets appear in Missing Resources.

**R26 — Acceptance.** "Accept" stores acceptance state; the project is untouched. "Reject"/discard allowed. Acceptance is the gate pattern every stage mirrors: Stage B runs only on the accepted Action Scenario version (not directly on plan acceptance — the plan feeds Stage A first).

### Stage A — Action Scenario

**R27 — Action Scenario record.** A separate backend SQLite record (not a Lesson Plan extension): project-scoped, conversation-linked, with revision history per the R21 pattern (each regeneration stores its source request; user edits preserved across revisions unless explicitly changed). The Lesson Plan stays as specified in R19; the scenario links to it through project/conversation. No LessonPlan/ActionScenario code exists yet — both are spec-only until implementation.

**R28 — Step schema (minimal six + id/order).** Ordered steps, each: `id, order, partTag, spokenLine, onScreenAction, assetHints, estimatedDurationSec`. `partTag` ∈ {`intro`, `middle`, `outro`} — generic steps with optional tagging, not a fixed three-section schema (the cat video — pregenerated intro + goodbye bounding the blackboard middle — is one tagging of this field). `spokenLine`: verbatim narration text. `onScreenAction`: what happens visually (who is on frame, what appears/disappears, camera note at prose level). `assetHints`: bare names only (e.g. `cat`, `blackboard`, `chalk text`) — no library definition ids, no clip/material/shader refs; resolution belongs to Stage B. No camera-rig, clip, script, or material fields — those belong to Stages D/E. `estimatedDurationSec` is a rough, non-binding estimate; Stage C refines it into PrompterPart durations. Steps carry no slide commitment (slide-agnostic); grouping into slides happens downstream (Stages C/E). Intro/outro pregenerated projects are not steps — they bound the generated middle at merge time (R42–R45).

**R29 — Scenario gate + Stage B handoff.** Explicit user accept per scenario version (mirrors R26); Stage B runs only on the accepted version. Follow-up chat regenerates with prior scenario + user edits as context, preserving accepted content unless the user requests a change. Stage B reads the canonical structured record (JSON) and renders the same text the user approved — no re-parsing of free prose. Asset-hint names + spoken lines + on-screen actions are its inputs.

### Stage B — Reconciliation + image-gen brief

**R30 — Input scope + record.** Stage B reconciles only **middle-tagged** Action Scenario steps. Intro/outro-tagged steps do not reconcile and produce no verdicts — they are pregen references re-entering at merge. Output persists as its own backend SQLite record: project-scoped, linked to the accepted Action Scenario version + conversation, with revision history. Explicit user accept per reconciliation version (mirrors R26/R29); Stage C runs only on the accepted version.

**R31 — Asset reconciliation (Spec 13 reuse).** Reuses Spec 13 Asset Discovery Run semantics against each step's `assetHints`: weighted scoring over name/tags/category/AI-description, matched floor 0.35, verdicts `matched`/`missing`, accept/reject/replace persisted. No new scoring engine, no LLM pre-classification. Per-step asset verdicts cite the matched definition or the gap.

**R32 — Motion feasibility + sounds.** `Possible` = library clips + Clip Collections (by name/semanticName) + built-in clips (Fade/Pop/Bounce/Shake/Float/Pulse/Scale…) + animatable params (6 standard transform/opacity props, material/shader params, circle/table props) + Animation Script reveal/mark/wipe verbs — checked live per step against Context Snapshot library/clip names. Full engine command validation is out (binding to commands happens in Stages D/E). Per middle step, one 4-state verdict with explanation citing the matched clip/params or the gap: `feasible` / `feasible-with-substitution` (named clip + params) / `needs-new-asset` / `needs-new-motion`. Sounds: sfx/music hints only, reconciled against global audio definitions (`category='audio'`) + project embedded audio. Voice/`spokenLine` is out — Stage C owns narration.

**R33 — Missing-asset briefs (Spec 13 handoff).** Each missing hint yields an auto-drafted brief from the step's `spokenLine` + `onScreenAction` + hints, under the wizard default style profile, user-editable before handoff. Shape feeds the Spec 13 Generation Workflow (name + note + style profile + production constraint block + provider note → Detailed/Concise/Stylized variants). Handoff = Generation Wizard entry + copyable prompt. Briefs are provider-agnostic — no generator pinned (Spec 13 is orchestration-only; direct in-editor generation stays out of scope). Stage C reads the accepted reconciliation record (asset mappings + feasibility + briefs), not re-derived state.

### Stage C — Prompter fill + local TTS

**R34 — Reuse + proposal allowlist.** The nowadays prompter/TTS stack is reused as-is (per-slide gap-free parts, `reflowPrompter` prefix-sum, `splitChars` import split, `secondsPerCharacter` estimate default 0.2, Split/Unite, `UpdatePrompterPartWithShift`, `stale` freeze-until-resolved, word-level `AudioSegment` + `ReplacePrompterWordsCommand`/`SplitPrompterWordsCommand`; dual-scope `AudioAsset` with embedded snapshot; flat per-slide `AudioClip` on fixed voice/sfx/music lanes; non-destructive pitch/noise/playbackRate + Waveform Editor mismatch dialog; `POST /api/tts/generate` + `voice_prompts` CRUD + `TTSProvider`/`TtsApi` + per-part `TtsModal → CommitTtsCommand` + word-level and record modals; backend serialized inference queue). The one real gap is transport: the previous command surface has no prompter/audio commands, so the agent cannot fill prompter through the approved-proposal path without bypassing the dispatcher. The spec adds to the canonical proposal surface (R47): `CreateSlideCommand` (middle slides) + `CreatePrompterPart` / `UpdatePrompterPart` / `UpdatePrompterPartWithShift` + CommitTts-equivalent + `ReplacePrompterWordsCommand`, with server schema validation + client dry-run `validate()` in order, executed as one transaction with inverse-walk rollback.

**R35 — Batch TTS (queued, asset-id refs).** The agent emits one generate per part through the internal TTS engine call (same prompt-merge semantics as `POST /api/tts/generate`, not HTTP loopback), serialized by the existing inference lock — batch queues, never parallel-bursts. Single voice prompt for the whole middle by default (consistency), overridable per part; recorded on the Stage C version. Transport: the server embeds each WAV as `EmbeddedAsset` first; proposal commands reference `assetId` — never inline base64 in command params. Per-part failure marks that part `stale` (existing status, no new persisted states) and blocks the Stage C accept gate; retry is per part. Progress reuses the existing `/ai/chat` SSE stream (R6/R7); no new endpoints.

**R36 — Two-phase timing (no new estimator).** Pre-TTS: part duration = `charCount × secondsPerCharacter`; `slide.duration` = sum of its parts (rule — export/playback clip at `slide.duration`, so they must agree). Post-TTS: always adopt the TTS audio duration + shift downstream gap-free (`UpdatePrompterPartWithShift` semantics); never auto-stretch audio to fit text. The user adjusts later via the existing Waveform Editor mismatch choices. No new persisted status schema (parts stay `stale` | absent; generating/failed live as ephemeral proposal/UI state) and no new rerecord UI: after execution, parts are ordinary bound parts (`audioClipId`/`audioAssetId`, stale cleared) — the user rerecords with the existing modals, and agent follow-up redo ("warmer part 3") is a new single-part proposal preserving neighbors via gap-free reflow.

**R37 — Stage C gate + handoff.** Input: the accepted Stage B record + the accepted Action Scenario middle `spokenLine` verbatim — no re-derivation, no prose re-parsing. Gate: explicit user accept per Stage C version (mirrors R26/R29/R30); Stages D/E run only on the accepted version. Handoff: the accepted PrompterPart→AudioClip bindings + part durations are the timing source for Stage D (calibration/mouth) and Stage E (blackboard sync).

### Stage D — Calibration + phoneme-timed mouth

**R38 — Triple check, verify-only.** Stage D covers three checks and creates nothing: (a) voice reuse check against the accepted Stage C record (single voice prompt for the middle by default) + measurement of pregen intro/outro durations/levels as timing input — no re-synthesis, no normalization, no audio-byte writes (volume/pitch matching stays manual via existing non-destructive AudioClip flags; mismatch blocks the gate); (b) face-rig readiness (mouth Shapes + `MorphBinding{fromShapeId,toShapeId}` present on the target rig, imported via the existing shape-id remap — missing shapes = soft-warn-and-skip and blocks the gate); (c) intro/outro camera framing (pan/zoom keys for cat-face framing via generic `tween`/`set`/`move` — no camera-specific verb exists; rotation is never written; the exactly-one-camera invariant holds and violations block the gate). The agent never creates Shapes, never rewrites audio bytes, never rewrites MorphBinding from/to pairs. 'Calibration' stays a Stage-D umbrella term only — it does not enter CONTEXT.md; it decomposes into Voice Check / Face-Rig Readiness / Camera Framing. No calibration exists in the repo today — this is new spec.

**R39 — Timing source + shape authorship.** Qwen3-TTS emits WAV bytes only — no words/phonemes/timestamps; no forced-alignment code exists. Canonical: a new backend forced-aligner (word level) run on the accepted audio (Stage C middle TTS WAVs + pregen intro/outro WAVs), producing per-part word times, then phoneme→Shape mapping through the rig-local map (user-authored shape names per rig — no global viseme set pinned). Fallback, per part, when the aligner is unavailable or fails: the waveform-peaks envelope (`waveformPeaks` convention, `AudioAsset.metadata{duration,sampleRate,channels,waveformPeaks?}`) drives a single Open coefficient; fallback is recorded on the calibration version and the gate may still accept with fallback marked. Char-proportional split is out. Shapes are user-authored arbitrary names (no shipped mouth set); the cat reusable object ships the mouth Shapes + bindings. Agent allowlist: `morphCoefficient` tracks only — via Animation Script `morph()` / `tween`/`set{morphCoefficient}`, Control values (`control('Key',v)`), or mouth-bearing clip/collection placements on `semanticName='mouth'` nodes. Never: create/rename Shapes, rewrite bindings, or bake shape ids into clips (clips stay name-based + portable).

**R40 — Scene scope.** Mouth lives on the pregenerated cat nodes (part 1 intro greeting, part 3 goodbye). The blackboard middle (cat paused/off-frame, zoomed on board per Stage E) gets no mouth. A middle cat cameo is a Stage B substitution case, not a Stage D default. Middle camera is untouched — Stage E owns it.

**R41 — Stage D gate + handoff.** Input: the accepted Stage C version (PrompterPart→AudioClip bindings + part durations) + the named pregen intro/outro projects. No re-derivation. Gate: explicit user accept per calibration version (mirrors earlier gates). Handoff: rig-readiness refs + per-part word-timing map + intro/outro camera keys → the merge author (R42–R45). Stage E stays independent (blocked on Stage C only — middle needs no mouth/timing from D).

### Stage E — Blackboard middle synced to prompter

**R42 — Timing source + sync strictness: hard lock.** Timing source is the accepted Stage C version: PrompterPart `startTime`/`endTime`/`duration` plus AudioClip bindings. `slide.duration` equals the sum of its parts (R36 rule); script windows derive exactly from those times. Hard lock: every effect is scheduled inside its owning part's [`startTime`, `endTime`]; a segment may not start before `from` or end past `Slide.duration` (compiler errors). Overrun or drift blocks the Stage E accept gate — no best-effort slip, no auto-shift.

**R43 — Granularity + authorship.** One Animation Script per middle slide, `from=0`, cursor advancing through the slide. A compile-time `mark(partId)` at each PrompterPart boundary; statements between marks belong to that part's window. No per-part segments/runs. Binding resolves per slide (node by Unique Name, semantic group, table, clip/collection, material); reads (`bounds`, `cellRect`, `controlValue`) land at the cursor or an explicit time inside the window. The agent authors fresh script text per slide: `reveal` / Temporary Mark loop / `wipe` plus `create text/table` for board content appearing/disappearing. Only compiler built-ins are reused (e.g. `pointArrowAt`); no shared blackboard library entry in this spec; the mentioned ready-made function stays out (a future library entry may graduate it once fresh scripts show the repeated shape).

**R44 — Scene + mechanics + failure.** Middle slides carry no cat nodes (not present-hidden). Camera is the standard single Camera node with static board framing; the agent writes no pan/zoom keys unless the accepted Action Scenario on-screen action explicitly asks for a board move. Appear: `create text/table` (script-created nodes, deterministic slide-scoped ids, replace-by-footprint on re-run) then `reveal(subtree)` sweep inside the owning part window. Disappear: opacity hold to zero (show/hide lowers to opacity holds; no Visible Track). Empty/unmeasurable Effect Target is invalid and blocks the gate. Tables use Table/Row/Cell components plus Grid Layout; cell text is renderable content, empty layout slots are not. Overrun past part/slide end, unmeasurable target, or unresolved binding blocks compilation and the gate with a message; the user fixes manually (re-time, re-create, fix binding). No auto-repair, no audio rewrite, no coefficient invention. No CONTEXT.md change (existing Script/Segment/Marker/Effect-Target language only).

**R45 — Stage E record + gate + handoff.** New backend SQLite record, project-scoped, linked to the accepted Stage C version + conversation, with revision history. Explicit user accept per Stage E version (mirrors earlier gates); merge runs only on the accepted version. Handoff: accepted per-slide scripts (compiled footprint + marks-to-part map) plus middle slide ids/durations → merge (R42–R45 of project ops below are R46–R49; see Project ops).

### Project ops + merge

**R46 — Ops surface: create + open + duplicate.** The agent can: create a blank middle working project (`createBlankProject` shape), open named intro/outro projects by name/id read-only (`projectsApi.get` shape), and duplicate to an assembly target (`duplicateLessonJSON` shape). Sources are never mutated. No delete/rename through the agent — full browser parity stays out.

**R47 — Merge target + order + assembled base.** The merge target is a new assembled project; intro slides, then middle slides, then outro slides, in that fixed order. Sources stay untouched and reviewable. Fresh project id, name `<middle> (assembled)` uniquified, createdAt/modifiedAt now. Slides/materials/clips/settings start as the middle's copy (duplicate-middle base — a blank base would drop middle prompter settings, clip library, and script library entries); intro slides prepended, outro appended, all with fresh remapped ids.

**R48 — `ImportSlidesCommand` (new canonical command, Spec 02 R36–R38 contract).** One `ImportSlidesCommand` = one Transaction = one History Entry (source: AI). Undo restores pre-merge exactly. The command path emits no `ProjectLoaded` (which would clear the undo stack — `dispatcher.ts`), unlike the `openProject`/`restoreFromJSON` path. `persistence dirty=true`; active slide repoints to the first imported slide. Validation failure rolls back fully with no partial history. The command joins the canonical AI proposal surface (R51): server schema validation + client dry-run `validate()` in order, one Transaction with inverse-walk rollback, explicit user accept. Runs only on accepted Stage C + D + E versions. `DuplicateSlideCommand` (Spec 05 R2) is unaffected. No CONTEXT.md change (existing Project/Slide/Unique-Name/embedded-snapshot language only).

**R49 — Collisions + dedup + remap + checks.** Node Unique Names untouched — per-scene scope, so cross-slide node names never collide. Slide names: first occurrence in final order keeps its name; later duplicates get ` (2)`, ` (3)` in order (duplicate-name pattern; slide names are not uniqueness-enforced in code — list tidiness, not an invariant). Asset/material/shader definition name clashes: incoming suffixed the same way; target keeps. Never blocks, never asks mid-merge. Embedded + audio dedup: union `Project.embeddedAssets` (+ materials/shaders/data-sources) by asset id. Same id = same immutable bytes — keep target's. Different ids kept separate even if bytes are identical (no hash-dedup, no ref rewriting). Missing-asset references resolve embedded-first, then library (snapshot + lessonTransfer self-containment rules). Remap every id domain (slides/scenes/nodes/parents/shapes+categories/clips+instances+collections+placements/keyframes/audio clips/prompter parts+segments/IK chains/constraints/control sets + morph bindings + script footprints) — the `duplicateLessonJSON` + reusable-object import pattern. Then `lesson validate()` + Missing Assets Report (embedded-first). Any error blocks the merge accept gate with a message; the user fixes manually.

### Proposals + execution (Step 20, extended surface)

**R50 — AI edit proposal model.** A proposal: id, project id, title, description, optional confidence, affected slide ids, warnings[], status (`draft` | `validated` | `approved` | `rejected` | `executed` | `rolled-back`), conversation id + originating message id (R53), and an ordered list of commands. Each command: id, canonical command type, serialized parameters (Spec 02 R36 `toJSON()` shape), and a human-readable label generated server-side for the review UI.

**R51 — Proposal generation.** `POST /ai/proposals` (body: `{projectId, request, context, conversationId, planId?|scenarioId?}`) generates a proposal via a direct Zen `chat/completions` call with `response_format=json_schema`, restricted to the command surface (R52). Generation is asynchronous; the UI shows a generating state. No LangGraph workflow (those deps are never added).

**R52 — Supported command surface (v1, extended).** The AI may generate only these canonical commands:
- Slides (Spec 05 R2): `CreateSlideCommand`, `DeleteSlideCommand`, `RenameSlideCommand`, `MoveSlideCommand`, `DuplicateSlideCommand`, `SetSlideDurationCommand`.
- Scene (Spec 02 R39 + R48/R53): `CreateNodeCommand` (asset-instance component **or** text component — text content set at creation; no content-editing command in v1), `DeleteNodeCommand`, `DuplicateNodeCommand`, `MoveNodeCommand`, `RotateNodeCommand`, `ScaleNodeCommand`.
- Materials (Spec 06): `AssignMaterialCommand`, `OverrideMaterialParameterCommand`.
- Animation (Spec 07): the clip command set (create/rename/delete clip) and the keyframe family (`AddKeyframesCommand`, `DeleteKeyframesCommand`, `MoveKeyframesCommand`, `SetValueCommand`, `ScaleKeyframesCommand`, `PasteKeyframesCommand`, `DuplicateKeyframesCommand`, `SetInterpolationCommand`, `SetTangentsCommand`), targeting node or clip per Spec 07.
- Prompter/audio (Stage C): `CreateSlideCommand` (middle slides), `CreatePrompterPart` / `UpdatePrompterPart` / `UpdatePrompterPartWithShift`, CommitTts-equivalent (embed + voice-clip at part start + bind + optional fitTextToClip), `ReplacePrompterWordsCommand` (word-level). Proposal commands reference TTS audio by `assetId` (server embeds first — never inline base64).
- Mouth (Stage D): `morphCoefficient` tracks only — via Animation Script `morph()` / `tween`/`set{morphCoefficient}`, Control values, or mouth-bearing clip/collection placements on `semanticName='mouth'` nodes. Never Shape creation/rename, binding rewrites, or baked shape ids.
- Merge (project ops): `ImportSlidesCommand` (R48).
Not in v1: shader commands, fullscreen-shader assignment, `SetVisibilityCommand`, `ReparentNodeCommand`, text-content editing beyond creation + word-level replace/split, asset-definition creation, material/shader/clip-definition creation beyond the clip set above.

**R53 — `DuplicateNodeCommand` (retained).** Deep-copies a node and its subtree with fresh ids, same components, same asset-definition references; the copy lands after the source as its sibling. Validation: target exists, target is not the camera node (exactly one camera per slide — Spec 02 R9), target not the scene root. Inverse: the old state (Spec 02 R37). `DuplicateSlideCommand` (Spec 05 R2) is unaffected.

**R54 — Server-side validation.** At generation, the server validates the proposal structurally: command types in the R52 allowlist, required parameters present and well-typed, command ids unique, no empty proposal. Structural failures are retried once, then surfaced as a generation error. The server does **not** validate against project state (it holds the last save, which may be stale) — the client dry-run (R55-style R33 analogue below) does that.

**R55 — Client dry-run.** The client deserializes each proposal command into its engine class and runs `validate()` (Spec 02 R40) against the **live** engine, in proposal order, plus intra-proposal consistency (e.g. a `CreateNodeCommand` targeting a slide the proposal deletes fails; commands referencing a definition id absent from the library store fail). Each command's dry-run result is recorded on the proposal (`valid` | `invalid` + reason); the proposal becomes `validated` when every command is valid.

**R56 — Stale proposals.** Dry-runs run at review-open **and** at approval. If any command fails the approval dry-run (the project changed since generation — user edits in between), approval is blocked with "Project changed — regenerate", and a one-click regenerate re-runs R51 with a fresh context snapshot (which creates a new proposal; the stale one is closed as `rejected` with reason `stale`).

**R57 — Review UI.** A proposal card in the AI panel: title, description, warnings, and the command list. Each command is expandable to its details (type, target names/ids, values — e.g. "Move Node: Boy → X 120, Y 350"). Controls: per-command accept/reject toggle, "Accept all", "Reject all". Warnings are shown prominently; blocking warnings (any invalid dry-run) prevent approval until regenerated.

**R58 — Partial acceptance.** Only the approved subset executes. The command list is re-validated with the rejected commands removed (a rejection can invalidate dependents — they are flagged and excluded automatically with a note).

**R59 — Transactional execution.** The client executes the approved commands in order through the dispatcher (Spec 02 R34) as one batch. The executor captures each command's inverse data (Spec 02 R37) as it executes; on any execution failure it walks back the recorded inverses — the project never ends in a partially modified state (a failure mid-walk reports the rollback result). No user-facing undo/redo: Ctrl+Z and one-proposal-undo arrive with Spec 14. Command events fire normally (Spec 02 R41) — the renderer, timeline, and slides UI update through the canonical events, exactly as for manual edits.

**R60 — Execution record.** After execution the client reports the outcome to the backend: `POST /ai/proposals/{id}/status` with the new status (`executed` | `rolled-back` | `rejected`), per-command results, and a timestamp. Rejected proposals are retained (deletable only by deleting the project). The proposal links to its conversation and originating message; the conversation message links back to the proposal (R57).

**R61 — AI history in v1.** The AI panel's history view lists the project's proposals (from `GET /ai/proposals`), chronological, with status and linked conversation. This is the v1 AI execution history; no separate history panel — Spec 14 builds the user-facing history panel and consumes these records.

### Safety, performance, policy

**R62 — Safety rules.** The AI never: executes without explicit user approval, deletes user work without approval, bypasses the dispatcher, references nonexistent ids (blocked by R55), modifies asset/material/shader definitions, performs asset generation, creates/renames Shapes or rewrites MorphBindings, rewrites audio bytes, mutates merge sources, or writes rotation keys to the camera. Generation receives only the read-only context snapshot (R12) plus the current plan/scenario/stage records and recent proposal records — never engine write access. Every stage gate (R26/R29/R30/R37/R41/R45, merge R48) blocks on failure with a message; the user fixes manually — no auto-repair, no silent fallback beyond the recorded Stage D envelope fallback (R39).

**R63 — Performance.** Generation runs server-side, never blocking the UI. Review lists virtualize for large proposals. Validation (R55) completes in well under 100 ms for typical proposals. Streaming never blocks input rendering (R7). Scoring (Stage B via Spec 13) completes in well under 500 ms for libraries of thousands of assets. TTS batching queues server-side through the existing inference lock (R35) — never parallel-bursts.

**R64 — Voice-clone consent (open policy, not decided here).** The spec assumes a single reusable voice prompt for the middle by default (R35) but sets no custom-voice policy: whose voice may be cloned, what consent UX gates CustomVoice creation, and how cloned voices are labelled/stored remain a future effort. Implementers must not invent consent UI in this phase; the voice-prompt picker stays as-is.

## Acceptance criteria

1. A user opens the AI panel from the toolbar, creates several conversations, renames/deletes them, and switching is instantaneous.
2. Asking a general question streams a markdown response (headings, lists, table, code block with syntax highlighting) that renders fully.
3. Selecting a slide and asking "What slide am I editing?" answers from the live project context (R12) — the context reflects unsaved in-memory state.
4. Stopping a long generation halts promptly and keeps the partial response; regenerating replaces it.
5. Closing and reopening the project restores conversations, messages, active conversation, and draft.
6. AI Settings shows endpoint + single model dropdown + temperature/max-tokens/streaming/system-prompt (no provider switch); saving a key shows only its masked tail; requests work with the stored key; saving without `AI_SECRET_KEY` errors clearly. The model list shows live Zen models, with env fallback when the provider is unreachable; selecting a delisted model blocks with a "reselect" message.
7. A provider failure (bad key → 401, exhausted credits → 401/402, rate limit → 429, no network) shows the mapped friendly error with retry and preserves the conversation; partial streams keep partial content.
8. A lesson request produces a complete storyboard in the proposal viewer (overview, slides, classified assets, recommended clips, missing resources); editing the plan (title, duration, order) then revising preserves manual edits unless explicitly changed; accepting stores it without touching the project.
9. From the accepted plan, the agent drafts an Action Scenario (ordered steps with `partTag`, verbatim `spokenLine`, on-screen action, bare asset hints, rough durations); the user accepts one version; Stage B reads exactly the accepted JSON.
10. Reconciliation covers exactly the middle-tagged steps: each asset hint is `matched`/`missing` (Discovery-Run reuse, floor 0.35, explained candidates); each middle step carries a 4-state motion verdict citing the clip/params or the gap; sfx/music hints reconcile against audio; voice is untouched. Each missing hint yields an editable brief that opens the Spec 13 Generation Wizard pre-filled (or copies a provider-agnostic prompt).
11. Stage C fills middle PrompterParts from the accepted scenario lines via an approved proposal (no dispatcher bypass; commands reference `assetId`, never base64); pre-TTS estimates use `charCount × secondsPerCharacter` with `slide.duration` = sum of parts; after generation each part adopts its TTS duration with gap-free shift (no auto-stretch). A failed part is `stale`, blocks the Stage C gate, and retries per part. After accept, the user rerecords any part with the existing TTS/record/word-level modals.
12. Stage D reports the triple check (voice consistency + measured pregen durations/levels, face-rig readiness with shape/bindings present, intro/outro camera framing) with word timings per part (forced alignment; envelope fallback explicitly marked per part); mouth appears only on the pregen intro/outro cat (middle has none); the agent wrote only `morphCoefficient`/control/clip placements (no new Shapes, no binding rewrites, no audio rewrites). Accepting hands the timing map to merge.
13. Each middle slide owns one fresh Animation Script (`from=0`, marks at each PrompterPart boundary) whose effects sit strictly inside their owning part windows; board text/tables appear via create-then-reveal and disappear via opacity holds; cat is absent and the camera is static unless the scenario explicitly asked for a board move. Overrun/unmeasurable-target/unresolved-binding blocks the gate with a message.
14. The agent creates a blank middle project, opens the named intro/outro projects read-only, and assembles a new `<middle> (assembled)` project in intro → middle → outro order via one `ImportSlidesCommand`: sources untouched; one undo reverts the whole merge; slide-name collisions suffix `(2)`, `(3)`; embedded/audio union by id; full id remap validates cleanly (Missing Assets Report embedded-first).
15. Free natural-language edits still work as proposals ("move the title right"): expandable command details, per-command accept/reject, approved-subset-only execution through the dispatcher with inverse-walk rollback on failure (no partial state), execution record linked to its conversation, history lists it with status.
16. Editing the project after generation makes approval report "Project changed — regenerate"; one click regenerates a fresh proposal (stale one closed as `rejected/stale`).
17. With the backend down, the AI panel shows the unavailable state and the editor still works (degraded mode); "Reconcile assets" and wizard entries disable cleanly.

## Testing

Unit tests (Vitest frontend / pytest backend):

- **Conversations** (R2–R4): create/rename/delete/persistence; cascade delete with project.
- **Messages & streaming** (R4/R6–R9): send, receive, incremental persistence, regenerate replacement, stop-keeps-partial; Zen SSE proxy through a tolerant client (non-standard chunks). Backend tests use a fake Zen endpoint (no network); a fake model verifies prompt composition (system → context → history → message) and budget trimming (R13: oldest-first, no mid-message splits, context never dropped).
- **Settings & keys** (R14–R16): masked reads, replace-on-non-empty, save-without-secret error, Fernet round-trip, `GET /ai/models` proxy with fallback list, delisted-model block, family-routing pinned to `/chat/completions` with `response_format=json_schema`.
- **Markdown & search** (R10/R11): render list/table/code/link cases; filter by title and content.
- **Context snapshot** (R12): reflects current engine state incl. unsaved changes; under 50 ms.
- **Planning + scenario** (R19–R29): plan shape validation, classification (existing/missing/optional), revision preservation of user edits, acceptance transitions; scenario schema (six fields + id/order, `partTag` tags, bare hints, rough durations, slide-agnostic), gate blocks Stage B until accept, Stage B reads the accepted JSON verbatim.
- **Reconciliation** (R30–R33): middle-only coverage, Discovery-Run reuse (floor 0.35, matched/missing, accept/reject/replace carried forward), 4-state feasibility citing clip/params, sfx/music-only audio check, brief shape feeding the Generation Workflow, gate blocks Stage C until accept.
- **Prompter/TTS agent** (R34–R37): allowlist validation rejects non-surface commands; batch queues through the inference lock (never parallel); asset-id refs (no base64 in params); two-phase timing (estimate then adopt-TTS + shift, never stretch); part failure → `stale` blocks gate, per-part retry; rerecord leaves neighbors intact via reflow.
- **Calibration/mouth** (R38–R41): triple-check verdicts; word timings from the aligner with envelope fallback marked per part (char-split absent); agent writes only `morphCoefficient`/control/clip placements (Shape creation/binding rewrite/audio rewrite rejected); intro/outro scope (middle untouched); gate blocks merge until accept.
- **Blackboard** (R42–R45): one script per middle slide, `from=0`, marks at part bounds; overrun/unmeasurable/unresolved blocks compile + gate; create-then-reveal with deterministic ids + replace-by-footprint; opacity-hold disappears; static camera unless scenario asks.
- **Project ops + merge** (R46–R49): create/open/duplicate without source mutation; assembled order intro → middle → outro on a duplicate-middle base; one `ImportSlidesCommand` = one transaction/history entry, undo restores pre-merge, no `ProjectLoaded`, dirty + active-slide repoint; collisions suffix, union-by-id dedup, full remap validates.
- **Proposal generation** (R50–R54): natural-language → valid commands on the extended surface; structural validation rejects out-of-surface commands.
- **Dry-run & staleness** (R55/R56): invalid references fail; intra-proposal inconsistency fails; changed-project approval is blocked.
- **Execution & rollback** (R59): batch executes in order; a forced mid-batch failure rolls back every executed command (verify full inverse-walk); events fire per command.
- **Persistence** (R21/R30/R37/R41/R45/R60/R61): plans, scenarios, reconciliations, stage versions, proposals, and statuses restored after reload; rejected retained.

Manual verification checklist: the Acceptance criteria scenarios (1–17), including degraded mode (17) and a real end-to-end three-part video (scenario → reconcile → prompter/TTS → calibrate/mouth → board scripts → merge → preview the assembled intro/blackboard/goodbye with synced narration, mouth on intro/outro only, and board reveals locked to voice).

## Dependencies on other specs

- **Spec 01 — Foundation**: editor layout and toolbar (AI button, AI menu), Vite proxy (`/api/*`), ApiClient pattern, dependency-list discipline (this spec's list extends R4's: +`cryptography`, +`httpx`; never `langchain`/`langgraph`).
- **Spec 02 — Core Engine**: engine read API (R18), command lifecycle/dispatcher/inverse contracts (R54–R59), canonical events (R15/R41 analogues), validation rules; `DuplicateNodeCommand` extends the command set; `ImportSlidesCommand` is defined here under the same contract.
- **Spec 03 — Assets**: asset-library store (definitions by id, names for the snapshot and classification), categories vocabulary, API + store pattern (not commands).
- **Spec 04 — Timeline**: editor-state stores pattern and store events; PlaybackController untouched (AI never commands playback); fixed voice/sfx/music lanes (no "Add Tracks").
- **Spec 05 — Slides**: slide command set as the AI slide surface; `openProject`, persistence being UI-layer, dirty flag, degraded mode, `.lesson` excluding editor state — conversations/plans/scenarios/stage records/proposals follow the same exclusion; `duplicateLessonJSON` + validation + Missing Assets Report patterns reused by merge.
- **Spec 06 — Materials & Shaders**: `AssignMaterialCommand`/`OverrideMaterialParameterCommand` surface; material/shader names for the snapshot. No AI shader commands in v1.
- **Spec 07 — Animation Editor**: clip command set and keyframe family as the AI animation surface; clip names for the snapshot and Stage B feasibility.
- **Spec 08 — Rigging**: rig/morph/control vocabulary consumed by Stage D (Shapes, MorphBinding, shape-id remap, `morphCoefficient`, Controls, `semanticName='mouth'` portability). (Previous bodies mislabeled the next two rows — corrected here.)
- **Spec 13 — AI Asset Pipeline**: consumes this spec's `/ai/*` transport and key handling for prompts/metadata calls; owns library-search reconciliation (Discovery Runs), the Generation Workflow (prompts/variants, Style Profiles, import, playground handoff, Metadata Assistant), and the `ai_plan_asset_decisions` / discovery / workflow tables. Stage B reuses — never duplicates — that machinery and feeds it briefs.
- **Spec 14 — Polish**: builds the undo stack over the inverse contracts this spec's executor consumes (R59) — the extended surface (prompter/audio/`ImportSlidesCommand`/`morphCoefficient` placements) joins its undoable enumeration, each approved proposal staying one history entry (source `AI`); builds the history panel over this spec's proposal records (R61).
- **Backend storage**: the SQLite schema gains `ai_settings` (singleton), `ai_conversations`, `ai_messages`, `ai_plans`, `ai_action_scenarios`, `ai_reconciliations`, `ai_prompter_runs` (Stage C versions), `ai_calibrations`, `ai_board_scripts`, `ai_proposals` tables (project-scoped except settings, cascade delete) alongside `projects` (Spec 05 R17) and the asset library (Spec 03); Spec 13 tables (`ai_discovery_runs` + verdicts, `ai_generation_workflows`, `ai_plan_asset_decisions`) are reused, not redefined.

## Definition of Done

- Users hold context-aware, persistent, searchable conversations with the AI inside the editor, with streaming, stop, regenerate, markdown, and Zen-mapped error handling — and the AI can describe the current project without touching it — all over a single opencode.ai key with encrypted storage and masked display.
- Users get structured, reviewable, editable lesson plans that reuse existing assets and identify missing ones — and accept them without any project change — then drive an accepted Action Scenario through gated reconciliation (with Generation Workflow briefs), prompter fill + per-part local TTS (with manual rerecord), verify-only calibration with phoneme-timed mouth on the pregen intro/outro, and hard-synced blackboard scripts for the middle.
- Users assemble the three-part video (pregen intro + generated middle + pregen goodbye) as a new project via one undoable merge — order, collisions, dedup, and remap all per contract — and preview narration locked to board reveals with mouth on intro/outro only.
- Users can still request free-form project changes in natural language, review the resulting canonical-command proposal (individually selectable, extended surface), and execute a validated subset transactionally — with the project never left partially modified and every execution recorded and traceable to its conversation.
- All AI traffic is backend-proxied with encrypted server-side keys and masked UI display; every capability degrades cleanly when the backend is down.
- The spec leaves no AI feature to a later spec that the steps assign to this phase (undo UI and history panel are explicitly Spec 14's; asset generation is Spec 13's; voice-clone consent policy and preview-QA/export-readiness stages are explicitly future — R64/Scope).
