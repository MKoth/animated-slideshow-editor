# ADR 0012 — Control Track Persistence & Keyframeability on Host Node

Date: 2026-09-12
Status: Accepted (grill #332, wayfinder map #328)
Deciders: MKoth + Muse Spark (wayfinder grill)

## Context

Map #328 needs Controls whose value over time is authored as ordinary animation lanes on the host node (standing preference: "Control values are themselves keyframeable `controlTracks` on the host node (seconds-based, same interpolation/tangents as morph)"). ADR 0010 locked the definition model (`SceneNode.controlSet` embedded, `Control {id,key,label,min=0,max=1,default,exposed,bindings}` with `key` unique per ControlSet, `Record<semanticName, clipId>` bindings, `ClipDefinition duration=1` reuse) and ADR 0011 locked evaluation (`base → ClipInstances → Controls` last-wins, `u=clamp(value,0,1)` always-active). Research #330 validated verbatim reuse of `effectiveUForClip` and `#evaluateClipChannel`. Ticket #332 must lock where the per-slide animated value lives, its keyframe semantics, JSON shape, raw-lane interaction, validation/commands, and default/unset behavior.

Code anchors: `frontend/src/engine/nodeAnimation.ts:40` (`#tracks`, `#materialTracks`, `#circleTracks`, `#shadowTracks`), `frontend/src/engine/slideAnimation.ts:75` (`SlideAnimation.#nodes`, `clampKeyframesTo:107`, `toJSON:237`, `fromJSON:283`), `frontend/src/engine/animationManager.ts:154` (`addKeyframe`, `KeyframeAdded` events), `frontend/src/engine/keyframe.ts` (Keyframe, Interpolation, tangents, disabled), `frontend/src/engine/json.ts:216` (NodeAnimationJSON), `frontend/src/engine/keyframeTarget.ts` (`resolveKeyframeTrack`), `frontend/src/engine/animationProperties.ts` (`requireKeyframeTime`).

## Decision

### 1. Where the value lives — `NodeAnimation.controlTracks` on the host node

- `NodeAnimation` gains `readonly #controlTracks = new Map<string, Keyframe[]>` where the map key is `Control.key` (the stable public name, not the ephemeral `Control.id`). The host node's `NodeAnimation` in `SlideAnimation` (`SlideAnimation.ensure(hostNodeId)`) owns the instance data per slide.
- Why this over `SlideAnimation.controlTracks` top-level sidecar: co-location with all other per-node lanes (uniform-six, material, circle, shadow, morph, symmetry, zIndex) reuses every existing path — `SlideAnimation.clampKeyframesTo`, `toJSON`/`fromJSON` tolerance, `copyFor`, `animationManager` track resolution, and paste/move/scale. A sidecar would duplicate `SlideAnimation` branching and separate instance data from its node owner; a `Project.controlTracks` top-level would further detach it from per-slide duration. `NodeAnimation.controlTracks` is the same pattern as `materialTracks` (`Map<string, Keyframe[]>`) and `shadowTracks`.
- No new Top-level `LessonJSON` field; no new `SlideAnimation.controlAnimation` entity.

### 2. Key identity & value domain

- Map key = `Control.key` (`^[A-Za-z][A-Za-z0-9_.]*$`, per-ControlSet unique, block-on-duplicate like Unique Name). Using `key` survives `copyNodeDeep` / `ReusableObject` id-remap (ids are regenerated, keys are preserved as public API per ADR 0010 §6); using `id` would require a second remap table for tracks.
- Value = finite number in `[min,max]` (v1 fixed `0…1`). Validation via `requireFiniteNumber` + clamp check; validator rejects non-finite, warns and skips bad value like shadow tolerant path.
- Interpolation: `hold`, `linear`, `bezier` (with `tangentIn`/`tangentOut`) are allowed; parametric family `bounce`/`elastic`/`spring` is accepted by `requireKeyframeInterpolation` but evaluation defers to the existing `evaluateSegment` path (no new math). `visible`/`zIndex` hold-only restriction does **not** apply to controlTracks; shadow `color` hold/linear restriction also does not apply (control value is a scalar).

### 3. Default & unset & out-of-range (evaluation-time truth)

- The evaluator resolves a control value at global time `t` as:
  ```
  if controlTracks.get(key) is empty or absent → value = Control.default
  else value = evaluateControlTrack(keyframes, t) // hold-before-first, hold-after-last, segment interpolation between
  u = clamp(value, min, max)         // v1 = clamp(value,0,1)
  normalized = (u - min)/(max - min) // v1 identity = u
  effectiveU = effectiveUForClip(clip, keyframes, normalized) // keeps isReversed+parametric flip, then #evaluateClipChannel
  ```
- `evaluateControlTrack` reuses the same `evaluateSegment` / `effectiveUForClip:50` helpers as base tracks (disabled filtering via `enabledKeyframes`, parametric bounce/elastic/spring). No special "gap → default" rule — once a track has any keyframe, gaps are interpolated/hold per segment.
- Tangent overshoot outside `[min,max]` is clamped before normalize (so a bezier spike to 1.2 → 1.0).

### 4. Interaction with raw lanes — not locked, hidden not deleted

- When Normal Mode exposes only `controlTracks` for a rig, raw property lanes on the same node/descendants that are driven by those Controls remain in `NodeAnimation` but are **hidden** (not deleted). Authoring Mode reveals them.
- Raw lanes are **not locked**: both the control lane and any raw lane may be keyframed concurrently. Evaluator precedence (`base → ClipInstances → Controls`, ADR 0011) is the user-facing truth: "the animated Control value will overwrite the raw output at the same global time." Documented affordance, no write guard, no error.

### 5. Serialization — array shape, tolerant load, instance vs definition split

- `NodeAnimationJSON` extends with optional:
  ```ts
  controlTracks?: readonly { readonly key: string; readonly keyframes: readonly KeyframeJSON[] }[]
  ```
  Array-of-objects shape, consistent with `materialTracks: {parameter, keyframes}[]`, `shadowTracks: {property, keyframes}[]`, `circleTracks`, `tableTracks` (`json.ts:170`). Rejected `Record<string, KeyframeJSON[]>` to avoid diverging from the codebase's array pattern and to keep tolerant iteration simple.
- `SlideAnimation.toJSON()` emits `controlTracks` only when non-empty for a node, alongside other tracks (`slideAnimation.ts:237`). `SlideAnimation.fromJSON(duration, nodeOf, parameterKindOf)` and `NodeAnimation.fromJSON(json, duration, node, parameterKindOf)` read it tolerantly: if `controlTracks` is absent → empty; if present but not an array → warn and ignore; per-entry `{key, keyframes}` validates `key` as non-empty string, skips entry if `key` has no corresponding `Control` in `node.controlSet` (soft-warn, like clip morph missing-shape fallback `clipDefinition.ts:568`), validates each keyframe via `trackKeyframeParser` (`requireKeyframeTime` in `[0, duration]`, finite value, interpolation, tangents). Bad keyframe → warn and skip that keyframe, not the whole track (mirrors `restoreShadowTracks:143` tolerant path).
- `.lesson` embedding: per-slide animated values live in `SlideJSON.animation.nodes[].controlTracks` (instance data, per-slide duration); the `ControlSet` definition lives on `NodeJSON.controlSet` (definition data, inside `SceneJSON.nodes[]`, per ADR 0010 §1). Old files without either field load unchanged (tolerant). `ReusableObjectJSON` handling — definitions snapshot via existing `library.clips` + embedded shapes (host node's `controlSet` travels inside `nodes[]`); per-slide `controlTracks` are instance data and are **not** part of the reusable library definition (they live per-slide, like other `NodeAnimation` tracks). Import of a rig with a `ControlSet` but no `controlTracks` → tracks empty → defaults apply. Detailed export contract for exposed controls and version bump is deferred to ticket #335 but the split is locked here.
- No `REUSABLE_OBJECT_VERSION` bump in this ticket; validator will extend to allow `controlSet` on `NodeJSON` and `controlTracks` on `NodeAnimationJSON` without breaking old validators.

### 6. Validation, commands, engine events, clamp

- Validation per control keyframe: `controlKey` must exist in host node's `ControlSet` (if host has no `controlSet` → error "host has no ControlSet"); `time` via `requireKeyframeTime(time, slide.duration)` (same as `animationManager.ts:157`); `value` finite number in `[min,max]` (v1 0…1, later `min/max` arbitrary → interval check); `id` uniqueness per track via `seenIds` in parser; duplicate time at `≠ duration` rejected (like base parser). `disabled` boolean allowed.
- Commands / `AnimationManager` surface: extend `AnimationManager` with control-aware paths rather than a second manager. The existing `KeyframeTarget` discriminator (`keyframeTarget.ts`: `resolveKeyframeTrack`) gains a new `control` kind:
  ```ts
  { kind: 'control', nodeId: hostNodeId, controlKey: string }
  ```
  All existing operations route through it: `addKeyframe`, `deleteKeyframes`, `moveKeyframes`, `scaleKeyframes`, `setKeyframeValue`, `setKeyframeInterpolation`, `setKeyframeTangents`, `setKeyframeDisabled`, `pasteKeyframes`, `duplicateKeyframes`. Each reuses `requireTrackKeyframeValue` (new `control` branch: `requireFiniteNumber` + range), `requireKeyframeInterpolation` / `requireKeyframeTangent`, and `previousInterpolation` for default interpolation. Thin command wrappers (`AddControlKeyframeCommand`, `UpdateControlKeyframeValueCommand`, etc.) delegate to the manager so undo/redo and `EventBus` batching stay identical.
- Engine events: reuse existing `KeyframeAdded`, `KeyframeRemoved`, `KeyframeMoved`, `KeyframeValueChanged`, `KeyframeInterpolationChanged`, `KeyframeTangentsChanged`, `KeyframeDisabledChanged` with the `control` target payload — no new event kind. Stores that subscribe to `Keyframe*` (timeline, curve editor) will match on `target.kind === 'control'` the same as `property`/`material` etc.
- `SlideAnimation.clampKeyframesTo(duration)` (`slideAnimation.ts:107`) extends with a loop over `animation.controlTrackKeys()` and `animation.controlKeyframes(key)` clamping `keyframe.time > duration → duration`, collecting `ClampedKeyframe` entries with a new discriminator `{controlKey: string, keyframeId, oldTime}` (parallel to `shadowProperty`/`symmetry` branches). Same for `copyFor`, `toJSON` filtering, and any future `clearControlTracks` helpers.
- `disabled` per-keyframe is fully supported (like base tracks `animationManager.ts:322` and clip `enabledKeyframes` filter). Control clips keep `enabledKeyframes` semantics for the normalized-clip side; controlTracks use the same `!!keyframe.disabled` field.

## Alternatives Considered

- **`SlideAnimation.controlTracks` top-level map** — rejected: separates instance data from its node, duplicates branching in `clampKeyframesTo`/`toJSON`/`fromJSON`, and breaks the `NodeAnimation` lane cohesion that `animationManagerModel` and timeline lane filtering rely on.
- **`Map<controlId, …>` keyed by id** — rejected: ids are ephemeral and remapped on copy/import; keys are stable public names and are the evaluator's lookup key anyway (`bindings` are by `semanticName`, not id).
- **Record `controlTracks: Record<key, KeyframeJSON[]>`** — rejected: diverges from `materialTracks`/`shadowTracks`/`circleTracks` array-of-objects convention and complicates tolerant load (array iteration is already copy-pasted in tolerant restore paths).
- **Locking raw lanes when driven** — rejected: forces a new validation guard and modal workflow for a case the evaluator already resolves deterministically via last-wins; Authoring Mode already provides the escape hatch.
- **Separate `ControlAnimationManager`** — rejected: duplicates 90% of `AnimationManager` (`#resolve`, `#keyframesOf`, `#addToTrack`, validation). One manager with a new target kind is smaller and keeps command/event plumbing unified.
- **Gap → default instead of hold** — rejected: would make controlTracks behave unlike every other NodeAnimation track (which holds before first / after last); sparse rigs would snap to default unexpectedly.

## Consequences

- One new `Map` on `NodeAnimation` plus ~8 new `control*` accessors (`controlKeyframes`, `hasControlTrack`, `addControl`, …) mirroring `materialTracks`/`shadowTracks` shape; zero change to `SceneNode` (definition already on `controlSet`).
- The spec's engine section can describe `controlTracks` as "just another NodeAnimation lane, keyed by Control key, seconds-based, with hold/linear/bezier and disabled" and point to `nodeAnimation.ts` and `slideAnimation.ts:107/237/283` for implementation.
- Frontier unblocks tickets #333 (prototype can render drill-in lanes + main-timeline control lanes with same gizmos), #334 (Normal vs Authoring lane filtering can enumerate `controlTrackKeys()`), and #335 (ReusableObject export can state "instance controlTracks stay per-slide; definitions travel on the node").
- Test seam: a regression where `host.controlTracks['Mouth.Openness']` has keyframes `[0→0, 0.5→1]` and a base `positionX` clip also targets a descendant's `positionX` at same time must assert control wins; a second test asserts `disabled` control keyframe is skipped; a third asserts `clampKeyframesTo` shortens a control keyframe.

## Links

- Map: #328
- This grill: #332
- Data model: ADR 0010, CONTEXT.md § Controls (Control, Control Set, Control Binding, Normalized Clip, Control Track)
- Evaluation: ADR 0011, CONTEXT.md § Priority, § Control Track
- Research: #330 (`animationEvaluator.ts:50,67,817,1083,1107,1252`, `clipDefinition.ts:164`, `clipManager.ts:601`)
- Follow-ups: #333, #334, #335 (blocked by this ticket), #336 (independent)
- Code anchors: `frontend/src/engine/nodeAnimation.ts:40`, `frontend/src/engine/slideAnimation.ts:107,237,283`, `frontend/src/engine/animationManager.ts:154,177,322`, `frontend/src/engine/json.ts:216`, `frontend/src/engine/keyframe.ts`, `frontend/src/engine/keyframeTarget.ts`, `frontend/src/engine/animationProperties.ts`
