# Research: ClipDefinition & animationEvaluator reuse for normalized value→time evaluation

**Ticket:** [Research: ClipDefinition & animationEvaluator reuse for normalized value→time evaluation](https://github.com/MKoth/animated-slideshow-editor/issues/330) — part of [Wayfinder Map: Parametric Controls for Reusable Rigs](https://github.com/MKoth/animated-slideshow-editor/issues/328)
**Branch:** `research/evaluator-reuse` — this file
**Date:** 2026-09-12

## Question

Can the existing clip evaluator pipeline be reused verbatim for Controls by mapping `controlValue ∈ [min,max] → u ∈ [0,1] → evaluateClip(clipId, u)`, without forking interpolation logic for hold/linear/bezier/parametrics, morph name-resolution, or shadow/circle/table/material channels?

## Answer

**Yes — verbatim reuse.** Every channel already evaluates via a normalized `u ∈ [0,1]` that is the divisor output `u = ((time - startTime) * speed) / duration` (`frontend/src/engine/animationEvaluator.ts:1107`). Fixing `duration=1` and substituting `u = normalize(controlValue,min,max)` (identity `u=clamp(controlValue,0,1)` in v1) reuses all interpolation, reversal, name-resolution, and material/shadow paths unchanged. No `isControlClip` flag, no second evaluator path, no new sidecar for normalized clip keyframes. Controls must ignore `isClipInstanceActive` and `speed`/`Stretch` (value is not time; always active) and supply `controlValue → u` per frame.

---

## 1. ClipChannelAnimation time validation [0,1] — already correct for normalized clips

- `ClipChannelAnimation.fromJSONWithValueValidator` validates every keyframe time in `[0,1]` at `frontend/src/engine/clipDefinition.ts:163-166`:
  ```ts
  const time = requireFiniteNumber(record.time, `Clip keyframe "${id}" time`)
  if (time < 0 || time > 1) throw new Error(`Clip keyframe time must be within [0, 1]`)
  ```
  This is shared by all `ClipChannelAnimation` instances, including `visibleAnimation`, `circleChannelAnimations`, `morphAnimation`, `shadowChannelAnimations`. Any `duration=1` clip the Controls authoring creates passes without change; `duration` is not validated against keyframe times.
- `ClipDefinition.fromJSON` at `frontend/src/engine/clipDefinition.ts:670-724` mirrors the same validator for `channelAnimations` (`ClipChannelAnimation.fromJSON` at `:730`), `materialChannelAnimations` at `:735`, `visibleAnimation` (boolean value validator at `:743-761`), `circleChannelAnimations` at `:763-773`, `morphAnimation` (number-or-name object validator at `:774-841`), `shadowChannelAnimations` (per-property kind + tolerant clamp at `:843-909`). All branches call the `[0,1]` validator — no per-type exception.
- `duration` is a free `finite number ≥0` field (`frontend/src/engine/clipDefinition.ts:676-679`):
  ```ts
  const duration = requireFiniteNumber(json.duration, 'Clip duration')
  if (duration < 0) throw new Error('Clip duration must be non-negative')
  ```
  `duration=1` is legal, and the keyframe times remain `[0,1]`. Channel existence is defined by `channels: ClipChannelDef[]` at `:701-720` plus lazily-created animation maps; a channel exists while it has ≥1 keyframe (`removeChannelKeyframe` at `:461-469` guards the spec), so control clips need no schema extension.

### Verdict
`ClipDefinition` is unchanged. A control binding of `Record<semanticName, clipId>` where each clip has `duration=1` and times `[0,1]` is valid per existing validation. Direct-linear shortcut lowering to a 2-keyframe clip at `t=0→1` is also valid (see §4).

## 2. Duration is purely a divisor — fixing it to 1 needs no code change

The only use of `duration` in evaluation is the divisor in every `#apply*` path:

- `#applyClipInstances` at `frontend/src/engine/animationEvaluator.ts:1107-1110`:
  ```ts
  const u = Math.min(Math.max(((time - instance.startTime) * instance.speed) / clip.duration, 0), 1)
  ```
- `#applyClipShadowInstances` at `:458-461` and `#evaluateClipShadowColor` at `:486-489` — identical divisor.
- `evaluateMorphValue` clip layer at `:563-566`, `evaluateMorphVertices` clip layer at `:626-630`, `#applyClipMaterialOverrides` at `:1201-1204` — all `u = ((clampedTime - start)*speed)/duration`.

**Fixing `duration=1` means `u = (time - start)*speed` clamped to [0,1].** For Controls we replace the whole `((time - start)*speed)/duration` expression with `u = normalize(controlValue,min,max)` (v1 `clamp(controlValue,0,1)`). No change to the divisor path — we simply stop calling it for Controls and supply `u` directly. The `duration=1` value keeps serialized clips consistent and avoids a special-case validator.

**Guard:** `isClipInstanceActive` at `frontend/src/engine/animationEvaluator.ts:67-77` returns `false` when `clip.duration <=0` (`:72`), so a degenerate `duration=0` control clip would be inert; authoring must ensure `duration=1` on creation (validated by `clipManager.ts:156` `setDuration` guard and `clipDefinition.ts:257-259` setter).

## 3. Every channel already evaluates via u — a single helper is shared

`effectiveUForClip` at `frontend/src/engine/animationEvaluator.ts:50-62` centralizes reversal + parametric handling:

```ts
function effectiveUForClip(clip: ClipDefinition, keyframes: readonly Keyframe[], u: number): number {
  if ((clip as {isReversed?:boolean}).isReversed && isParametricKeyframes(keyframes)) return 1 - u
  return u
}
```

It is called in every clip-applied path:
- Shadow numeric `:466`, shadow color `:492`, morph value `:569`, morph vertices `:633`, node channels `:1125`, material `:1222`. **All channels pass through this helper before segment lookup.**

`#evaluateClipChannel` at `frontend/src/engine/animationEvaluator.ts:1252-1271` is the uniform per-channel segment evaluator for `u ∈ [0,1]`:
- Hold/linear/bezier/parametric all via `evaluateSegment(from,to,u)` at `:1268`. It is the same `evaluateSegment` used by base `NodeAnimation` tracks (via `#evaluate` at `:1295` with `time` instead of `u`, but sharing the interpolator registry at `frontend/src/engine/interpolators.ts`).
- Material, shadow numeric, circle, etc. all delegate to it. The per-channel variants differ only in value shape (number vs color vs morph object), not in time math.

**Therefore a single `evaluateClipAtU(clip, u, node, scratch)` that iterates `clip.channels` and each `shadow/morph/circle/material` map with `effU = effectiveUForClip(clip, kfs, u)` then `evaluateSegment` reuses 100% of interpolation logic.** No fork needed for hold/linear/bezier/parametrics; the parametric family (bounce/elastic/spring) is rejected on discrete kinds earlier but otherwise evaluated correctly via `u`.

### Material / shadow / morph / circle — all via u

| Channel | Animation store | Clip lookup | Evaluator | u usage | Lines |
|---|---|---|---|---|---|
| position/rotation/scale/opacity | `clip.channelAnimation(channel)` | `#applyClipInstances` | `#evaluateClipChannel` | `effU = effectiveUForClip`, then `evaluateSegment` | `clipDefinition.ts:317`, `animationEvaluator.ts:1120,1125,1252` |
| visible | `clip.visibleAnimation()` | not currently layered in `#applyClipInstances` (visible is hold-only, now static per `animationEvaluator.ts:220`) | `isHold` in manager | `u` not yet used — intentionally out of v1 Controls (see §7) | `clipDefinition.ts:365`, `animationEvaluator.ts:220` |
| circle radius/startAngle/endAngle/segments | `clip.circleAnimation(prop)` | `evaluateCircle` base + clip branch (future) | same | `u` when layered | `clipDefinition.ts:370`, `animationEvaluator.ts:1000` |
| morph coefficient + shape names | `clip.morphAnimation()` | `evaluateMorphValue/Vertices` clip loop | `#evaluateMorphClipKeyframes` `:838-873` and `#evaluateMorphClipVertices` `:875-909` | `effU` then `ratio = (u - from.time)/(to.time-from.time)` → `#easedProgress` → lerp coeff + cross-blend vertices | `clipDefinition.ts:373`, `animationEvaluator.ts:539,598,817-836` |
| shadow (offset/scale/skew/rotation/blur/opacity/color) | `clip.shadowChannelAnimation(prop)` | `#applyClipShadowInstances` `:446-471` and `#evaluateClipShadowColor` `:474-495` | `#evaluateClipShadowNumeric` `:498-511` and `#evaluateClipShadowColorValue` `:514-529` | `effU` then `evaluateSegment` / `lerpHexColor` | `clipDefinition.ts:410`, `animationEvaluator.ts:446` |
| material params | `clip.materialChannelAnimation(key)` | `#applyClipMaterialOverrides` `:1175-1249` | `#evaluateClipChannel` | `effU` then `evaluateSegment`; gain/offset composition with `paramOverrides` | `clipDefinition.ts:321`, `animationEvaluator.ts:1206,1222` |
| table/circle extended | similar maps | `evaluateTable` `:1035` | same | same | `clipDefinition.ts:410` |

**Name-based morph resolution** confirms reuse: `#resolveClipValueToNode` at `frontend/src/engine/animationEvaluator.ts:817-836` resolves `MorphClipKeyframeValue {fromShapeName,toShapeName,coefficient}` at `clipDefinition.ts:790-805` to `MorphKeyframeValue {fromShapeId,toShapeId,coefficient}` by `shapes.find(s=>s.name===fromShapeName)`. It is called from both `evaluateMorphValue` clip path at `:850` and `evaluateMorphVertices` at `:886,902`. A Controls evaluator broadcasting `semanticName → clipId` per descendant calls the same resolver per descendant `shapes` — no duplication.

## 4. Normalized clip keyframes are managed via existing ClipDefinition / ClipManager APIs — no new sidecar

- `ClipManager.addChannelKeyframe` at `frontend/src/engine/clipManager.ts:235-255` validates time with `requireClipKeyframeTime` at `clipManager.ts:601-606`:
  ```ts
  function requireClipKeyframeTime(time: unknown){ const bounded=requireFiniteNumber(time); if(bounded<0||bounded>1) throw... }
  ```
  Same `[0,1]` check as `clipDefinition.ts:164`. All clip keyframe ops (`add/move/scale/duplicate/paste`) clamp to `[0,1]` — e.g. paste at `:423` `Math.min(Math.max(boundedAtTime+relative,0),1)`.
- `AnimationManager.addKeyframe` at `frontend/src/engine/animationManager.ts:155-178` is for `NodeAnimation` seconds-based tracks (`requireKeyframeTime(time, slide.duration)` at `:157`). **Controls' two kinds are distinct:** (a) the normalized clip's own keyframes (edited in the drill-in `Editing Control: Mouth.Openness (0…1)` timeline) are clip keyframes via `ClipManager`/`ClipDefinition` — already normalized; (b) the host node's `controlTracks` (global time, value ∈ [min,max]) are `NodeAnimation` tracks analogous to `morph/symmetry` — validated against `slide.duration` for time and against `[min,max]` for value (new `controlTracks` map per ADR 0010, ticket #332). The drill-in timeline reuses the clip editor (`ClipEditBody.tsx` per `frontend/src/engine/clipManager.ts` + `clipDefinition.ts`) with header `0 … 1` guardrails; no new sidecar type is needed.
- Existing `clipDefinition.ts:417-459` `addChannelKeyframe` / `addMorphKeyframe` / `addShadowChannelKeyframe` / `addMaterialChannelKeyframe` all instantiate a fresh `ClipChannelAnimation` if absent (`:418-422` etc.) — control clips creating a new binding channel auto-creates the animation.

### What Controls do need

- A new `NodeAnimation.controlTracks: Map<controlKey, Keyframe[]>` (ticket #332) for the host-node value-over-time lane. Its JSON lives in `SlideAnimationJSON.nodes[].controlTracks` (per-slide instance data), mirroring `materialTracksJSON`/`shadowTracksJSON`/`morphTrackJSON`. This is not clip keyframe state; it is the Control's seconds-based `KeyframeTarget` (`kind:'control'`) that `AnimationManager` must resolve (new `resolveKeyframeTrack` branch, `requireKeyframeTime` against `slide.duration`, value clamp to `[min,max]`).
- The drill-in timeline for control bindings must swap `time` domain from `slide.duration` to `duration=1` (clip editor already does `[0,1]`), but the per-descendant lanes are ordinary clip channel lanes with no change to `ClipManager`.

## 5. clipLookup wiring and speed/Stretch — already decoupled, controls must not stretch

- Engine wiring at `frontend/src/engine/internal.ts:223-228`:
  ```ts
  this.#evaluator = new AnimationEvaluator(
    (nodeId)=>this.getNode(nodeId),
    (nodeId)=>this.getSlideOfNode(nodeId),
    this.#materialParameterKindOf,
    (clipId)=>this.getClip(clipId),  // ← #clipLookup
  )
  this.#clips = new ClipManager(this.#bus)
  ```
  `#clipLookup` resolves `clipId → ClipDefinition` via `Engine.getClip` at `frontend/src/engine/internal.ts:3114`. The same lookup is used for `#applyClipInstances`, shadow, morph, material — a new `evaluateClipAtU` path can call it identically for each `Control.bindings[semanticName]`.

- **Speed / Stretch is instance-local, not clip-local.** `ClipInstance.speed` at `frontend/src/engine/clipInstance.ts:5-80` scales visual duration via `visualDuration = duration / speed` (see `animationManager.collectionLane` / timelineComponents `keyframeScale.ts:258`). In evaluation it appears only as `((time - startTime)*speed)/duration` at `animationEvaluator.ts:1108`. **Controls are not time clips; they are not `ClipInstance`s.** ADR 0010 fixes the Controls evaluator to `u = controlValue` (v1 identity) — no `startTime`, no `speed`, no `isClipInstanceActive` guard. The prototype's Stretch handle (`MIN_VISUAL 0.25s` etc.) does not apply to controls; stretching a Control's clip is editing the normalized clip's shape (moving keyframe times in `[0,1]`), not scaling a placement.

- `clipLibraryStore.ts` at `frontend/src/stores/clipLibraryStore.ts:42-46` serializes clip library entries via `clip.toJSON()` and `ClipsApi` — no speed there; `clipManager.ts:3124 createReversedClipDefinition` and `clipCollectionManager` handle duplicate/reverse. `useClipLibraryStore` at `:201 selectClip` / `:211 createClip` are orthogonal to controls.

### Do not reuse for Controls

- `isClipInstanceActive` at `frontend/src/engine/animationEvaluator.ts:67-77` gates time clips by `startTime + duration/speed`. Controls are always active (no interval), so skip this guard entirely. A helper `evaluateControlAtGlobalTime(nodeId, controlKey, globalTime)` first evaluates the host's `controlTrack` at `globalTime` (via `AnimationEvaluator.#evaluate` → `enabledKeyframes` + `evaluateSegment`, clamped to `[min,max]`), then uses that scalar as `u` for every descendant broadcast.

## 6. Existing tests that must transfer verbatim via u

| Exercise | Where | Why it transfers via u |
|---|---|---|
| Reversed clips (time-mirrored) | `frontend/src/engine/clipReverse.ts:17-157`, `createReversedClipDefinition` default `<orig> Reversed`, `t'=1-t` with swapped+negated bezier tangents `:37-44`, parametric kept `1-u` via `effectiveUForClip` `:50-62` ; tests `frontend/src/tests/engine/clipReverse.test.ts` (if present) + `duplicateImmutability.test.ts:81` | Controls reuse the same `ClipDefinition.isReversed` and `effectiveUForClip` path; a reversed control clip is just a reversed normalized clip. No new reverse primitive. |
| Parametric interpolation (bounce/elastic/spring) | `frontend/src/engine/interpolators.ts:207`, `frontend/src/tests/engine/interpolators.test.ts:207`, `frontend/src/tests/engine/keyframeFamilyCommands.test.ts:754 parametric interpolation (bounce)` `:775 elastic` `:792 rejection on discrete` | `effectiveUForClip` special-cases parametric `clip.isReversed → 1-u` at `:57-60`; `#evaluateClipChannel` delegates to `evaluateSegment` which dispatches parametric registry at `interpolators.ts`. Controls evaluate at `u` — parametric works. |
| Morph name fallback (missing shape) | `clipDefinition.ts:799-825`, `animationEvaluator.ts:817-836 #resolveClipValueToNode` soft-warn + `null` ids → `resolveMorphedVerticesFromKeyframe` fallback to base; tests `reusableObjectPortability.seam.test.ts:36,87,120` and `lessonSelfContainment.test.ts:58` | Same resolver called per descendant; missing `semanticName` on target → skip descendant contribution (ADR 0010). |
| Animation evaluator determinism & mixed hold/linear/bezier | `frontend/src/tests/engine/animationEvaluator.test.ts:104-431` (hold at `:125`, linear at `:105`, bezier at `:150`, mixed at `:381`, determinism at `:412`) | All via `evaluateSegment`; clip channel path at `animationEvaluator.ts:1252` calls the same. |
| Duplicate immutability (clip copy → new ids) | `frontend/src/tests/duplicateImmutability.test.ts:81 new ClipDefinition(..., duration=1)` | Controls' normalized clips copy via `ClipDefinition.copy()` at `clipDefinition.ts:572-619` (deep copies `visible/circle/morph/shadow`). |

## 7. Out-of-scope / channel allowlist for v1 Controls

Per map Out-of-scope and CONTEXT § Visible / zIndex (hold-only), recommended v1 Control-drivable channels are the same as `ClipChannel` + `morphCoefficient` + `shadow`/`circle`/`material` — i.e. every channel reachable via `ClipDefinition` except `visible`/`zIndex` (hold-only, not useful as a continuous rig param). `Table.borderRadius/padding` etc. are writable via clips but not recommended in v1; the evaluator would still handle them if bound.

## 8. Spec changes required (for tickets #331/#332)

- New engine helper `evaluateControlClipAtU(clip, u, descNode, scratch)` — essentially the body of `#applyClipInstances` loop but with `u` supplied and without `isClipInstanceActive` / `speed` / `startTime`.
- `AnimationEvaluator` insertion point: after `#applyClipInstances` (base clips, last-wins by `clipInstances` order at `animationEvaluator.ts:1083`) insert `#applyControlTracks(hostNode, globalTime, descendants)` where `hostNode.controlSet` is consulted, `controlValue = #evaluate(controlTracks[key], globalTime, Control.default) ∈ [min,max]`, clamped, normalized `u = (controlValue - min)/(max-min)` (v1 identity), then per `semanticName → clipId` broadcast to each `descNode = findNodesBySemantic(hostSubtree, semanticName)` and layered via the same `#evaluateClipChannel` / morph / shadow helpers. Within-Control ordering is `ControlSet.controls` order last-wins; across Controls+Clips, Controls win (ADR preference).
- `NodeAnimation` + `SlideAnimation` extension for `controlTracks` (see ticket #332 spec) — do not reuse `ClipParam`.

## 9. Risks & non-issues

- **Non-issue:** Forking interpolator logic — no. Shared `evaluateSegment` + `effectiveUForClip` already handles all six types.
- **Risk if done wrong:** Reusing `ClipInstance.speed` for Controls would make value scale with time; must not. Control binding is `clipId` only; direct-linear shortcut should be lowered to a 2-keyframe clip at author time (ticket #336), not a second evaluator path.
- **Non-issue:** `duration` field confusion — `clip.duration` appears in `clipManager.ts:156 setDuration` and `clipDefinition.ts:257 setter`; authors may edit duration in clip editor, but for control clips the drill-in timeline must guard `duration=1` (editing duration in that view resizes the normalized axis; stretching the control's placements is not a thing).

## 10. Sources — line-cited index

| Claim | File:line |
|---|---|
| Clip keyframe time `[0,1]` validation | `frontend/src/engine/clipDefinition.ts:163-166` |
| Clip `duration ≥0` | `clipDefinition.ts:676-679` |
| Channel existence while ≥1 keyframe | `clipDefinition.ts:461-469,519-522` |
| `ClipDefinition.fromJSON` time validation for all channel kinds | `clipDefinition.ts:670-724,743-909` |
| `isReversed` flag | `clipDefinition.ts:204-242,721,664` |
| Morph clip value `{fromShapeName,toShapeName,coefficient}` | `clipDefinition.ts:790-805,807-825` |
| `u = ((t-start)*speed)/duration` divisor | `animationEvaluator.ts:1107-1110,458-461,486-489,563-566,626-630,1201-1204` |
| `isClipInstanceActive` guard | `animationEvaluator.ts:67-77` |
| `effectiveUForClip` parametric 1-u | `animationEvaluator.ts:50-62` |
| `enabledKeyframes` disabled filter | `animationEvaluator.ts:37-48` |
| `#applyClipInstances` loop + `effectiveUForClip` + `#evaluateClipChannel` | `animationEvaluator.ts:1083-1146,1252-1271` |
| Material clip layering | `animationEvaluator.ts:1175-1249,1222` |
| Shadow clip numeric + color | `animationEvaluator.ts:446-495,498-529` |
| Morph name resolution `fromShapeName → fromShapeId` | `animationEvaluator.ts:817-836` |
| Morph clip value → vertex paths | `animationEvaluator.ts:539-590 (#evaluateMorphClipKeyframes),598-643 (#evaluateMorphVertices),838-909` |
| Clip keyframe add time `[0,1]` | `engine/clipManager.ts:601-606,242-244` |
| Paste clamp to `[0,1]` | `clipManager.ts:423,150,474` |
| `reverseAnimation` t'=1-t + tangent swap | `engine/clipReverse.ts:37-61` |
| Parametric reverse keep isReversed + 1-u | `clipReverse.ts:79-93, 50-62 in animationEvaluator` |
| `AnimationManager.addKeyframe` seconds-based | `engine/animationManager.ts:155-178,10 requireKeyframeTime` |
| `NodeAnimation` track kinds + JSON | `engine/nodeAnimation.ts:40-611` |
| `SlideAnimation.clampKeyframesTo` + `toJSON`/`fromJSON` | `engine/slideAnimation.ts:107,237,283` |
| `#clipLookup` wiring | `engine/internal.ts:223-228,3114` |
| `ClipManager` bus + duration guard | `engine/clipManager.ts:46-48,150-158` |
| `clipLibraryStore` no-speed serialization | `stores/clipLibraryStore.ts:35-46` |
| Reversed/parametric/morph tests | `tests/engine/animationEvaluator.test.ts:104-431`, `tests/engine/interpolators.test.ts:207`, `tests/engine/keyframeFamilyCommands.test.ts:754`, `duplicateImmutability.test.ts:81`, `reusableObjectPortability.seam.test.ts:36` |

---

**Gist for map:** `ClipDefinition` duration=1 + `[0,1]` times is valid as-is; `animationEvaluator` already computes `effectiveUForClip` + `evaluateSegment` via `u` for every channel (including morph name-resolution and shadow/material), so Controls can reuse it by substituting `u = controlValue` and skipping `isClipInstanceActive`/`speed`; clip keyframes are managed via `ClipManager`/`ClipDefinition` with `[0,1]` validation, while host `controlTracks` are new seconds-based `NodeAnimation` tracks per ticket #332.
