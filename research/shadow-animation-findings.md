# Research: Animation track & evaluator extension points for all-animatable shadow parameters

Ticket: #289 · Map: #286 · Branch: `research/shadow-animation` · Date: 2026-09-05

Question: How should shadow projection parameters `offsetX, offsetY, scaleX, scaleY, skewX, skewY, rotation, blur, opacity, color` be added so every param is keyframable per `ANIMATABLE_PROPERTIES` and portable through Clips / ClipCollections (by `semanticName`) / ClipExtraction — given `NodeAnimation`/`SlideAnimation`/`AnimationEvaluator`/`keyframeTarget.ts`/`animationProperties.ts`/`materialTrackEvaluation.ts`, the recent morph addition (`morphCoefficient` + `MorphBinding` bespoke lane, visible-pattern), and the fact that shadows are an **effect on a group** not a per-mesh component? Compare: extend `ANIMATABLE_PROPERTIES` vs bespoke shadow track vs material-param track. Note JSON shape, interpolation per kind (color hex hold vs linear), evaluator insertion order, and where shadow effect ownership lives (`NodeComponents.shadowEffect` vs `SceneNode.shadowEffect`).

> Every factual claim cites `file:line`. No Pixi APIs.

---

## 1. Destination context

Map #286 destination is one shadow effect per **group node**, source = its subtree, params listed above all animatable. Prior research establishes:

* `isGroupNode(node)` at `sceneNode.ts:172-174` = `Object.keys(node.components).length===0 && children.length>0` (see `research/shadow-renderer-findings.md:85-96`).
* Shadow ownership proposed as `ShadowEffect` struct with fields `offsetX, offsetY, scaleX, scaleY, skewX, skewY, rotation, blur, opacity, color, enabled?, castFlags?`. Not yet present in codebase (`components.ts:103-115` has 11 components, none shadow; `sceneNode.ts:37-50` has no shadow field — grep for `shadowEffect|ShadowEffect` returns 0 in `frontend/src/engine`).
* Rendering path wants an `EvaluatedShadowState` parallel to `EvaluatedNodeState`/`EvaluatedCircleState` (`animationEvaluator.ts:22-54`) consumed by `sceneRenderer` alongside `evaluateNode`/`evaluateCircle`/`evaluateTable` (`sceneRenderer.ts:997-1016`).

This note answers only the **local animation stack** extension points; renderer dirty/BBox/compositing is covered in `research/shadow-renderer-findings.md`.

---

## 2. Current animation architecture — canonical map

### 2.1 Property registries

| Registry | File:line | Shape |
|----------|-----------|-------|
| `ANIMATABLE_PROPERTIES` (6) | `animationProperties.ts:4-11` | `['positionX','positionY','rotation','scaleX','scaleY','opacity']` |
| `BONE_ANIMATABLE_PROPERTIES` (5) | `animationProperties.ts:14-20` | same without `opacity` |
| `CIRCLE_ANIMATABLE_PROPERTIES` (4) | `animationProperties.ts:22-27` | `['radius','startAngle','endAngle','segments']` |
| `TABLE_ANIMATABLE_PROPERTIES` (2) | `animationProperties.ts:29` | `['borderRadius','padding']` |
| `CLIP_CHANNELS` (6, mirrors standard) | `clipDefinition.ts:26-33` | same 6 as `ANIMATABLE_PROPERTIES` |
| `CLIP_CIRCLE_CHANNELS` (4) | `clipDefinition.ts:35-40` | circle 4 |
| Types | `animationProperties.ts:31-38` | `AnimationProperty`, etc. |
| Guards/validators | `animationProperties.ts:44-154` | `requireAnimationProperty`, `requireKeyframeValue` (opacity clamped via `requireOpacity` at `95-96`), `requireCircleKeyframeValue`, `requireTableKeyframeValue`, `requireKeyframeTime` |

`NodeAnimation` stores all tracks in **parallel dictionaries** (not one map):

* `#tracks: Map<AnimationProperty, Keyframe[]>` at `nodeAnimation.ts:35`
* `#materialTracks: Map<string, Keyframe[]>` at `nodeAnimation.ts:36`
* `#dataLabelTracks` at `37`, `#circleTracks` at `38`, `#tableTracks` at `39`
* `#visible: Keyframe[]` at `40` — bespoke array, not a map (single `visible` lane)
* `#morphBinding: MorphBinding|null` at `41` (deprecated sidecar, kept for migration) + `#morph: Keyframe[]` at `42` — second bespoke array

Each has symmetric accessors (`keyframes`, `hasTrack`, `add`/`remove`/`get`) at `nodeAnimation.ts:44-177`, `copy()` at `243-285`, JSON serialisers at `287-344`, and `fromJSON` readers at `354-614`. `SlideAnimation` at `slideAnimation.ts:56` is `Map<nodeId, NodeAnimation>`; `clampKeyframesTo` iterates all registries at `slideAnimation.ts:87-178`; `toJSON` at `182-217` writes every lane; `fromJSON` at `219-252` dispatches to `NodeAnimation.fromJSON`.

### 2.2 Evaluator

`AnimationEvaluator` at `animationEvaluator.ts:114-130` holds `#nodeLookup`, `#slideLookup`, `#parameterKindOf`, `#clipLookup`. Per-kind evaluators:

* `evaluateNode(nodeId,time,target?)` at `animationEvaluator.ts:132-161` — evaluates 6 transform/opacity channels via `#evaluate` (`883-903` using `evaluateSegment` from `interpolators.ts:28`) at `141-155`, then `evaluateVisible` at `156` via dedicated hold-only walk `163-192`, then `#applyClipInstances` at `158` (last-wins layering at `684-753`).
* `evaluateMaterialOverrides` at `534-577` loops `animation.materialTrackParameterKeys()` then `evaluateMaterialTrackValue(kind, ...)` at `563` (linear per-channel clamping at `91-102`, color lerp at `112-124`), then `#applyClipMaterialOverrides` at `574` (`781-859`).
* `evaluateMorphValue` at `201-253` + `evaluateMorphVertices` at `260-301` — bespoke: `#evaluateMorphKeyframes` linear+cross-blend at `303-338`, `#easedProgress` via synthetic `evaluateSegment` at `511-525`, clip name-resolution at `416-435`, clip-coeff layering last-wins at `214-253`.
* `evaluateCircle` at `601-634`, `evaluateTable` at `636-675` — same `#evaluate` pattern.
* `CHANNEL_TO_TRANSFORM_KEY` at `animationEvaluator.ts:105-112` maps `AnimationProperty → transform key`; `#getChannelValue`/`#setChannelValue` at `755-774` used only for clip layering.

Insertion order inside `evaluateNode` is significant: **transform channels → opacity → visible → clip instances**. Shadow insertion point is discussed in §5.

### 2.3 Manager / target resolution / extraction

* `AnimationManager` at `animationManager.ts:64-80` — `addKeyframe` at `117-134`, `delete/move/scale/setValue/setInterpolation/setTangents/paste/duplicate` at `136-352`. All resolve through `#resolve` → `resolveKeyframeTrack` (`keyframeTarget.ts:200-236`) which validates `AnimationProperty`/`Circle`/`Table`/`visible`/`morph`/`parameter` and calls `requireTrackKeyframeValue` (`239-283`). Track branching in `#keyframesOf` at `370-391`, `#addToTrack` at `393-410`, `#removeFromTrack` at `412-429`.
* `keyframeTarget.ts` — discriminated union `KeyframeTarget` at `86-94` with kinds `node|dataLabel|circle|table|visible|morph|clip` (`28-94`), predicates `isPropertyTarget` etc. at `96-126`, `requireKeyframeTarget` at `128-171`, `resolveKeyframeTrack` at `200-236`, `requireTrackKeyframeValue` at `239-283`, `requireNodeTarget` at `285-313`.
* `interpolators.ts` — `registerSegmentInterpolator` at `17-25`, `evaluateSegment` at `28-31` dispatching on `from.interpolation` (hold/linear/bezier at `33-64`, bounce/elastic/spring parametric at `72-126`). Registry is closed insertion point for future easings.
* `materialTrackEvaluation.ts:13-52` — `evaluateMaterialTrackValue` dispatches on `isContinuousMaterialKind` (`54-63`: number/float/color/vec2/3/4 → linear; int/bool/sampler2D → hold at `44-50`), interpolates via `lerpVector`/`lerpHexColor` at `86-130`.
* `clipDefinition.ts` — `ClipDefinition` at `195-229`; `#channelAnimations` at `202`, `#materialChannelAnimations` at `203`, `#visibleAnimation` at `204`, `#circleAnimations` at `205`, `#morphAnimation` at `206`. Each channel has `channelAnimation()`/`materialChannelAnimation()`/`visibleAnimation()`/`circleAnimation()`/`morphAnimation()` accessors (`303-361`), `add*Keyframe`/`remove*Keyframe` at `383-460`, `toJSON` at `561-599` writing per-channel animations as `channelAnimations`, `materialChannelAnimations`, `visibleAnimation`, `circleChannelAnimations`, `morphAnimation` (`json.ts:359-371`), and `fromJSON` at `601-774` with per-kind validators.
* `clipCollection.ts:5-50` — `ClipCollection {id,name,bindings: Map<semanticName→clipId>, sourceNodeId?}` — **untyped** map; same `semanticName` carries whatever channels clip contains (transform+visible+circle+morph).
* `clipExtraction.ts:6-252` — `ExtractableKeyframe` at `6-14`, `NormalizedKeyframe` at `16-24`, `computeExtractionBounds` at `33-48` (duration = `selEnd-selStart`, 1s floor), `normalizeExtractable` at `50-123` (time → `(t-selStart)/selDuration`, tangent time ÷ selDuration at `58-64`, opacity/morph range checks at `79-112`), `channelKeyOf` at `142-170` (`visible`→`"visible"`, `morph`→`"morph"`), `groupNormalizedByChannel` at `172-190`, `validateNoDuplicateTimes` at `192-222`, `createNormalizedClipKeyframes` at `224-234`, `toClipKeyframes` at `240-252`.

### 2.4 Ownership today

* `NodeComponents` at `components.ts:103-115` — 11 optional components (`camera, assetInstance, text, bone, mesh, ghost, table, tableRow, tableCell, chart, circle`) — **no shadow**.
* `SceneNode` at `sceneNode.ts:37-50` — flat fields `id,name,semanticName,parent,children,transform,visible,opacity,material,components,clipInstances` — **no shadow**.
* `NodeJSON`/`NodeComponentsJSON`/`ClipJSON`/`SlideAnimationJSON` at `json.ts:99-371` — none carry shadow.
* `lessonSerializer.ts:364-821` — `validateNode` at `365-551`, `validateAnimation` at `553-821` — validates `ANIMATABLE_PROPERTIES` via `requireAnimationProperty` and per-kind `validateKeyframeList`; no shadow validation.

---

## 3. Shadow parameter surface

Map #286 specifies 10 params; prior shadow research agrees (see ticket #289 + `research/shadow-pixi-findings.md:optics`):

| Param | Kind | Default | Range / unit |
|-------|------|---------|--------------|
| `offsetX` | number (px) | 8 | finite, any |
| `offsetY` | number (px) | 8 | finite, any |
| `scaleX` | number (factor) | 1 | ≥0, finite |
| `scaleY` | number (factor) | 0.5–1, squash 0.15–0.2 | ≥0 |
| `skewX` | number (rad) | 0 | finite |
| `skewY` | number (rad) | 0 | finite |
| `rotation` | number (rad or °) | 0 | finite, wraps |
| `blur` | number (px) | 8 | ≥0 |
| `opacity` | number | 0.45 | 0..1 |
| `color` | hex string | `#000000` | `^#[0-9a-fA-F]{6}$` |

One shadow per group node (map #286 attachment rule). Effect is **group-scoped** — only nodes with `isGroupNode(node)` true or at minimum `children.length>0` should expose shadow tracks (see `research/shadow-renderer-findings.md:1.4`).

---

## 4. Three options compared

### 4.1 Option A — Extend `ANIMATABLE_PROPERTIES` (10 new entries)

Add `shadowOffsetX` etc. to `ANIMATABLE_PROPERTIES` at `animationProperties.ts:4`, extend `AnimationProperty` union (`31`), `CHANNEL_TO_TRANSFORM_KEY` (`animationEvaluator.ts:105`), `CLIP_CHANNELS` (`clipDefinition.ts:26`), `BUILT_IN_MATERIAL_KEYS`-style filtering, and thread through `NodeAnimation.#tracks` (`nodeAnimation.ts:35`) with no new types.

*JSON shape* — reuse `PropertyTrackJSON` (`json.ts:142-145`): `{property: 'shadowOffsetX', keyframes: [...]}` inside `NodeAnimationJSON.tracks[]`. Clip side: `channelAnimations['shadowOffsetX']`.

*Interpolation* — always via `evaluateSegment` at `animationEvaluator.ts:899` → `interpolators.ts:28` (hold/linear/bezier/bounce/elastic/spring). Color would be a `number` (`hexColorToTint`) or raw hex — **mismatch**: transform channels assume `value: number` (`keyframe.ts:9`, `animationProperties.ts:90-99` `requireKeyframeValue` returns `requireFiniteNumber`), so `color` hex would need a separate `string`-valued property track, but `KeyframeValue` (`keyframe.ts:9`) does allow `string|number|...` — the evaluator `#evaluate` at `883-903` casts `value as number` unconditionally, so hex would break.

*Evaluator order* — `evaluateNode` already evaluates 6 channels; adding 10 more extends the same loop; shadow evaluation trivially lands after opacity/visible but before clips (same as other transform channels).

*Pros*: minimal new code, reuses `getKeyframes`/`hasTrack`/`clampKeyframesTo` (`slideAnimation.ts:90-102`) and `animationManager` dispatch (`animationManager.ts:370-391`) without new branches; extraction handles any `AnimationProperty` via `channelKeyOf` `property:...` key (`clipExtraction.ts:143-145`).

*Cons*: **Pollutes the uniform-six**. Every non-group leaf node would advertise 10 shadow params in `getAnimatableParameters` (`animatableParameters.ts:95-109`) unless guarded by `isGroupNode` filtering — but `ANIMATABLE_PROPERTIES` iteration there is unconditional (`for (const property of ANIMATABLE_PROPERTIES)`), so guard logic must sprout everywhere: `requireAnimatableForNode` (`animationProperties.ts:64-73`, today blocks `camera.rotation` and `bone.opacity`), `clipDefinition.fromJSON` (`635-651` validates every `channel.property` via `requireAnimationProperty`), `slideAnimation.clampKeyframesTo` (`90-102`), and `animationEvaluator.CHANNEL_TO_TRANSFORM_KEY` (would need 10 new entries mapping shadow props to shadow state, not node transform). Worse, shadow params are **not** transforms — mapping them through `MutableTransform` (`animationEvaluator.ts:28-35`) is semantically wrong and couples shadow projection to `EvaluatedNodeState.transform` (`22-26`). Naming collision: `scaleX/scaleY/rotation/opacity` already exist as transform params — shadow `scaleX` would shadow them (`scaleX` vs `shadowScaleX` prefix required, yet prefix leaks into Clip/ClipCollection `channel` names and UI). Color hex as a string breaks `#evaluate`'s numeric assumption and forces a per-channel branch that the uniform-six loop doesn't have. In short, option A conflates two domains' types and validators.

**Verdict: rejected** — fits the track machinery but violates the `ANIMATABLE_PROPERTIES` contract (transform-only, numeric, uniform-six) and heredity rules (`BONE_ANIMATABLE_PROPERTIES` at `animationProperties.ts:14-20`, camera/bone exclusions). Recent morph/visible work explicitly rejected this same path (see `docs/adr/0008:Decision 1` — `property:'morphCoefficient'` rejected as polluting uniform-six).

---

### 4.2 Option B — Bespoke shadow lanes (visible / morph pattern) — RECOMMENDED

Add **10 separate `Keyframe[]` arrays** (or one `Map<ShadowProperty, Keyframe[]>` + structured `ShadowState`) to `NodeAnimation` parallel to `#visible` (`nodeAnimation.ts:40`) and `#morph` (`42`), a **matching `#shadowAnimations: Map<ShadowProperty, ClipChannelAnimation>`** (or 10 named fields) on `ClipDefinition` parallel to `#visibleAnimation`/`#circleAnimations`/`#morphAnimation` (`clipDefinition.ts:204-206`), and `NodeShadowTarget {kind:'shadow', nodeId, property: ShadowProperty}` in `keyframeTarget.ts` parallel to `NodeVisibleTarget` (`63-67`)/`NodeMorphTarget` (`70-73`).

This is the exact pattern the codebase converged on:

* visible lane: `NodeAnimation.#visible: Keyframe[]` (`40`), `visibleKeyframes/hasVisibleTrack/addVisible/removeVisible` (`100-128`), `visibleTrackJSON` (`327-332`), `readVisibleTrack` (`539-560`, hold-only enforcement at `555-556`), `AnimationEvaluator.evaluateVisible` (`163-192`, hold walk), `#visibleAnimation` on clip (`clipDefinition.ts:204`, `323-345,401-403,442`).
* morph lane: `#morph: Keyframe[]` (`42`), `morphKeyframes/hasMorphTrack/addMorph/removeMorph` (`149-177`), `morphTrackJSON` (`334-339`), `readMorphTrack` (`584-614`, scalar migration via `legacyBinding`), `AnimationEvaluator.evaluateMorph*` (`194-337`, `#evaluateMorphKeyframes` with cross-blend), `#morphAnimation` on clip (`206`, `343-349,414-416,460`).

*JSON shape* — parallel to `VisibleTrackJSON`/`MorphTrackJSON` (`json.ts:167-178`) and `CircleTrackJSON`/`TableTrackJSON` (`157-165`):

```ts
// json.ts — new
export type ShadowTrackJSON = {
  // Option B1: single track carrying object values (like morph object):
  // readonly keyframes: readonly KeyframeJSON[] // value: ShadowState or per-prop number
}
export type ShadowTracksJSON = { // or per-property array:
  readonly tracks: readonly { readonly property: ShadowProperty; readonly keyframes: readonly KeyframeJSON[] }[]
}
// NodeAnimationJSON — new optional field:
readonly shadowTracks?: readonly ShadowTrackJSON[] | ShadowTracksJSON
readonly shadowTracksV2?: ... // whichever shape
```

Recommended shape is **per-property tracks** mirroring `materialTracks`/`circleTracks`/`tableTracks` (`json.ts:147-165`) because shadow has 10 params (morph has 1, visible has 1 — they use single arrays; shadow needs 10). So:

```ts
export type ShadowTrackJSON = { readonly property: ShadowProperty; readonly keyframes: readonly KeyframeJSON[] }
```

and on `NodeAnimationJSON`: `readonly shadowTracks?: readonly ShadowTrackJSON[]` (parallel to `circleTracks` at `json.ts:186`).

Clip side: `ClipJSON.shadowChannelAnimations?: Record<ShadowProperty, ClipChannelJSON>` mirroring `circleChannelAnimations` (`json.ts:369`) — or reuse the 10 named keys under `shadowChannelAnimations`.

*Interpolation per kind* — bespoke evaluators allow **per-property** rules, matching the two existing families:

| Param | Continuous? | Interp family | Notes |
|-------|-------------|---------------|-------|
| `offsetX/Y` | continuous (px) | linear/bezier/bounce/elastic/spring + hold | like positionX/Y via `evaluateSegment` |
| `scaleX/Y` | continuous (factor, ≥0) | linear/bezier/parametric + hold | like scaleX/Y; clamp evaluated result ≥0 if desired (like `evaluateTable` clamps at `animationEvaluator.ts:673`) |
| `skewX/Y` | continuous (rad) | linear/bezier/parametric + hold | new — finite, no clamp |
| `rotation` | continuous (rad) | linear/bezier/parametric + hold | like rotation; angle wrap not needed for shadow tilt |
| `blur` | continuous (px ≥0) | linear/bezier/parametric + hold | like `TABLE_ANIMATABLE` (`animationProperties.ts:133-143` clamp ≥0) — non-negative |
| `opacity` | continuous 0..1 | linear/bezier/parametric + hold | like opacity via `requireOpacity` (`guards.ts:41-46`); evaluator should clamp 0..1 |
| `color` | hex string `#rrggbb` | **linear = per-channel lerp, hold = jump** (material color branch) | must reuse `lerpHexColor` (`materialTrackEvaluation.ts:112-124`) or a new `lerpShadowColor`; discrete samplers hold (`materialTrackEvaluation.ts:54-63`). Color hex is hold vs linear decision stays: continuous kind → lerp. Shadow color is continuous, so lerp. `materialTrackEvaluation` already does this for `kind==='color'` at `76`. Bespoke evaluator should branch on `property==='color'` similarly. |

Bespoke lane lets each property pick its validator (`requireKeyframeValue`-like per shadow prop, see `requireShadowKeyframeValue`) and its interpolator, just as `requireMaterialKeyframeValue` branches on `kind` (`materialKeyframes.ts:13-36`) and `evaluateMaterialTrackValue` branches on `isContinuousMaterialKind` (`materialTrackEvaluation.ts:54-63`).

*Evaluator insertion order* — Shadow evaluates **after** `state.opacity`/`state.visible` and **before or after** clip layering, but **before** `applyEvaluatedState` flushes to `container.alpha`. Recommended order inside `evaluateNode` (`animationEvaluator.ts:132-161`):

```
evaluated.x/y/rotation/scaleX/scaleY via #evaluate
state.opacity via #evaluate
state.visible via evaluateVisible
state.shadow = evaluateShadow(nodeId, clampedTime)  // new — bespoke
#applyClipInstances(state)          // if shadow clip channels exist, apply here OR in evaluateShadow's clip phase
#applyShadowClipState(state, node, clampedTime) // OR fold into #applyClipInstances iteration
return state
```

And a parallel `evaluateShadowMap` method akin to `evaluateMaterialOverrides` (`534-577`) + `evaluateCircle`/`evaluateTable` (`601-675`) for callers that want `EvaluatedShadowState`.

If shadow is **not** folded into `EvaluatedNodeState` but lives as its own `EvaluatedShadowState` (cleaner, avoids bloating `MutableTransform`), shadow has its **own evaluator path** like morph:

```ts
evaluateShadow(nodeId: string, time: number): EvaluatedShadowState
evaluateShadowValue(nodeId, time): EvaluatedShadowState // with defaults from node.shadowEffect
```

Call order from `sceneRenderer.#evaluateAndApply` (`sceneRenderer.ts:902-1046`) is `evaluateNode` → `evaluateMaterialOverrides` → `#resolveMaterial` → `#applyNodeShader`; shadow insert is **after line 997 (`evaluateNode`)**, same site as `evaluateCircle` (`941-967`) and `evaluateTable` (`968-996`).

Why after opacity/visible: shadow's effective alpha is `node.evaluatedOpacity * shadow.opacity * (visible?1:0)` — must read final opacity/visible. Why before `applyEvaluatedState`: `applyEvaluatedState` at `nodeRenderer.ts:110-121` writes `container.alpha/visible`; shadow sprite's `alpha = evaluatedOpacity * shadowOpacity` and `visible = evaluatedVisible && shadowEnabled` must be written in the same flush. Why before/inside clip layering: clip instances are **last-wins in array order** (`animationEvaluator.ts:692-753`, `214-253` for morph) — shadow clip channels must also respect instance order, so shadow clip application must iterate `node.clipInstances` with the same `if (!enabled) continue; if (time<startTime) continue; u=clamp((time-start)*speed/duration)` loop. Most maintainable is to extend `#applyClipInstances`'s inner `for (const channelDef of clip.channels)` at `719-751` to also handle shadow channels (new `shadowChannelAnimations` map on clip) — or add a dedicated `#applyClipShadowInstances` called from `evaluateShadow`.

*Portability (Clip / ClipCollection / ClipExtraction)* — bespoke lane ports cleanly:

* `ClipDefinition` gains `Map<ShadowProperty, ClipChannelAnimation>` at `clipDefinition.ts:202-206` seam; `toJSON` writes `shadowChannelAnimations` (like `circleChannelAnimations` at `590-594` / `morphAnimation` at `595-597`); `fromJSON` reads it with `ClipChannelAnimation.fromJSON` + per-prop validator (time 0..1, value finite or hex, at `141-184`).
* `ClipCollection` (`clipCollection.ts:5-50`) needs **no schema change** — bindings remain `Map<semanticName→clipId>` (`12`). Same `semanticName` carries whatever channels the clip contains; a morph+shadow+transform clip broadcasts identically via `ApplyClipCollectionCommand`'s subtree walk (`docs/adr/0008:Decision 4`). This is intentional (ADR 0008 rejected morph-specific naming).
* `ClipExtraction` extends `channelKeyOf` (`clipExtraction.ts:142-170`) with `if (target.kind==='shadow') return \`shadow:${target.property}\`` (like `morph`→`"morph"` at `154` and `visible`→`"visible"` at `152`), `NormalizedChannelKey` at `133-140` adds `{kind:'shadow', property:ShadowProperty}`, `normalizeExtractable` validates per-prop (opacity 0..1 at `79-84` pattern, blur ≥0, color hex at `materialKeyframes.ts:50-55`, scales ≥0), `validateNoDuplicateTimes`/`groupNormalizedByChannel` reuse unchanged. `clipManager.duplicateClip`'s keyframe-id regeneration at `clipManager.ts:94-143` needs a new `shadowChannelAnimations` loop mirroring `circleChannelAnimations`/`morphAnimation` there.

*Pros*: honest domain separation (transforms ≠ shadows ≠ circles), per-property validators/kinds, clean JSON namespacing (shadow never collides with `scaleX`), reuses already-proven bespoke patterns with exact line-for-line templates to copy; no `#tracks` bloat; color lerp natural; clip-collection portability unmodified.

*Cons*: more boilerplate — 10 maps vs 6 entries (but morph defence at `docs/adr/0008` already pays this tax; shadow is larger, so mitigations matter — see §6 for compact representation).

**Verdict: recommended** (unanimous with recent morph/visible/circle/table precedent; `docs/adr/0008:Decision 1` rejected the `ClipChannelDef` uniform-six extension for morph for the same reasons).

---

### 4.3 Option C — Material-param track

Treat shadow params as **material parameters** on the group's `MaterialInstance` (`sceneNode.ts:46-47`), e.g. keys `shadowOffsetX`, `shadowColor` defined in the default material (`materialResolution.ts:DEFAULT_MATERIAL_PARAMETERS`) and animated via `NodeAnimation.#materialTracks` (`nodeAnimation.ts:36`) / `ClipDefinition.#materialChannelAnimations` (`clipDefinition.ts:203`) / `AnimationEvaluator.evaluateMaterialOverrides` (`534-577`) + `materialTrackEvaluation.ts` (color lerp at `76`).

*JSON shape* — `MaterialTrackJSON {parameter, keyframes}` (`json.ts:147-150`) and `materialChannelAnimations` (`json.ts:367`). Already portable end-to-end.

*Interpolation* — automatically handled: `isContinuousMaterialKind` at `materialTrackEvaluation.ts:54-63` treats `color` as continuous with `lerpHexColor` (`112-124`), `number/float` as linear, discrete kinds as hold — shadow color as `kind:'color'` with `requireMaterialKeyframeValue` validation at `materialKeyframes.ts:25-26` (`^#[0-9a-fA-F]{6}$` at `50-55`), numeric params as `number/float` via `requireFiniteNumber`. Correct.

*Evaluator insertion order* — `evaluateMaterialOverrides` at `animationEvaluator.ts:534-577` runs **after** `evaluateNode` and after standard material tracks; `#applyClipMaterialOverrides` (`781-859`) already layers material clip channels after. Shadow material tracks would be evaluated alongside tint/opacityMultiplier — correct ordering, no new site.

*Pros*: zero new evaluator code; material validator/interpolator already correct for color vs number branching; Clip/ClipCollection portability free via existing material channel plumbing; param discoverability via `getAnimatableParameters`' material loop (`animatableParameters.ts:111-125`).

*Cons*: **conceptual mismatch and deployment consequences**:

1. Shadow is an **effect on a group node**, not a shading property of a single drawable. Material parameters are per-node shading of that node's own mesh/text/chart (`components.ts` rendering branches at `nodeRenderer.ts:57-96`); a group node has **no drawable** (`isGroupNode` at `sceneNode.ts:172`) and typically uses `defaultMaterial()` (`sceneNode.ts:68-69, defaultMaterial() at materialInstance.ts`) — attaching 10 shadow params there abuses the definition. Every leaf mesh would also inherit shadow params as material overrides, inviting stray shadow animations on non-groups.
2. Material definitions live in `MaterialDefinition` library (`materialDefinition.ts`, `materialManager.ts`, `librarySection.ts`); adding shadow params there bloats every material type (default, custom shaders) and couples shadow UX to shader authoring. Shadow color as a `vec4`? `color` hex? Both would need a stable `MaterialParameterKindOf` resolver (`internal.ts:878-909` `materialKindResolver`) per node, which already has `BUILT_IN_MATERIAL_KEYS` filtering at `animatableParameters.ts:48-52` to hide `tint`/`opacityMultiplier`/`uTime`.
3. History matters: the morph grind deliberately **moved away** from material-like generic tracks for a single bespoke coefficient — see ADR 0008. Shadow with 10 params would need 10 material params **and** a group-only guard in `resolveKeyframeTrack` (`keyframeTarget.ts:232-235` `Unknown material parameter`) that currently allows any known material param on any node with that material.
4. Clip material channels at `clipDefinition.ts:203` are keyed by `materialParameter` string, not typed property — rename/migration is fragile compared to typed `ShadowProperty` enum.

**Verdict: rejected as primary** — correct interpolation but wrong ownership. Shadow behaves like `circle/table` (component-defined, geometry-adjacent) and `visible/morph` (per-receiver single lane). If the project insists on zero bespoke code, material tracks are a workable **provisional shim** (wire 10 `DefaultMaterialParameters` with kinds `number|color` and treat group's `material.overrides` as shadow defaults) — but the research recommendation is to graduate to option B before GA, and ADR 0008's reasoning applies verbatim.

---

## 5. Extension point inventory — where to touch

Below is the exhaustive file:line checklist for **option B (bespoke, recommended)** — validated against current trunk (commit `c167b29`).

### 5.1 Property registry

| Step | File:line | Action |
|------|-----------|--------|
| B-01 | `frontend/src/engine/animationProperties.ts:4-54` | Add `SHADOW_ANIMATABLE_PROPERTIES = ['shadowOffsetX','shadowOffsetY','shadowScaleX','shadowScaleY','shadowSkewX','shadowSkewY','shadowRotation','shadowBlur','shadowOpacity','shadowColor'] as const` (naming with `shadow` prefix avoids collision with `scaleX`/`rotation`/`opacity` at `4-11`). Types `ShadowAnimationProperty`, `ShadowPropertyValues`, validators `requireShadowAnimationProperty`, `requireShadowKeyframeValue` (switch on property: numeric params via `requireFiniteNumber`, `shadowBlur` via `requireFiniteNumber>=0` like `requireTableKeyframeValue` at `133-143`, `shadowOpacity` via `requireOpacity` at `guards.ts:41-46`, `shadowColor` via `requireHexColor` at `materialKeyframes.ts:50-55` i.e. `^#[0-9a-fA-F]{6}$`). Mirror `CIRCLE_ANIMATABLE_PROPERTIES`/`TABLE_ANIMATABLE_PROPERTIES` pattern. |
| B-02 | `frontend/src/engine/shadowEffect.ts` (new) | Canonical `ShadowEffect` defaults + `DEFAULT_SHADOW_EFFECT: ShadowEffect = {offsetX:8, offsetY:8, scaleX:1, scaleY:1, skewX:0, skewY:0, rotation:0, blur:8, opacity:0.45, color:'#000000', enabled:true}` + `EvaluatedShadowState` type + `SHADOW_PARAM_KINDS: Record<ShadowProperty, string>` (`number|color`) for interpolator dispatch. Imported by `animationProperties.ts`, `materialTrackEvaluation` alternative, and `sceneNode` ownership site. |
| B-03 | `frontend/src/engine/animationProperties.ts:40-52` | Add `SHADOW_ANIMATABLE_PROPERTY_VALUES` and validators alongside `ANIMATABLE_PROPERTY_VALUES`/`CIRCLE_ANIMATABLE_PROPERTY_VALUES` (`40-42`). |

### 5.2 NodeAnimation — the per-node store

| Step | File:line | Action |
|------|-----------|--------|
| B-04 | `frontend/src/engine/nodeAnimation.ts:34-43` | Add `#shadowTracks = new Map<ShadowAnimationProperty, Keyframe[]>()` alongside `#circleTracks:38`/`#tableTracks:39` (or 10 arrays; map mirrors `#tracks` and is easier for generic loops). |
| B-05 | `frontend/src/engine/nodeAnimation.ts:44-98` | Add `shadowKeyframes(property)`, `hasShadowTrack(property)`, `shadowTrackKeys()` mirroring `circleKeyframes/hasCircleTrack/circleTrackKeys` at `76-98`. |
| B-06 | `frontend/src/engine/nodeAnimation.ts:191-197,215-221` | Add `addShadow(property, kf)` / `removeShadow(property, kfId)` mirroring `addCircle/addTable` at `191-197`. |
| B-07 | `frontend/src/engine/nodeAnimation.ts:234-241,243-285` | Add `getShadow(property,kfId)` at `234-241` row and `copy()` clone loop at `243-285` mirroring `circleTracks` clone at `263-268`. |
| B-08 | `frontend/src/engine/nodeAnimation.ts:311-325,334-344` | Add `shadowTracksJSON(): ShadowTrackJSON[]`/`shadowTrackJSON()` mirroring `circleTracksJSON` at `311-317`/`tableTracksJSON` at `319-325`; `visibleTrackJSON`/`morphTrackJSON` at `327-344` show single-track serialisation when needed. |
| B-09 | `frontend/src/engine/nodeAnimation.ts:354-432` | Extend `NodeAnimation.fromJSON` to read `shadowTracks` array: validate `Array.isArray(json.shadowTracks)` then loop `readShadowTrack` (new) — mirroring `readCircleTrack` at `485-510` / `readTableTrack` at `512-537` / `readVisibleTrack` at `539-560` / `readMorphTrack` at `584-614`. Hook legacy-migration hook like `readMorphTrack`'s `legacyBinding` param if shadow color format evolves. |
| B-10 | `frontend/src/engine/nodeAnimation.ts:505+` | Add `readShadowTrack(animation, track, duration, node)` helper: verify `isGroupNode(node)` or `node.children.length>0` (if shadow only on groups — else allow any node), call `requireShadowAnimationProperty(track.property)` / `requireShadowKeyframeValue(property, value, what)` for validator. |
| B-11 | `frontend/src/engine/nodeAnimation.ts:616-706` | Helpers `insertSorted` at `616-628` / `removeById` at `630-648` / `copyKeyframe` at `650-665` / `trackKeyframeParser` at `667-704` — reuse as-is for shadow (pass property-specific `valueOf`). |

Alternative compact shape: one `#shadow: Map<ShadowProperty, Keyframe[]>` (chosen) vs 10 discrete `#shadowOffsetX: Keyframe[]` fields. Map is smaller wiring; discrete is faster lookup. Recommendation is map — `circleTracks` already uses it.

### 5.3 SlideAnimation — slide-wide orchestration

| Step | File:line | Action |
|------|-----------|--------|
| B-12 | `frontend/src/engine/slideAnimation.ts:7-15` | Import `SHADOW_ANIMATABLE_PROPERTIES` alongside `CIRCLE`/`TABLE` at `7-15`. |
| B-13 | `frontend/src/engine/slideAnimation.ts:17-53` | Extend `ClampedKeyframe` union with `{readonly nodeId, readonly shadowProperty: ShadowAnimationProperty, keyframeId, oldTime}` branch mirroring `circleProperty`/`tableProperty`/`visible`/`morph` at `17-53`. |
| B-14 | `frontend/src/engine/slideAnimation.ts:87-180` | Extend `clampKeyframesTo` loop with `for (const property of SHADOW_ANIMATABLE_PROPERTIES) for (const kf of animation.shadowKeyframes(property)) if (kf.time>duration) {...}` mirroring circle (`116-128`) / table (`129-141`) / visible (`156-166`) / morph (`167-177`). |
| B-15 | `frontend/src/engine/slideAnimation.ts:182-217` | Extend `toJSON` to write `shadowTracks` alongside `circleTracks`/`tableTracks`/`visibleTrack`/`morphTrack` at `188-213` (pattern: `const shadowTracks = animation.shadowTracksJSON(); ...(shadowTracks.length>0?{shadowTracks}:{})`). |
| B-16 | `frontend/src/engine/slideAnimation.ts:219-252` | No change needed beyond `NodeAnimation.fromJSON` dispatch; `fromJSON` validates via that call. |

### 5.4 Keyframe target resolution

| Step | File:line | Action |
|------|-----------|--------|
| B-17 | `frontend/src/engine/keyframeTarget.ts:49-79` | Add `NodeShadowTarget {kind:'shadow', nodeId, property: ShadowAnimationProperty}` interface mirroring `NodeCircleTarget:49-54` / `NodeTableTarget:56-61` / `NodeVisibleTarget:63-67` / `NodeMorphTarget:70-73`. |
| B-18 | `frontend/src/engine/keyframeTarget.ts:86-94` | Extend `KeyframeTarget` union to include `NodeShadowTarget` (alongside 7 existing). |
| B-19 | `frontend/src/engine/keyframeTarget.ts:96-126` | Add `isShadowTarget(target)` predicate mirroring `isCircleTarget:112-114` / `isTableTarget:116-118`. |
| B-20 | `frontend/src/engine/keyframeTarget.ts:128-171` | Extend `requireKeyframeTarget` with `if (isRecord(value) && value.kind==='shadow') { nodeId=requireString(...); property=requireShadowAnimationProperty(value.property); return {kind:'shadow', nodeId, property} }` mirroring circle at `147-151` / table at `152-156`. |
| B-21 | `frontend/src/engine/keyframeTarget.ts:185-199` | Extend `KeyframeTrackRef` with `{kind:'shadow', property: ShadowAnimationProperty}` mirroring `circle`/`table`/`visible`/`morph` at `191-198`. |
| B-22 | `frontend/src/engine/keyframeTarget.ts:200-236` | Extend `resolveKeyframeTrack` with `if (isShadowTarget(target)) return {kind:'shadow', property: requireAnimatableForShadow(node, target.property)}` mirroring `isCircleTarget:218-220` / `isTableTarget:224-226`. Add `requireAnimatableForShadow(node, property)` helper in `animationProperties.ts` gating on `isGroupNode(node)` (or children check) like `requireAnimatableForCircle:112-121` gating on `node.components.circle`. |
| B-23 | `frontend/src/engine/keyframeTarget.ts:239-283` | Extend `requireTrackKeyframeValue` with `if (track.kind==='shadow') return requireShadowKeyframeValue(track.property, value, what)` mirroring `circle:273-275` / `table:276-278` / `visible:244-248` / `morph:250-263`. |
| B-24 | `frontend/src/engine/keyframeTarget.ts:285-313` | Extend `requireNodeTarget`'s whitelist at `296-303` to include `kind==='shadow'` (currently enumerates 6 kinds). |

### 5.5 AnimationManager — timeline editing

| Step | File:line | Action |
|------|-----------|--------|
| B-25 | `frontend/src/engine/animationManager.ts:97-115,117-134` | Add `getShadowKeyframes(nodeId, property)` alongside `getVisibleKeyframes:97-115`; `hasShadowTrack` if desired. Manager dispatch at `addKeyframe:117-134` only needs `resolveKeyframeTrack` + `requireTrackKeyframeValue` hooks (B-22/B-23) to work — no explicit `if (track.kind==='shadow')` branch except in helpers below. |
| B-26 | `frontend/src/engine/animationManager.ts:370-429` | Extend `keyframesOf:370-391` with `if (track.kind==='shadow') return animation.shadowKeyframes(track.property)`, similarly `#addToTrack:393-410` (`animation.addShadow`), `#removeFromTrack:412-429` (`animation.removeShadow`), `#requireKeyframe:431-467` (`animation.getShadow`). Mirror `circle`/`table` arms at `385-390`/`403-406`/`423-426`/`444-446`. |
| B-27 | `frontend/src/engine/animationManager.ts:246-260,382-404` | `#validateMoves`/`#assertTimeFree`/`#trackLabel` already route through `#keyframesOf` — no change. `pasteKeyframes:261-311`'s `resolve+requireTrackKeyframeValue` + `addToTrack` path covers shadow. `previousInterpolation:577-589` is generic. Visible's hold enforcement at `124-130`/`287-292` should be mirrored for any hold-only shadow param if one (none currently; color is continuous, so no hold gate — but `shadowColor` could be gated as `kind==='color'` continuous, so no hold). |
| B-28 | `frontend/src/engine/animatableParameters.ts:74-165` | Extend `getAnimatableParameters` to expose shadow params when node is a group: add `for (const prop of SHADOW_ANIMATABLE_PROPERTIES) result.push({key: shadowKey(prop), label: SHADOW_LABELS[prop], kind: shadowKind(prop), source:'shadow', linked: hasShadowTrack(prop)})` guarded by `if (isGroupNode(node) || node.children.length>0)` before the material loop at `111-125`. Add `SHADOW_LABELS`/`shadowKind` mapping like `CIRCLE_LABELS:36-41`/`TABLE_LABELS:43-46`. Extend `AnimatableParameter.source` union at `22` to include `'shadow'`. Ensure `BUILT_IN_MATERIAL_KEYS` filtering at `48-52` does not hide shadow keys. |
| B-29 | `frontend/src/engine/animatableParameters.ts:14-25` | `AnimatableParameter.source` currently `standard|material|dataLabel|circle|table` — add `| 'shadow'` (and `'visible'| 'morph'` exist today only as targets, not parameter entries — shadow should be a source like `circle`/`table`). |

### 5.6 AnimationEvaluator — evaluated shadow state

| Step | File:line | Action |
|------|-----------|--------|
| B-30 | `frontend/src/engine/animationEvaluator.ts:22-67` | Add `EvaluatedShadowState { readonly offsetX:number; readonly offsetY:number; readonly scaleX:number; readonly scaleY:number; readonly skewX:number; readonly skewY:number; readonly rotation:number; readonly blur:number; readonly opacity:number; readonly color:string }` and helpers `evaluatedShadowScratch(): EvaluatedShadowScratch`, `evaluatedShadowsEqual`, `copyEvaluatedShadow` mirroring `EvaluatedNodeScratch` at `37-41` / `EvaluatedCircleState` at `43-48` / `EvaluatedTableState` at `50-53` / helpers at `55-67`/`69-103`. |
| B-31 | `frontend/src/engine/animationEvaluator.ts:105-112,755-774` | Do **not** extend `CHANNEL_TO_TRANSFORM_KEY`; shadow is not a transform. Add parallel `SHADOW_TO_STATE_KEY` if shadow lives in `EvaluatedNodeState`, but recommended is standalone state; clip-layering for shadow should use its own `#getShadowChannelValue`/`#setShadowChannelValue` pair mirroring `#getChannelValue/#setChannelValue` at `755-774`. |
| B-32 | `frontend/src/engine/animationEvaluator.ts:132-161,163-192,260-301` | Add `evaluateShadow(nodeId,time): EvaluatedShadowState\|null` alongside `evaluateVisible:163`/`evaluateMorph:194`/`evaluateMorphValue:201`/`evaluateMorphVertices:260`/`evaluateCircle:601`/`evaluateTable:636`. Logic mirrors `evaluateCircle`/`evaluateTable`: look up `node`, `slide`, `clampedTime`, `animation = slide.animation.node(nodeId)`, then for each `SHADOW_ANIMATABLE_PROPERTIES` iterate: `const fallback = shadowEffect[node].prop ?? DEFAULT_SHADOW_EFFECT[prop]` (from `NodeComponents.shadowEffect` or `SceneNode.shadowEffect` — see §7 ownership), then `const v = this.#evaluate(animation?.shadowKeyframes(prop), clampedTime, fallback)` for numeric props; for `shadowColor` call dedicated hex path. |
| B-33 | `frontend/src/engine/animationEvaluator.ts:33-45,511-525,883-903` | Add `evaluateShadowColor` helper mirroring `evaluateMaterialTrackValue`'s color branch at `materialTrackEvaluation.ts:76,112-124` — either (a) branch inside `evaluateShadow`: if `prop==='shadowColor'` use `evaluateMaterialTrackValue`-style hex lerp (`lerpHexColor` at `112-124`), else `evaluateSegment` path; or (b) new shadow-specific `#evaluateShadowColorKeyframes` that reuses `evaluateMaterialTrackValue` by passing `kind='color'` and a synthetic `key` (no clamping beyond hex). Numeric props all go through existing `evaluateSegment` → hold/linear/bezier/bounce/elastic/spring dispatch (`interpolators.ts:28`), so parametric family works for free. Table/circle numeric props already prove this path via `#evaluate` at `883-903`. |
| B-34 | `frontend/src/engine/animationEvaluator.ts:684-753,781-859` | Add shadow clip layering: new private `#applyClipShadowInstances(node, time, state: EvaluatedShadowScratch)` mirroring `#applyClipInstances:684` (standard) and `#applyClipMaterialOverrides:781` (material). Signature `time→u` mapping at `714-717` (`u = clamp((time-start)*speed/duration,0,1)`) is shared; for each `channelDef` where `materialParameter` absent and `property` in shadow set, `clip.shadowChannelAnimation(prop)` at `??` (new accessor) → `#evaluateClipChannel` at `861-881` → gain/offset composition (`740-750` / `836-848` pattern) → `#setShadowChannelValue`. Guard: `if (isCamera && channel==='rotation') continue` at `722-725` needs no shadow analogue; group-only shadow clips still apply to any target with `shadowEffect`. Alternatively fold shadow channels into existing `#applyClipInstances` by extending its `for (const channelDef of clip.channels)` at `719-751` to also check `clip.shadowChannelAnimation(materialParamKey)` — but loop over `clip.channels` vs `clip.shadowChannelAnimations` separation mirrors material channels' separate loop at `816-857`, so a separate method is cleaner. Call site: `evaluateShadow` calls `#applyClipShadowInstances` after its base evaluation (last-wins). |
| B-35 | `frontend/src/engine/animationEvaluator.ts:861-903` | `#evaluateClipChannel:861-881` is generic numeric — valid for shadow numeric props. `shadowColor` clip channel needs hex lerp: reuse `lerpHexColor` at `materialTrackEvaluation.ts:112` via helper; clip's `shadowColor` keyframes hold hex strings, so `#evaluateClipChannel`'s `value as number` cast at `867-873` would break — color clip channel needs separate `#evaluateClipShadowColor` walk that interleaves hex lerp with ratio logic at `876-877` replicating `materialTrackEvaluation.ts:32-43`. |
| B-36 | `frontend/src/engine/animationEvaluator.ts:534-577` | `evaluateMaterialOverrides` remains separate — shadow does not flow through it. |
| B-37 | `frontend/src/engine/animationEvaluator.ts:69-103` | Add `evaluatedShadowsEqual` / `copyEvaluatedShadow` beside `evaluatedStatesEqual`/`copyEvaluatedState` for `sceneRenderer` early-out gating. |

Evaluator ordering guarantee (answers ticket):

```
animationEvaluator.evaluateNode  (animationEvaluator.ts:132-161)
  ├─ 141-155  #evaluate for positionX/Y/rotation/scaleX/scaleY/opacity
  ├─ 156      evaluateVisible (hold-only, separate lane)
  ├─ NEW     evaluateShadow (bespoke, after visible — reads final visible/opacity)
  └─ 158      #applyClipInstances (standard clips last-wins, in instance array order)
             └─ NEW  #applyClipShadowInstances (shadow clip last-wins, same order)
                     invokes #evaluateClipChannel / #evaluateClipShadowColor

sceneRenderer.#evaluateAndApply (sceneRenderer.ts:902-1046)
  ├─ 997  evaluateNode
  ├─ 998-1002 evaluateMaterialOverrides + resolveMaterial
  ├─ 941-967  evaluateCircle (if circle)
  ├─ 968-996  evaluateTable (if table)
  ├─ NEW     evaluateShadow (bespoke) → EvaluatedShadowState
  └─ 1016    applyEvaluatedState writes container transform/alpha/visible;
             NEW applyShadowState writes shadowSprite offset/scale/skew/rotation/blur/tint/alpha
```

Shadow after opacity/visible ensures `shadowSprite.alpha = state.opacity * opacityMultiplier * shadow.opacity` and `shadowSprite.visible = state.visible && shadowEnabled` are correct; before clip layering ensures clips can override shadow params same as transform (last-wins).

### 5.7 ClipDefinition — portable clip channels

| Step | File:line | Action |
|------|-----------|--------|
| B-38 | `frontend/src/engine/clipDefinition.ts:1-33` | Import `ShadowAnimationProperty` and `SHADOW_ANIMATABLE_PROPERTIES`; add `CLIP_SHADOW_CHANNELS: readonly ShadowAnimationProperty[] = [...]` alongside `CLIP_CHANNELS:26-33` / `CLIP_CIRCLE_CHANNELS:35-40`. |
| B-39 | `frontend/src/engine/clipDefinition.ts:54-63` | `ClipChannelDef` (`54-63`) stores `property:ClipChannel` + `paramKey?` + `linkMode?` + `materialParameter?`; shadow channels are not `ClipChannelDef` entries — they are a parallel map like `materialParameter`. Recommended: add `#shadowChannelAnimations = new Map<ShadowProperty, ClipChannelAnimation>()` at `202-206` alongside `#materialChannelAnimations:203` / `#visibleAnimation:204` / `#circleAnimations:205` / `#morphAnimation:206`. Each key maps to a `ClipChannelAnimation` with its own validator (numeric vs hex). |
| B-40 | `frontend/src/engine/clipDefinition.ts:75-184` | `ClipChannelAnimation` (`75-139`) is generic (`Keyframe[]` + `fromJSON(valueValidator)` at `139-184`). Shadow numeric channels use `fromJSON` with `requireFiniteNumber` at `125-128`; `shadowColor` channel uses `fromJSONWithKind` at `133-139` with `requireHexColor` at `materialKeyframes.ts:50-55` pattern (`ClipChannelAnimation.fromJSONWithKind(animJson, (v,id)=>requireHexColor(v,\`Clip shadow keyframe "${id}"\`))`). Time validator at `161-164` enforces `[0,1]` normalized. |
| B-41 | `frontend/src/engine/clipDefinition.ts:231-330` | Accessors: `shadowAnimation(property): ClipChannelAnimation|undefined` mirroring `circleAnimation:355-357`, `hasShadowTrack(property):boolean` mirroring `hasCircleTrack:335-338`, `shadowChannelParameterKeys: string[]` mirroring `materialChannelParameterKeys:311-313`, `getShadowKeyframes(property)` mirroring `getCircleKeyframes:331-333`. |
| B-42 | `frontend/src/engine/clipDefinition.ts:383-460` | Mutators: `addShadowKeyframe(property,kf)` mirroring `addCircleKeyframe:405-412` / `addMorphKeyframe:414-416`, `removeShadowKeyframe(property,kfId)` mirroring `removeCircleKeyframe:444-456` / `removeMorphKeyframe:458-460`, `removeShadowChannel(property)` mirroring `removeChannel:462-465`/`removeMaterialChannel:467-470`, `addChannel(channelDef)` at `472-486` needs shadow variant `addShadowChannel(property)` or treat shadow channels as always keyed by `ShadowProperty` without `ClipChannelDef`. |
| B-43 | `frontend/src/engine/clipDefinition.ts:515-559,561-599` | `copy()` at `515-559` must clone shadow animations (loop over `#shadowChannelAnimations.entries()` like `circleAnimations` at `543-545` and `morphAnimation` at `546-557`). `toJSON()` at `561-599` writes `shadowChannelAnimations: Object.fromEntries(...)` when non-empty (like `circleChannelAnimations` at `590-594`, `morphAnimation` at `595-597`). `materialChannelAnimations` at `580-585` pattern for param-keyed entries. |
| B-44 | `frontend/src/engine/clipDefinition.ts:601-774` | `fromJSON()` at `601-774` reads `shadowChannelAnimations` object via `isRecord(json.shadowChannelAnimations)` pattern at `692-703` (circle), `672-692` (visible), `704-772` (morph), dispatching with `ClipChannelAnimation.fromJSON` for numeric shadow params and `fromJSONWithKind(..., requireHexColor)` for `shadowColor` (mirrors visible's `fromJSONWithKind` at `674-679` with boolean validator). Also handle `params` + `channels` arrays at `615-651` — shadow channels do **not** belong in `ClipChannelDef[]` `channels` (like morph at `docs/adr/0008:Decision 1`), so no `CLIP_CHANNELS` pollution. |
| B-45 | `frontend/src/engine/json.ts:348-371` | `ClipJSON` (`359-371`) gains optional `shadowChannelAnimations?: Readonly<Record<string, ClipChannelJSON>>` aliasing `circleChannelAnimations?:...:369`. Existing `ClipJSON` optional fields (`materialChannelAnimations:367`, `visibleAnimation:368`, `circleChannelAnimations:369`, `morphAnimation:370`) show the additive optional-field pattern (no version bump). |

### 5.8 ClipCollection — hierarchical broadcast by semanticName

| Step | File:line | Action |
|------|-----------|--------|
| B-46 | `frontend/src/engine/clipCollection.ts:1-134` | **No change required.** `ClipCollection` at `9-50` is type-erased: `bindings: Map<string,string>` (`12`) from `semanticName` to `clipId` (`getBindingsObject:53`, `hasBinding:57`, `toJSON:80-87` serialises `Record<string,string>`). Same binding carries clips containing shadow channels as it carries morph clips (ADR 0008 §4). Export walks parent subtree via `walkPreOrder` → per-node `clipInstances` / `hasShadowTrack`; apply walks target subtree broadcasting each `clipId` to nodes with matching `semanticName` — identical to morph/visible/circle broadcasting. Rationale: `docs/adr/0008:Decision 4` explicitly rejected morph-specific naming; that reasoning applies to shadows. |
| B-47 | `frontend/src/engine/clipCollectionManager.ts` | Same — no-op. Manager delegates to `ClipCollection`. |
| B-48 | `frontend/src/engine/reusableObject.ts:1-221` | `ReusableObjectJSON` at `5-16` carries `nodes:NodeJSON[]` (with shadow effect fields, see §7) + `animation?:SlideAnimationJSON` (with `shadowTracks`, see B-08) + `library?:LessonLibraryJSON` (with `shadowChannelAnimations` clips, see B-45). `validateReusableObject` at `20-221` checks `library.clips`/`library.clipCollections` arrays at `136-175` — add optional shadow field tolerance (non-fatal). Shape-specific quirk: morph needed `shapeIdMap` remapping on import because shape ids are per-node random (`docs/adr/0008:Decision 5`); **shadow has no such translation** — color hex and numeric projection params are geometry-free, so import/export copies shadow state verbatim. No remapping table needed. |

### 5.9 ClipExtraction

| Step | File:line | Action |
|------|-----------|--------|
| B-49 | `frontend/src/engine/clipExtraction.ts:6-24` | `ExtractableKeyframe` (`6-14`) / `NormalizedKeyframe` (`16-24`) are generic over `KeyframeTarget` — no change; they already carry `target` discriminated union that will include `NodeShadowTarget` after B-17. |
| B-50 | `frontend/src/engine/clipExtraction.ts:33-48,50-123` | `computeExtractionBounds` (`33-48`) generic (min/max over `kf.time`) — no change. `normalizeExtractable` (`50-123`) normalizes time `(t-selStart)/selDuration` at `55` and tangent time ÷ selDuration at `58-64` — generic. Must add per-shadow validation at `79-112` row: `if (isShadowTarget(kf.target)) { if (kf.target.property==='shadowColor') requireHexColor(normalizedValue, ...) else if (prop==='shadowBlur' && value<0) throw; if (prop==='shadowOpacity' && (value<0||value>1)) throw bound; }` mirroring `isOpacityTarget:125-127` / `isMorphTarget:129-131` + morph validation block at `85-112`. Color is hex — no numeric interval; diffuse gate at `81-84` (opacity) & `85-112` (morph) pattern. |
| B-51 | `frontend/src/engine/clipExtraction.ts:133-170` | Extend `NormalizedChannelKey` (`133-140`) with `| {kind:'shadow', property:ShadowAnimationProperty}` mirroring `morph:140`/`visible:135`/`circle:136`. Extend `channelKeyOf` (`142-170`) with `if (target.kind==='shadow') return \`shadow:${target.property}\`` mirroring `visible` at `151-153` / `morph` at `154-156` / `circle` at `157-159` / `clip` at `167`. Per-property key ensures `shadowOffsetX` and `shadowScaleY` don't collide in `groupNormalizedByChannel`. This is the correct grouping — same rationale as `circle:radius` vs `circle:segments` at `158`. |
| B-52 | `frontend/src/engine/clipExtraction.ts:172-222` | `groupNormalizedByChannel` (`172-190`) sorts each group by `time` — generic; `validateNoDuplicateTimes` (`192-222`) checks per-channel `seen` rounded at `199-201` and `existingTimesByKey` at `207-220` — generic. No shadow-specific change. |
| B-53 | `frontend/src/engine/clipExtraction.ts:224-252` | `createNormalizedClipKeyframes` (`224-234`) / `toClipKeyframes` (`240-252`) create `KeyframeModel(newKeyframeId(), nk.time, nk.value, ...)` at `242-250` — value copied verbatim (numeric or hex), time in `[0,1]` — works for shadow. |
| B-54 | `frontend/src/engine/clipManager.ts:94-148,383+` | `ClipManager.duplicateClip` at `94-148` regenerates keyframe ids per channel: loops over `channelAnimations`, `materialChannelAnimations`, `visibleAnimation` (`119-125`), `circleChannelAnimations` (`126-136`), `morphAnimation` (`137-143`) — must add `shadowChannelAnimations` loop `if (shadowJson) for (anim of Object.values(shadowJson)) for (kf of anim.keyframes) kf.id=newKeyframeId()` mirroring morph path (`137-143`). Similar regeneration needed in any bulk-id rotation. |

### 5.10 Serialization — lesson & reusable object

| Step | File:line | Action |
|------|-----------|--------|
| B-55 | `frontend/src/engine/json.ts:19-98,99-391` | Define `ShadowTrackJSON: {property:string, keyframes:KeyframeJSON[]}` (`142-165` pattern) alongside `CircleTrackJSON:157-160`/`TableTrackJSON:162-165`/`VisibleTrackJSON:167-169`/`MorphTrackJSON:176-177`. Extend `NodeAnimationJSON:180-190` with optional `shadowTracks?: readonly ShadowTrackJSON[]`. Extend `NodeJSON:114-126` / `NodeComponentsJSON:19-98` with shadow effect static fields — see §7 for ownership choice; at minimum `NodeJSON.shadowEffect?: ShadowEffectJSON` beside `opacity:122`/`material:123`/`components:124`. |
| B-56 | `frontend/src/engine/lessonSerializer.ts:19-113,211-821` | `validateNode` at `365-551` must tolerate `node.shadowEffect` object (validate each field's kind/range: `offsetX/Y finite`, `scaleX/Y ≥0`, `skewX/Y finite`, `rotation finite`, `blur ≥0`, `opacity 0..1`, `color hex`). `validateAnimation` at `553-821` enters `for (const entry of animation.nodes)` at `571-819`; add branch reading `entry.shadowTracks` array identical to `circleTracks` at `680-709` / `tableTracks` at `710-739` / `visibleTrack` at `740-765` / `morphTrack` at `766-804`: `if (!Array.isArray(entry.shadowTracks)) push('Node animation shadowTracks must be an array')` else loop `requireShadowProperty:1095-1103` pattern (`requireAnimationProperty` structure) and `validateKeyframeList` at `602-620` with per-prop validator (`opacity∈[0,1]`, `blur≥0`, `color hex`, other numeric finite). Wire global `keyframeIds: Set<string>` dedup at `202-206` continues — reuse `validateKeyframeList` at `lessonValidation.ts`. `buildProjectFromJSON` at `823-876` already calls `SlideAnimation.fromJSON` which delegates to `NodeAnimation.fromJSON` — shadow validation flows through there; no extra resolver needed. |
| B-57 | `frontend/src/engine/librarySection.ts` | `validateLibraryClips` already tolerates missing optional channel animations (`morphAnimation` tolerated) — add `shadowChannelAnimations` to the known-optional set so a clip missing it does not fire `unknown field`. Structural check on `library.clips`/`library.clipCollections` mirrors `reusableObject.ts:136-175` tolerant-optional pattern. |
| B-58 | `frontend/src/engine/reusableObject.ts:20-221` | See B-48. |

### 5.11 Dirty/early-out & exports

| Step | File:line | Action |
|------|-----------|--------|
| B-59 | `frontend/src/engine/export.ts` | `EXPORT_VERSION` bump if shadow changes determinism payload shape; `getExportFrameTimestamps` already evaluates at `t=i/fps` (`CONTEXT.md` Video Export). Preview (`sceneRenderer`) and export must share `evaluateShadow` path for pixel-identical frames (ADR 0008 §6 requirement for morph determinism applies verbatim). No separate FFmpeg baking. |

---

## 6. Interpolation datum — color and the parametric family

### 6.1 Color (`shadowColor`)

Material history settled this: **continuous kinds interpolate linearly per-channel, discrete kinds hold** (`materialTrackEvaluation.ts:13-52` comment at `5-11`, `isContinuousMaterialKind` at `54-63` where `color` is continuous (`59`), `interpolateMaterialValue`'s `case 'color'` at `76` calls `lerpHexColor` at `112-124` which does `parseInt(slice(1,3),16)` per channel + `hexChannel` integer rounding at `126-130`). Discrete kinds (`int, bool, sampler2D`) at `54-63` use the hold walk at `46-51`.

Shadow color must follow the **same** rule. So `shadowColor` track's interpolator:

* `interpolation==='hold'` → immediately return `from.value` (`evaluateMaterialTrackValue` else-branch implication; shadow bespoke would check `if (from.interpolation==='hold') return from.value as string` like morph's hold at `animationEvaluator.ts:319/361`).
* Otherwise → `lerpHexColor(fromHex, toHex, ratio)` where `ratio = (time-from.time)/(to.time-from.time)` at `32`, clamped `Math.min(Math.max(...,0),1)` at quote at `materialTrackEvaluation.ts:94-100` for opacity/alpha only — for hex, no clamping needed beyond 0..1 ratio.

Special note: `evaluateSegment` at `interpolators.ts:28` assumes `value as number` (`34,39`) — applying it to hex strings would yield `NaN`. So `shadowColor` must **not** route through `evaluateSegment`; it needs its own hex path (material path precedent). The bespoke evaluator handles this branch cleanly; option A (transform numeric path) would hide it incorrectly.

### 6.2 Parametric family (bounce / elastic / spring)

`interpolators.ts:70-126` registers `bounce`/`elastic`/`spring` as `parametricSegment` at `124-126` that eases `ratio` via `easing(n)` at `73-76` but still applies it as `from + (to-from)*eased` with `from/to` cast to numbers (`76`). Material evaluation **ignores** these: `materialTrackEvaluation.ts:32` computes raw `ratio` without consulting `KeyFrame.interpolation`'s registry — intentionally, because discrete/continuous decision gates there, and material curves are linear per-channel. Shadow discussion: should shadow numeric params support bezier + parametric easings on a per-segment basis like transform channels, or linear-only like material?

Recommendation: **full segment interpolator registry** for **shadow numeric params** (`evaluateSegment` path), and **linear-only for color** (material-style per-channel lerp). This matches: position/rotation/scale support hold/linear/bezier/bounce/elastic/spring (`interpolators.ts:66-68` registry + `evaluateSegment`); morph's cross-blend at `animationEvaluator.ts:327-328,461` reuses `evaluateSegment` via synthetic 0→1; table opacity? Actually numeric. For shadows: numeric offset/scale/skew/rotation/blur/opacity are **motion curves** — they benefit from bounce/elastic (e.g. shadow bounce on contact). Color is **appearance** — linear per-channel is sufficient; bezier on a hex string would be nonsense (tangents have no meaning for color).

Implementation: shadow numeric evaluator calls `evaluateSegment(from,to,clampedTime)` via new `#evaluateShadowNumeric` that delegates to `evaluateSegment` (already interpolator-agnostic). Color evaluator calls `lerpHexColor` with linear ratio only (or if `from.interpolation==='hold'` honor it). This mirrors morph's hybrid: coefficient linear-with-eased progress via `#easedProgress` synthetic `evaluateSegment` (`animationEvaluator.ts:511-525`), binding held.

### 6.3 Hold vs linear per param

Only color might be considered hold-only if we want hard cuts (dark→light instant). Current proposal treats it as continuous linear — matches material color (`materialTrackEvaluation.ts:58`). If a future pass wants hold-only color (e.g. toggled shadow tints), `Interpolation` picker already surfaces `hold` (`keyframe.ts:5`) — user picks it per-segment, not globally; `requireKeyframeValue` gate at `keyframe.ts:28-40` already allows hold on any property. So both paths are covered without a per-kind policy beyond clamp.

---

## 7. Shadow effect ownership: `NodeComponents.shadowEffect` vs `SceneNode.shadowEffect`

Current tree: `SceneNode.components: NodeComponents` at `sceneNode.ts:47` (frozen via `freezeComponents` at `components.ts:554-614` + `copyComponents` at `117-156`); `SceneNode.shadowEffect` does not exist.

| Option | Location | Analogous precedent |
|--------|----------|---------------------|
| **O1 `SceneNode.shadowEffect`** | `sceneNode.ts:37-50` alongside `material:46`, `opacity:45`, `visible:44`, `clipInstances:48` | `SceneNode.visible` (`44`) and `SceneNode.opacity` (`45`) are receiver-level properties storing the **fallback** for animation (`evaluateNode` fallback at `animationEvaluator.ts:141-155` reads `transform.*`/`node.opacity`/`node.visible`). Shadow fallback would be needed for `evaluateShadow` when no keyframe at time. |
| **O2 `NodeComponents.shadowEffect`** | `components.ts:103-115` adding `readonly shadowEffect?: ShadowEffect` | `components.circle` (`114`) / `components.table` (`110`) / `components.mesh/shapes` (`55-62` + `shape.ts:6`) are **typed storage** for component-defined geometry. Shadow is an **effect on a group** — not geometry but effect — but groups are **defined by absence of components** (`isGroupNode` at `sceneNode.ts:172`), so `NodeComponents.shadowEffect` on a group would be the sole component (making it no longer a pure group — breaks `isGroupNode`). |
| **O3 Hybrid: `SceneNode.shadowEffect` static + `NodeComponents.shadowEffect` rendering flag** | static on the node + flag on leaf | Unnecessary split. |

Analysis:

* `NodeComponents` is the **kind identity** mechanism (`sceneNode.ts:171-174` comment: node's kind is defined by the components it carries, not a type field; `CONTEXT.md` Component). Adding `shadowEffect` to `NodeComponents` would make a shadow-carrying group acquire a component `shadowEffect`; `isGroupNode` would then return `false` for that group (since `Object.keys(components).length>0`), breaking group tests at `isGroupNode:172`, `research/shadow-renderer-findings.md:85-96`, and the renderer's table/bone special paths (`nodeRenderer.ts:57-96` branch). The manager would need to special-case `isGroupNode` to ignore `shadowEffect` — fragile and un-convex (every future `isGroupNode` caller must remember the exception).

* `SceneNode.shadowEffect` keeps the component abstraction pure: a group node remains a component-empty parent whose shadow is an **attached effect**, not a component. This matches `visible`/`opacity`/`material`/`clipInstances` which are all `SceneNode`-level receivers evaluated via `evaluateNode/evaluateMaterialOverrides` (outside `components`). `sceneNode.ts:47` already documents `material: MaterialInstance` on every node, even though only renderable nodes use it; shadow would follow the same “every node may carry a `ShadowEffect` but only groups render it” convention, with `evaluateShadow` treating non-groups as fallback `null` (renderer checks `isGroupNode(node)` before evaluating).

* JSON/portability: `SceneNode.toJSON` at `sceneNode.ts:82-123` already serialises `material`, `opacity`, `visible`, `components`, `clipInstances` as sibling keys inside `NodeJSON` (`json.ts:114-126`). Adding `shadowEffect?: ShadowEffectJSON` there (alongside `opacity:122`) mirrors existing fallback fields; putting it inside `NodeComponentsJSON` (`json.ts:19-98`) would require component JSON deep-merge.

**Recommendation**: **O1 — `SceneNode.shadowEffect`** (static, typed `ShadowEffect` struct, always present on a group with sensible defaults, optional elsewhere). Concretely:

```ts
// new file shadowEffect.ts (or nodeShadow.ts)
export interface ShadowEffect {
  readonly enabled: boolean;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly skewX: number;  // rad
  readonly skewY: number;  // rad
  readonly rotation: number; // rad
  readonly blur: number;
  readonly opacity: number; // 0..1
  readonly color: string;   // #rrggbb
}
export const DEFAULT_SHADOW_EFFECT: Readonly<ShadowEffect> = { enabled:true, offsetX:8, offsetY:8, scaleX:1, scaleY:1, skewX:0, skewY:0, rotation:0, blur:8, opacity:0.45, color:'#000000' };
export interface ShadowEffectJSON extends ShadowEffect {}
export function shadowEffectFromJSON(json: unknown, nodeId:string): ShadowEffect;
export function shadowEffectToJSON(effect: ShadowEffect): ShadowEffectJSON;
```

Wiring:

* `sceneNode.ts:46` add field `shadowEffect: ShadowEffect` initialized to `DEFAULT_SHADOW_EFFECT` (or `undefined` for non-groups) after `material:47`; `freezeComponents` at `components.ts:554` unchanged; `clone` at `components.ts:117-156` copies `shadowEffect` via `sceneNode.ts:copy`-like path; `toJSON` at `sceneNode.ts:82-123` writes `shadowEffect` when non-default (`...(this.shadowEffect !== DEFAULT ? {shadowEffect: shadowEffectToJSON(this.shadowEffect)}:{})`); `fromJSON` at `125-169` reads it via `shadowEffectFromJSON` (like `materialFromJSON:162`).
* `sceneRenderer` dirty/BBox code path in `research/shadow-renderer-findings.md:6` reads `node.shadowEffect` (static) via `NodeManager.getShadowEffect(nodeId)` and blends with `evaluateShadow` (animated) to produce final `EvaluatedShadowState` — same split as `node.transform` vs evaluated `state.transform` (`animationEvaluator.ts:141-146` reads `transform` as fallback) and `node.material.overrides` vs `evaluateMaterialOverrides` (`534-554` reads `node.material.overrides` as base).
* Alternative if a future need arises for per-leaf shadow toggles (per-object `Cast Shadow` bool): add scalar `castShadow: boolean` on `SceneNode` separate from `shadowEffect` — source model already needs it, but that's a separate component-level field (leaf, not group).

If reviewers prefer `NodeComponents`, document the `isGroupNode` exception at `sceneNode.ts:172` and at every `walkPreOrder` shadow collector (see `research/shadow-renderer-findings.md:230-242`).

---

## 8. End-to-end flow — how a keyframe becomes a pixel

```
TimelineInspector → AnimationManager.addKeyframe({kind:'shadow', nodeId:'groupA', property:'shadowBlur'}, time=1.2, value=16)
  └─ keyframeTarget.ts:resolveKeyframeTrack  (B-22)  → {kind:'shadow', property:'shadowBlur'}
     └─ requireTrackKeyframeValue           (B-23)  → requireShadowKeyframeValue('shadowBlur',16) → 16
        └─ nodeAnimation.ts:addShadow('shadowBlur', Keyframe{time:1.2,value:16,interp:linear}) (B-06)
           └─ slideAnimation.ts:toJSON writes {shadowTracks:[{property:'shadowBlur',keyframes:[...]}]} (B-15)
              └─ json.ts:NodeAnimationJSON.shadowTracks (B-55)

Scrub to t=1.0 → sceneRenderer.#evaluateAndApply('groupA') calls evaluator:
  evaluator.evaluateShadow('groupA',1.0) at (B-32)
    ├─ for each prop: #evaluate(shadowKeyframes,1.0, fallback=shadowEffect[prob] from SceneNode.shadowEffect)
    │     └─ interpolators.evaluateSegment (hold/linear/bezier/bounce/elastic/spring) via trackKeyframeParser's tang interpolation (nodeAnimation.ts:667-704, interpolators.ts:28)
    └─ #applyClipShadowInstances (B-34) last-wins over clip.shadowChannelAnimations (B-43)

  → EvaluatedShadowState{blur:12.3, color:'#1a1a1a', offsetX:..., opacity:...}
     └─ sceneRenderer applies to shadowSprite:
        sprite.position.set(state.offsetX,state.offsetY)
        sprite.scale.set(state.scaleX,state.scaleY)
        sprite.skew.set(state.skewX,state.skewY)
        sprite.rotation = state.rotation
        sprite.blurFilter.strength = state.blur
        sprite.tint = state.color
        sprite.alpha = evaluatedOpacity*state.opacity
        container.visible = evaluatedVisible && shadowEffect.enabled
        container.filters=[blurFilter] (if blur>0)
        RT sizing via BBox union + blur pad (research/shadow-renderer-findings.md:237-249)

Portability:
  Clip extraction selects two shadow keyframes (blur at t=0,2s etc.)
    → clipExtraction.normalizeExtractable recomputes u=(t-selStart)/selDuration, tangentTime/selDuration (clipExtraction.ts:58-64), validates hex/opacity (B-50)
    → channelKeyOf → 'shadow:shadowBlur' (B-51) grouped, validateNoDuplicateTimes (clipExtraction.ts:192), toClipKeyframes (clipExtraction.ts:240)
    → ClipDefinition.shadowChannelAnimations['shadowBlur'].add(kf) (B-42)

  ClipCollection export walkPreOrder(parent) collects nodes with semanticName that have hasShadowTrack or shadow clip instances → Map(semanticName→clipId) (clipCollection.ts:12) unchanged (B-46).
  ClipCollection apply walks target subtree, broadcasts addClipInstance per matching semanticName → AnimationEvaluator layers shadow clip at next scrub.
  ReusableObject export bundles NodeJSON.shadowEffect + SlideAnimationJSON.shadowTracks + LessonLibraryJSON.clips[w/shadowChannelAnimations] (B-48).

Video export at t=i/fps calls same evaluator path → lerpHexColor per-channel for color, evaluateSegment for numeric, clamp blur≥0 / opacity 0..1, deterministic (export.ts, ADR 0008 §6).
```

---

## 9. Risks & mitigations

* **Routing explosion**: 10 properties × 2 surfaces (node + clip) × 5 target verbs (add/move/scale/value/interp) × undo handlers = large surface but templated. Mitigate: single `ShadowProperty` enum + generic per-category helpers (`insertSorted` at `nodeAnimation.ts:616` is already generic) and `ClipManager.shadow*` delegates mirroring circle's 4 delegates if you add them, or let `ClipManager` operate generically over `shadowChannelAnimations` map without new channels (keep `ClipChannelDef`-free).

* **Interpolator/validator branching for color**: color's hex validator vs numeric finite is the only per-property split in `requireShadowKeyframeValue`. Keep it inside `shadowEffect.ts:requireShadowKeyframeValue` switch (10 cases), similar to `requireMaterialKeyframeValue:13-36` (color vs number vs bool vs sampler). Evaluator branching at `evaluateShadow` should read `SHADOW_PARAM_KINDS[prop]` to choose `lerpHexColor` path vs `evaluateSegment`.

* **ClipCollection with heterogeneous clips**: same `semanticName` may map to a clip containing shadow + transform channels. That's intentional — `docs/adr/0008:Decision 4` says no morph-specific naming; extend to shadow without change.

---

## 10. Summary — recommendation

**Recommended**: **bespoke shadow lanes** (one `Map<ShadowProperty, Keyframe[]>` on `NodeAnimation`, mirrored as `Map<ShadowProperty, ClipChannelAnimation>` on `ClipDefinition`, a new `NodeShadowTarget` in `keyframeTarget.ts`, JSON `shadowTracks` array on `NodeAnimationJSON` and `shadowChannelAnimations` map on `ClipJSON`, effect defaults on `SceneNode.shadowEffect`). Numeric params interpolate via `evaluateSegment` (full parametric family); `color` hex interpolates via `lerpHexColor` linear (like material `color`); every track is keyframable and portable by semanticName/ClipExtraction using the existing morph/visible/circle/table collateral; insertion order is after `evaluateVisible`/opacity, before/inside clip layering.

**Not recommended**: extending `ANIMATABLE_PROPERTIES`/`CLIP_CHANNELS` (pollutes transform domain and forces numeric-only `KeyframeValue` path on a hex color) and treating shadows as material parameters (shadow is a group effect, not shading; would leak shadow tracks onto every leaf's material and conflate two owner semantics).

Extension points are enumerated at `§5 B-01…B-59` with file:line for each insertion.

---

## Appendix — history of `MorphBinding` (informative)

`MorphBinding` began as a **static sidecar** on `NodeAnimation` (`nodeAnimation.ts:41` `morphBinding: MorphBinding|null`, `get/setMorphBinding` at `132-147`, command `SetMorphBindingCommand` at `commands/setMorphBindingCommand.ts:15`, persisted as `morphBindingJSON` at `nodeAnimation.ts:341-344` and `json.ts:171-174`, validated at `lessonSerializer.ts:805-819`). Coefficient was animated via `morphCoefficient` track (single lane). Evaluation stitched `binding` (which pair) + `coefficient` (along that pair) at `shape.ts:65-79` `MorphBinding`/`MorphState` and `animationEvaluator.ts:194-301` `evaluateMorph/Vertices`.

The rework migrated to **per-keyframe pair** `MorphKeyframeValue {fromShapeId,toShapeId,coefficient}` at `shape.ts:75-78` (validator at `151-176`, cross-blend evaluator at `238-262`), kept sidecar only for legacy migration (`nodeAnimation.ts:421-430` reading legacy `morphBinding` into `legacyBinding` then `readMorphTrack` at `584-614` merging scalar→object via binding), and moved clips to name-based `MorphClipKeyframeValue {fromShapeName,toShapeName,coefficient}` at `shape.ts:81-84` (`requireMorphClipKeyframeValue` at `178-203`) resolved to ids at evaluation via `#resolveClipValueToNode` at `animationEvaluator.ts:416-435`. Clip morph lane is bespoke `#morphAnimation` at `clipDefinition.ts:206` (like `visible`), not a `ClipChannelDef`. Clip extraction uses `channelKeyOf` → `"morph"` single-key (`clipExtraction.ts:154`) despite morph being per-node (grouping by channel, not per-binding). Layering is last-wins with legacy-binding inheritance (`animationEvaluator.ts:234-247`).

Lesson for shadow: if shadow later needs per-segment **binding** (e.g. `fromColorSpace`/`toColorSpace` or `fromFilter`/`toFilter`), consider per-keyframe pair `ShadowKeyframeValue {from, to, t}` the same way morph did — but v1 shadow is 10 pure scalars/hex, not paired.

---

## Files changed by this research (none — throwaway)

* This doc: `research/shadow-animation-findings.md`

---

## Links

* Issue #289 (this research), Map #286, Ticket #287 (shadow Pixi v8), Ticket #288 (shadow renderer), ADR 0007 (Shape storage), ADR 0008 (Morph portability).
* Prior findings: `research/shadow-pixi-findings.md`, `research/shadow-renderer-findings.md`.
* Canonical animation files: `frontend/src/engine/animationProperties.ts`, `nodeAnimation.ts:35`, `slideAnimation.ts:56`, `animationEvaluator.ts:114`, `keyframeTarget.ts:86`, `materialTrackEvaluation.ts:13`, `interpolators.ts:10`, `animationManager.ts:64`, `clipDefinition.ts:195`, `clipCollection.ts:9`, `clipInstance.ts:5`, `clipExtraction.ts:6`, `ids.ts:3`, `json.ts:19`, `lessonSerializer.ts:19`, `components.ts:103`, `sceneNode.ts:37`, `shape.ts:6`, `clipManager.ts:46`.
