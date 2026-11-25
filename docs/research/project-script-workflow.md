# Research: name-based project script review and draft workflow

## Finding

**Possible in principle, but not as a direct name-based backend operation.** The repository has a project library listing summaries, an ID-only project fetch, and an editor-side script focus that exposes source plus prompt-block windows/text without audio. A human or trusted tool can resolve a supplied name to an ID, read the project, and prepare a script proposal conversationally. To genuinely validate timing/script behavior, however, the project must be loaded in the frontend engine and run through its script Check/dry-run path. The existing AI proposal workflow is useful precedent but is command-oriented and requires a conversation/project ID; it is not a standalone “draft a script by project name” API.

This research does not establish access to a deployed database or its credentials. No database file, credentials, or external DB access were presumed or inspected.

## Evidence

### Project lookup and data access

- Backend settings use `DATA_DIR` (default backend `var`) and `DATABASE_URL` (default `sqlite:///{data_dir}/library.db`): `backend/app/config.py:732-768`. The database is constructed from that URL by `Database` (`backend/app/database.py:8-24`). Runtime access therefore depends on the app's actual environment/configuration; repository presence alone does not prove the database is available.
- `ProjectRow` stores metadata plus the complete serialized `.lesson` blob in `projects.blob` (`backend/app/projects/model.py:20-38`).
- `GET /projects` lists summaries only (`backend/app/api/projects.py:55-59`); the library intentionally excludes potentially large blobs in `ProjectLibrary.list` (`backend/app/projects/library.py:41-58`). `GET /projects/{project_id}` retrieves the blob, and its route parameter is an ID, not a name (`backend/app/api/projects.py:82-92`).
- Thus a supplied name can be resolved by listing projects and matching summary names, then fetching by ID. There is no name-search/get-by-name route or uniqueness guarantee visible here. If zero or multiple exact matches occur, stop and request clarification; do not silently select the newest/first result. The list is ordered by last-modified, which is not a safe disambiguation policy (`backend/app/projects/library.py:41-58`).
- `.lesson` is the portable project representation and carries project/slide data (`CONTEXT.md:39-50`). It is a reasonable read-only alternative if the user provides an exported `.lesson` file.

### Scenario and narration data

- Scenario markdown is project-attached and travels in `.lesson`; it is distinct from server-side conversation/context (`CONTEXT.md:369-395`). The same context describes append-only Scenario version records and restore-as-new-version semantics (`CONTEXT.md:394-404`).
- Backend scenario endpoints address the project using `projectId`. Active markdown returns active and accepted versions (`backend/app/api/scenario_routes.py:464-502`); accepted markdown can be fetched separately (`:540-557`). The canonical downstream endpoint deliberately reads only the accepted version and returns 409 if none is accepted (`:560-583`).
- Scenario versioning is server-side by project ID; it has active/accepted pointers and append-only version/audit records (`backend/app/ai/model.py:160-240`). Applying scenario markdown bypasses proposal gates but is audited and documented as revertible text / last-writer-wins (`backend/app/ai/scenario_versions.py:5-20, 495-537`). Therefore merely drafting prose in a conversation is safe, but submitting it to the markdown apply endpoint is a real mutation and must not be conflated with a dry run.
- Prompter content/timing belongs to each slide in `slide.prompter.parts`; each `PrompterPart` includes text and start/end/duration, and parts are gap-free by default (`CONTEXT.md:452-462`). The `.lesson` project blob therefore has script and timing data, not merely AI chat history.

### Animation Script and timing focus

- The editor's `buildScriptFocus` is a pure read-only function that returns a slide's current draft source, duration/name/ID, prompt blocks `{id,start,end,text}`, and diagnostics; it does not mutate engine state (`frontend/src/ai/scriptFocus.ts:17-77`). It reads only PrompterPart text/timing; no audio bytes or clips are included in this focus object.
- The canned “Improve timing” request is explicit about timing-only edits and preserving `from`, camera setup and board/background creation/transforms (`frontend/src/ai/scriptFocus.ts:80-149`). It contains the relevant timing/visual constraints and requests clarification for ambiguity. This is the closest existing prompt contract for a conversational revised script.
- The project domain model says an Animation Script is a per-slide authored source artifact compiled to ordinary timeline data only when explicitly run (`CONTEXT.md:173-177`). Its source lives on the slide (`frontend/src/engine/animationScriptRun.ts:317`; script state is also manipulated by `frontend/src/engine/slideManager.ts:237-265`).
- `buildScriptFocus` itself expects an already available `EnginePublic`; the current backend project fetch returns serialized JSON, not the focus structure. An external process can inspect the JSON, but matching the editor's compile/check guarantees requires loading it into the frontend engine or implementing an equivalent supported validation path.

### Draft, preview, apply, and history semantics

- Existing canonical AI Edit Proposals are server-validated commands plus client dry-run against live state; execution occurs only after user approval (`CONTEXT.md:375-380`). Proposal records have `draft` status, command/validation/dry-run JSON and base/validated fingerprints (`backend/app/ai/model.py:78-99`). API routes include draft, dry-run, approve and proposal retrieval (`backend/app/api/ai.py:3253-3257, 3573-3630`).
- Approval is stale-sensitive: proposal code requires a successful client dry-run before approval (`backend/app/ai/library.py:2102-2128, 2150-2178`); the domain contract describes a single approved proposal as one transaction, linked to its conversation (`CONTEXT.md:375-377`). This is a strong safety pattern, but it applies to engine commands rather than an arbitrary conversational script source.
- Existing animation script checking/run paths are in the frontend: `animationScriptRun.ts` imports `checkAnimationScript` and the compiler (`frontend/src/engine/animationScriptRun.ts:10-24`); the project domain says script output is compiled in an explicit transaction (`CONTEXT.md:175-180`). A script proposed in chat can stay uncommitted text until the user asks to check it; running it changes the project timeline and is not a read-only preview.
- Scenario history is append-only and supports restore-as-new-version, but that is a different artifact and applying a scenario version is not a no-op (`CONTEXT.md:394-404`; `backend/app/api/scenario_routes.py:358-462`). No corresponding persistent animation-script proposal/history store by name was identified in the traced surfaces. Keep conversational drafts in the conversation or a separately labelled report/draft, not in project state.

## Safe workflow

1. Obtain authorized access to the running app/API or a user-provided `.lesson`; do not infer a usable DB location from defaults. If using API: list project summaries, exact-match the requested name, and require clarification for ambiguous matches; retain the resolved ID for all subsequent calls.
2. Fetch the project blob read-only by ID. Inspect scenario markdown (report whether it is accepted vs merely active) and the relevant slide's `animationScript.source`, slide duration, and PrompterParts' IDs/text/start/end. Exclude AudioAssets, audio clip payloads and waveform/audio data from the briefing.
3. Draft/revise the complete proposed script and explain changes in the conversation. Clearly label it **proposal only — not checked, applied, or saved**. Never call scenario-apply, proposal-approve, or script Run without explicit authorization.
4. For a true dry-run, load the project into the editor's live engine, construct focus from the current live slide, run Check/compiler validation on the candidate, and return diagnostics without running the script. Re-read/revalidate if the live project changed; the focus builder is read-only, but Check is the validation seam.
5. Only after explicit approval, use the editor's normal reviewed script Run flow. It compiles to timeline data transactionally; the user should review the result and save through the ordinary Save flow. Do not imply that a chat-generated source has been tested/applied when this live-engine prerequisite is absent.

## Limits / prerequisites

- Project ID is required by fetch and AI endpoints; name matching is an extra resolution step, not a supported direct lookup.
- Need the correct configured backend/database or an exported `.lesson`, and authorization to read it. The local default SQLite location is only a default, not proof of availability or permission.
- To provide an actual script compile/dry-run, need the browser/editor engine (or a separately supported equivalent compiler host) and current project state. Static JSON inspection can describe timing blocks but cannot guarantee successful compile or live-state behavior.
- Script source is per slide: the correct target slide must be identified if the project name alone does not identify it.
- Keep script draft and scenario draft distinct. Scenario acceptance/versioning has existing durable semantics; an Animation Script draft does not appear to have the same versioned approval mechanism in the traced APIs.
