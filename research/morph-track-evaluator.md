# Research: Animation track & evaluator extension points for morph coefficient — Findings

Branch: `research/morph-track-evaluator` · Issue #270 · 2026-09-04 · base `origin/main` (`d596427`)

## TL;DR — cheapest insertion (prototype)

**One float track + node-level sidecar, as a bespoke lane (copy the `visible` pattern, not an `ANIMATABLE_PROPERTIES` entry) reusing the existing `Keyframe` machinery with `hold|linear|bezier`.** `N²` per-pair tracks are rejected for prototype — combinatorial, duplicates interpolation plumbing, and breaks any-to-any.

* **Coefficient** `0→1` — single `Keyframe[]` per `NodeAnimation` (`#morphCoefficient: Keyframe[]`), value `number` clamped `0..1`, interpolation already covered by `keyframe.ts:5` / `interpolators.ts:66-68` / `evaluateSegment:28`.
* **Pair** `{fromId,toId}` — static sidecar `MorphBinding { fromShapeId: string|null, toShapeId: string|null }` stored alongside the track on the `NodeAnimation` (and on `NodeComponentsJSON` or `SceneNode` extension for the base), **not keyframed** in v1. Changing the pair is a discrete command, not a track. Hold-interpolated string tracks are a v2 if scrubbing pair swaps becomes required.
* **Clip** — defer for prototype. Add later as one `clip morphCoefficient` channel (`clipDefinition.ts:195`) once node track ships; extraction maps `morphCoefficient` like `opacity`.

Why this wins: reuses every generic seam (add/move/delete/paste/duplicate, undo, persistence, evaluator, CurveEditor) with ~30 lines per layer, same as `visible` (`nodeAnimation.ts:95-123` / `animationEvaluator.ts:156-185` / `timelineTracks.ts:48` / `lessonSerializer.ts:740-765` did). No new interpolator, no schema fork.

---

## 1. How tracks are defined today

| File:line | Pattern to copy |
|---|---|
| `frontend/src/engine/animationProperties.ts:4-11,31-52` | `ANIMATABLE_PROPERTIES` + `requireAnimationProperty` / `requireKeyframeTime/Value`. Generic properties go through this gate; bespoke lanes (visible, circle, table) bypass it with their own `require*` — morph should follow the bespoke lane. |
| `frontend/src/engine/animationProperties.ts:22-27,64-73,112-121` | `CIRCLE_ANIMATABLE_PROPERTIES` / `requireAnimatableForCircle` — template for guard helpers if morph needs shape-existence checks. |
| `frontend/src/engine/nodeAnimation.ts:31-37` | Private map fields `#tracks`, `#materialTracks`, `#circleTracks`, `#tableTracks`, `#visible: Keyframe[]`. Morph adds one `#morphCoefficient: Keyframe[]` (single lane) — not a `Map`. |
| `frontend/src/engine/nodeAnimation.ts:95-123` | `visibleKeyframes/hasVisibleTrack/addVisible/removeVisible/getVisible` — the bespoke-lane shape to clone for `morphCoefficientKeyframes/hasMorphTrack/addMorph/removeMorph/getMorph`. |
| `frontend/src/engine/nodeAnimation.ts:125-143,189-225` | `add/addMaterial/addCircle…` + `copy()` loops. Insertion for morph: `insertSorted` helper `480-492` reuse, `copyKeyframe:514-523` reuse. |
| `frontend/src/engine/nodeAnimation.ts:227-273,282-350,456-478` | `toJSON/materialTracksJSON/circleTracksJSON/visibleTrackJSON` and `fromJSON` + `readVisibleTrack/readCircleTrack` helpers. Morph adds `morphTrackJSON()` + `readMorphTrack()` at the same call sites (`toJSON:165-193` in `slideAnimation.ts` fans out to these). |
| `frontend/src/engine/slideAnimation.ts:81-163,165-193` | `clampKeyframesTo` iterates `ANIMATABLE_PROPERTIES`, `CIRCLE…`, `visible` — morph adds one loop for `#morphCoefficient` at `138-160` block; `toJSON:165-193` adds `morphTrack` to the `nodes.push` guard. |
| `frontend/src/engine/keyframe.ts:5,26-38,50-84` | `InterpolationType='hold'\|'linear'\|'bezier'\|'bounce'\|'elastic'\|'spring'` + `requireKeyframeInterpolation` + `Keyframe {id,time,value,interpolation,tangentIn,tangentOut}`. Morph needs **no** new kind or tangent shape; existing `ZERO_TANGENT:14` and bezier control-point offsets in `(time,value)` at `interpolators.ts:47-63` map directly to coefficient easing. |
| `frontend/src/engine/interpolators.ts:8-31,28,66-68` | `SegmentInterpolator=(from,to,time)=>number` + `registry` + `evaluateSegment` dispatch on `from.interpolation`. Morph reuses `holdSegment:33, linearSegment:37, bezierSegment:47` verbatim — clamp output `0..1` at evaluator, not interpolator. Material's kind-gated `hold` vs linear (`materialTrackEvaluation.ts:54-82` `isContinuousMaterialKind`) is the analogy but **not** copied — morph coefficient is always continuous. |
| `frontend/src/engine/animationManager.ts:107-123,144-246,376-392,394-409` | Unified `#resolve → #keyframesOf → #addToTrack/#removeFromTrack` dispatch on `KeyframeTrackRef`. Adding `morph` means one new `resolveKeyframeTrack` arm (`keyframeTarget.ts:183-216`), one `#keyframesOf` branch, one `#addToTrack` branch, and one `#trackLabel` branch `510-528`. All move/scale/paste/duplicate/undo flows then inherit for free. |
| `frontend/src/engine/keyframeTarget.ts:29-86,80-114,133-276` | `KeyframeTarget` discriminated union (`node/parameter/dataLabel/circle/table/visible/clip`) + `is*` + `requireKeyframeTarget` + `resolveKeyframeTrack` + `requireTrackKeyframeValue`. Morph adds `NodeMorphTarget {kind:'morph', nodeId}` (≈ `NodeVisibleTarget:62`), its `isMorphTarget`, validator arm, resolver arm, and value validator (`number finite 0..1`). |
| `frontend/src/engine/commands/addKeyframeCommand.ts:38-49` | `validate` calls `requireNodeTarget → resolveAnimationTarget → requireKeyframeTime → requireTrackKeyframeValue`. No new command needed — generic command already routes through the new resolver/validator. Same reuse for `moveKeyframesCommand, setKeyframeValueCommand, setKeyframeInterpolationCommand, setKeyframeTangentsCommand`. |

## 2. How tracks are persisted

| File:line | Insertion point |
|---|---|
| `frontend/src/engine/json.ts:128-174` | `KeyframeJSON:128-135` stays generic (`value: KeyframeValue`). Add `MorphTrackJSON { keyframes: readonly KeyframeJSON[] }` next to `VisibleTrackJSON:162-164`; add `morphTrack?: MorphTrackJSON` and `morphBinding?: { fromId: string|null, toId: string|null }` to `NodeAnimationJSON:166-174`. Do **not** mint a new `property` string like `morph:from->to` — that is the `N²` path. |
| `frontend/src/engine/lessonSerializer.ts:553-766` | `validateAnimation:553` loops `entry.tracks` + `materialTracks` + `circleTracks` + `tableTracks` + `visibleTrack`. Append a `morphTrack` block after `visibleTrack:740-765` calling `validateKeyframeList` with a `0..1` number validator and an `interpolation must be hold|linear|bezier` guard mirroring `lessonValidation.ts:106-113`. Also call `validate` at `163-209` pre-flight — morph inherits the same `keyframeIds` uniqueness set `203`. |
| `frontend/src/engine/lessonValidation.ts:3,64-132` | `INTERPOLATIONS:3` whitelist + `validateKeyframeList:64` (time monotonic `91-101`, duplicate `84-88`, interpolation `106-113`, tangent `114-131` checks) — reused unchanged; only wire a new caller. No schema version bump needed (`lessonSerializer.ts:37` stays `v2`) — new optional fields are backward-compatible per existing `circle/table/visible` additions. |
| `frontend/src/engine/lessonSerializer.ts:769-932` | `buildProjectFromJSON:769` funnels through `buildSlideFromJSON:857` → `SlideAnimation.fromJSON:196` → `NodeAnimation.fromJSON:282`. Morph's `fromJSON` reads the optional `morphTrack` / `morphBinding` with same `trackKeyframeParser:525-563` pattern (`requireKeyframeTime` + `requireMorphCoefficientValue` `0..1` finite). |
| `frontend/src/engine/slide.ts` `toJSON` (≈ `slideManager.ts` fanout) | Threaded via `SlideAnimation.toJSON:165` already; no separate slide-level change. |

Sidecar persistence — two equivalent shapes, pick one:

* **A (recommended prototype):** `NodeAnimationJSON.morphBinding` alongside `morphTrack` (co-located, undoable via the same node-animation mutation). The base shapes themselves live as `MeshComponent.morphShapes?: Map<shapeId, Float32Array deltas>` or as sibling node components; the binding references those ids. Validation: if `morphTrack` present without `morphBinding`, error; `fromId===toId` rejected; unknown `shapeId` warns but does not hard-fail (mirrors `validateAnimation` unknown-node softness pre-parse).
* **B (alt):** `SceneNode` extension `morphState: {fromId,toId,coefficientBase}` — coefficient base is the static fallback when no keyframes (like `node.opacity:116` or `node.visible:116` vs track). Slightly more plumbing (sceneNode.ts JSON) but meshes better if morph is conceptually a node property, not just an animation track.

## 3. How tracks are evaluated

| File:line | Insertion point |
|---|---|
| `frontend/src/engine/animationEvaluator.ts:125-154` | `evaluateNode:125` evaluates `x,y,rotation,scaleX,scaleY,opacity` via `#evaluate:543` (`evaluateSegment:28`) then `#applyClipInstances:344`. Morph adds a sibling free function `evaluateMorph(nodeId,time): { coefficient:number, fromId:string|null, toId:string|null }` next to `evaluateVisible:156` and `evaluateCircle:261` / `evaluateTable:296`. Value is `#evaluate(animation?.morphCoefficientKeyframes(), clampedTime, 0)` clamped `0..1`. Sidecar pair is read from `NodeAnimation.morphBinding` (static) or thread through `evaluatedMorphScratch` like `evaluatedMaterialOverridesScratch:53`. |
| `frontend/src/engine/animationEvaluator.ts:156-185` | `evaluateVisible` is the bespoke `hold`-only lane template. Morph copies its early-return `!keyframes → fallback` pattern and its `time <= first / >= last` fast paths, but keeps the generic `evaluateSegment` loop for `hold|linear|bezier` rather than the visible `throw if !== hold` gate `178-180`. |
| `frontend/src/engine/animationEvaluator.ts:193-237,441-519` | `evaluateMaterialOverrides` + `#applyClipMaterialOverrides` — composition after standard tracks. Morph has no analogue until clips adopt it; call sites that need the coefficient (e.g. `meshDeformationEvaluator`) query the evaluator directly. |
| `frontend/src/engine/animationEvaluator.ts:343-413,521-563` | `#applyClipInstances:344` + `#evaluateClipChannel/#evaluate:521` — today only iterates `clip.channels` for `ClipChannel=AnimationProperty`. Morph clip support would add `#applyClipMorphOverrides` iterating `clip.morphChannelAnimation` — **defer for prototype** to avoid per-frame blend double-write. |
| `frontend/src/engine/meshDeformationEvaluator.ts:16` + `frontend/src/pixi/renderer/deformedMeshWorld.ts:9` | The existing **morph-then-bones** insertion (from `research/morph-pixi-pipeline`) stays: `resolveMorphedVertices(mesh, morphState) → evaluateMeshDeformation`. `animationEvaluator.evaluateMorph` supplies `morphState`; these two files own the lerp, not the evaluator. No timeline/evaluator change threads `faces/uvs` — deltas are stored sparsely per-shape. |
| `frontend/src/engine/curveGeometry.ts:62-67,73-133` | `interpolateValue:62` + `computeCurvePoints:73` already call `evaluateSegment`; morph curves render by supplying the morph `Keyframe[]` as a `CurveData` (same as `CurveEditorPanel` does for standard tracks). Clamp display `0..1` in evaluator, not geometry. |

Evaluator shortcut already present: `evaluatedNodeScratch:48` / `evaluatedMeterialOverridesScratch:58` pool objects to avoid alloc per frame — morph should follow with `evaluatedMorphScratch(): {coefficient, fromId, toId}` if called per-node per-frame at 60 Hz.

## 4. How timeline UI is wired

| File:line | Insertion point |
|---|---|
| `frontend/src/components/panels/timelineTracks.ts:12-70,72-92,132-185` | Add `MorphSubtrackEntry {kind:'morphSubtrack', node:SceneNode, depth:number}` next to `VisibleSubtrackEntry:48`, `MORPH_LABEL='Morph'`, and one `rows.push({kind:'morphSubtrack', …})` after `rows.push({kind:'visibleSubtrack'…})` at `157`. Gate on `node.components.mesh && nodeHasMorphShapes(node)` (shape inventory) so empty nodes do not sprout a lane. |
| `frontend/src/components/panels/TimelineBody.tsx:106-148,392-515,928-1140` | Selection `allSelectionItems:106` adds one branch `else if (row.kind==='morphSubtrack') engine.getMorphKeyframes(node.id)…`; context menu `handleTrackListContextMenu:446` / `handleKeyframeContextMenu:386` / `addKeyframeFromMenu:521` / `deleteKeyframeFromMenu:583` copy the `visibleSubtrack` branches verbatim (replace `visible` guard with numeric `0..1` fallback). Lane JSX after the `visibleSubtrack` block (`963-1036`) is the minimal visual — forward to `KeyframeMarker`. For v1, no custom shading like `timeline-visible-segment:996-1009` needed; the curve is the signal. |
| `frontend/src/components/panels/TimelinePanel.tsx:88` | `rows = scene ? timelineRows(scene, expandedNodeIds, …) : []` already drives both Dope Sheet and CurveEditor; no change beyond the `timelineTracks` addition. |
| `frontend/src/components/panels/CurveEditorPanel.tsx:74-117,181-245` | `buildCurves:74` iterates `animatablePropertiesOf(node)` for standard tracks + `CIRCLE…` for circle. Morph adds one `if (nodeHasMorphShapes) { const kfs = engine.getMorphKeyframes(nodeId,'morphCoefficient'); if (kfs.length) curves.push({nodeId, property:'morphCoefficient', label:'Morph', keyframes:kfs, color:'#ff6e40'}) }`. Filters `matchesFilter:64` gain a `morph` case. `resolveKeyframes:181` / `buildTarget:195` / `dispatchMoveAndValue:211` / `dispatchTangents:247` gain a morph arm (mirrors the existing `isCircleProperty` branch). |
| `frontend/src/engine/curveGeometry.ts:42-61` | `CurveData {nodeId, property, label, keyframes, color}` (see `CurveEditorPanel:74` usage) already generic — no type change, just new `property='morphCoefficient'`. |
| `frontend/src/stores/playbackStore.ts:107-119,151-182` | No morph-specific code. Playhead `currentTime` (`getTime:190`), scrub `setCurrentTime:192` (`clampTime:115` + `CurrentTimeChanged` event), and `tick→advance:151` feed evaluator via `engine.evaluateMorph(nodeId, time)` like they already feed `engine.evaluateNode/Visible/Circle`. No insertion. |
| `frontend/src/app/keyframeActions.ts:27-85,130-169` | `animatablePropertiesOf:27` filters `rotation` for camera / `opacity` for bones. Morph adds `if (nodeHasMorphShapes) push morph param` branch. `addKeyframeAtPlayhead:130` / `addPoseKeyframesAtPlayhead:146` clone directly for morph (`evaluatedMorphValue(engine,nodeId,time) ?? 0`). For auto-key (`keyframeEdit.ts:64-100` `autoKeyCommands`) morph benefits from the same `requireTrackKeyframeValue` gate. |
| `frontend/src/stores/timelineViewStore.ts` + `useEngine.ts` | Viewport `pps, scrollTime` and `EngineEvent → setTick` already trigger rerenders for any keyframe lane; no insertion. |

## 5. Clip system — does prototype need it?

**No.** Defer for the tracer bullet (see `docs/research/d3-svg-to-pixijs-texture-pipeline.md` pattern). Evidence:

* `frontend/src/engine/clipDefinition.ts:23-62,195-228,300-333` — clips declare `ClipChannel = AnimationProperty` (`CLIP_CHANNELS:26`) + per-channel `ClipChannelAnimation:75` maps. Adding morph means widening `ClipChannel`, a new `#morphAnimations: Map<string,ClipChannelAnimation>` sibling to `#circleAnimations:205`, and `toJSON/fromJSON` branches (`521-556,610-661`). That's a non-trivial fork plus validator, extractor, and evaluator changes for a feature whose node-level semantics are still settling.
* `frontend/src/engine/clipInstance.ts:5-12` — `ClipInstance {startTime,speed,enabled,paramOverrides}` layers channels via `#applyClipInstances:344` gain/offset composition. Morph's `0..1` does not fit `gain|offset` cleanly — per-pair blend semantics would need a new link mode.
* `frontend/src/engine/clipExtraction.ts:96-133` + `frontend/src/app/clipExtractionActions.ts` — extraction groups by `channelKeyOf:108` (`property:opacity` etc.) and normalizes `time→[0,1]` `34-46`. Morph would add `morph:morphCoefficient` there.
* `frontend/src/engine/clipCollection.ts:9-30` — bindings `semanticName→clipId` broadcast per clip; morph clips would inherit that broadcast for free, but again only after the base lane exists.

**Recommendation:** ship node morph lane first, gate clip wiring behind a later issue that migrates `ClipDefinition` only after the evaluator+timeline shape stabilizes. The one-track+sidecar node design keeps that later migration cheap (one extra clip map).

---

## 6. One track + sidecar vs N² tracks — trade-off

| Axis | One `morphCoefficient` Float Track + `MorphBinding{fromId,toId}` sidecar | N² ordered-pair tracks `morph:A→B`, `morph:A→C`, … |
|---|---|---|
| **Any-to-any** | One scrub `0→1` always meaningful; From/To is a discrete node property (two selects). Any pair by swapping binding — no schema for pairs. N=10 shapes → 1 track. | Each ordered pair is a distinct lane; any-to-any = enumerate all lanes, show/hide by binding. N=10 → 90 ordered tracks (45 unordered if `coeff` symmetric). UI noise and validation burden. |
| **Interp** | Single `hold\|linear\|bezier` with tangents in `value` units already stored (`keyframe.ts:55-56`). Hold = cut, linear = crossfade, bezier = ease — exactly the request. No per-pair easing dupe. | Same interpolators per pair — but N² copies of identical easing data; changing default easing touches many lanes. |
| **Keyframes** | `time→coefficient` scalar — `move/scale/paste/duplicate` reuse generic seams (`animationManager.ts:149-197`). Sparse: one lane holds all morph story. | Sparse per pair — timeline shows many empty lanes; marquee/scale/drag operates on one pair at a time; history grows as `N²` entries. |
| **Persistence** | 1 optional `morphTrack` + 1 `morphBinding` per node — same object shape as `visibleTrack` (`json.ts:162`). Validator one block (`lessonSerializer.ts:740`). Version stays `v2`. | `morphTracks?: MorphPairTrackJSON[]` array keyed by `fromId/toId`. Validator loops array + duplicate-pair check + per-pair `validateKeyframeList` calls. Serialized size grows `N²`. |
| **Evaluation** | `O(K)` where K = keyframes in the one lane; one `evaluateSegment` call per query. `deformedMeshWorld / meshOverlay / sceneRenderer` thread one `morphState` (`meshDeformationEvaluator.ts:16` lerp) — uniform call sites. | Must evaluate up to `N` active pair tracks to find non-zero coefficient (or one if only one pair animated) — still `O(K)` per active track but amortized worse and requires priority rule (last-wins or sum-to-1). |
| **UX** | Two dropdowns (From, To) + coefficient curve — minimal, matches Familiar "Blend" mental model (After Effects `Morph` effect, Blender `ShapeKey` value). | One dropdown pair per lane — user picks lane implicitly but the linear list scales poorly; binder and extraction `Add to clip` must route correctly. |
| **Cost to add** | ~6 files, ~30 LOC each (mirror `visible`): `animationProperties` guard (optional), `keyframeTarget` arm, `nodeAnimation` field+methods+json, `slideAnimation` clamp+toJSON, `animationManager` resolver, `animationEvaluator` getter, `timelineTracks`/`TimelineBody`/`CurveEditorPanel` lane, `lessonSerializer` validator, `json` type. | Same files × `N` fan-out: `nodeAnimation` map not single field, `slideAnimation` loops array, `animationManager` batch resolver, `timelineTracks` dynamic row factory per shape inventory, `json` array types + length guards. Tests × pairs. |

**Verdict: one track + sidecar strictly dominates** for prototype and remains the only sane any-to-any primitive. Promote pair selection to animated (hold-interpolated string tracks) only if scrubbing `A→B` then `B→C` mid-clip becomes a requirement — still cheaper as two hold tracks for `fromId`/`toId` beside the coefficient, not `N²`.

---

## 7. Recommended insertion shape (reuse property-track machinery, bespoke lane)

> **Not** a new `ANIMATABLE_PROPERTIES` entry, **not** `N²`. Be a bespoke lane.

1. **`animationProperties.ts:29-33`** — add `export const MORPH_PROPERTIES=['morphCoefficient']` and `requireMorphCoefficientValue(value): number` (`0..1` finite) helper if you want an explicit guard; otherwise reuse `requireKeyframeValue` with extra clamp at evaluator. No change to `ANIMATABLE_PROPERTIES` — bones/cameras/mobility checks stay untouched.
2. **`keyframeTarget.ts:62-66,80-86,133-216,219-249`** — add `NodeMorphTarget {kind:'morph', nodeId}`, `isMorphTarget`, `requireKeyframeTarget` arm `value.kind==='morph'`, `resolveKeyframeTrack` arm `return {kind:'morph'}`, and `requireTrackKeyframeValue` arm returning clamped `number`.
3. **`nodeAnimation.ts:32,95-123,125-143,189-225,227-273,282-350,456-478`** — `readonly #morphCoefficient: Keyframe[] = []` + `morphCoefficientKeyframes/hasMorphTrack/addMorph/removeMorph/getMorph` + copy loop + `morphTrackJSON()` (like `visibleTrackJSON:267`) + `readMorphTrack()` (like `readVisibleTrack:456`). Sidecar: `readonly #morphBinding: {fromId:string|null,toId:string|null}|null = null` + getter/setter + JSON cofield.
4. **`slideAnimation.ts:81-163,165-193`** — `clampKeyframesTo` morph loop (between `table` and `visible` at `150`), `toJSON` morph guard alongside `visibleTrack` at `173-190`.
5. **`animationManager.ts:376-392,394-409,510`** — `track.kind==='morph'` branches in `resolve`, `keyframesOf`, `addToTrack`, `removeFromTrack`, `requireKeyframe`, `trackLabel`.
6. **`animationEvaluator.ts:156-185,194,543`** — `evaluateMorph(nodeId,time,{coefficient,fromId,toId})` beside `evaluateVisible`; clamp `0..1`; optional `evaluatedMorphScratch` pool. No `#applyClipInstances` arm in v1.
7. **`timelineTracks.ts:48-52,132-185`** — `MorphSubtrackEntry` + `MORPH_LABEL` + `timelineRows` push guarded by `hasMorphShapes`. Consider hiding morph lane for `camera`/`bone` nodes if shape inventory empty.
8. **`TimelineBody.tsx:106-136,392-515,928-1140` + `CurveEditorPanel.tsx:74-245`** — collection + context-menu + lane JSX + curve building arms (copy visible/circle patterns). `curveGeometry.ts:42` needs nothing beyond feeding morph `Keyframe[]` as `CurveData`.
9. **`json.ts:162-174` + `lessonSerializer.ts:740-765` + `lessonValidation.ts:64`** — type + validator + `fromJSON`/`toJSON` threading — optional fields, no version bump.

At every seam, reuse the generic `Keyframe`/`interpolators`/`commands`/`Evaluator`/`CurveEditor` contracts — **custom lane kind, generic machinery**, exactly how `visible` ships with `hold`-only interpolation as its only specialization (`animationManager.ts:113-119` + `animationEvaluator.ts:178`).

---

## 8. Risks / open questions

* **Shape inventory source** — morph expects shapes as addressable snapshots (ids). Recommendation from `research/morph-pixi-pipeline` (`frontend/src/engine/mesh.ts:26`) holds: per-shape deltas (`Float32Array`/`Map<vertex,dv>`) not whole `MeshData` copies; lerp before bones (`meshDeformationEvaluator.ts:16` / `deformedMeshWorld.ts:9` / `sceneRenderer.ts:281`). Binding validation must tolerate stale ids after shape deletion (warn, fallback to base).
* **Tangents vs clamp** — bezier `tangentOut.value` can push coefficient outside `0..1` between keyframes (overshoot). Decision: clamp per evaluation (`Math.min(Math.max(v,0),1)`) vs allow extrapolation for elastic/bounce experiments. Recommend clamp for morph; document as material `opacityMultiplier` does (`materialTrackEvaluation.ts:90-102`).
* **Hold semantics for binding** — if pair ever becomes animated, discrete `fromId/toId` hold tracks avoid tweening a string through nonsensical intermediates. Model as two separate hold lanes beside coefficient, not string interpolation.
* **Bone nodes** — morph lane should be invisible on `node.components.bone` nodes (same exclusion as `opacity` at `animationProperties.ts:15` / `keyframeActions.ts:33`).
* **Export** — client-rendered `getExportFrameTimestamps` → `evaluateMeshDeformation` already queries morph state deterministically per frame; no extra export path once evaluator threads `morphState`.

## File:line index (complete, as requested)

| Layer | File:line |
|---|---|
| Track def | `animationProperties.ts:4-73` `ANIMATABLE_PROPERTIES/CIRCLE…/TABLE…` + guards; insertion for morph guard at `29-33` |
| Track store | `nodeAnimation.ts:31-37` fields; `:95-123` visible lane template; `:125-143` `add*`; `:189-225` `copy`; `:227-273` `toJSON`; `:282-350` `fromJSON`; `:456-478` `readVisibleTrack`; `:480-563` helpers |
| Slide fanout | `slideAnimation.ts:81-163` `clampKeyframesTo`; `:165-193` `toJSON`; `:196-229` `fromJSON` |
| Keyframe shape | `keyframe.ts:5,14,26-38,50-84` type/tangents/class + `110` snapshot |
| Interp | `interpolators.ts:8-68` registry + `evaluateSegment:28`; `materialTrackEvaluation.ts:54-130` continuity model for reference |
| Persistence types | `json.ts:128-174` `KeyframeJSON/…TrackJSON/NodeAnimationJSON` |
| Persistence validate | `lessonSerializer.ts:37,163-209,553-766` version + `validate` + `validateAnimation` |
| Persistence list | `lessonValidation.ts:3,64-132` `INTERPOLATIONS` + `validateKeyframeList` |
| Evaluation standard | `animationEvaluator.ts:107-154` `evaluateNode` + `98-105` channel map |
| Evaluation bespoke | `animationEvaluator.ts:156-185` `evaluateVisible` (morph template); `:193-237` material overrides; `:261-335` circle/table; `:344-563` clip layering + `#evaluate` |
| UI rows | `timelineTracks.ts:12-70` row types; `:72-92` labels; `:132-185` `timelineRows`; `:205-226` `clipChannelRows` |
| UI body | `components/panels/TimelineBody.tsx:106-148` selection; `:386-659` menu/extraction; `:928-1140` lane JSX |
| UI panel | `components/panels/TimelinePanel.tsx:38-168` row sourcing + view mode |
| UI curves | `components/panels/CurveEditorPanel.tsx:74-245` `buildCurves` + `resolveKeyframes` + dispatch helpers; `curveGeometry.ts:62-133,235-256` sampling + bounds |
| Interaction | `stores/playbackStore.ts:107-182` RAF tick/advance; `app/keyframeActions.ts:27-185` `animatablePropertiesOf/addKeyframeAtPlayhead`; `engine/keyframeEdit.ts:64-152` `autoKeyCommands` |
| Clip def | `clipDefinition.ts:23-62,75-132,195-228,300-661` `ClipChannel/ClipChannelAnimation/ClipDefinition` |
| Clip instance | `clipInstance.ts:5-12,42-80` `ClipInstance` + JSON |
| Clip extraction | `clipExtraction.ts:108-185` `channelKeyOf/groupNormalizedByChannel` |
| Commands | `engine/commands/addKeyframeCommand.ts:38-49` generic validation gate (all keyframe commands share this seam) |
| Morph-then-bones | `engine/mesh.ts:26-57` `MeshData/Component`; `engine/meshDeformationEvaluator.ts:16` skin; `pixi/renderer/deformedMeshWorld.ts:9` world composition; `pixi/renderer/meshOverlay.ts:52-67,137-239` deformed+preview; `pixi/renderer/sceneRenderer.ts:281-464` `refreshDeformedMeshSizes/handleMeshChanged` (from sibling research `research/morph-pixi-pipeline.md`) |
