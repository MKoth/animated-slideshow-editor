# ADR 0014 — Reusable Object Public API & .lesson Serialization for Controls

Date: 2026-09-12
Status: Accepted (grill #335, wayfinder map #328)
Deciders: MKoth + Muse Spark (wayfinder grill)

## Context

Map #328's destination requires Controls to become the public API of an exported rig — "complex combination of shapes/animations represented as one object with few parameters" — with `ReusableObject` / `.lesson` export that hides internals. ADR 0010 locked the definition model (`SceneNode.controlSet` embedded, `Control {id,key,label,min=0,max=1,default,exposed,bindings: Record<semanticName, clipId>}` ordered, `duration=1` reuse, `bindings` mirrors `ClipCollection`), ADR 0011 locked evaluation (`base → ClipInstances → Controls` last-wins, ControlSet order = Priority, `u=clamp(value,0,1)` always-active, ancestor-wins nesting, whitelist excludes `visible`/`zIndex`), ADR 0012 locked persistence (`NodeAnimation.controlTracks: Map<controlKey, Keyframe[]>` seconds-based `hold|linear|bezier` + `disabled`, `NodeAnimationJSON.controlTracks?: {key, keyframes}[]` tolerant array, `KeyframeTarget {kind:'control'}`), and ADR 0013 locked timeline filtering (per-rig Normal vs Authoring mode, muted placeholder, `authoringModeByHost`). Ticket #335 must lock how Controls become the exposed public API on export, how definitions vs per-slide instance tracks serialize across `.lesson_object` and `.lesson`, how Normal Mode hides internals after import, versioning/validation, and ClipCollection coexistence.

Code anchors: `frontend/src/engine/reusableObject.ts` (`REUSABLE_OBJECT_VERSION`, `validateReusableObject`, `ReusableObjectJSON`), `frontend/src/engine/json.ts` (`NodeJSON`, `NodeAnimationJSON`, `LessonLibraryJSON`, `ClipJSON`), `frontend/src/engine/nodeAnimation.ts:40`, `frontend/src/engine/slideAnimation.ts:75,107,237,283`, `frontend/src/engine/clipCollection.ts`, `frontend/src/engine/clipExtraction.ts`, `frontend/src/engine/sceneNode.ts`, `frontend/src/engine/animationManager.ts`, `frontend/src/stores/sceneTreeViewStore.ts`, `frontend/src/stores/timelineViewStore.ts`, `docs/adr/0006`, `0008`.

## Decision

### 1. Exposed Controls contract — `Control.exposed: boolean` default false

- `Control` gains `exposed: boolean` (default `false`). `SceneNode.controlSet.controls[]` order is retained as Priority; exposed is a per-Control flag.
- Exporting a `ReusableObject` via `engine.exportReusableObject(parentNodeId)` captures the parent's `controlSet` definitions **inside `nodes[]`** as `NodeJSON.controlSet` (embedded snapshot, like `shadowEffect`), including each `Control`'s `key/label/min/max/default/exposed/bindings` and the referenced per-`semanticName` normalized `ClipDefinition`s (`duration=1`, `time ∈ [0,1]`, any interpolatable channel except `visible`/`zIndex`) in `library.clips` plus any `MeshComponent.shapes` embedded per `NodeJSON.components.mesh.shapes` (ADR 0007/0008).
- On import (`ImportReusableObjectCommand`) all descendant nodes are created with new node ids and `semanticName` preserved, `Control.id` / `ControlSet.id` remapped fresh, and `Shape.id` remapped via `shapeIdMap`; `Control.key` is preserved as the stable public name (like `Semantic Name` reuse for clips) and `bindings[oldSemantic] → newClipId` is remapped via the existing clip-id map already used for `ClipCollection` portability. `exposed` travels with the definition.
- Normal Mode enumerates `controlSet.controls.filter(c => c.exposed)` as the rig's public API (main Timeline lanes + Objects library filter). `exposed === false` controls remain definition-visible only in Authoring Mode.
- Rejected: export-time whitelist set stored outside the node (`ReusableObjectJSON.exposedControlKeys`) — duplicates state and separates definition from owner; "all controls exposed" — defeats "few parameters" promise.

### 2. Instance vs definition split — embedded definitions, per-slide instance tracks

- **Definition data** (what the rig *is*): `NodeJSON.controlSet` embedded in `SceneJSON.nodes[]` + `library.clips` snapshots of `bindings` clipIds + embedded `shapes`. `LessonJSON.library` does **not** carry a separate `controls` array; `ReusableObjectJSON.library.controls` sidecar is not added. No top-level `LessonJSON.controlSets` or `Project.library.controls`.
- **Instance data** (what is animated): `NodeAnimation.controlTracks` on the host node (`Map<controlKey, Keyframe[]>` keyed by `Control.key`, ADR 0012) serialized per slide as `SlideAnimationJSON.nodes[].controlTracks?: {key, keyframes}[]` tolerant array (alongside `materialTracks`/`shadowTracks`/`circleTracks`). Each `controlTrack` is seconds-based, `requireKeyframeTime(time, slide.duration)` in `[0, duration]`, finite value in `[min,max]` (v1 `0…1`), `hold|linear|bezier` + tangents + `disabled`, clamped via `SlideAnimation.clampKeyframesTo` with discriminator `{controlKey}`.
- On import with no prior library entry, definitions are self-contained via the embedded node snapshot (like cross-blend shape portability, ADR 0008); per-slide `controlTracks` are **not** part of the reusable library — imported rig has empty tracks → evaluator falls back to `Control.default` (ADR 0012 §3). `captureAudioSnapshot` pattern not needed.
- `.lesson` self-containment rides existing snapshot paths; old files without `controlSet`/`controlTracks` load unchanged (tolerant).
- Rejected: `Project.library.controls` top-level array, `ReusableObjectJSON.controlSets` sidecar, or hybrid mirror — extra indirection, separates definition from its scene-graph owner (reason rejected in ADR 0010 §1).

### 3. Normal Mode after import — reuse collapsed + filter, no new persisted flag

- After import the rig's parent appears as **one logical object** in Normal Mode. The main Timeline shows only exposed Control lanes on the host (`controlTracks` where `Control.exposed` true); internal descendant nodes are hidden unless Authoring Mode is entered.
- Implementation: reuse existing `isGroupNode` / `Scale Group` collapsed state plus a Timeline filtering rule driven by `authoringModeByHost: Record<hostNodeId, boolean>` in `timelineViewStore` (ADR 0013). When `authoringModeByHost[hostId] !== true` and the host has `controlSet.controls.some(c => c.exposed)`, descendants are filtered from `Animated Child` enumeration and raw property lanes driven by Controls are rendered as muted placeholders (`Controlled via Mouth.Openness`) with tooltip; badge shows `N hidden`. Entering Authoring Mode (`Animation Manager → Controls tab → Edit` or main Timeline / Scene Tree right-click host → `Rig / Authoring Mode`) expands all and reveals raw lanes.
- No new persisted `isControlInternal` or `isRigInternal` flag on `SceneNode`; collapsed/filter state is transient UI (`zustand/persist` `partialize`, like `expandedNodeIds`). No new dedicated layer or flattened rig node type.
- Rejected: new `isControlInternal` boolean per node (persists derived view state), separate rig layer.

### 4. Versioning & validation — no bump, optional fields, soft-warn skip

- **No version bump** in v1: `REUSABLE_OBJECT_VERSION` stays `1` and `LessonJSON.version` stays `1|2`; both gain tolerant optional-field handling (like morph `ClipJSON.morphAnimation` optional without bump, ADR 0008). A future breaking change can bump then; v1 is purely additive.
- `validateReusableObject` extends to allow `NodeJSON.controlSet?: ControlSetJSON` and validates `bindings: Record<string,string>` values are non-empty `clipId` strings present in `library.clips` (if present); missing `clipId` → soft-warn-and-skip that binding, not file-fatal. `NodeAnimationJSON.controlTracks` validates `{key, keyframes}[]` tolerant: missing array → empty, bad `key` (no matching `Control` in `node.controlSet`) → warn-skip entry, bad keyframe → warn-skip keyframe (mirrors `restoreShadowTracks:143` tolerant path).
- **Missing `semanticName` on target** during `Control` broadcast → soft-warn and skip that descendant's contribution (same as clip `morphCoefficient` fallback `clipDefinition.ts:568` and `Missing Assets Report` philosophy — not file-fatal).
- `SlideAnimation.fromJSON(duration, nodeOf, parameterKindOf)` and `NodeAnimation.fromJSON` tolerate absent `controlSet`/`controlTracks`.

### 5. ClipCollection interaction — disjoint but composable

- `ClipCollection` (time-based `ClipInstance {clipId, startTime, speed}` evaluated via `isClipInstanceActive` + `u = ((time-startTime)*speed)/duration`) and `ControlSet` (value-based `value → u=clamp(value,0,1) → effectiveUForClip → #evaluateClipChannel` always-active) are **disjoint types but composable on the same rig**. Both may be attached; evaluation order remains `base NodeAnimation → ClipInstances (including Collection placements) → Controls` per ADR 0011 §1, so Controls win unconditionally. No `ControlsCollection` grouping type in v1; Controls keep last-wins within `ControlSet` order (ADR 0011 §3). Additive blending / per-binding weight remains deferred to the fog patch `Weight painting & per-target curves`.
- No new `REUSABLE_OBJECT_VERSION` field for collection type; `ReusableObjectJSON.library.clipCollections` and `controlSet` coexist in `nodes[]`.

### 6. Naming & enumeration

- `Control.key` unique per `ControlSet` (`^[A-Za-z][A-Za-z0-9_.]*$` like `Unique Name` uniqueness scope, block-on-duplicate), `label` display, `min/max/default` v1 fixed `0/1/0` (arbitrary ranges deferred, normalize is identity `u = clamp(value,0,1)`). `Semantic Name` repeatable per descendant, `Unique Name` per-scene unique display name — three orthogonal namespaces, no cross-validation.
- Key is the stable public name across copy/import; `id` is ephemeral. Exposed listing is `controlSet.controls.filter(c => c.exposed)` for Normal Mode and for Objects library panel grouping.

## Consequences

- One optional embedding `NodeJSON.controlSet` plus per-slide `controlTracks` sidecar; zero new top-level library arrays; existing `copyNodeDeep` / `sceneManager` id-remap + `cloneMeshData` shape-id remap + clip-id map cover all Control copy/import paths.
- Imported rig self-contained via embedded node snapshot; `.lesson` old files readable; `Missing Assets Report` / morph soft-warn pattern reused.
- Normal Mode satisfies "few parameters" without new persisted flags; Authoring Mode reuses ADR 0013 drill-in normalized timeline (`Editing Control: Mouth.Openness (0…1)` `t∈[0,1]` `duration=1` guardrails).
- Test seams: (1) export rig with 2 exposed + 1 internal Control, re-import, assert only 2 lanes in Normal and `key` preserved with new `id`; (2) import old `.lesson_object` without `controlSet` → loads and `controlTracks` empty → `Control.default` applies; (3) target missing `semanticName` → warn-skipped, other descendants still driven; (4) host with both a `ClipCollection` walk and `Mouth.Openness` at same property → Controls win; (5) `clampKeyframesTo` shortens a `controlTrack` keyframe after duration shrink.

## Links

- Map: #328
- This grill: #335 (blocked by #329, #332)
- Data model: ADR 0010, #329
- Evaluation: ADR 0011, #331
- Persistence: ADR 0012, #332
- Timeline filtering: ADR 0013, #334
- Prototype: #333 (`prototype/controls-authoring` Variant A)
- Follow-up: #336 (direct-mapping sugar, independent)
- Glossary: CONTEXT.md § Controls, Reusable Object, Project, Clip Collection
- Code anchors: `frontend/src/engine/reusableObject.ts:3,20`, `frontend/src/engine/json.ts:133,216,371`, `frontend/src/engine/nodeAnimation.ts:40`, `frontend/src/engine/slideAnimation.ts:75,107,237,283`, `frontend/src/engine/clipCollection.ts`, `frontend/src/engine/clipDefinition.ts:164,568,799`, `frontend/src/engine/animationEvaluator.ts:50,67,1083,1252`

