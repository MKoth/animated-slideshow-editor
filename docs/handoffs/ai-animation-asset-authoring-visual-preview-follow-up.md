# AI Animation Asset Authoring — Visual Preview Follow-up

Implementation contract: [#448](https://github.com/MKoth/animated-slideshow-editor/issues/448), extending [#437](https://github.com/MKoth/animated-slideshow-editor/issues/437).

## Current implementation

- Animation asset proposals support approved Shape, Clip, Clip Collection, and Animation Script create/update/delete operations through the inline conversation card.
- Shape proposals carry complete vertex positions and must cite a source Shape on create; topology is validated against the target mesh before execution.
- Clip and Collection proposals render in an isolated engine. Per-Clip previews use a temporary one-binding Collection; full Collection previews reuse `CollectionSilhouettePreview`.
- Animation Script proposals run through `AiRunAnimationScriptCommand`, including replace-by-footprint cleanup, one Transaction, stale validation, and undo. `AiDeleteAnimationScriptCommand` clears the footprint and removes the retained script.
- Denial feedback is persisted on the proposal and sent as a new animation-conversation message. Successfully applied asset IDs are reconstructed from proposal history and added to subsequent assistant context.
- Shape geometry is included in bounded context, capped at 800 vertices total with selected nodes first. Larger/omitted geometry is not guessed.

## Follow-up work

The isolated visual cards intentionally render mesh silhouettes, not the editor's complete Pixi scene. They do not yet show materials, textures/images, text, charts, camera framing, or other non-mesh renderables. Implement a reusable isolated-scene render seam that runs the existing Pixi renderer against the proposal's cloned engine at requested timestamps, captures labelled frames, and never attaches a mutating renderer to the live editor. Use it for:

1. Existing Clip and Clip Collection proposal previews, preserving the current per-part and five-step affordances while showing the actual rendered object.
2. Final `AiRunAnimationScript` previews, including camera framing, scene travel, non-mesh content, and the script footprint time window.
3. Shape draft comparison, showing source and proposed geometry in the same object/render context.

Also add an on-demand geometry detail request for a single target Shape when it is absent from the bounded `shapeGeometry` snapshot. Return the full source vertex list only for the requested node/Shape and keep that request read-only; the present global cap can exclude a large mesh even when the artist selects it.

## Suggested seams and verification

- Extend `frontend/src/engine/aiPreview.ts` with the isolated frame-render contract; keep temporary engine setup and renderer ownership inside engine/renderer modules rather than importing `engine/internal` from UI components.
- Replace or complement SVG-only rendering in `frontend/src/components/ai/AiAnimationAssetPreview.tsx` and `AiAnimationScriptPreview.tsx` with captured frames. Keep the cards inline under their assistant messages.
- Add a focused `Renderer`/Pixi test seam that captures at least two known timestamps from a cloned project and proves the live project's serialized fingerprint is unchanged.
- Add integration coverage for a scene containing a mesh, a textured/image object, and text, and verify all are visible in the proposal frames; verify the animation-script sample range comes from its compiled footprint.
- Add a focused geometry request test that returns full vertices for a selected high-vertex-count mesh without exceeding the normal bounded chat snapshot.

The current UI labels the existing preview as a mesh-silhouette preview so the omitted rendering detail is visible to the artist rather than implied to be a complete Pixi render.

## Detailed implementation plan

### Goal and boundaries

Deliver complete, deterministic proposal visuals from an isolated copy of the project, and allow an artist to request the full geometry of one selected Shape when the bounded conversation snapshot omitted it. The existing live editor remains the authority for the current project and must not be mutated, resized, camera-adjusted, or temporarily rendered into by proposal-preview work. Keep preview creation, renderer lifecycle, and frame capture behind engine/renderer APIs; React components consume labelled frame results and display them inline in the assistant message.

### Phase 0 — Map the existing renderer lifecycle and define the contract

1. Trace renderer construction, Pixi application ownership, scene mount/unmount, render scheduling, camera setup, asset loading, and disposal in the editor renderer modules. Identify which code assumes a DOM canvas, live editor stores, resize observers, animation ticker, or project persistence.
2. Define a small engine-facing contract in `frontend/src/engine/aiPreview.ts`, for example a request containing a cloned `LessonJSON`, a slide ID, ordered `{ label, time }` samples, output dimensions, and optional camera policy; return ordered `{ label, time, image }` frames plus structured errors. The exact image representation (data URL, Blob, or another serializable view value) should follow existing renderer conventions and avoid leaking Pixi objects into components.
3. Make the contract asynchronous because image/texture resources may need loading. Specify cancellation/disposal behavior for unmounts and superseded proposal revisions. A failed or missing individual asset should produce a useful preview error without changing proposal approval or live editor state.
4. Snapshot the source project once per request with `toJSON()` and `structuredClone`; all proposal application, script compilation/execution, timeline seeking, camera changes, and rendering happen against this disposable clone.
5. Keep the renderer seam narrow: UI may request frames and render returned images, but may not import `engine/internal`, construct the production Pixi scene, dispatch commands, or manually advance project state.

**Exit criteria:** the ownership path is documented in code; the contract can render at least two labelled timestamps from a cloned project in a focused renderer test; after capture and disposal the live project's serialized fingerprint exactly matches its pre-render fingerprint.

### Phase 1 — Build the isolated frame-render seam

1. Add an engine/renderer-owned helper that creates an isolated engine from a `LessonJSON` clone and applies the requested proposal state only to that instance. Reuse the existing `createIsolatedPreviewEngine` / `createAnimationScriptPreview` foundations where possible rather than creating a second clone mechanism.
2. Add an isolated renderer factory or renderer mode that accepts the cloned engine and explicit dimensions. It must own its canvas/Pixi application, stage, ticker or manual render loop, asset subscriptions, and cleanup. It must not register itself with the live editor, attach live persistence listeners, or share mutable scene/display objects with the live renderer.
3. Add a deterministic “render at time” operation: set timeline time on the clone using the same evaluation path used in normal playback, flush scene/display-object updates, render once, then capture the canvas. Avoid wall-clock playback and polling where an explicit update/render step can be used.
4. Render sample requests in caller-provided order and preserve labels and requested timestamps in results. Ensure each sample is independent of prior samples (seek/reset deterministically) so frame output does not depend on request order or animation ticker drift.
5. Cover resource readiness: await fonts/images/textures required by the cloned scene, impose a bounded failure/timeout policy, and expose missing-resource diagnostics. Dispose all temporary resources even on cancellation, render error, and partial asset-load failure.
6. Preserve output bounds and pixel ratio deliberately. Choose a fixed preview viewport or explicit request dimensions; never use the live editor canvas size or alter live camera framing to fit content.

**Tests:** capture two or more distinct known timestamps; validate frame labels/order/dimensions; ensure the render happens from the isolated engine; compare live `toJSON()`/fingerprint before and after success, error, cancellation, and disposal; assert all renderer resources are released.

### Phase 2 — Replace silhouette-only proposal previews with captured scene frames

1. Refactor `AiAnimationAssetPreview.tsx` to request frame capture through the new seam and render returned images with accessible labels and timestamps. Keep current inline placement, proposal action controls, delete-impact explanation, per-part previews, and five-step Collection affordances.
2. For Clip proposals, preserve the temporary one-binding Collection strategy where needed to evaluate a Clip on its target node. Derive the preview target and sample times from the Clip duration and known keyframe/event boundaries, with a small capped set of useful representative samples. Label frames clearly and retain a fallback explanation when a target lacks a matching semantic binding.
3. For Clip Collection proposals, render the full isolated Collection and preserve the existing five-step affordance. Use requested sample times across its meaningful duration, avoiding duplicate or out-of-range timestamps; keep frame count bounded to prevent large cards and excessive Pixi work.
4. Replace the current SVG-only Shape draft comparison with the same object/render context: create a source-state clone/frame and a proposal-state clone/frame using the same camera and requested time, display them side-by-side or as an explicit before/after pair. Keep vertex/topology diagnostics and make clear that the proposed geometry is not yet applied to the live project.
5. Ensure updates to proposal content, project fingerprint, sample configuration, or target cause a fresh preview. Cancel obsolete work and avoid stale frames flashing after a proposal changes.
6. Keep visible failure states local to the preview card. A renderer/resource failure must not block dry-run, approval review, rejection feedback, or ordinary chat use.

**Tests:** a single proposal card can display captured frames with labels; Clip and Collection sample labels/times are correct and bounded; Shape source and candidate use matching render context; stale/cancelled results are discarded; proposal cards remain inline and existing affordances remain available.

### Phase 3 — Animation Script preview range and full-scene coverage

1. In the script preview builder, compile/run the proposal against an isolated engine with the existing `AiRunAnimationScriptCommand` semantics. Obtain the script's compiled footprint from the compiler/run result or retained script metadata; do not guess the preview time window from source text or the whole slide duration.
2. Define the sample range from the footprint start/end, including endpoints and a small set of deterministic intermediate samples. Handle zero-duration/instantaneous footprints, negative or invalid ranges, and empty scripts explicitly. Clamp only where the domain contract requires it and surface validation errors instead of silently changing the requested range.
3. Render the final resulting scene at each sample, including camera framing and travel as applied by the script and all supported renderables (mesh, textured/image objects, text, charts, and other Pixi scene elements). Ensure isolated camera state is evaluated per sample.
4. Preserve the current script preview card's source/diagnostics and inline location; add frame labels/time readouts and a clear no-preview/error state. Deletion proposals should continue to explain footprint cleanup and should not falsely show a proposed run.
5. Add an integration fixture with a mesh, textured/image object, and text in one scene and assert each appears in captured proposal frames. Include a script with a known compiled footprint and assert the sample range is sourced from that footprint, not the overall slide or source declaration alone.

**Tests:** script compiler/runner errors are contained in preview state; `AiRunAnimationScript` preview applies on clone only; sample times derive from its compiled footprint; camera motion and scene travel produce expected distinct frames; mesh, image/texture, and text are visible; live fingerprint stays unchanged.

### Phase 4 — On-demand geometry detail for one Shape

1. Define a read-only request keyed by the active project/conversation and a single `{ nodeId, shapeId }` (or equivalent stable target reference). Prefer an explicit detail request path over raising `shapeGeometryVertices` or sending all geometry in chat context.
2. Resolve only the requested node and Shape from the current engine, verify the target still exists, and return its full ordered vertex list plus identity/name and any minimal topology metadata required for comparison. Do not mutate engine state, selection, or project revision.
3. Keep the ordinary `buildContextSnapshot` bounded at the existing global vertex cap and selected-node prioritization. Extend only the Shape detail view / detail request result, not normal snapshots, assistant history, or unrelated node context. Avoid logging/persisting large vertex arrays unless existing privacy/data-retention policy explicitly requires it.
4. Add UI/assistant context flow so an omitted selected Shape is recognizable from `shapeDetails` / `shapeGeometryTruncated`, then request details only when needed for an actual Shape operation. Cache only for the current project revision and invalidate on geometry changes, node removal, project switch, or conversation change.
5. Bound request frequency and validate the returned vertex count/finite coordinates on receipt. If the target is stale, report that a fresh selection/context is needed; never substitute geometry from a similarly named Shape.

**Tests:** selected high-vertex-count Shape request returns the full ordered vertex list while a normal snapshot remains under the 800-vertex cap; request is read-only with unchanged project fingerprint; only the requested Shape is returned; stale/missing IDs and malformed geometry fail clearly; cache invalidates after project revision changes.

### Phase 5 — End-to-end hardening and acceptance

1. Run focused frontend tests for preview engine, Renderer/Pixi capture, asset preview, script preview, and AI animation context; run backend proposal tests only if request/schema changes touch the backend. Follow the repository guidance to avoid relying on the known-OOM full frontend suite.
2. Review renderer cleanup on every exit path, ensure no hidden canvas/ticker remains after closing or revising the proposal, and verify render failures do not leak errors into live editor state.
3. Manually exercise one Shape create/update, one Clip, one Collection, and one Animation Script proposal in the editor. Confirm actual scene objects, camera framing, image assets, and text are visible, all frames are labelled, cards remain inline, and approve/deny behavior is unchanged.
4. Verify no preview operation creates history entries, changes the project fingerprint, marks the project dirty, emits persistence writes, or alters the live renderer's camera/selection/time.
5. Keep any remaining renderer limitations explicit in the UI; remove the mesh-silhouette-only label only after the full-scene capture path is verified for the supported renderable types.

### Suggested dependency order

`Phase 0 → Phase 1 → Phase 2 → Phase 3`, with `Phase 4` independent of Pixi rendering and implementable in parallel after the bounded snapshot contract is understood. `Phase 5` gates completion. The highest-risk early decision is how to drive a production Pixi scene deterministically without attaching it to editor-owned state; resolve that with the Phase 0 renderer trace and a minimal Phase 1 spike before replacing existing previews.
