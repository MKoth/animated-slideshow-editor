# Research: Timeline row model, clip evaluation, and resize/scale extension points

**Ticket:** #307 — Research: Timeline row model, clip evaluation, and resize/scale extension points  
**Map:** #306 — Wayfinder map — Animation Manager for Hierarchical Objects  
**Branch:** `research/manager-timeline-clip`  
**Date:** 2026-09-07  
**Scope:** Gaps for lane-per-clip + resize-condense in the Animation Manager modal. No code changes — findings only.

---

## 1. Current row model — property-per-lane, no lane-per-clip

### 1.1 `timelineTracks.ts` — the single source of row types

- **Track header constants** `timelineTracks.ts:17-18`: `TRACK_HEADER_WIDTH = 240`, `ROW_HEIGHT = 28`. Depth indentation `12 + depth*16` is applied inline in `TimelineBody.tsx` for every subtrack row.
- **Two disjoint row worlds today:**
  - `TimelineRow` union `timelineTracks.ts:90-100`: `TrackRowEntry|SubtrackEntry|MaterialSubtrackEntry|DataLabelSubtrackEntry|CircleSubtrackEntry|VisibleSubtrackEntry|MorphSubtrackEntry|SymmetrySubtrackEntry|ShadowSubtrackEntry|BoneTrackEntry`. Every non-header variant carries `node: SceneNode, depth: number` and a lane-discriminator (`property`, `parameter`, `label`, etc.).
  - `ClipTimelineRow = ClipChannelRowEntry` `timelineTracks.ts:276`: `clipId, channel: AnimationProperty, label, rowIndex` — built only by `clipChannelRows(clip)` `timelineTracks.ts:278-292` from `clip.channels` in insertion order. Used **only** in `ClipEditBody.tsx` (clip editor sub-view).
- **Builder** `timelineRows(scene, expandedNodeIds, materialDefs)` `timelineTracks.ts:168-258`: iterates `trackRows(scene)` (pre-order walk rooted at `scene.root` + camera appended at `depth:1` — `timelineTracks.ts:142-162`). For each expanded node (`expandedNodeIds[nodeId]===true`), pushes subtracks in fixed order: transform channels via `animatablePropertiesOf` → `visibleSubtrack` → `morph/symmetry` if `components.mesh` → material params → `dataLabelSubtrack` per `chart.dataLabels` → `circleSubtrack` per `CIRCLE_ANIMATABLE_PROPERTIES` → `shadowSubtrack` (auto vs manual filtered via `SHADOW_LIGHT_PROPERTIES`/`SHADOW_SHARED_PROPERTIES`/`SHADOW_BASE_PROPERTIES`). Shadow rows are flat at `depth+1` with no header (`timelineTracks.ts:222-253`).
- **Filtering gap for Manager:** No filtered-row builder exists. The modal spec says "only children that have animation, only animated params" — neither `timelineRows` nor `ClipEditBody` filters. Manager will need a new function, e.g. `managerTimelineRows(parentId, filter)` that walks only children of the clicked parent, keeps nodes with `slide.animation.hasTrack` or `node.clipInstances.length>0`, and keeps only animated params per node (query `animation.node(nodeId)` + material/circle/shadow presence). Bone rows are already excluded from property expansion by the `kind==='bone'` branch guard `timelineTracks.ts:178-185` — Manager should replicate that.
- **Clip-collection rows:** `clipCollection.ts:9-117` exists (`ClipCollection.bindings: Map<semanticName,clipId>`) but has **no row type** and no timeline representation. Manager will need collection-level rows above clip rows.

### 1.2 `TimelineBody.tsx` vs `ClipEditBody.tsx`

- **Main timeline** `TimelineBody.tsx:239-…`: receives `rows: readonly TimelineRow[]` from parent (`TimelinePanel` in production, builds via `timelineRows`). Renders two synced panes: left `timeline-tracks` with header/subtrack labels and `TrackRow` / `MorphSubtrackHeader`, right `timeline-scroller` → `timeline-time-area` → `timeline-lanes` with one absolute `timeline-lane-row` per row (`top: index*ROW_HEIGHT`, `height: ROW_HEIGHT`). Content width `Math.max(viewportWidth, duration*pps + TRAILING_PADDING)` `TimelineBody.tsx:1029`.
- **Clip editor** `ClipEditBody.tsx:46-688`: isolated mode — own `scrubTime` state, own `rows = clipChannelRows(clip)` `ClipEditBody.tsx:88`, own `keyframeRefsMap` (Map keyed by clip keyframe id) `ClipEditBody.tsx:135-143`, own `SelectionScaleBox` instance. Does **not** render `ClipInstance` bars; it renders per-channel diamonds for a single `ClipDefinition`.
- **Gap:** There is no "lane-per-clip" renderer anywhere. The Manager needs a third mode (or a mode switch inside the modal) that renders **one bar per `ClipInstance`** on a per-object lane (name-only, no per-param breakdown), plus layers for collection lanes and orphan-param lanes.

### 1.3 `timelineViewStore.ts` + `timelineTracks` geometry

- Store `frontend/src/stores/timelineViewStore.ts:1-182`: `zoomLevel` (0.25–8, `ZOOM_STEP=2`), `scrollTime`, `height` (persisted via `zustand/persist`), `expandedNodeIds`, `gridSnapEnabled`, `snapToKeyframesEnabled`. Helpers:
  - `pps = BASE_PPS(100) * zoomLevel` `timelineViewStore.ts:15-17`.
  - `rulerTickStep(pps)` picks from `[0.05,0.1,0.2,0.5,1,2,5,10,30,60,120,300]` where `step*pps >= 40px` `timelineViewStore.ts:19-26`.
  - `snapTimeToGrid(time, step)` `timelineViewStore.ts:42-45` (used for playhead drag) vs `snapToFrameGrid/snapKeyframeTime` in `timelineSnapping.ts` (used for keyframe drag/scale) — two different grids.
  - `clampScrollTime` keeps `scrollTime` within `duration + trailingPadding/pps - viewport/pps` `timelineViewStore.ts:58-68`.
- **Manager implication:** Bar placement math must reuse `pps` and `scrollTime` directly: `leftPx = startTime * pps`, `widthPx = visualDuration * pps - 1px border`. The modal will share the global `timelineViewStore` or scope a local copy; decide before implementing.

---

## 2. Clip evaluation and the visual-duration formula

### 2.1 `clipInstance.ts` — shape + persistence

- `ClipInstance` `clipInstance.ts:5-12`: `{ id, clipId, startTime:number, speed:number, enabled:boolean, paramOverrides: Record<string,number> }`.
- Factory `createClipInstance(clipId, start=0, speed=1, enabled=true)` `clipInstance.ts:14-29`. `cloneClipInstance` clones with new id `clipInstance.ts:31-40`.
- JSON `clipInstanceToJSON/FromJSON` `clipInstance.ts:42-80` + `json.ts:400-407`: persists `id, clipId, startTime, speed, enabled, paramOverrides`. Validation in `clipInstanceFromJSON:62-67` rejects `speed < 0` and `startTime < 0`; `enabled` defaults true. `validateClipInstance:86-96` mirrors.
- **Ordering is array order on `SceneNode.clipInstances`** `sceneNode.ts:50,73`. Serialized via `node.toJSON().clipInstances.map(clipInstanceToJSON)` `sceneNode.ts:123-125` and restored in document order `sceneNode.ts:171-174`. `lessonSerializer.ts:849-862` re-validates each instance's `clipId` and param keys after parse. There is no separate layer index field — the array **is** the layer stack.

### 2.2 `animationEvaluator.ts` — last-wins, `u` formula

Every clip-aware evaluator method follows the same pattern:

```ts
if (clip.duration <= 0) continue
if (time < instance.startTime) continue   // hasn't started → must not override earlier layers
const u = clamp(((time - startTime) * speed) / clip.duration, 0, 1)
value = evaluateClipChannel(anim.keyframes(), u) // u in [0,1]
```

Occurrences:
- Main transform+opacity layering `#applyClipInstances` `animationEvaluator.ts:1050-1053`
- Material overrides `#applyClipMaterialOverrides` `animationEvaluator.ts:1147-1150`
- Shadow numeric `#applyClipShadowInstances` `animationEvaluator.ts:397-400` and color `#evaluateClipShadowColor` `animationEvaluator.ts:425-428`
- Morph value `#evaluateMorphValue` `animationEvaluator.ts:502-506`
- Morph vertices `#evaluateMorphVertices` `animationEvaluator.ts:566-570`

Key semantics:
- **Visual duration** is `clip.duration / speed` `clipInstance.ts` implied, `animationEvaluator.ts` derivation explicit. With `speed=1`, a 7 s default clip spans `[start, start+7)`. With `speed=2`, same 7 s clip condenses to 3.5 s (`u` reaches 1 twice as fast). With `speed=0`, `u` is always 0 → frozen at first keyframe (duration guarded as `<=0` skip, not division by zero because numerator is 0).
- **Hold after end:** `u` clamps to 1, so after `start + visualDuration` the clip holds its last keyframe and continues to override lower layers (unless disabled). Clips do **not** implicitly stop contributing — they layer last-wins for all `t >= startTime`.
- **`speed < 0` rejected** by `clipInstanceFromJSON` — no reverse playback. If reverse is desired for Manager, validation must change.
- **`enabled === false`** skips the instance at all levels — same guard in every evaluator loop.

### 2.3 `clipDefinition.ts` — the shared definition

- Channels `clipDefinition.ts:56-65,201-231`: `ClipDefinition` stores name/duration/category/params/channels and per-kind maps: `channelAnimations (ClipChannel)`, `materialChannelAnimations (string)`, `visibleAnimation`, `circleAnimations (CircleProperty)`, `morphAnimation`, `shadowChannelAnimations (ShadowProperty)`.
- Clip keyframe time is normalized `[0,1]` `clipDefinition.ts:163-172` (fromJSON enforces `[0,1]`, sorted, no duplicate unless at `time===1`). Tangents likewise normalized by extraction duration `clipExtraction.ts:58-65`.
- `clipDefinition.ts:238-248` duration setter is a plain number; `ClipManager.setDuration` `clipManager.ts:150-158` validates `>=0` and emits `ClipDurationChanged`. Changing definition duration mutates the shared clip for **all** instances — not per-object.

### 2.4 Which resize target: `ClipInstance.speed` vs `ClipDefinition.duration`

| Option | What changes | Scope | Visual duration formula | Undo scope | Side-effect |
|---|---|---|---|---|---|
| **A. Resize drives `ClipInstance.speed`** (recommended for Manager) | `instance.speed = clip.duration / newVisualDuration` | Per-object, per-instance | `visual = duration / speed` | `SetClipInstanceSpeedCommand` + `SetClipInstanceStartTimeCommand` (left edge) per handle; group via Transaction | Definition untouched; sharing is safe. Member clips already stretched per `speed`; evaluator probes `u` with new `speed`. |
| **B. Resize rescales `ClipDefinition.duration` + keyframe times** | `clip.duration = newVisualDuration` and `keyframe.time *= oldDuration/newDuration` per channel | Global — every node using that clip | `visual = duration` when per-instance `speed` stays 1 | `SetClipDurationCommand` + many `MoveClipKeyframesCommand` (one per channel keyframe); global mutation | Breaks sharing; Manager's per-object bar would affect other objects. Useful only for clip-editor internal stretch (the existing `scaleChannelKeyframes` `clipManager.ts:310-347` already does this). |
| **C. Hybrid** | Left/right handles decide via modifier (Alt = definition rescale, otherwise speed) | — | — | Complex | Confusing for users; not recommended for v1. |

**Recommendation:** Manager bar resize (both collection-level and per-clip) drives **instance `speed`** (option A). Left handle also drives `startTime`; right handle keeps `startTime`. Definition rescale (option B) stays in the clip editor (`ClipEditBody`) where `clipManager.scaleChannelKeyframes` and the `SelectionScaleBox` factor math already exist. For a collection resize that "propagates to members, hidden internals", the command should iterate the collection's member instances and apply the **same factor** to each `speed` (or recompute each from its own `visualDuration` ratio when members have heterogeneous `clip.duration` values).

### 2.5 Speed semantics corner cases

- `speed === 0`: `u=0`, bar has infinite visual width if computed naïvely as `duration/0`. Cap with `MAX_VISUAL_DURATION` or clamp speed to `EPS = 1e-4` and render width as `duration/EPS`. Spec example: disabled vs frozen — `enabled` is the right way to pause; `speed=0` should be rejected in resize UI and mapped to `enabled=false` or min speed.
- Defined width formula for bar component: `visualDuration = clip.duration > 0 && instance.speed > EPS ? clip.duration / instance.speed : fallback` (e.g. `Math.min(slide.duration - startTime, clip.duration)`).
- `clip.duration === 0`: evaluator skips it (`continue`) for that layer. Rendering should hide or show as a 6 px tick so it stays reorderable.

---

## 3. Reordering / layering mechanism + dirty strategy

### 3.1 `moveClipLayerCommand.ts` + `internal.ts#moveClipLayer`

- Command `frontend/src/engine/commands/moveClipLayerCommand.ts:1-58`: params `{nodeId, instanceId, newIndex}`, validates `newIndex < node.clipInstances.length` `moveClipLayerCommand.ts:43`, executes `engine.moveClipLayer` and records `oldIndex` for inverse.
- Engine `internal.ts:4338-4350`: finds `index = findIndex(id)`, bounds-checks `newIndex`, does `splice(index,1)` then `splice(newIndex,0,instance)` and emits `ClipLayerMoved`. No secondary storage — the array splice mutation is the entire model.
- Undo `commands/undoHandlers.ts:797-802` and redo `commands/undoHandlers.ts:2710-2714` replay the same splice; no layer-conflict handling needed because the array carries order.
- **Vertical reorder extension:** Today `newIndex` is vertical position in the per-node array (which also decides z-order). For Manager's "up↔down" drag, reuse the same command but visualize stacking. For "left↔right" reorder, that's really `startTime` reorder — no command needed beyond move-time; however a drop that crosses another bar's vertical slot should translate to an intra-node `moveClipLayer` to set last-wins priority.
- **Cross-node moves:** No engine primitive for moving an instance to another `nodeId`. Apply (collection broadcasting) does it via `clipCollection` bindings + import-time remapping; at runtime the Manager's "assign clip to object" should call `assignClipInstance` on the target node (or a new `CopyClipInstanceCommand`).

### 3.2 Dirty / event strategy — what actually dirties today

- `SceneNode.markDirty()` `sceneNode.ts:76-84` only flags `_worldTransformDirty` for `worldTransform.ts` caching. It walks children to propagate. Not related to animation or clips.
- `chart._dirty` `sceneNode.ts:625-626` and `chartComponent.ts:46-84` is per-chart re-rasterization; similarly per-node, not per-timeline.
- Clip/timeline changes use **EventBus** events, not dirty flags:
  - Assignment/removal: `ClipInstanceAdded/Removed` `internal.ts:4323,4334`
  - Moves: `ClipLayerMoved` `internal.ts:4349`
  - Per-instance edits: `ClipInstanceTimeChanged / SpeedChanged / EnabledChanged / ParamOverridden` `internal.ts:4355,4361,4367,4378`
  - Definition edits: `ClipCreated/Duplicated/Removed/DurationChanged/CategoryChanged/ParamDefaultChanged/ChannelLinkChanged` `clipManager.ts:76-196`, plus `KeyframeAdded/Removed/Moved/ValueChanged` for clip channels.
- **TimelineBody reactivity:** Today `TimelineBody.tsx` reads engine synchronously (`engine.getKeyframes(...)`, `engine.getMorphKeyframes(...)`, etc.) inside render and via `useKeyframeDrag`/`useKeyframeScale` refs. It does not subscribe to clip instance events — because no bar exists. The Manager's bar layer will need to subscribe to `Clip*` events (or to `engine.subscribe` + filter) and recompute stacked layout on each change. No global dirty batching needed; clips are lightweight count (usually <10 per node).

### 3.3 Lane stacking — none today

- There is no horizontal overlap stacking. `TimelineBody` rows are fixed 1-per-property (`ROW_HEIGHT=28`), and `ClipEditBody` rows are 1-per-channel. Overlapping content (keyframes at same time on different properties) never collides because they are on separate rows.
- For Manager, multiple `ClipInstance` bars on the **same** per-object lane will overlap horizontally. The spec says: collections stack vertically when overlapping horizontally; lower takes control (i.e. later in array → higher z-index). There is no layout function for this today. A new helper is needed, e.g.

```ts
function stackClipLanes(instances: readonly ClipInstanceView[]): LaneStack[]
// where ClipInstanceView { id, startTime, visualDuration, arrayIndex }
// returns stacked rows with computed yOffset and height
```

Greedy interval partitioning (sort by `startTime`, pack into minimum tracks where `start >= lastEnd` else new track) gives the classic DAW lane packing. The track index then maps to `top: rowBase + track*gap` and vertical order maps to `zIndex = arrayIndex`. Lower (later `arrayIndex`) → higher `zIndex` when in same horizontal interval.

---

## 4. Visual duration, bar widget math, and handle semantics

### 4.1 Bar geometry

```
let EPS = 1e-4
let rawVisual = clip.duration / Math.max(instance.speed, EPS)
let visualDuration = Math.max(MIN_BAR_DURATION, Math.min(rawVisual, slide.duration - instance.startTime))
leftPx  = (instance.startTime) * pps
rightPx = (instance.startTime + visualDuration) * pps
widthPx = visualDuration * pps
```

- `MIN_BAR_DURATION` ~ `FRAME_STEP (0.5s)` or `1/60` depending on grid. Clamp to avoid 0-width bars.
- `slide.duration - startTime` clamp prevents bars extending past the slide end (evaluator would hold, but UI should truncate).
- For `speed===0` or `clip.duration===0`, clamp as noted in 2.5.

### 4.2 Handle drag math (compare to `keyframeScale.ts`)

`keyframeScale.ts:258-346` defines the canonical selection-scale loop:

- Session captures `minTime`, `maxTime`, `isAlt`, `playheadTime`, `edge`; on move computes
  ```
  pivot = isAlt ? playhead : edge==='left' ? max : min
  denom = originalEdge - pivot
  newEdge = clamp(raw,0,duration)
  factor = (newEdge - pivot)/denom   // >0 guard, <1e-9 denom guard
  preview(t) = pivot + (t - pivot)*factor
  ```
- Snapping inside move uses `snapKeyframeTime(raw, {gridEnabled, keyframesEnabled, candidateTimes, pps})` `timelineSnapping.ts:62-78` (frame 0.5s grid vs keyframe threshold 5px).

For a single **clip bar** the same factor math applies but over the bar's interval:

**Right handle (trailing edge):**
```
pivot = startTime
origEdge = startTime + oldVisualDuration
newEdge = clamp(snapTime(raw), pivot + MIN, slide.duration)
factor = (newEdge - pivot) / (origEdge - pivot)
newSpeed = clip.duration / (newEdge - pivot)
newVisual = clip.duration / newSpeed
preview timeline: rightPx = newEdge * pps
commit: SetClipInstanceSpeed(nodeId, instanceId, newSpeed)  // + undo groups startTime unchanged
// alternative definition-rescale: clip.duration = newEdge - pivot and rescale keyframes; not recommended for Manager
```

**Left handle (leading edge):**
```
pivot = rightEdge = startTime + oldVisualDuration   // fixed
origEdge = startTime
newStart = clamp(snapTime(raw), 0, pivot - MIN)
factor = (pivot - newStart) / (pivot - origEdge)
newSpeed = clip.duration / (pivot - newStart)
newStartTime = newStart
commit: Transaction[ SetClipInstanceStartTime(..., newStartTime), SetClipInstanceSpeed(..., newSpeed) ]
```

Left handle therefore changes **both** `startTime` and `speed` to keep the right edge fixed (common DAW behavior). If the spec wants stretch-from-start (lengthen rightward), the "left handle" would instead be a move, not a resize — document which is intended before implementing.

**Move (whole bar drag):** like `useKeyframeDrag` `components/panels/keyframeDrag.ts` (not requested in ticket but sibling), compute `delta = newX/pps - dragAnchor`, set `newStart = clamp(origStart + delta,0, duration - visual)`, commit `SetClipInstanceStartTime`.

### 4.3 Snapping for bars

- `snapTimeToGrid(time, rulerTickStep(pps))` `timelineViewStore.ts:42-45` — used for playhead drag `TimelineBody.tsx:464,461-464`. Step varies with zoom (as low as 0.05s).
- `snapKeyframeTime` / `snapToFrameGrid` `timelineSnapping.ts:1-78` — used for keyframe drag/scale, grid step is fixed `FRAME_STEP=0.5` and threshold `KEYFRAME_SNAP_THRESHOLD_PX=5`.
- For bar handles, candidate times should include: grid boundaries, other instance `endTime`/`startTime`, collection `start/end`, visible/keyframe times. Pass them as `candidateTimes` to `snapKeyframeTime` or a new `snapClipEdgeTime(raw, { pps, snapToGrid, snapToClips, clipEdges })`. Keep grid snap threshold 5px consistent.

---

## 5. New row types needed

Minimal extension to `timelineTracks.ts`:

```ts
export interface ClipInstanceRowEntry {
  readonly kind: 'clipInstance'
  readonly node: SceneNode
  readonly instance: ClipInstance
  readonly clip: ClipDefinition
  readonly visualDuration: number
  readonly rowIndex: number   // within the Manager lane group
  readonly stackTrack?: number // for overlapping packing
}

export interface ClipCollectionRowEntry {
  readonly kind: 'clipCollection'
  readonly node: SceneNode // host object where collection assigned
  readonly collection: ClipCollection
  readonly startTime: number // derived from member instances or explicit lane time (TBD — spec says collection lane has its own stretch)
  readonly visualDuration: number
  readonly memberInstanceIds: readonly string[]
  readonly stackTrack?: number
}

export interface OrphanParamRowEntry {
  readonly kind: 'orphanParam' // param with keyframes but not in a clip, per spec validation surface
  readonly node: SceneNode
  readonly property: AnimationProperty | string // material/clip-like
  readonly depth: number
}

export type ManagerTimelineRow = ClipInstanceRowEntry | ClipCollectionRowEntry | OrphanParamRowEntry
  | { kind:'header', node: SceneNode } // e.g. per-child group header
```

`timelineRows` needs a new builder `managerTimelineRows(scene, expandedNodeIds, filter)` or a dedicated module `frontend/src/components/panels/managerTimelineRows.ts` to avoid coupling. It will query:
- `engine.getClip(clipId)` for `clip.duration/name`
- `node.clipInstances` for lanes
- `engine.getClipCollection` for collection rows (if collections are assigned to the parent object's lane vs per-node — needs product decision; today `ClipCollection` is library-level, not per-node assigned via `clipInstances`; see `clipCollection.ts` and `reusableObject.ts` pattern for binding persistence)
- `slide.animation.node(nodeId)` to detect orphan params for the validation banner.

---

## 6. Bar widget requirements (no widget exists today)

- New component `ClipBar` / `CollectionBar` in `frontend/src/components/panels/manager/` or inside `timelineComponents.tsx` alongside `KeyframeMarker` `timelineComponents.ts:157-194` and `SelectionScaleBox` `timelineComponents.ts:208-276`:
  - Props: `instance, clip, leftPx, widthPx, selected, zIndex, onPointerDownMove, onHandlePointerDown(left|right)`.
  - Handles mirror `SelectionScaleBox` handles `timelineComponents.tsx:238-273`: `HANDLE_WIDTH=6`, `cursor: ew-resize`, `pointerEvents: auto` on the handle `div`, `stopPropagation` on `pointerdown`.
  - Bar styling: name-only label (clip name), 14–20 px tall, rounded, border indicates enabled, drag affordance vs resize split.
  - Collection bar is visually heavier (header lane), spans the union of member visuals or its own `visualDuration`.
- Interaction wiring parallels `keyframeDrag`/`keyframeScale` hooks; a new hook `useClipBarDrag` / `useClipBarResize` should mirror `useKeyframeScale`'s session pattern `keyframeScale.ts:115-347`:
  - On `pointerdown` on handle, capture `session { instanceId, nodeId, origStart, origVisual, startTime, speed, edge }`.
  - On `pointermove`, compute `raw = timeFromClientX(clientX)` `TimelineBody.tsx:262-267`, apply snapping, derive `newSpeed`/`newStartTime`, call `setPreview(map)` for optimistic render.
  - On `pointerup`, dispatch a `Transaction` of the `SetClipInstance*` commands (see 7).
- No marquee for bars in v1; bars are larger hit targets than diamonds (8×10 px diamonds today).

---

## 7. Commands, undo grouping, and collection resize propagation

- **Per-instance move:** `SetClipInstanceStartTimeCommand` `frontend/src/engine/commands/setClipInstanceStartTimeCommand.ts` (params `{nodeId, instanceId, startTime}`) and `SetClipInstanceSpeedCommand` `setClipInstanceSpeedCommand.ts`. Both call `engine.setClipInstanceStartTime/Speed` `internal.ts:4352-4362` which mutate `instance.startTime/speed` and emit BUS events.
- **Per-instance reorder:** `MoveClipLayerCommand` `moveClipLayerCommand.ts` — one per vertical reorder.
- **Clip editor internal scale:** `MoveClipKeyframesCommand` / `ScaleClipKeyframesCommand` patterns via `clipManager.ts` — not for Manager lane resize.
- **Bar drag preview → commit:** Maintain a preview `Map<instanceId, {startTime, speed}>` during drag (like `scalePreview` `keyframeScale.ts:117`). On `pointerup`, dispatch. Use the existing `dispatch` plumbing from `useEngine` `TimelineBody.tsx:240`.
- **Collection resize:** No dedicated command exists. Implement `ResizeClipCollectionCommand` (new) or a `Transaction` that iterates members:
  ```
  for (const semantic of collection.bindings.keys()) {
    for (const node of subtreeMatching(semantic)) {
      for (const inst of node.clipInstances.filter(i => i.clipId===collection.bindings.get(semantic))) {
        newSpeed = clip.duration / (newCollectionVisual / oldCollectionVisual * oldInstanceVisual)
        // or uniform factor = newCollectionVisual/oldCollectionVisual across all members
      }
    }
  }
  ```
  The spec says "resize propagates to members, hidden internals" — so the collection lane's visual duration drives a uniform factor applied to each member instance's `visualDuration` via its `speed`. Collection lane's own persistence location is undecided (new field on `ClipCollection` assignment record vs per-node `clipInstances` envelope). Ticket the decision before implementing.
- **Undo grouping:** Wrap each gesture (move, left-resize, right-resize, collection stretch, reorder drop) in a Transaction so one Ctrl+Z undoes the whole handle interaction, matching `keyframeScale.ts:252-256` (`dispatchKeyframeCommands`) and transaction behavior in `internal.ts` transactions.

---

## 8. Snapping & validation gaps

- **Snapping:** Today keyframe drag uses `snapKeyframeTime` with `FRAME_STEP=0.5` and `snapToKeyframesEnabled`; playhead uses `rulerTickStep(pps)`-derived grid. For bars, unify on `FRAME_STEP` for consistency and add an `otherEdges: number[]` candidate list (other clip ends, collection edges, keyframe times). Expose `snapClipEdgeTime(raw, { pps, gridEnabled, otherEdges })`.
- **Validation (orphans vs semantic):** Spec's two blocking validations — "any keyframe not in a clip" and "any clipped object lacks `semanticName`" — have no code today. They are Manager-only checks. Implementation sketch:
  - Walk `slide.animation.nodes` + per-node `animation.node(nodeId).tracks` → collect all keyframe targets.
  - For each target, check if it is covered by a `ClipInstance` on that node (`clip.channels` contains the property) or by a `ClipCollection` binding on that semantic name. Uncovered → orphan row + banner.
  - For each `node.clipInstances`, check `node.semanticName?.trim() !== ''`; empty → collection-creation validation error.
  - Render as banners above the modal, not inline per lane.

---

## 9. Ordering persistence & lesson serialization

- Order persists as document order of `clipInstances` arrays `sceneNode.ts:123-174` and `json.ts:138`. No separate version field; migrations are not needed. Import (`.lesson` and `.lesson_object`) remaps ids and preserves order via `lessonSerializer.ts` and `reusableObject.ts` (`node.clipInstances` replay).

---

## 10. Concrete extension points (where to cut)

1. **`timelineTracks.ts`** — add `ClipInstanceRowEntry / ClipCollectionRowEntry / OrphanParamRowEntry` and new builder `managerTimelineRows` (or new file `managerTimelineRows.ts` that imports `ClipDefinition`/`ClipCollection` + `SceneNode`). Keep `timelineRows` unchanged for the main timeline.
2. **`timelineComponents.tsx`** — add `ClipInstanceBar` and `ClipCollectionBar` components next to `KeyframeMarker`/`SelectionScaleBox`. Reuse `HANDLE_WIDTH`, handle styles, `tickLabel` for tooltips.
3. **New `frontend/src/components/panels/manager/` module** — holds `ManagerTimelineBody` (filtered `rows`, stacked lane layout, bar render + handle wiring), `managerTimelineRows.ts`, `clipBarGeometry.ts` (`visualDuration(clip,speed)`, `barPx(...)`, `handleMath(...)`), `clipSnap.ts` (candidate edge collector + `snapClipEdgeTime`).
4. **`timelineViewStore.ts`** — optionally add `managerScrollTime/managerZoomLevel` or reuse global `zoomLevel/scrollTime`; decide before prototype. If modal is modal-only, scoping a local store prevents global timeline jumps.
5. **New hooks** `useClipBarDrag.ts` / `useClipBarResize.ts` — mirror `useKeyframeDrag`/`useKeyframeScale` session model, but drive `SetClipInstanceStartTime/Speed` commands and a preview map.
6. **New `ResizeClipCollectionCommand`** (or `StretchCollectionCommand`) — iterates bound instances, computes per-instance `newSpeed` from uniform collection factor, dispatches per-instance `SetClipInstanceSpeed` (and optionally `SetClipInstanceStartTime` for anchored stretches).
7. **`internal.ts` Clip-instance methods** — no change needed for per-instance resize; for collection assignment, potentially add `assignCollectionInstance(parentId, collectionId, startTime, speed)` that materializes per-node instances per binding (id remapping via `reusableObject` logic). Clarify whether a collection lane is a real instance or a virtual header — research suggests virtual header with propagation.
8. **`clipCollection.ts` + `reusableObject.ts`** — ensure export/import of subtree + hierarchy + clips/collections self-contained pattern matches spec's portability requirement.

---

## 11. Open risks / product decisions needed before building

- Does a collection lane store its own `startTime/speed` independently, or is it derived as the union of member visuals? Spec says "resize propagates to members, hidden internals" — the research recommendation is to store collection lane's anchor and scale separately and apply as a factor, leaving members hidden until expanded.
- Does left-handle resize preserve the right edge (anchor-right) or stretch symmetrically? Recommendation: anchor-right (fixed end) — most predictable for layering.
- Should `speed=0` be reachable from the handle? Recommendation: floor at `EPS` and map to disabled for pause.
- Where does the Manager's "assignments live" for objects with many collections — per-node `clipInstances` already holds them; the dropdown assignment picker persists via `assignClipInstance` / `assignCollection` (new). Document import merge strategy for duplicate semantic names.

---

*File references are pinned to `frontend/src/components/panels/timelineTracks.ts`, `TimelineBody.tsx`, `timelineComponents.tsx`, `timelineViewStore.ts`, `keyframeScale.ts`, `ClipEditBody.tsx`, `frontend/src/engine/clipDefinition.ts`, `clipInstance.ts`, `clipCollection.ts`, `animationEvaluator.ts:1050-1151`, `internal.ts:4298-4350`, `commands/moveClipLayerCommand.ts`, `clipExtraction.ts`, `sceneNode.ts:50-174`, `json.ts:400-414`, `lessonSerializer.ts:849-862` as reviewed above.*
