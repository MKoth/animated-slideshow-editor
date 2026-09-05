# ADR 0008 — Shapes & morphs in Clips, Clip Collections, and Reusable Objects

Date: 2026-09-04
Status: Accepted (grill #276)
Deciders: MKoth + Muse Spark (wayfinder grill)
Context: Map #268 — Brush-based Shape Morph for Mesh, ticket #276. Composes on ADR 0007 (Shape storage) and #273 (Morph operation: one `morphCoefficient` track + static `MorphBinding {fromShapeId,toShapeId}` sidecar, visible-pattern, morph-then-bones).

## Context

Prototype must prove that Shapes & morphs survive the three library/export paths without forking the portability model: Clips (normalized channels), Clip Collections (semanticName → clipId hierarchical binding), and Reusable Objects (`.lesson_object` subtree snapshot), plus deterministic Video Export. Shape ids are per-node random (`newId('shape')`), so cross-node identity and stale-lookup handling are central.

## Decision

### 1. Clips — bespoke `morphAnimation` lane (like `visible`), not `ClipChannelDef`

*Location*: `frontend/src/engine/clipDefinition.ts:202-205` alongside `#visibleAnimation`/`#circleAnimations`.

- Add private `#morphAnimation = new ClipChannelAnimation()` to `ClipDefinition`. Accessors: `morphAnimation(): ClipChannelAnimation`, `hasMorphTrack(): boolean`, `getMorphKeyframes(): readonly Keyframe[]`, `addMorphKeyframe(kf:Keyframe)`, `removeMorphKeyframe(id:string)`. Existence = `hasMorphTrack()` (`#morphAnimation.length > 0`), same rule as Clip Channel (“exists while it has ≥1 keyframe”).
- Value validator: finite number in [0,1] (store 0..1, preview allows 1.5 clamped at eval), `interpolation` ∈ `hold|linear|bezier` (+ parametric family via interpolation picker, same whitelist as `lessonValidation.ts:106` for morph track), tangents in time/value units, time normalized to [0,1]. Mirror `ClipChannelAnimation.fromJSON` validator: dedicated `fromJSONWithMorphKind`.
- Persistence: `ClipJSON.morphAnimation?: ClipChannelJSON` in `frontend/src/engine/json.ts:343`. `ClipDefinition.toJSON()` writes `morphAnimation` only if non-empty; `fromJSON()` reads it if present. `librarySection.ts` `validateLibraryClips` tolerates missing `morphAnimation` → no clip. No `LessonSerializer` version bump (optional field, like `visibleAnimation`). `copy()` clones morph animation.
- Rejected: `ClipChannelDef {property:'morphCoefficient'}` entry in `CLIP_CHANNELS`/`ANIMATABLE_PROPERTIES` (pollutes uniform-six, forces N²-style plumbing and `channelAnimations['morphCoefficient']` indirection inconsistent with bespoke-tracks elsewhere); per-shape param `morph_<shapeId>` N-channel model (N² blowup, duplicates interpolation/persistence).

### 2. Clip extraction — `NodeAnimation.morphCoefficient → ClipDefinition.morphAnimation`

- New target: `NodeMorphTarget {kind:'morph', nodeId:string}` in `frontend/src/engine/keyframeTarget.ts:62`, alongside `NodeVisibleTarget`. Extend `KeyframeTarget` union, `isMorphTarget`, `requireKeyframeTarget`/`resolveKeyframeTrack`/`requireTrackKeyframeValue` arms to route `morphCoefficient` through the same track resolution as visible (finite 0..1 validator, hold/linear/bezier). `requireMorphCoefficientValue` validates stored value 0..1.
- `frontend/src/engine/clipExtraction.ts`:
  - `NormalizedChannelKey` adds `{kind:'morph'}` (single key per extraction, since one coefficient lane per node).
  - `channelKeyOf(target)` returns `"morph"` for morph targets (like `"visible"`).
  - `normalizeExtractable` validates morph value 0..1 and maps time via `(t - selStart)/selDuration` → [0,1] and `tangentIn/Out.time / selDuration` (same as other channels, `value` copied verbatim, already in [0,1]).
  - `validateNoDuplicateTimes` reused for morph channel.
  - Extraction entry: `createNormalizedClipKeyframes()` groups morph keyframes under `morph`; `toClipKeyframes()` then `clip.morphAnimation().add(kf)` for each normalized morph kf (new `newKeyframeId()`). Appending to existing clip merges times (`existingTimesByKey` check); dup time → error (same as other channels).
- Non-destructive copy: source `NodeAnimation` keeps its morph keyframes; extraction only appends to `ClipDefinition`.

### 3. Clip instance layering — coefficient overrides, binding stays node-local

- `frontend/src/engine/animationEvaluator.ts:156` `evaluateMorph(nodeId,time): {coefficient, fromId, toId}` (beside `evaluateVisible`) composes:
  1. Base: `NodeAnimation` morph keyframes evaluated at `clampedTime` via `evaluateSegment` (hold/linear/bezier, last-value hold beyond range) with base fallback `0`.
  2. Clips: iterate `node.clipInstances` in order (array order = layer order); for each enabled instance with `clip.duration>0` and `time >= startTime`, compute `u = clamp((time - startTime)*speed / clip.duration, 0, 1)`, evaluate `clip.morphAnimation` at `u` via `#evaluateClipChannel`, and override `coefficient` with that value (last instance wins, same as ` #applyClipInstances` for transform channels).
  3. Evaluate `lerp(from.vertices[i], to.vertices[i], coefficient)` only if `MorphBinding {fromId,toId}` is set and both shape ids resolve in the node's `MeshComponent.shapes` (lookup by id). If binding null/incomplete, or either id missing → soft `console.warn("Missing shape id ...")` + fallback to base `mesh.vertices` (no lerp).
- Binding is **not** stored in the clip. A morph clip animates only the scalar coefficient; the pair selection (`From → To` dropdowns) remains the discrete `MorphBinding` on `NodeAnimation` (Q2=A of #273, `SetMorphBindingCommand`), not keyframed. This keeps shape ids node-local (random per-node) and avoids cross-node id translation. Clips remain applicable to any mesh that has shapes with compatible topology; shape-id mismatch is detected at evaluation, not at clip-apply time.
- No param-linking for morph in v1 (no `paramKey`/`linkMode` on morph channel); `ClipParam` gain/offset model applies only to uniform-six/material channels. Morph clips are absolute coefficient curves.

### 4. Clip Collections — same `semanticName → clipId` map, no morph-specific convention

- `frontend/src/engine/clipCollection.ts:9` and `frontend/src/engine/clipCollectionManager.ts`: no schema change.
- Hierarchical **export** (`ExportClipCollectionCommand {parentNodeId, name}`): walks parent subtree via `walkPreOrder`, collecting for each node with `semanticName` that has either (a) `NodeAnimation.hasMorphTrack()` (morph keyframes) or (b) `clipInstances` whose clips have `hasMorphTrack()`. Currently the engine's export collects `clipInstances` (not raw keyframes); for morph we keep that — morph tracks become clips via the extraction step above, then collections group those clips by semantic name. If future export wants to auto-extract raw morph keyframes into morph clips during collection export, it can reuse the same `clipExtraction` path before binding; but v1 keeps collections as clip-instance grouping only (consistent with ADR 0006).
- Hierarchical **apply** (`ApplyClipCollectionCommand {collectionId, targetNodeId}`): walks target subtree, broadcasting each `clipId` in the collection to every descendant node whose `semanticName` matches the binding key, as `AddClipInstanceCommand` (identical to existing transform/visible/circle broadcasting). Morph clips broadcast the same way; target node's `MorphBinding` supplies the pair, coefficient comes from the clip's `morphAnimation`. Missing shapes on a target node → warn+fallback per §3, no collection-level failure.
- Naming: no morph-specific `semanticName` convention needed; `left_hand`, `face_smile`, etc. carry whatever channels the clip contains (transform + morph + visible can co-exist in one clip). Reuses `CONTEXT.md` `Semantic Name` tag.

### 5. Reusable Objects — node-owned Shapes + animation sidecar + library snapshot

- `ReusableObjectJSON` (`frontend/src/engine/reusableObject.ts:5`, `frontend/src/engine/json.ts:109`, `librarySection.ts`):
  - `nodes: NodeJSON[]` already carries `components.mesh` — with ADR 0007 extension, `components.mesh.shapes?: ShapeJSON[]` (`{id,name,vertices:{x,y}[]}`) is inside each Mesh node. Reused for free; no `embeddedAssets` indirection.
  - `animation?: SlideAnimationJSON` — carries per-node `morphBinding?: {fromId:string|null,toId:string|null}` and `morphTrack?: {keyframes:KeyframeJSON[]}` inside each `NodeAnimationJSON.nodes[]` entry (Q5 A of #273). Filtered to `nodeIds` in `internal.ts:2639` (`filtered = fullAnim.nodes.filter(entry => nodeIds.has(entry.nodeId))`).
  - `library?: LessonLibraryJSON` — carries referenced `clips: ClipJSON[]` and `clipCollections: ClipCollectionJSON[]` that include `morphAnimation` where present (`internal.ts:2678-2712` already snapshots `library.clips`/`library.clipCollections` from referenced `clipId`s; no change except clips may now have `morphAnimation`).
- Copy semantics: `copyComponents` (`frontend/src/engine/components.ts:112`) + `cloneMeshData` (`mesh.ts:236`) behaviour extends via ADR 0007: `copyComponents` clones `shapes` with fresh `newId('shape')` and a per-mesh `shapeIdMap: oldId→newId`; `sceneManager.ts:90` `copyNodeDeep` regenerates ids and names. For `ReusableObject` export, shapes are snapshotted with their current ids; on **import** (`internal.ts:2850` `importReusableObject`), generate fresh shape ids per imported Mesh node (`newId('shape')` for each `shape.id`), build a `shapeIdMap`, and remap each imported `NodeAnimation.morphBinding`'s `fromId/toId` through that map so referential integrity holds inside the imported subtree. Vertices need no bone remap.
- Validation: `validateReusableObject` (`reusableObject.ts:20`) stays structural (nodes array, clip library arrays), but `lessonSerializer`/`internal.ts` validation soft-warns on stale morph binding: if `morphBinding.fromId/toId` references a shape id absent from the node's `shapes`, the file still loads (`lessonValidation` does not throw; evaluation falls back). Mirrors `Missing Assets Report` philosophy — not file-fatal. Import-time shape-id remapping prevents self-stale; cross-import stale (e.g., hand-edited JSON) remains soft-warned.

### 6. `.lesson` portability & Video Export determinism

- `.lesson` self-containment: `LessonJSON.library.assets` pattern is embedded snapshot; Shapes follow the same but simpler — they are **embedded** in `slides[].scene.nodes[].components.mesh.shapes`, not in `library` nor `Project.embeddedAssets`. `LessonSerializer` tolerates missing `shapes`/`morphTrack`/`morphBinding` → `[]`/`undefined` (old files readable, no version bump). `SlideAnimation.fromJSON` validates `morphTrack` keyframes against duration and discards invalid shape-id bindings with a warn rather than failing.
- Video Export (`frontend/src/engine/export.ts:41` `EXPORT_VERSION = 1`): remains deterministic per-timestamp `t = i/fps` (`getExportFrameTimestamps`). Both preview (`sceneRenderer.ts:281` `applyMeshVertices`, `meshOverlay.ts:52` ephemeral preview) and export evaluate the same composition: `resolveMorphedVertices(mesh, {from,to,coeff}) = lerp(from.vertices[i], to.vertices[i], clamp(coeff,0,1.5))` on rest vertices → `evaluateMeshDeformation(morphedMesh, bones, meshWorld)` → `localToWorld`. `coeff` comes from `evaluateMorph(nodeId, t)` which already includes clip layering (§3), so exported frames equal editor preview per timestamp on the same machine. No FFmpeg-side morph baking; no `EXPORT_VERSION` bump in prototype (determinism payload includes morph coefficient implicitly via `AnimationEvaluator` path).

## Alternatives Considered

- **Per-pair N² clip channels** (`morph_base_smile`, `morph_smile_base`, …) — rejected: 90 channels for N=10, duplicates interpolation/storage/UI; ADR 0007 + #273 already chose one-track+binding.
- **Clip stores `MorphBinding` per clip** (`ClipMorphBinding {fromId,toId}`) — rejected: shape ids are per-node random, so a binding baked into a clip cannot resolve on a different target node without semantic shape-name mapping (names are per-mesh unique but not cross-mesh stable); coefficient-only clips compose with node-local binding and need no cross-node id translation.
- **Morph param linking (`paramKey` gain/offset)** — rejected: adds indirection without use-case; morph coefficient is absolute 0..1, not gain/offset on a base value.
- **Separate `library.shapes` / `embeddedAssets` for Shapes** — rejected per ADR 0007: splits persistence, duplicates snapshot paths; Shapes ride in `NodeJSON`.

## Consequences

- One optional `morphAnimation` field on `ClipDefinition`/`ClipJSON`; extract/apply flows extend without breaking existing clips.
- Collections and Reusable Objects carry morph with no schema break (reuses `semanticName` broadcast and `library` snapshot).
- Old `.lesson`/`.lesson_object` files remain readable; new files port via normal `NodeJSON` + `ReusableObject` + `LibrarySection` paths.
- Topology freeze (ADR 0007) still gates `delete`/`extrude`/`subdivide`/`mirror` when `shapes.length>0`; morph does not lift it.
- Prototype `#275` can now build the throwaway `research/morph-brush` branch using §1-6 without re-deciding storage/binding.

## Links

- Map: #268
- Prior grills: #271 (Shape storage), #273 (Morph operation), #274 (UI placement), researches #269/#270
- This grill: #276
- Glossary: `CONTEXT.md` § Rig & Skeleton (Shape, Morph), § Object Library (Reusable Object), § Animation (Clip Collection)
- Follow-up: #275 prototype (now unblocked)
