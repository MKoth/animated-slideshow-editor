# Research: Control & Clip Lane Interval Patterns and Evaluator Reuse for Normalized Blocks

**Ticket:** #339 — Research: Control & Clip Lane interval patterns and evaluator reuse for normalized blocks  
**Map:** #338 — Control Interval Blocks and Hierarchical Blend Groups  
**Branch:** `research/control-interval-blend-reuse`  
**Date:** 2026-09-14  
**Status:** Facts only, no design decision

---

## 1. Control data model — current facts

**`frontend/src/engine/control.ts:15-24`**
```ts
export interface Control {
  readonly id: string
  readonly key: string
  readonly label: string
  readonly min: 0
  readonly max: 1
  readonly default: number
  readonly exposed: boolean
  readonly bindings: Readonly<Record<string, string>> // semanticName → clipId
}
export interface ControlSet {
  readonly id: string
  readonly hostNodeId: string
  readonly controls: readonly Control[]
}
```
- `CONTROL_KEY_PATTERN` at `control.ts:13` = `^[A-Za-z][A-Za-z0-9_.]*$`, per-ControlSet unique via `validateControls:70-80` (block-on-duplicate, same as Unique Name).
- `bindings` mirrors `ClipCollection.bindings` (`clipCollection.ts:12` `Record<string,string>`) — broadcast by `semanticName`. No per-property array, no `ControlBinding` entity (ADR 0010 §2).
- `createControl:32-54` defaults `min=0,max=1,default∈[0,1]`, `exposed=false`, copies `bindings`.
- `evaluateControlTrack:143-161` in same file: `enabled = filter(!disabled)`, hold-before-first/after-last, `evaluateSegment(from,to,time)` between. Value domain `[0,1]` (checked in `controlTrackKeyframeFromJSON:163-187`).

**Persistence of definition** — `control.ts:82-97` `controlSetToJSON` and `controlSetFromJSON:99-141` (tolerant: skips bad controls via try/catch, `continue`, then `validateControls`). `sceneNode.ts:153` embeds `controlSet` inside `NodeJSON` (`json.ts:149` `controlSet?: ControlSetJSON`). `json.ts:152-167`:
```ts
export type ControlJSON { id,key,label,min,max,default,exposed,bindings }
export type ControlSetJSON { id,hostNodeId,controls: ControlJSON[] }
```
`validateReusableObject:102-132` checks `controlSet.controls` array, per-key pattern, duplicate key, `min/max===0/1`, bindings object.

**v1 invariant still holds:** `min=0,max=1` identity, arbitrary ranges deferred (ADR 0010 §3). Extending to arbitrary `min/max` is non-breaking (`u = (value-min)/(max-min)`).

---

## 2. Evaluator reuse path — `controlValue → u → effectiveU → #evaluateClipChannel`

### 2.1 Entry: `#forEachControlClip` and `#applyControls`

**`frontend/src/engine/animationEvaluator.ts:1235-1268` `#forEachControlClip`:**
```ts
#forEachControlClip(node,time,callback){
  if(node.semanticName===undefined) return
  hosts = collect host.parent chain where host.controlSet exists // parentAfterChildren not sorted here — iteration is hosts in tree order (nearest parent first) but hosts array is built nearest→ancestor
  for each host in hosts:
    animation = slideLookup(node.id).animation.node(host.id) // host's NodeAnimation
    for each control in host.controlSet.controls (order = Priority, later wins):
      clipId = control.bindings[node.semanticName]
      clip = clipLookup(clipId) // throws → skip
      track = animation.controlKeyframes(control.key) // Map<controlKey,Keyframe[]>
      value = clamp(evaluateControlTrack(track,time,control.default), control.min, control.max)
      range = control.max - control.min
      u = range===0?0: clamp((value-control.min)/range,0,1) // v1 identity clamp(value,0,1)
      callback(clip,u)
}
```

**`animationEvaluator.ts:1211-1233` `#applyControls(node,time,scratch)`:**
```ts
#applyControls(node,time,state){
  this.#forEachControlClip(node,time,(clip,u)=>{
    for(channelDef of clip.channels){ // ClipDefinition.channels: readonly ClipChannelDef[] at clipDefinition.ts:281
      if(channelDef.materialParameter) continue // material handled separately
      channelAnimation = clip.channelAnimation(channelDef.property)
      enabled = enabledKeyframes(channelAnimation.keyframes()) // 1218
      if(enabled.length===0) continue
      kfValue = #evaluateClipChannel(enabled, effectiveUForClip(clip,enabled,u)) // 1220-1222
      base = #getChannelValue(scratch,channel)
      output = paramKey ? (linkMode==='offset'? base+param*kfValue : base*param*kfValue) : kfValue
      #setChannelValue(state,channel,output) // last-wins across controls
    }
  })
}
```
- Order: `evaluateNode:190-220` does `base NodeAnimation → #applyClipInstances → #applyControls` (ADR 0011 §1, CONTEXT.md § Control Track / Priority). Nested hosts: `#forEachControlClip` walks `node.parent` chain; ADR 0011 §5 specifies parents-last (ancestor wins). Current code builds `hosts` nearest→ancestor and iterates in that order — **later iteration = ancestor**, so ancestor does win via last-wins write. The comment at `1211` says "Nearest hosts run first so ancestors win."

**Other control-driven evaluators reuse same callback:**
- `#applyControlMaterialOverrides:1270-1306`, `#applyControlShadowLayers:1308-1320`, `evaluateMorphValue:593-604`, `evaluateMorphVertices:657-669`, `evaluateCircle:1069-1076`, `evaluateTable:1125-1131`, `evaluateSymmetryValue:683-687`, `evaluateMaterialOverrides:1008-1009` — all call `#forEachControlClip` then `enabledKeyframes` → `effectiveUForClip` → `#evaluateClipChannel` / morph equivalents.

### 2.2 Helpers shared verbatim

**`enabledKeyframes:38-48`** — filters `kf.disabled===true` (session-only grey preview, `animationManager.ts:322` `setKeyframeDisabled`). If no disabled, returns original array (no copy). Empty after filter → caller falls back.

**`effectiveUForClip:51-63`:**
```ts
function effectiveUForClip(clip,keyframes,u){
  if(clip.isReversed && isParametricKeyframes(keyframes)) return 1 - u
  return u
}
```
- `isParametricKeyframes:33-36` checks `isParametricInterpolation(kf.interpolation)` — only parametric family (`bounce|elastic|spring`, see `keyframe.ts`) flips. `hold|linear|bezier` unaffected by `isReversed` (bezier reversal is baked by tanget swap on `Reverse and Save`, not by `1-u`). `isReversed` is `ClipDefinition.isReversed` (`clipDefinition.ts:245-251`).

**`#evaluateClipChannel:1425-1445`:**
```ts
#evaluateClipChannel(keyframes,u){
  if(u<=first.time) return first.value
  if(u>=last.time) return last.value
  for i: if(u>=from.time && u<to.time && to.time>from.time) return evaluateSegment(from,to,u)
  return last.value
}
```
- `evaluateSegment` handles `hold|linear|bezier|parametric` via interpolators registry. Same for every channel type.

**`evaluateControlTrack:143-161`** already does `enabled` filter, hold edges, `evaluateSegment` between.

### 2.3 ClipDefinition normalized constraint

**`clipDefinition.ts:164-192` `fromJSONWithValueValidator`:**
- `time` must be finite, `0≤time≤1`, strictly increasing, distinct except duplicate `1` allowed. `previousTime` tracking enforces sort.
- `clipDefinition.ts:220-243` `ClipDefinition` holds `duration:number`, but clipDefinition time validation is independent of `duration`. `clipDefinition.ts:735` `fromJSON` allows `duration>=0`.
- **Duration convention:** Normalized clips are created with `duration=1` (see `control.test.ts:44-46`, `clipCommands.test.ts:61`), and ADRs 0010-0011 describe `duration=1` reuse. However, `reusableObject.ts:222` removed the `control clip must have duration=1` check (verified in `control.test.ts:106-151` “allows any duration clips referenced by Controls (e.g. 9s timeline clips)”). So a Control may currently reference a `duration=9` clip whose keyframe times are still `[0,1]` — `duration` is ignored for controls (`#forEachControlClip` never divides by `clip.duration`). Time-based `ClipInstance` still uses `u = ((time-startTime)*speed)/duration` at `animationEvaluator.ts:1169-1172`; controls do not.

**Implication for intervals:** clip time normalization already decouples `clip.duration` from `u`. Intervals should not reintroduce `clip.duration/speed`.

---

## 3. ClipInstance / Collection Lane interval → Priority and Stretch precedent

### 3.1 Priority (CONTEXT.md:225 + ADR 0011)

- `Priority` = vertical stacking order; lower lane = higher Priority, wins on overlap via last-wins `for(... instances) { state = kfValue }`.
- For `ClipInstance`: `animationEvaluator.ts:1145-1209` `#applyClipInstances` iterates `node.clipInstances` in stored order; later overwrites earlier per property.
- For Controls: `controlSet.controls[]` order is Priority (ADR 0011 §3). Later control wins per property via sequential `#setChannelValue` in `#applyControls`.
- For nested rigs: hosts evaluated deepest-first, ancestor wins (ADR 0011 §5).

### 3.2 Stretch via speed (CONTEXT.md:222)

- User “Stretch/Condense” = drag lane edge → visual duration change → engine adjusts `ClipInstance.speed`, not clip definition (CONTEXT.md § Stretch).
- `animationManagerModel.ts:373-387`:
  ```ts
  visualDurationForClip(clip,instance){
    effectiveSpeed = max(speed, MIN_CLIP_SPEED=1e-4)
    return max(clip.duration/effectiveSpeed, MIN_VISUAL_DURATION=0.25)
  }
  clampedSpeedForVisual(clipDuration, visualDuration){ return clipDuration / max(visualDuration,0.25) }
  barGeometry(start,visual,pps){ return {left:start*pps, width:visual*pps} }
  ```
- `animationManagerModel.ts:414-483` `packClipLanesForNode`: greedy interval packing by `start` then original index; overlapping intervals stack into `track`s; `track` = Priority, `zIndex=track`, lower track wins visually. Preview overrides via `Map<instanceId,{startTime,speed}>`.
- Collection Lanes (`animationManagerModel.ts:526-674`): `visualDurationForCollectionPlacement` = `max_i(clip.duration/speed)` over members sharing `placementId`; packing identical greedy.

**What intervals borrow:** drag/resize → `[start,end]` proportional width within `[0,1]` domain; reorder → Priority; greedy packing for visualization; `speed` is **not** reused for controls (ADR 0011 §4: skip `isClipInstanceActive` and `speed`).

### 3.3 Timeline handling constants

- `animationManagerModel.ts:367-371`: `MIN_VISUAL_DURATION=0.25`, `MIN_CLIP_SPEED=1e-4`, `CLIP_HANDLE_WIDTH_PX=6`, `CLIP_LANE_HEIGHT_PX=28`. Controls ignore these for evaluation but can reuse for UI.

---

## 4. Persistence — `controlSet` + `controlTracks`

### 4.1 NodeAnimation map

**`nodeAnimation.ts:54`** `readonly #controlTracks = new Map<string, Keyframe[]>` keyed by `Control.key`.
- Accessors `56-93`: `controlKeyframes(key)`, `controlTrackKeys()`, `hasControlTrack`, `addControl`, `removeControl`, `controlTracksJSON:76-93`.
- `copy:558-563` deep copies via `copyKeyframe`.
- `fromJSON:766-798` tolerant additive load inside `NodeAnimation.fromJSON`:
  ```ts
  if(Array.isArray(controlTracks)){
    for(rawTrack of controlTracks){
      if(!isRecord(rawTrack) || typeof rawTrack.key!=='string' || !Array.isArray(rawTrack.keyframes) ||
         !node.controlSet?.controls.some(c=>c.key===rawTrack.key)) { warn+continue }
      // dedupe ids/times, then controlTrackKeyframeFromJSON(rawKeyframe,duration) per keyframe; skip undefined/dup
      animation.addControl(rawTrack.key, keyframe)
    }
  }
  ```
  - Skips unknown `key` (no matching `Control` in `node.controlSet`) — analogous to clip morph fallback.
  - Per-keyframe `controlTrackKeyframeFromJSON:163-187` validates `time∈[0,duration]`, `value∈[0,1]` finite, interpolation/tangents, `disabled`.

**`slideAnimation.ts:239-246` `clampKeyframesTo(duration)`** loops `controlTrackKeys()` → `controlKeyframes` → `keyframe.time>duration ⇒ duration`, pushing `{nodeId,controlKey,keyframeId,oldTime}`.

**`slideAnimation.ts:265,278,293` `toJSON`** emits `controlTracks` only when `controlTracks.length>0`, alongside `tracks/materialTracks/...`.

**`json.ts:184-187` `ControlTrackJSON`** `{key:string,keyframes:KeyframeJSON[]}` matches `materialTracks`/`shadowTracks` array-of-objects shape (ADR 0012 §5, rejected `Record<string,Keyframe[]>`).

### 4.2 Definition vs instance split (ADRs 0010/0012/0014)

- **Definition:** `NodeJSON.controlSet` (embedded snapshot, `sceneNode.ts:153` `toJSON`, `222` `fromJSON` via `controlSetFromJSON`). Survives copy/duplicate via `copyNodeDeep`/`cloneMeshData` shape-id remap; `bindings` reference `clipId` remapped via clip-id map on `ReusableObject` import.
- **Instance:** `SlideAnimationJSON.nodes[].controlTracks` per slide, seconds-based, `hold|linear|bezier`+`disabled` (ADR 0012).
- `.lesson` self-containment rides existing `library.clips` snapshots; `ReusableObjectJSON.library.clips` snapshots referenced normalized clips (no new top-level `controls` array, ADR 0014 §2).

---

## 5. Morph specifics needed for blend

### 5.1 Data model

**`shape.ts:1-78`**:
- `Shape {id,name,categoryId,vertices:MeshVertex[]}` lives inline in `MeshComponent.shapes` (`sceneNode.ts:320-398`), not library. `faces/uvs/boneWeights/bindPose` stay on `mesh` (topology frozen, `validateShapesInvariant:67-78` checks `shape.vertices.length===mesh.vertices.length` else soft-warn + fallback).
- `MorphBinding` (`shape.ts:82-85`): `{fromShapeId:string|null,toShapeId:string|null}` — **node-local**, not in clip (ADR 0010 §2, ADR 0014). Legacy `NodeAnimation.morphBinding` deprecated; per-keyframe `MorphKeyframeValue` now owns binding.
- `MorphKeyframeValue` (`shape.ts:92-96`): `{fromShapeId,toShapeId,coefficient:0..1}`. `MorphClipKeyframeValue` (`shape.ts:98-102`): `{fromShapeName,toShapeName,coefficient}` — name-based for clip portability, resolved at eval via `animationEvaluator.ts:852-871` `#resolveClipValueToNode` (find by `name` in `shapes`, missing → `null` → fallback to base).
- Helpers: `lerpVertex:104-106` `a+(b-a)*t`; `resolveMorphedVertices:114-151` absolute lerp `lerp(from.vertices[i], to.vertices[i], clamp(coeff,0,1.5))`; `resolveMorphedVerticesFromKeyframe:261-271`; `resolveCrossBlendedVertices:279-303` (see 5.2); validators `requireMorphKeyframeValue:183-213`, `requireMorphClipKeyframeValue:215-245`.

**`clipDefinition.ts:799-925`** morph port: `#morphAnimation: ClipChannelAnimation`, `morphAnimation():ClipChannelAnimation`, `getMorphKeyframes`, `hasMorphTrack`, legacy JSON supports `fromShapeName/toShapeName/coefficient` or `fromShapeId/toShapeId` fallback.

### 5.2 Morph evaluation paths (what blend will reuse)

**`animationEvaluator.ts:593-604` `evaluateMorphValue`** and **`612-669` `evaluateMorphVertices(baseVertices,shapes)`:**
- Base: `#evaluateMorphKeyframes` / `#evaluateMorphVerticesForTrack` (enabled filter, hold before/after, `resolveMorphedVerticesFromKeyframe` or `resolveCrossBlendedVertices` with `eased u` via `#easedProgress:947-961` using synthetic `evaluateSegment` on `0→1` then `clamp(0,1)`).
- ClipInstances: loop in order, `u=((time-startTime)*speed)/duration` clamped `[0,1]`, then `effectiveUForClip` → `#evaluateMorphClipKeyframes` / `#evaluateMorphClipVertices` (name→id resolve, then same vertex resolvers). Last-wins.
- Controls: `this.#forEachControlClip(node,clampedTime,(clip,u)=>{ enabled=enabledKeyframes(...); controlMorphed=#evaluateMorphClipVertices(enabled, effectiveUForClip(clip,enabled,u), baseVertices, shapes); if(controlMorphed) morphed=controlMorphed })` at `657-668` (values path `593-603` similar with `#evaluateMorphClipKeyframes`). **MorphBinding stays node-local**; clip stores names, node stores ids+coefficient; missing shape → `resolveMorphedVertices:133-141` soft-warn `"[morph] Missing shape id … — falling back to base"` and returns `baseVertices`.

**Delta vs absolute:** Shapes are **absolute snapshots** (ADR 0007), not deltas. `resolveMorphedVertices` does `lerp(from,to,coeff)` on absolute positions. `resolveCrossBlendedVertices:279-303`:
- If same binding `(fromA===fromB && toA===toB)`: `coeff=lert(c0,c1,u)` then single `resolveMorphedVertices`.
- Else: `geom0=resolveMorphedVerticesFromKeyframe(base,fromVal)`, `geom1=...toVal`, then per-vertex `lerpVertex(geom0[i],geom1[i],u)` (with `baseVertices` fallback for null entries). This second branch is what **hierarchical blend** will generalize: blend needs per-vertex `lerp` between group accumulated result and next group, not coefficient interpolation, because bindings differ.

**Soft-warn paths:** `shape.ts:122-141` incomplete binding → warn+fallback; stale `categoryId` remap in `sceneNode.ts:379-392`.

---

## 6. Minimal diff surface for per-binding `[start,end] ⊆ [0,1]` intervals

### 6.1 Goal

Extend **one `Control` → N `bindings[semanticName]=clipId`** to **per-binding interval** `controlValue t ∈ [start,end]` maps to clip `u'` via
```
u' = clamp( (u - start) / (end - start), 0, 1)   where u = clamp(controlValue,0,1)
```
without forking clip time logic (`ClipDefinition` time validation stays `[0,1]`, `duration=1` reuse stays, `effectiveUForClip`/`#evaluateClipChannel` stay shared). Blocks behave like Clip Lanes: left=0 right=1, resize/reorder via Priority, last-wins stacking before blend.

### 6.2 Type-level seam (definition data, on `Control` binding, not keyframed — standing preference)

Current:
```
Control.bindings: Record<string, string>  // clipId
```
Required (backward-tolerant):
```
ControlBindingInterval { clipId: string, start: number, end: number } // ⊆[0,1], start<end
Control.bindings: Record<string, string | ControlBindingInterval>  // or new field `bindingIntervals: Record<string,{start,end}>`
```
- **Preferred seam:** change value type to union `string | {clipId,start,end}` and normalize in `controlSetFromJSON` (old `string` → `{clipId,start:0,end:1}`) to keep additive load. Alternative: parallel `intervals: Record<semanticName,{start,end}>` avoids union but duplicates map keys.
- **Files to touch:**
  - `frontend/src/engine/control.ts:15` `Control` interface, `32-54` `createControl`, `70-80` `validateControls` (validate `0≤start<end≤1`, `start!==end`), `82-97` `controlSetToJSON`, `99-141` `controlSetFromJSON` (tolerant: bad interval → default `0,1` or drop binding with warn).
  - `frontend/src/engine/json.ts:152-167` `ControlJSON.bindings` type widens to `Record<string, string | {clipId:string,start:number,end:number}>` or new shape; validator `reusableObject.ts:102-132` extends interval check.
  - `frontend/src/engine/sceneNode.ts:153,222` auto-covered via `controlSetToJSON/FromJSON`.

### 6.3 Evaluator seam — where `u'` fits in the existing `u` path

**Do NOT fork** clip time validation or duplicate `#evaluateClipChannel`. Insert remap **inside** the existing `u` computation, before `effectiveUForClip`:

Current `#forEachControlClip:1260-1265`:
```ts
value = evaluateControlTrack(track,time,default)
u = clamp((value-min)/(max-min),0,1)
callback(clip,u)
```

Interval extension (minimal):
```ts
// inside loop per binding after resolving clipId+interval
const interval = normalizeBindingInterval(control.bindings[semanticName]) // {clipId,start,end} with defaults 0,1
const rawU = clamp((value-min)/(max-min),0,1)
let mapped: number
if (rawU < interval.start || rawU > interval.end) {
  // outside interval: either skip (no write) or clamp — spec decides last-wins stacking semantics
  // For last-wins Priority before blend: skip → fall through to next-lower Priority binding that does contain u
  mapped = -1 // sentinel = inactive
} else {
  const span = interval.end - interval.start
  mapped = span < 1e-9 ? 0 : clamp((rawU - interval.start)/span, 0, 1)
}
const effU = effectiveUForClip(clip, enabled, mapped)
callback_with_mapped_u // or skip if sentinel
```

- **Shared-path invariant:** `effectiveUForClip(clip,enabled,u')` and `#evaluateClipChannel(enabled, effU)` stay verbatim; `clipDefinition.ts:164` `[0,1]` validation unchanged because `u'` is still `[0,1]` after clamp.
- **Per-channel variant:** If `u'` is computed per-clip (one `u` per leaf clips share same control value), compute once per `callback` and reuse across `clip.channels` loop in `#applyControls:1214-1231` (and parallel in `#applyControlMaterialOverrides`, `evaluateMorphVertices`, etc.). No per-property interval needed — one interval per `semanticName` binding suffices (one clip per descendant, may have multiple channels but same time base).
- **Reuse all other evaluator entry points:** `evaluateMorphClipVertices:910-945`, `evaluateCircle:1071-1073`, `evaluateTable:1127-1129` etc. already call `effectiveUForClip` with `u` from `#forEachControlClip` — same `u'` flows.

**Alternative seam considered and rejected:** add `isIntervalActive(u,start,end)` guard parallel to `isClipInstanceActive` — but controls are “always active” per ADR 0011 §4; interval inactivity should be handled as “skip this binding” not as global control inactivity, to allow lower-priority bindings to still contribute when u is outside higher-priority interval.

### 6.4 Persistence / migration seam

- `nodeAnimation.ts` / `slideAnimation.ts` / `controlTracks` untouched — intervals are **definition data** (per `Control` binding), not keyframed (standing preference #338). No change to `NodeAnimation.controlTracks:54`, `controlTracksJSON:76`, `slideAnimation:239/265`, `json ControlTrackJSON:184`.
- Tolerant load: old `.lesson` / `.lesson_object` with `bindings:"clipId"` (string) loads as `start=0,end=1`; validator `controlSetFromJSON:114-117` already skips bad `clipId`, extend to also default interval. No version bump (ADR 0014 §4 pattern).

### 6.5 UI / Priority seam (no evaluator change, but facts for later spec)

- Reuse `animationManagerModel.ts:414-483` greedy packing for visualization of interval blocks within `[0,1]` domain: map `start→left=start*ppsNormalized`, `width=(end-start)*pixels`. Absolute clip durations are already normalized to `[0,1]` (clip time axis `[0,1]`), then stretched to block’s proportional width via `u'` remap — no `speed` involved.
- Drag → update `start`/`end`; resize edge → update one bound; reorder → mutate `ControlSet.controls[]` order or per-binding sort key (spec says intervals inside same group compose via Priority — last-wins — but whether multiple bindings of same Control share one Priority list or per-control dispatch order is open; current code has single per-Control dispatch, but intervals of one Control overlapping at same `u` need intra-Control Priority — simplest: `bindings` insertion order defines win order, or add explicit priority array).
- `packClipLanesForNode` pattern can be adapted to `packControlIntervalBlocks` for the `Editing Control: Name 0…1` drill-in panel prototype `#333`.

---

## 7. Assumptions that would block `u' = (u - start)/(end - start)` — flagged

| # | Assumption / risk | Why it blocks | Current evidence | Mitigation seam |
|---|-----------------|---------------|------------------|-----------------|
| 1 | **Zero-width interval** (`end-start≈0`) → divide by zero / NaN | `u'` would be Inf/NaN, then `effectiveUForClip`/`#evaluateClipChannel` would return last value or throw on `evaluateSegment` | `clipDefinition.ts:177` rejects duplicate time (distinct times) but not interval span; `validateControls` not yet checks span | Guard `if(span<ε) mapped=0 or skip binding`; validator `control.ts:70` must enforce `end-start≥ε` (e.g. `1e-6`) |
| 2 | **`u` outside `[start,end]` semantics undefined** — skip vs clamp | If clamped, u at `0.2` with interval `[0.6,1]` would still produce `0` and drive clip at its start, violating lane “inactive” intuition; if skipped, ancestor-wins across controls still holds but intra-Control last-wins needs definition | ADR 0011 §3 last-wins, but intervals inside same `Control` not yet specified (map **Not yet specified → Additive vs lerp vs Priority within a group**) | Spec must lock: recommend skip (no write) and let next-lower Priority binding win; only clamp after inside-interval remap. Flag for grilling ticket. |
| 3 | **`effectiveUForClip` gating on parametric** — `isReversed` flip only for parametric family | If `u'` clamped outside then `1-u'` would be wrong for parametric after remap; but remap before `effectiveUForClip` keeps it correct (verified: `effectiveUForClip:51` flipped after interval map) | `animationEvaluator.ts:51-63` checks `isParametricKeyframes(keyframes)` on clip’s own keyframes, not control track | No block if `u'` computed **before** `effectiveUForClip` (as in §6.3). Document order: `rawU → u' → effectiveU`. |
| 4 | **Gain/offset composition assumes absolute or gain/offset, not additive blend** | Intervals that “stack” via last-wins overwrite `base*param*kfValue` vs `base+param*kfValue`; if intervals are blended later (Blend groups), gain path would double-apply base | `animationEvaluator.ts:1225-1229` `base = #getChannelValue(...)` per Control in order | No block: intervals keep last-wins (`#setChannelValue` overwrite); blend ticket will introduce explicit `lerp` between group results, not inside this `u'` path. Keep interval seam pure remap. |
| 5 | **`enabledKeyframes` before `effectiveUForClip`** — disabled filtering on clip keyframes | If `u'` remap incorrectly used clip’s `enabledKeyframes` length to decide span, disabled keyframes would affect interval extent | `animationEvaluator.ts:1218-1222` filters before `effectiveUForClip` correctly | No block: filter stays on clip keyframes; interval does not depend on keyframe count. |
| 6 | **Duration decoupling** — control clips may have `duration≠1` (now allowed `control.test.ts:106`); `duration` ignored for controls | If future author edits clip duration in library, interval `[0,1]` axis could drift vs clip’s `[0,1]` time if duration were misused | `animationEvaluator.ts:1235` no longer checks `clip.duration<0` only; `#forEachControlClip` does not use `clip.duration` at all | No block: keep ignoring `clip.duration` for controls; intervals measured in normalized `u` domain, not seconds. |
| 7 | **Morph vertex-cache cost** — per-frame `resolveMorphedVertices` allocates `MeshVertex[]` | Adding intervals does not increase vertex work, but blend’s per-group `lerp(posA,posB,blend)` will multiply allocations if naïvely called per leaf per frame | `shape.ts:146-151,279-303` allocate new arrays; `animationEvaluator.ts:657` assigns `morphed=controlMorphed` last-wins | Flag for blend ticket: need scratch-vertex reuse or cache; intervals alone do not worsen. |

---

## 8. Blend group interpolation — facts staged for next ticket (no decision)

- **Goal per map #338:** partition `Control.bindings` into N ordered groups; each added group beyond first introduces renamable `Blend` Control `0…1` exposed/keyframeable; interpolation `result₁₂=lerp(G1,G2,blend₁)`, `result₁₂₃=lerp(result₁₂,G3,blend₂)`, absent properties untouched, per-vertex morph deltas interpolatable.
- **Morph facts to interpolate:** As §5, shapes are absolute snapshots; group evaluation produces per-leaf vertex array via `resolveMorphedVertices` or already-evaluated `morphed`. Blend must per-vertex `lerp` (like `resolveCrossBlendedVertices:296-302` `lerpVertex(a,b,u)`), not coefficient lerp, because bindings differ. `MorphBinding` stays node-local; blend result is a vertex array fed to `evaluateMeshDeformation` as `mesh.vertices` substitute (morph-then-bones, `shape.ts:109-113`).
- **Reuse seam for blend:** Separate from `u'` — blend interpolates **outputs** (evaluated property values + vertex arrays) across groups, not `u`. Intervals interpolate **input** `u`. Order: `rawU → u'_interval → clipEval → per-group last-wins → lerp(groups, blend)` . No shared math beyond `lerpVertex`/`lerpHexColor` (`animationEvaluator.ts:429,517`) and `evaluateSegment` patterns.
- **Open fog (not blocking intervals):** additive vs lerp vs Priority within a group; multi-input 2D; performance cache — left to map’s `Not yet specified`.

---

## 9. Code anchors index

| Concern | Anchor(s) |
|---------|-----------|
| Control type, key pattern, bindings | `control.ts:13`, `15-24`, `32-54`, `70-80`, `99-141` |
| Control Track keyframes | `control.ts:143-187`, `nodeAnimation.ts:54-93`, `766-798` |
| Evaluator control path | `animationEvaluator.ts:38-63`, `1211-1268`, `1270-1320` |
| effectiveU, enabledKeyframes, evaluateClipChannel | `animationEvaluator.ts:38-48`, `51-63`, `1425-1445` |
| ClipDefinition [0,1] validation, duration | `clipDefinition.ts:164-192`, `220-243`, `735-743` |
| ClipInstance active/speed | `animationEvaluator.ts:65-78`, `1145-1209`, `1169-1172` |
| Clip/Collection lane geometry, packing, Priority | `animationManagerModel.ts:364-483`, `526-674` |
| Persistence (NodeJSON, SlideAnimation, Lesson) | `json.ts:152-187`, `216,253`, `sceneNode.ts:153,222`, `slideAnimation.ts:74-79,239-298` |
| ReusableObject validation | `reusableObject.ts:102-294` |
| Morph shapes, Binding, lerp, resolvers | `shape.ts:1-78,82-106,114-151,183-303` |
| Morph clip eval | `animationEvaluator.ts:593-604,612-669,852-945` |
| Shadow/circle/table/material control paths | `animationEvaluator.ts:1008-1320` |
| Docs | `CONTEXT.md:222-266`, `docs/adr/0010-0014`, `docs/adr/0007-0008` |

---

## 10. Verification

- Read `control.ts:1-187`, `animationEvaluator.ts` full (1-1470), `clipDefinition.ts:149-192,220-267`, `nodeAnimation.ts:54-798`, `json.ts:152-253`, `shape.ts:1-303`, `animationManagerModel.ts:364-731`, `sceneNode.ts:153-224`, `reusableObject.ts:102-294`, `clipManager.ts:601-614`, `slideAnimation.ts:74-333`, `control.test.ts:106-151`, ADRs 0010-0014, CONTEXT.md Controls/Priority.
- Confirmed `effectiveUForClip` flip only for parametric (`animationEvaluator.ts:51-58`).
- Confirmed `reusableObject.ts:222` no longer forbids `duration≠1` for control clips; `control.test.ts:149` asserts `expect(errors).not.toContain('Control clip ... must have duration 1')`.

---

*End of findings — ready for grilling ticket; intervals seam is `control.ts:15` bindings value + `animationEvaluator.ts:1235` u remap before `effectiveUForClip`; morph blend needs per-vertex `lerpVertex` (§5.2).*
