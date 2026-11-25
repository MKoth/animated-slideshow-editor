# Project-wide Animation Script Proposals

Use this instruction when the user gives an exact project name and wants a revised Animation Script for every step in that project. The expected deliverable is one saved proposal file per slide, not a change to the lesson.

## Invocation

Give the agent this document and one input: `Project name: <exact project name>`.

## Goal

Read the named project, its accepted/current scenario, each slide's standard Animation Script, prompt text and timing, scene setup, and referenced visual assets. Produce one complete revised Animation Script per slide as a copy-ready proposal. Keep all proposals outside the project until the user applies them.

## 1. Resolve the project by name

1. Fetch through the app's project API or use a user-provided `.lesson`. Never inspect a guessed database path or assume the default local database is the user's data. In this repo, the API is normally available through the frontend `/api` proxy at `http://localhost:5173` (proxy target defaults to `http://localhost:8000`; see `frontend/vite.config.ts`). If those defaults are unavailable, inspect the configured app/API URL. Do not ask the user to manually extract lesson content while an authorized API can be reached.
2. Request `GET <app-origin>/api/projects`, exact-match the supplied name, and retain its project ID. Verify exactly one match. Only a missing or ambiguous exact match requires asking the user to resolve the name.
3. Request `GET <app-origin>/api/projects/{project_id}`. The list endpoint returns summaries; the ID endpoint returns the `.lesson` JSON. A fetch failure is a retrieval/tooling problem to investigate, not evidence that the user must provide slide content.

## 2. Enforce the standard-script prerequisite before doing any proposal work

Preflight **every slide in the project before drafting any revised script**. The standard scenario-generated Animation Script should already have been run and saved on every step so its blackboard, camera, paw assets, image instances, and other staging are attached to the scene. The fetched `.lesson` is the source of truth; an interactively open editor is not a prerequisite, and the agent must not ask the user to open it just to provide lesson data.

A slide passes only when all of these are true:

- `slide.animationScript.source` exists and is non-empty.
- The saved script has a successful compiled footprint in `slide.animationScript.lastCompiled`.
- Nodes listed in `lastCompiled.createdNodes` are present in that slide's scene; the standard background/board staging is visibly present in the scene as well.
- A read-only Check of the saved source against the loaded slide produces a runnable result with no errors, and its footprint is consistent with the saved run/scene.

The source text alone is not proof that the standard script was run. If **any** slide fails this gate, stop the entire project-wide job before creating proposal files. Tell the user which step(s) need the standard script created, run, and saved/attached, and ask them to return when that is done. Do not draft the missing baseline, process only the ready steps, or modify the project to get past the gate. Lack of an interactive editor session is not itself a failed prerequisite: validate saved footprints and scene state from the fetched lesson, and use the app engine/test harness to check candidate scripts against the hydrated slide state.

## 3. Read only the needed project context

Extract a small, audio-free working view from the `.lesson`:

- Scenario markdown from `scenario.currentMarkdown`; record whether it is the active/current or accepted scenario where that information is available.
- Project slide order, slide IDs/names/durations, each `animationScript.source` and `lastCompiled` summary.
- Every `PrompterPart` as `{id, text, startTime, endTime, duration}`. Preserve full text and exact timing; do not include `audioClipId`, `audioAssetId`, audio bytes, waveform data, or audio payloads in model context or proposal files.
- Scene node names, components, transforms, camera, board/background, existing text/table structure, image asset IDs, and the script-created footprint.
- Scenario image references and their `scenario.bindings`; resolve aliases to asset IDs. Read asset metadata (intrinsic width/height) and inspect only referenced image assets when needed. Never fetch, play, transcribe, or include audio.

The project response can contain embedded audio in its `.lesson` JSON. Filter it locally before presenting context; only pass the fields above onward. Never print or pass the full lesson JSON to model context or terminal output. Prefer the read-only project/API surfaces over direct database access.

Relevant implementation references: `backend/app/api/projects.py` (project list and ID fetch), `frontend/src/ai/scriptFocus.ts` (read-only prompt-block focus and timing prompt), `frontend/src/engine/animationScriptCheck.ts` (pure Check), `frontend/src/engine/animationScriptRun.ts` (mutating Run), and `frontend/src/engine/animationScriptCompiler.ts` (`rowHeight`/`rowHeights` table properties).

## 4. Map scenario steps to slides and inspect the baseline

1. Match scenario step headings to the ordered project slides by step number/name. Confirm every slide has one corresponding scenario section; stop and ask if the mapping is ambiguous or incomplete.
2. For each slide, read its full scenario section and all prompt blocks. Use block IDs and their actual times; do not rely on stale `part-N` markers from an earlier scenario/TTS version.
3. Read the complete saved standard script, not just its effect lines. Identify the script header, defaults, `setCamera`, blackboard/background and Board group, hand/helper assets, image instances, table/text nodes, colors, bindings, markers, effects, and existing cleanup.
4. Treat the standard script as the staging baseline. Preserve its `from`, camera, background/board transforms and setup, and script structure. Do not replace it with a new script that omits the already-run blackboard/staging.

## 5. Revise each script against the complete visual brief

Align each reveal's start to the beginning of the `PrompterPart` that first speaks the visual's content. Do not wait for the next block after the word/phrase has already been spoken. For a multi-block phrase, start with the first block that says it; choose a reveal duration that lets it become readable while that phrase is being spoken. Apply the same rule to table cells and labels. Refresh marker definitions from the current blocks. Keep visuals hidden before their first spoken mention, and do not expose a complete phrase before its narration begins.

For each slide:

- **Legibility and color:** Use `fontSize` 50 as the normal floor for every visible text node, including table cells; use 60+ for short, prominent phrases when they fit. Do not reduce text below 50 merely to squeeze it into the current layout. First widen/reposition the table or node, shorten redundant support text without changing the lesson meaning, or split a long statement/cell into complete, meaningful lines using separately positioned text nodes. A size below 50 is an exceptional last resort only when the actual frame/cell cannot accommodate a readable 50-size alternative; identify that specific node and reason in the validation notes. Use several clearly distinct chalk colors (for example, aqua, coral, lemon, violet, mint, and orange) rather than near-identical shades.
- **Tables:** Make the table and cells large enough to read. Use the Animation Script DSL's `rowHeight` or `rowHeights` property to increase cell height; do not mistake it for a generic text-node `height` property. Increase column widths and/or move the table only as needed to fit the active frame. Reveal the border separately with `reveal(nodeOnly(table))` when cell text has separate timings, then reveal each cell as its narration is spoken. Give cells distinct colors. Keep the table border white/whitish (e.g. `#F5F0E6`); never yellow.
- **Long text:** Split long statements into separate text nodes with complete, meaningful lines. Position each line explicitly above/below the adjacent line and inside the camera frame. Do not put `\\n` or literal newlines inside a text string. Reveal lines in reading order, starting each at its matching spoken block; use a small stagger only when the narration itself progresses through those lines. Fade/remove them in reverse order when appropriate. Never split a studied-language phrase across nodes.
- **Cumulative teaching:** Keep useful definitions, translations, and rules visible while relevant and space permits. Replace or clear temporary support when the topic changes or imagery needs the space; do not make every item flash on and off.
- **Narration coverage:** Audit the full narration timeline from beginning to end, not just the example blocks. For each sentence/teaching beat, identify what is visible and why; keep a relevant heading, rule, example, or cumulative table on the board during explanations. A single title sitting alone through a long explanation is not adequate coverage. Do not reveal a studied-language phrase before it is spoken; reveal it at or just after the block that completes the phrase. Fade obsolete material before the next visual enters, not at the same timestamp.
- **No collisions:** Treat every simultaneously visible text node, table, and image as a collision set. Estimate each full rectangle from measured text dimensions (or conservative font-based bounds), table cell geometry, asset intrinsic dimensions/pivot/scale, and transforms. Check at entrance, while labels accumulate, during transitions, and whenever the visible set changes. Reposition, shorten/split support, or clear the old item early; do not rely on node centers alone to establish safe spacing.
- **Highlight with mark:** Use the highlight effect `mark(alias, at: ..., over: ..., visual: none)` (no hand — just the red underline) everywhere the narration points at, names, or compares something already visible: each spoken article/term, each table row or cell as its content is read ("first row", "third row", "masculine singular is..."), each example when it is referenced again, and each recap term when it is summarized. Place the mark at the block that speaks the content (or just after its reveal completes when both happen in the same block, e.g. `at: markTime("part-N") + 0.5`), while the target is still visible and before it fades. Never mark a node before it is revealed or after it has faded; every mark target must be visible and measurable at the mark's start time. Marks are highlights, not opacity writes, so sequential marks on one node are allowed — but a mark is not a substitute for revealing the content on time.
- **Image overlap:** Derive the visible world from the existing camera/frame. For each image, use its intrinsic dimensions, pivot, script scale and target transform to estimate its world-space bounds. Check those bounds against text, labels, tables and other images at the time they coexist. If an image would overlap a temporary sentence, fade that sentence just before the image enters (or reposition the sentence if that is clearer). Preserve the key idea in another visible form, such as the table, when possible. Do not guess image dimensions or alter the standard background/camera to solve an overlap.
- **Cleanup:** On each non-final slide, fade or erase every temporary teaching node/table/image shortly after narration ends, not at slide end. Compute effective speech end as the maximum `endTime` across that slide's `PrompterPart`s. Start the final clear at or just after speech end (typically speech end + 0.2-0.8s, staggered in reverse reveal order), and finish all final effects within ~1-2s after speech end while still finishing within `slide.duration` at proposal time. Never anchor final cleanup to `slide.duration` and never pack effects against the slide tail: use `markTime("part-N") + offset` off the last spoken block(s) or the absolute speech-end time, so the user can manually shorten `slide.duration` down to just past the cleanup with no script rewrite. Use ordinary opacity fades for routine text cleanup; reserve `wipe(...)`/hand effects for cases where the visual writing/erasing action adds value. The final slide may keep its closing image. Write each node's opacity intervals strictly sequentially: one `reveal` followed by at most one `fadeOut`, with the fade starting only after the reveal ends (touching at an endpoint is allowed, interior overlap is a compile error). Never emit two `fadeOut` calls on the same node with overlapping time ranges, and do not add a redundant end-of-slide fade for a node already faded mid-slide unless it is re-revealed in between.
- **Bounds:** Estimate text bounds after finalizing content and font size. Standalone text transforms are centers; table-cell `(x, y)` positions are insets from the padded cell top-left. Check full text bounds against the cell and active camera frame with a safety margin. Split/reposition/resize before reducing font size.

## 6. Check each complete candidate without applying it

1. Run the pure `checkAnimationScript(engine, slideId, source)` from `frontend/src/engine/animationScriptCheck.ts` for every candidate, using the actual slide scene hydrated from the fetched lesson via the app engine/test harness. Check diagnostics, asset/material references, marker lookups, effect overlaps, and end times against slide duration. Also record effective speech end (maximum `PrompterPart.endTime`) and confirm the last cleanup effect ends within ~1-2s after speech end, leaving any trailing slide silence trimmable without script edits. This Check is read-only; never call Run.
2. A blank synthetic slide is not the project slide and cannot satisfy the actual-scene Check. If the app can hydrate the fetched lesson in a test/engine harness, use that even when no browser/editor session is available. A parser-only test, blank synthetic slide, or manual source reading is not a candidate Check. If there is no supported way to hydrate/check the actual scene, report that limitation accurately; do not ask the user to provide data already fetched or imply a synthetic check validates the project. This is a tooling limitation, not a missing-user-information blocker.
3. Visually inspect a rendered candidate at the initial state, every meaningful entrance/transition, dense table/image states, and representative narration points throughout the slide. Confirm the board stays meaningfully occupied as narration proceeds and that no text/table/image rectangles collide. Use renderer measurements when available; otherwise estimate from the actual camera/frame, asset metadata, transforms, and text measurement, and state limits. A compiler Check is not a visual review. Never label a candidate visually checked unless it was rendered and inspected.
4. If Check fails, repair and Check again. Keep source-only proposals separate from the lesson.
5. Never Run, save, or apply a candidate as part of this task. Running changes timeline/scene data; the user will review and apply proposals themselves.

## 7. Save and return copy-ready proposal files

After **all** slides pass the baseline gate and have complete revised candidates:

- Follow the established Step 1 format: create `proposals/<exact project name>/<exact slide name>.md` for each remaining slide. Each Markdown file has a heading, project/status/basis metadata, exactly one fenced `text` block containing the complete copy-ready Animation Script, and validation notes outside that block. Do not rewrite existing proposal files unless asked.
- The fenced block contains the complete script, including its `script "..." from ...` header, retained staging/setup, bindings, current markers, and every effect. No `...` placeholders or omitted portions. Prose and validation notes stay outside the code block.
- The user asked for files: save proposals in the project directory and return their paths in project order with a concise completion note. Do not paste all scripts into chat unless asked. Creating proposals must not modify or save the lesson. If renderer validation was unavailable, label each file as an unverified draft and say so in the completion note; do not present source parsing or static inspection as evidence that overlap/pacing has been checked.
- Confirm proposal count equals slide count (including existing proposals) and each file contains its complete corresponding script. Each file's validation notes must list effective speech end, last effect end, and `slide.duration` to show cleanup is speech-anchored, not slide-anchored. Do not write partial project proposals if any earlier gate failed.

On a prerequisite failure, the only response is a short blocker listing the step names that still need a standard script run and attached. No proposal files or partial scripts are produced.
