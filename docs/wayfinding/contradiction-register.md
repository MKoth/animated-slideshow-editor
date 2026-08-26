# Contradiction Register

Fact-gathering output of the **Contradiction register** map ticket. Source: full audit of `docs/steps/step01–30.md`, `docs/planning/implementation_plan.md`, `docs/planning/general-project-description.md`, cross-checked against the map's standing decisions (web runtime architecture, node type system) and `CONTEXT.md`.

This register **records problems, resolves nothing**. Every spec ticket resolves its own rows.

## How to use

- Rows are grouped by phase (== the 12 specs). Cross-cutting rows touch all specs.
- **Severity**: `blocks spec` (must be resolved before that spec can be written implementably) / `needs decision` (explicit choice required, but drafting can proceed around it) / `cosmetic` (wording; fix while drafting).
- Rows marked **already decided** name the map decision that settles them — apply it in the spec, do not re-decide.
- When a spec drafting ticket resolves a row, note the outcome in that spec's issue (or the register) so the register stays a live ledger until the map closes.

## Cross-cutting

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| CC-1 | `general-project-description.md` §Project Overview (line 5); `step02.md` lines 31, 232, 496 | "The AI Slideshow Editor is a **desktop application**…"; "The editor targets **desktop usage**" vs the web-only decision (map: Web runtime architecture) | **blocks spec** | **Already decided**: web-only. Rewrite as "browser/web application"; Step 2 becomes a full-window paneled web layout; sweep "desktop" language everywhere |
| CC-2 | `general-project-description.md` §Technical Stack (FFmpeg, line 474); `docs/standards/tech-stack-and-install-and-run-instructions.md` lines 131–143 (`brew install ffmpeg`, dev machine only) | FFmpeg listed as if it runs on the client; the "backend encodes" decision appears nowhere in repo docs | **blocks spec** | **Already decided**: backend FFmpeg encodes; encoder interface is the HTTP boundary (map: Web runtime architecture). Move the FFmpeg install note under Backend in the tech-stack doc |
| CC-3 | `general-project-description.md` line 5, `step02.md`, `step06.md`, `step13.md`, `step23/24/30.md` | The web-only decision is not written anywhere in-repo (AGENTS.md's `docs/adr/` doesn't exist); planning docs still claim desktop semantics (local filesystem, native dialogs, "close application", "restart") | `needs decision` | **Already decided** (Web runtime architecture): hosted web app with backend-optional graceful degradation; `.lesson` download/import portability; browser-side in-app project browser. Optionally record as an ADR; spec drafting applies the runtime section |
| CC-4 | `step03.md` Events (l.338 `NodeRemoved`) vs `step04.md` Renderer Events (l.339–343 `NodeRemoved`) vs `step05.md` Events (l.226/236 `NodeDeleted`) vs `step07.md` (l.359–362 `NodeDeleted`) | Two event names for node deletion; Step 5's dispatcher emits a name the Step 4 renderer doesn't subscribe to — deletion silently stops syncing to canvas | **blocks spec** | Canonicalize one event name across the Core Engine + Timeline specs |
| CC-5 | `step04.md` Renderer Events (l.347–351 `TransformChanged`) vs `step03.md` Events (l.330–340) vs `step05.md` (l.227 emits `NodeMoved`) | Renderer reacts to `TransformChanged`, which no step defines and no command emits | `needs decision` | Pick one transform-changed event; emit it from the transform commands |
| CC-6 | `step05.md` Command Responsibilities (l.128–129 "A command should not… Display dialogs") vs `step13.md` Save (l.159–162 "Open Save As dialog", routed through `SaveProjectCommand`, l.377–389) | Command system forbids dialogs but the persistence step routes dialog-opening through a command; boundary unspecified | `needs decision` | State: dialogs/file pickers are UI-layer concerns; commands only request persistence |
| CC-7 | `general-project-description.md` §Non-Destructive Editing (l.85–91 "Undo/Redo… **always available**") vs `implementation_plan.md` (Undo only at Step 27) vs `step05.md` (l.161/272/508 "Undo will be implemented later") | Core philosophy promises undo from day one; the plan ships Steps 1–26 (incl. all AI editing) without it | **blocks spec** | Decide undo's v1 placement: retrofit contract at Step 5, or reword the philosophy to "undo arrives in Polish". Feeds the Step 20 Ctrl+Z row (P8-1) |
| CC-8 | `CONTEXT.md` (Text Node "in v1") + `general-project-description.md` example lesson (text morph "Yo correr"→"Yo corro", l.238–250; camera shift l.264) vs zero "text node" implementations in `docs/steps/` | Text and camera drive the flagship example but no step builds text nodes | **blocks spec** | **Already decided** (Node type system): first-class Text node, implicit per-slide Camera node — the specs draft these as core v1 node types |

## Phase 1 — Foundation (Steps 1–2) → Spec 01

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P1-1 | `step01.md` l.41 "Install all **previously selected** libraries." | No document records a completed library selection | `cosmetic` | Enumerate the install list (post Standards triage: no React Flow/Monaco/MUI/TanStack/Axios; keep Zustand; custom panel UI) |
| P1-2 | `step02.md` Success Criteria (l.19), Theme (l.257), Deliverables (l.508) — UI preferences must "persist" | Persistence vehicle (localStorage vs backend) unspecified; no persistence exists until Step 13 and that covers projects, not UI prefs | `needs decision` | Pin browser localStorage for UI prefs (matches degraded-mode feasibility) |
| P1-3 | `step02.md` Keyboard Shortcuts (l.283–308 placeholder Ctrl+N/O/S/Z/Y…) vs `step07.md` Ctrl+D (l.187), `step13.md` Ctrl+S (l.153–157), `step27.md` Ctrl+Z | Shortcut registration claimed twice (placeholders, then real bindings) without stating the placeholder registrations are replaced; Ctrl+D missing from Step 2's list | `cosmetic` | Note Step 2 registrations are provisional and overridden later |
| P1-4 | `step01.md` Documentation (l.375) — README must list "uv version" | `uv` appears nowhere in the planning docs; unverified prerequisite | `cosmetic` | Confirm the toolchain or drop the requirement |

## Phase 2 — Core Engine (Steps 3–5) → Spec 02

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P2-1 | `step03.md` Public API (l.90 `openProject()`) | API listed before any save/load exists (Step 13); undefined behavior for Steps 3–12 | `cosmetic` | No-op/future until persistence lands |
| P2-2 | `step05.md` Command History (l.240–274, incl. Debug Panel l.276–297) vs `implementation_plan.md` Step 28 "Inspect the list of executed commands" | Step 5 already builds the execution log + display; Step 28's entire deliverable is pre-implemented | `needs decision` | Repurpose Step 28 to history panel polish/persistence, or trim Step 5 to log-only (see P12-2) |
| P2-3 | `step05.md` Goal (l.5–8, "no part of the application may modify the project directly. Every change must be represented by a command") vs `step06.md` Metadata/Pivot/Anchor editors (l.330–387) with only events, no commands | Step 5's command-only mandate has no asset commands; Step 6 edits metadata directly | `needs decision` | Add asset commands (UpdateAssetMetadata, SetPivot, AddAnchor…) to the asset spec |

## Phase 3 — Assets (Steps 6–7) → Spec 03

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P3-1 | `step06.md` Persistence (l.401–408 "stored in **SQLite**", l.420 asset repository) + Asset Storage (l.108–126 `storage/assets/originals/thumbnails/metadata/`) vs `step01.md` (only `/health`, `/ping`) vs `step13.md` (single `.lesson` JSON, l.69–101, no SQLite) | SQLite library + on-disk folder scheme required before any database/upload/storage capability is defined; Step 13's persistence model ignores the library | **blocks spec** | **Already decided** (Web runtime architecture): FastAPI backend owns SQLite asset library + project storage; define the upload/asset API in the backend spec and the library↔project reference contract with the persistence spec |
| P3-2 | `step06.md` Pivot Editor (l.330–347), Anchor Editor (l.350–368), Metadata Editor (l.371–387), AI Description (l.237–251) vs `implementation_plan.md` Steps 21/22 (pivot/anchor, tags/AI description) | Step 6 ships the full pivot/anchor/metadata editors that Steps 21/22 later re-ship as headline features | **blocks spec** | Slice: Step 6 = import + library + read-only preview; pivot/anchor/metadata editors live only in the Asset Authoring spec (Steps 21/22) |
| P3-3 | `step06.md` Classification (l.147–165: Characters, Animals, Fish, Plants, UI, Backgrounds, Speech Bubbles, Icons) vs `step21.md` Asset Categories (l.337–362) vs `step22.md` Categories (l.180–204) | Three incompatible category vocabularies ("Fish" vs "Animal"; "Plant"/"Decoration"/"Speech Bubbles" differ) for one domain; Steps 22/25 assume one enum | **blocks spec** | One canonical category list + validation rule shared by the Assets, Asset Authoring and AI Asset Pipeline specs |
| P3-4 | `step06.md` Thumbnail Generation (l.305–312) vs `step21.md` Asset Preview (l.442–447) | Both steps own the thumbnail pipeline | `cosmetic` | One pipeline; Step 21 only invalidates/regenerates on definition change |
| P3-5 | `step06.md` Supported Formats (l.104 — SVG postponed "until the rendering strategy is finalized") | Rendering strategy finalized at Step 4; referenced decision point no longer exists | `cosmetic` | Re-anchor the reason or drop the clause |
| P3-6 | `step04.md` Temporary node types (l.163–207 Rectangle/Circle/Text; TextureCache l.308–320) vs `step07.md` (l.75–86 "Create an Asset Instance… Render it immediately") | Placeholder types never retired, never replaced; nothing connects the placeholder texture cache to imported assets | **blocks spec** | **Already decided** (Node type system): dev placeholder types scrubbed from specs; the asset-instance spec defines the texture path |
| P3-7 | `step07.md` Selection (l.130 — sync with "Inspector (next step)") | Mandates synchronization with a panel built only in Step 8 | `cosmetic` | Shared selection store defined here; Inspector leg lands in its own spec |
| P3-8 | `step04.md` Mouse Controls (l.243–247 middle-mouse pan) | Middle-click pan conflicts with browser autoscroll/paste | `needs decision` | Web-compatible pan binding (or wheel+modifier) in the renderer spec |

## Phase 4 — Timeline (Steps 9–11) → Spec 04

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P4-1 | `step09.md` Timeline Length (l.257–267, 10s default, "Duration editing comes later") vs `step12.md` Slide Duration (l.306–316, "Timeline length automatically reflects slide duration") vs `step11.md` Playback End (l.264, "project duration") | Two duration models (global 10s timeline vs per-slide duration); the "project duration" in Step 11 has no owner; playhead/currentTime scope on slide switch undefined | **blocks spec** | Decide currentTime scope (per-slide reset on switch is consistent with Step 12's independent timelines) and where playback ends |
| P4-2 | `step09.md` Timeline State (l.271–285, single/global) vs `step12.md` Independent Timeline (l.274–282, per-slide tracks) | Step 12 retrofits the Step 9 model with no stated rework | `needs decision` | State in the Timeline spec that timeline state becomes per-slide in the Slides spec |
| P4-3 | `step09.md` Persistence (l.368–376 — persist UI prefs) | Persisting UI prefs before any persistence exists and with no mechanism | `needs decision` | Same answer as P1-2: browser localStorage |
| P4-4 | `step09.md` Empty Timeline copy (l.328–330, l.518–520 "No objects in **this slide**") | Assumes the slide concept introduced only in Step 12 | `cosmetic` | Reword to "No objects in the scene" |
| P4-5 | `step11.md` (l.264, l.374 "project duration") vs `step12.md` (Slide Duration) | Terminology drift ("project duration" vs "slide duration") for the same unowned concept | `cosmetic` | Folds into P4-1; standardize wording once decided |
| P4-6 | `step08.md` Name (l.138, l.530 — renaming updates "Command History") | References the Command History panel, a Step 28 feature | `cosmetic` | Re-word to "command stack/events" or mark forward-looking |

## Phase 5 — Slides (Step 12) → Spec 05

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P5-1 | `step12.md` Delete (l.211–215 "This action cannot be undone") vs `step27.md` (l.15 "Every editing operation supports Undo") vs `general-project-description.md` (l.23, l.89 "always available") | Promises irreversibility for an operation Step 27 makes reversible | **blocks spec** | Softer copy: deletion becomes undoable once the Polish spec lands (feeds CC-7) |
| P5-2 | `step12.md` Reorder (l.223 "Project **execution order**") | "Execution" pre-commits to export/presentation semantics that no step defines | `cosmetic` | Say "slide order"; defer execution semantics to the Export spec |
| P5-3 | `step12.md` vs `step13.md` (l.95 "Commands (optional, future)" in project file) | Step 13's format decision pre-commits against Step 27's requirement that undo history survive reload | `needs decision` | Stop treating persisted commands as optional/future; decide format support now |

## Phase 6 — Materials & Shaders (Steps 14–15) → Spec 06

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P6-1 | `step08.md` Appearance Opacity (l.241–260) + `step10.md` animatable Opacity (l.106–116) vs `step14.md` Material Parameters "Opacity Multiplier" (l.169–186) vs `CONTEXT.md` (opacity lives in the Material Instance) | Opacity has two competing channels (node property vs material parameter); rendering and keyframing disagree | **blocks spec** | **Already decided** (Node type system): timeline animates the uniform six (Pos X/Y, Rot, Scale X/Y, Opacity) for every node; opacity's material channel defined in the Materials spec so the two compose |
| P6-2 | `step14.md` (l.112, l.160 — material instances only for asset instances; Text only a "future material type") vs `CONTEXT.md` (every renderable node owns a Material Instance) | Material generalization has no Text node to generalize to | `needs decision` | **Already decided** (Node type system): Text node is first-class v1 — the Materials spec covers asset and text nodes |
| P6-3 | `step15.md` Inspector shader assignment (l.170–181) vs `implementation_plan.md` Step 22 ("Shader slots" in asset metadata) | Two competing shader-assignment mechanisms, unconnected | `needs decision` | **Already decided** (Node type system): shader slots stay asset-only; materials own shaders per-node |
| P6-4 | `step15.md` Error Reporting (l.200–220), Hot Reload (l.377–393), Compilation (l.184–197) | Step 15's scope (l.33–53) has no shader-source editor, but these features require editing shader source | `needs decision` | Add a minimal shader-source editor to the spec or defer hot reload/line highlighting |
| P6-5 | `step14.md` Serialization (l.299–308 — "Projects store: Material Definitions…") vs `CONTEXT.md` (definitions reusable/immutable) + `general-project-description.md` (everything reusable) + `step13.md` (project format lists no materials at all) | Material definitions per-project vs shared library; Step 13's format (written first) omits them entirely | `needs decision` | Definitions in a shared library, instances in the project (matches the domain model); align with packaging |
| P6-6 | `step15.md` Shader Types (l.124–146 Fullscreen Shader; future Post Process) vs `step14.md` per-node material pipeline | Screen-space effects mixed into the per-node material mechanism with no defined target | `needs decision` | Separate screen-space effects (scene-level stack) or drop to future |

## Phase 7 — Animation Editor (Steps 16–17) → Spec 07

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P7-1 | `step16.md` Interpolation Types (l.172–180 "Future: Bounce/Elastic/Spring") vs Easing Presets (l.184–212, includes Bounce and Elastic) | Same file declares Bounce/Elastic future *and* shipped | **blocks spec** | State whether presets are named curve configurations over Linear/Bezier/Constant or require new interpolator types |
| P7-2 | `step16.md` Success Criteria (l.27 "Playback and export **automatically use** the new interpolation system") | Export (Step 23) doesn't exist yet; claim unverifiable at this step | `cosmetic` | Rephrase: shared evaluator upgraded; the Export spec consumes it |

## Phase 8 — AI (Steps 18–20) → Spec 08

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P8-1 | `step20.md` Goal (l.9), Success Criteria (l.22), Undo/Redo section (l.374–389 "Ctrl+Z… One proposal becomes one Undo transaction"), tests (l.594–598, 642–652), Deliverables (l.690) vs `step05.md` (undo deferred) vs `step27.md` (undo built here) | Step 20 makes Ctrl+Z and transactional execution success criteria 7 steps before the capability exists | **blocks spec** | Step 20 = command generation + validation + review + execute; move one-proposal-undo verification to the Polish spec (or reorder undo earlier — see CC-7) |
| P8-2 | `step20.md` Supported Commands → Timeline (l.189–192 "Change Duration / **Add Tracks**") | "Add Tracks" has no backing command anywhere in the plan (Step 9's tracks are read-only) | `needs decision` | Drop "Add Tracks" or specify a track-add command in the Timeline spec |
| P8-3 | `step18.md` AI Settings (l.310–328), Provider Abstraction (l.331–349 OpenAI/Anthropic/Google/Ollama) + Steps 19/20/25/26 consuming LLM output | No step defines the AI transport: no backend endpoint, no proxy, no key-storage policy; Step 18's client-side provider config invites keys in the browser | **blocks spec** | **Already decided** (Web runtime architecture): all AI traffic proxies through the backend, no keys in browser. The AI spec must define the `/ai/*` endpoint surface, server-side keys, and what "AI Settings" configures client-side |
| P8-4 | `step19.md` Asset Planning (l.237–261, l.323–342 — existing/missing/optional classification) vs `step25.md` (l.17–27, l.257–278 — missing-asset detection) | Step 19 already produces the "missing assets" output Step 25 claims as its own; boundary and "missing asset" ownership undefined; "Optional Asset" class vanishes in Step 25 | `needs decision` | Step 19 = planning-time classification (LLM); Step 25 = library-search reconciliation feeding the same model; one owner of "missing" truth |
| P8-5 | `step20.md` History (l.392–409) vs `step27.md` History Panel (l.276–300, source "AI" l.207–236) vs Step 28 (implementation_plan l.525–529) | Three specs for one AI history surface | `needs decision` | Step 20's history is a filtered view of the Polish-spec history; don't spec a separate UI |
| P8-6 | `step19.md` Future Placeholders (l.516 — lists "Video export", "Automatic slide creation", "Asset generation") | Future list mixes unplanned items with already-scheduled steps (23, 20, 25/26) | `cosmetic` | Re-label "deferred beyond this step" or drop items later steps deliver |

## Phase 9 — Asset Authoring (Steps 21–22) → Spec 09

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P9-1 | `step21.md` Architectural Principle (l.80 "The **imported image is never placed directly into a scene**") vs `step07.md` + implementation_plan Step 7 (l.151 "Drag an image onto the canvas") | Playground-mandatory lifecycle contradicts the direct import→place pipeline | **blocks spec** | Decide one canonical pipeline: direct import→place stays legal, or Playground prep becomes mandatory; align the Assets and Asset Authoring specs |
| P9-2 | `step22.md` Persistence (l.545 "Metadata… **shared across all projects**") vs `step06.md` (global SQLite library) vs Step 24 packaging ("portable package" with assets/metadata) | Boundary between library-global and package-local metadata undefined | `needs decision` | Define whether asset definitions+metadata ship in packages or stay library-global (align with P6-5) |
| P9-3 | `step21.md` Commands (l.484 "All changes remain fully undoable") + `step22.md` Commands (l.508 "participate in Undo/Redo") | Same premature undo claim as P8-1 | **blocks spec** | Rephrase: commands structured to be reversible; Undo lands in the Polish spec |
| P9-4 | `step21.md` (Pivot/Anchors/Bounding Box/Metadata/AI Metadata, l.189–335) vs `step22.md` (Tags/Categories/Semantic Anchors/AI Description, l.108–419) vs `step06.md` (see P3-2) | Step 6 vs 21/22 pivot/anchor/metadata duplication; 21→22 split itself is consistent (22's features are "Future" in 21, l.294–299) | **blocks spec** | P3-2's slice decision applies: Step 6 = library only; Steps 21/22 own the editors, with 21 = geometry (pivot/anchor/bbox/transforms) and 22 = semantic metadata (tags/categories/AI description) |
| P9-5 | `step26.md` AI Metadata Assistant (l.339–354 suggests Name/Category/Tags/AI description/Compatible animations/Shader slots) | Duplicates Step 22's feature set with no reuse statement — violates the same "no duplicate implementation" principle Step 26 states elsewhere | `needs decision` | The assistant populates Step 22's editor fields/commands; no parallel metadata model |
| P9-6 | `step22.md` Geometry quick actions (l.219 — navigate to Asset Playground) | None — ordering correct (Step 21 precedes 22). Registered as verified non-issue | — | — |

## Phase 11 — Export (Steps 23–24) → Spec 11

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P10-1 | `step23.md` Encoder (l.275 "Use **FFmpeg**"), architecture diagram (l.58–84 local pipeline), Performance (l.465 "background worker or separate process") | FFmpeg assumed in-process; browser cannot run it; no step locates it or defines the encoder boundary | **blocks spec** | **Already decided** (Web runtime architecture): browser renders frames → HTTP → backend FFmpeg encodes; encoder interface is the HTTP boundary |
| P10-2 | `step23.md` (l.127 "Output File" dialog, l.372 "Open containing folder", l.403/515 "Invalid output path", l.453 "Recent output directory", l.532 "Restart") + `step24.md` (l.305 "File Open dialog", l.617 "package selection dialog") + `step30.md` (l.226, l.299, l.553–557, l.589–591, l.617–619) | Native-dialog/filesystem/process vocabulary in a browser app | `needs decision` | **Already decided** (Web runtime architecture): in-app project browser + `.lesson` download/import; replace dialog/process language with browser equivalents (download, file picker, page reload) |
| P10-3 | `step13.md` `.lesson` (l.71, l.76) vs `step24.md` `.lessonproj` (l.105, l.479, l.573/634 "canonical portable representation") | Two file formats, relationship undefined | `needs decision` | **Already decided** (Web runtime architecture): `.lesson` download/import is the portability path — document the format relationship (package wraps the `.lesson` file, or consolidate on one) |
| P10-4 | `step23.md` Persistence (l.450–454 — last export settings, output dir, history) vs `step30.md` Export Settings (l.292–300, same keys) | Step 30 re-implements export-settings persistence | `needs decision` | Step 30's Settings dialog reads/writes the Step 23 store (see P12-4) |

## Phase 13 — AI Asset Pipeline (Steps 25–26) → Spec 13

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P11-1 | `step25.md` Embeddings (l.380–403 "Embedding Generator → Vector Index → Semantic Search") | Embedding computation assigned nowhere; needs backend placement (keys/proxying) | `needs decision` | Scope embedding generation to the backend in the AI transport spec (P8-3) |
| P11-2 | `step26.md` Asset Preparation (l.326–335 "**Reuse Step 21 functionality**… No duplicate implementation") + Import Workflow (l.306–322) + wizard steps (l.148–182) vs `step06.md`/`step21.md`/`step22.md` | Names the **right** step (21 — seeded suspicion of a wrong name is refuted), but its own workflow/wizard/import sections re-specify pivot/anchor/metadata; Step 6/22 also claim the same | **blocks spec** | Wizard = thin orchestrator invoking the Assets/Asset Authoring UI and commands; delete re-specified content (aligns with P3-2) |
| P11-3 | `step26.md` (l.7, l.34, l.52 — no direct image generation; future placeholder l.500) vs `general-project-description.md` (l.161–169, l.490) | None — consistent with the deferred direct-generation decision. Registered as verified non-issue | — | — |

## Phase 14 — Polish (Steps 27–30) → Spec 14

| ID | Where | Contradiction | Severity | Direction |
|---|---|---|---|---|
| P12-1 | `step27.md` (l.9 "Command Pattern introduced in earlier phases", l.17 "Every editing operation supports Undo", l.84–90 undo/redo contract) vs `step05.md` (l.161/272 — commands built execute-only) | Step 27 retrofits undo onto every prior command type; retrofit scope never enumerated | **blocks spec** | Spec must enumerate the retrofit of all prior command types as explicit scope (feeds CC-7) |
| P12-2 | `step27.md` History Panel (l.276–300, l.698) + History Persistence (l.373–386) + Command Sources (l.244–248) vs `step28.md` (l.34–41, l.423, l.268–279, verbatim-identical source list l.100–114) | Two consecutive steps each build a history panel, persist overlapping history, track identical sources | `needs decision` | Step 27 = undo/redo engine only; Step 28 = the single history panel + audit log consuming Step 27's events (see P2-2) |
| P12-3 | `step29.md` Timeline-skip rules (l.91–101 — skip hidden objects, locked slides, disabled animations) vs `step23.md` (l.241 "No dropped or duplicated frames", l.392–394 determinism, l.24 "Exported videos match the editor preview") | If skip rules reach the export path, exported video differs from preview; scope of the optimizations never stated | `needs decision` | State explicitly: Step 29 optimizations apply to editor playback only, never the offline renderer |
| P12-4 | `step30.md` Export Settings (l.292–300) vs `step23.md` Persistence (l.450–454) | Duplicate persistence (see P10-4) | `needs decision` | Step 30 settings = UI over Step 23's store |
| P12-5 | `step30.md` Performance Settings (l.257–265) + Developer Settings (l.303–311) vs `step29.md` Persistence (l.266–274) + Performance Overlay (l.193–213) | Same preference keys re-specified; overlay re-built | `needs decision` | Step 30 settings = UI over Step 29's persisted keys; drop overlay/render-stats duplication |
| P12-6 | `step30.md` Final Acceptance (l.671–684) vs `CONTEXT.md` (Text Node in v1) + `general-project-description.md` example lesson | v1.0 acceptance silently omits text (and narration/particles — see CC-8, below) | **blocks spec** | **Already decided** (Node type system): text is core v1 — acceptance criteria must cover text; narration/particles stay out of v1 (no node type, asset category only) |

## Verified seed suspicions

| Seed | Verdict |
|---|---|
| Step 20 promises Ctrl+Z on AI edits; Undo only built in Step 27 | **Confirmed** — P8-1 |
| Steps 6, 21, 22, 26 overlap on asset import/pivot/anchor/metadata; Step 26 "reuse Step 21" | **Confirmed** (P3-2, P9-4, P11-2) — but Step 26 names the **correct** step; the wrong-step suspicion is refuted; the real violation is Step 26's AI Metadata Assistant duplicating Step 22 (P9-5) |
| Step 4's temporary node types never replaced | **Confirmed** — P3-6 (decided: scrubbed) |
| "Desktop" mentions (Steps 2, 13, 30, general description) | **Confirmed** at planning level (CC-1) and Step 30 (P10-2); Step 13 has no literal "desktop" word but is written entirely in desktop semantics (P10-2) |
| Native file dialogs (Step 13) vs browser reality | **Confirmed** — P10-2 |
| FFmpeg assumed but never located | **Confirmed** — P10-1 |
| Example lessons use text and camera with no step specifying them | **Confirmed** for text (CC-8, P12-6); **refuted** for camera — camera exists in Steps 4/16/17 and the implicit per-slide camera is decided |
| Step 6 requires SQLite before Step 13 defines persistence | **Confirmed** — P3-1 |
| 10-second timeline default (Step 9) vs per-slide duration (Step 12) | **Confirmed** — P4-1 |
| Step 21/22 metadata overlap; Step 22 "navigate to the Asset Playground" ordering | **Confirmed** (P9-4); ordering **verified fine** (Step 21 precedes 22) — P9-6 |

## Refuted / verified non-issues

- Camera coverage gap (seeded) — camera is built (Step 4) and decided (implicit per-slide node); benign mentions in Steps 16/17.
- Step 26 vs deferred direct AI image generation — consistent (P11-3).
- "Event System" references in Steps 23/30 — live (built at Step 3).
- Step 26's "reuse Step 21" naming — correct as written (P11-2).
- Undo/Redo promised before Step 20/27 in Steps 1–7 — Steps 2/5 correctly defer (residue only: Step 2's placeholder shortcut registrations, P1-3).

## Resolved by Spec 01 — Foundation (issue #20)

| ID | Outcome |
|---|---|
| P1-1 | Resolved — R4 enumerates the canonical dependency list (no React Flow / Monaco / MUI / TanStack Query / Axios; Zustand kept; custom panel UI). Tech-stack doc now mirrors it. |
| P1-2 | Resolved — R29: UI prefs (theme, panel sizes, visible panels, selected sidebar tab) persist in browser `localStorage` via the Zustand `persist` middleware; works with the backend down. |
| P1-3 | Resolved — R31: Step 2 registrations are explicitly provisional; `shortcutRegistry.ts` is a single binding map so later specs rebind without restructuring. |
| P1-4 | Resolved — R1: toolchain confirmed as Node.js 22 LTS, Python 3.12, uv; README lists all three with minimum versions. |
| CC-1 | Resolved — web-only language applied throughout the spec; the editor is a full-window paneled browser layout (R17); "desktop" vocabulary dropped. |
| CC-2 | Resolved — FFmpeg install note moved under the Backend section of the tech-stack doc; encoder boundary (browser renders frames, backend encodes) stated there. |
| CC-3 | Resolved — Spec 01's Scope/Out and R8/R9/R29 apply the web-runtime decisions (same-origin production hosting, degraded mode with backend down, localStorage persistence). |

## Resolved by Spec 10 — Charts, Tables and Data Visualization (issue #171)

Spec 10 is a new spec (not in the original planning docs), so no contradiction register rows apply. The spec was produced from 7 research/design sub-issues (#172–#178) and synthesizes their decisions into the implementation contract.
