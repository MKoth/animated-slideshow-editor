# ADR 0010 — Control & ControlSet Data Model for Parametric Rigs

Date: 2026-09-12
Status: Accepted (grill #329, wayfinder map #328)
Deciders: MKoth + Muse Spark (wayfinder grill)

## Context
Map #328 needs a generic parametric Controls subsystem where one Control (e.g. Mouth.Openness 0…1) drives N per-descendant normalized-clip fragments, reusing ClipDefinition with time in [0,1] and `controlValue → t` evaluation, parent-owned, Controls win over time clips, values are keyframeable, authoring via Animation Manager → Controls tab + drill-in timeline. Ticket #329 locks the data model.

## Decision

### 1. Ownership: embedded on the parent Scene Node (like Shadow Effect)
- `SceneNode.controlSet?: ControlSet` — optional, on any node but semantically on group/locator nodes (Rig Handle / Scale Group / isGroupNode). Analogous to `NodeJSON.shadowEffect`.
- Persisted as `NodeJSON.controlSet?: ControlSetJSON` (embedded snapshot). No new top-level `LessonJSON.controlSets` array.
- Why: survives per-node copy/duplicate via `copyNodeDeep` / `copyComponents` without extra remap plumbing; ReusableObject export captures it automatically inside `nodes[]`; per-rig definition is cross-slide (shared via the node itself, present on every slide where the subtree exists) — a SlideAnimation sidecar would duplicate definitions per slide, and a Project map would separate definition from its scene-graph owner.
- Considered: `Project.controlSets Map<hostNodeId, ControlSet>` (top-level like clips) — rejected as extra indirection; `SlideAnimation.nodes[].controlSet` — rejected as per-slide duplication.

### 2. One Control → N clips: Map<semanticName, clipId> per Control
- `Control { id, key, label, min, max, default, exposed, bindings: Record<semanticName, clipId> }`
- `ControlSet { id, hostNodeId, controls: Control[] }` — ordered list, order = evaluation last-wins within the set.
- `ControlBinding` is not a separate entity; `bindings` map mirrors `ClipCollection.bindings` (semanticName → clipId) so the evaluator's broadcast by semantic name is identical. Each referenced ClipDefinition may carry multiple channels (transform uniform-six, circle angles, morphCoefficient, shadow, table, materialParameter) — a single clip per descendant is sufficient; splitting per-property would duplicate the channel mechanism.
- `MorphBinding` stays node-local (`NodeAnimation.morphBinding` + per-keyframe `MorphKeyframeValue {fromShapeId,toShapeId,coefficient}`); clips store morph via name-based `MorphClipKeyframeValue {fromShapeName,toShapeName,coefficient}` at `clipDefinition.ts:799` and resolve at eval like existing morph clip path — broadcast by semanticName still works.
- Rejected: `ControlBinding[] {semanticName, clipId, property}` per-property array; `driver: {type:"normalized-clip", clipId}` single-clip multi-node shape (loses name-routed reuse and forces a new multi-node clip type).

### 3. Control identity — key/label/min/max/default
- Per-ControlSet uniqueness for `key` (validated `^[A-Za-z][A-Za-z0-9_.]*$` with block-on-duplicate like Unique Name), `label` is display string.
- v1 fixes `min=0, max=1, default=0` (or default within [0,1]). Arbitrary ranges (e.g. Head.Orientation -1…+1) are intentionally deferred; `normalize(value,0,1) = clamp(value,0,1) = u` is identity, so no new math is introduced. Extending later to arbitrary `min/max` is non-breaking (adds optional fields, evaluator becomes `u = clamp((value - min)/(max - min),0,1)`).
- Rejected now: arbitrary `inMin/inMax` per control (ticket #336 follow-up can re-grill if trivial Tail.Curl 0→60° sugar proves necessary).

### 4. Driver shape & ClipDefinition reuse — normalized-clip-collection, duration=1, no flag
- Driver is fixed to `{ type:"normalized-clip-collection", bindings }` — no union needed in v1; direct linear mapping shortcut from map Notes is not a driver variant but sugar lowered to a 2-keyframe normalized clip at creation time (ticket #336 decides keep vs cut, but either way it does not add a second evaluator path).
- `ClipDefinition` is unchanged. Control clips are ordinary clips with `duration=1`; `ClipChannelAnimation.fromJSON` time validation `[0,1]` at `clipDefinition.ts:164` already fits, and `animationEvaluator.ts:1107` `u = ((time - startTime)*speed)/duration` handles `duration=1` with `u = controlValue` substituted (research #330 validated `effectiveUForClip`, `isClipInstanceActive`, `#applyClipInstances:1083`, `#evaluateClipChannel:1252`, morph paths `evaluateMorphVertices:598` all already via `u`).
- `ClipDefinition.isReversed` and parametric interpolation transfer verbatim via `effectiveUForClip`; `clipLookup` wiring in `clipManager.ts` / `clipLibraryStore.ts` unchanged; speed/Stretch is ignored for controls (value is not time), and `isControlClip` flag is not added.
- Rejected: `isControlClip` boolean, forked `ControlClipDefinition` type, or reusing `ClipParam` (Controls are not ClipParams).

### 5. JSON & validation sketch
- `ControlJSON { id, key, label, min:0, max:1, default, exposed:boolean, bindings: Record<string,string> }`
- `ControlSetJSON { id, hostNodeId, controls: ControlJSON[] }`
- Persisted inside `NodeJSON.controlSet` (see §1). `LessonJSON.library` does not carry a separate `controls` array; ReusableObject `library.clips` already snapshots referenced normalized clips (like any clip), and shapes are embedded in `MeshComponent.shapes` per ADR 0007 — `.lesson` self-containment rides the existing snapshot paths. Tolerance: old files without `controlSet` load unchanged; validator extends `validateReusableObject` to allow `controlSet` on nodes and validates `bindings` values are non-empty clipIds present in `library.clips` or embedded clips (soft-warn-and-skip missing semanticName descendant, like morph fallback `clipDefinition.ts:568`).
- `NodeAnimation` gains `controlTracks: Map<controlKey, Keyframe[]>` (ticket #332); that per-slide animated data lives in `SlideAnimationJSON.nodes[].controlTracks` (instance data), while `ControlSet` definition lives on the node (definition data) — the split mirrors Clips (library) vs ClipInstances (node) and Shapes (node-owned) vs morph tracks (slide sidecar).

### 6. Copy / ReusableObject portability
- Reuses `copyNodeDeep` / `sceneManager` id-remap + `cloneMeshData` shape-id remap: control bindings reference `clipId`s (project-global) not shape ids, so import remaps `Control.id`/`ControlSet.id` fresh, preserves `key` as stable public name, and remaps `bindings[oldSemantic] → newClipId` via the clip id map already used for `clipCollections` in `reusableObjectPortability` tests. Missing `semanticName` on target → soft-warn and skip that descendant's contribution (same as ClipCollection).

## Consequences
- One new optional embedding on Scene Node; one new `ControlSet`/`Control` domain model; zero change to ClipDefinition validation or evaluator time→u divisor path.
- Frontier unblocks tickets #331 (evaluation order), #332 (track persistence), #336 (direct-mapping sugar), and transitively #333 (prototype) and #335 (ReusableObject export).

## Links
- Map: #328
- This grill: #329
- Research: #330 (evaluator reuse validated)
- Follow-ups: #331, #332, #333, #334, #335, #336
- Glossary: CONTEXT.md § Controls
- Code anchors: `clipDefinition.ts:197`, `animationEvaluator.ts:1083/1107`, `nodeAnimation.ts`, `slideAnimation.ts:75`, `clipCollection.ts`, `reusableObject.ts`, `shape.ts`
