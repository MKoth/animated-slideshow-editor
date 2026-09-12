# ADR 0011 — Evaluation Order: Controls Win Over Time Clips

Date: 2026-09-12
Status: Accepted (grill #331, wayfinder map #328)
Deciders: MKoth + Muse Spark (wayfinder grill)

## Context

Map #328's standing preference says Controls win over time-based `ClipInstance`/`NodeAnimation` keyframes. Ticket #331 must lock the exact evaluator phasing, per-property composition, edge handling (disabled, reversed, parametric, speed), nested ControlSet interaction, and Control-drivable track whitelist, building on ADR 0010's data model (`SceneNode.controlSet` embedded, `Control.bindings: Record<semanticName, clipId>`, `duration=1` reuse validated in research #330 via `animationEvaluator.ts:50` `effectiveUForClip` and `#evaluateClipChannel:1252`).

## Decision

### 1. Phase order — Controls after everything, last-wins

Per-frame evaluation for each node descending through `AnimationEvaluator` is:

```
base NodeAnimation keyframes @ clampedTime
  → ClipInstance layers in node.clipInstances order (existing last-wins, animationEvaluator.ts:1083 #applyClipInstances)
  → Control layers (new) in ControlSet order (later Control wins)
```

Within a `ControlSet`, `controls[]` order is Priority: lower index = lower priority, later wins — mirrors `ClipInstance` order and `Clip Lane` / `Collection Lane` Priority (CONTEXT.md Priority). No interleaving of clips and Controls; Controls are an unconditional final pass (`base → clips → Controls`).

Implementation sketch: after `#applyClipInstances(node, time, scratch)` the evaluator runs `#applyControlLayers(hostNode, time, scratchMap)` iterating host nodes in parent-after-children order (see §5), each evaluating its controls at `u = clamp(controlValue, 0, 1)` (v1 identity normalize) via `u → effectiveUForClip → #evaluateClipChannel` and writing through `#setChannelValue` / morph / material / shadow / circle / table equivalents.

### 2. Per-property resolution — preserve gain/offset

A Control's normalized clips reuse `ClipDefinition` channel `paramKey` + `linkMode` (clipDefinition.ts:52) verbatim. Evaluation keeps:

```
if (channelDef.paramKey) {
  param = instanceOverrides || clip.getParam(paramKey).default || 1
  base  = current scratch value (after clips + earlier Controls)
  output = linkMode==='offset' ? base + param*kfValue : base * (param*kfValue)
} else {
  output = kfValue  // absolute — the common case
}
```

So an absolute Mouth.Openness drive is simply a channel without `paramKey`; a gain/offset rig (e.g. parameterised scale) continues to compose off the already-clipped value. This reuses the same branch as `animationEvaluator.ts:1128` and avoids a second evaluator path. Forbidding `paramKey` on Control clips was rejected.

### 3. Additive vs last-wins across Controls — last-wins in v1

When two Controls on the same host (e.g. `Mouth.Openness` and `Mouth.Smile`) target the same descendant property at the same global time, later Control in `ControlSet` order wins per property — scalar last-wins, not sum. Additive blending (per-binding weight / curve, Control→target weight) is explicitly deferred; noted in map **Not yet specified → Weight painting & per-target curves** as future extension with an explicit compositing operator.

### 4. Edge evaluators — always active, skip speed, keep disabled/reversed/parametric

For each Control-driven clip at `u`:

- **Active:** Controls are always active — skip `isClipInstanceActive` (animationEvaluator.ts:67) and ignore `ClipInstance.speed` / `Stretch` (value is not time, no `duration/speed` divisor).
- **Disabled:** Respect session-only `disabled` via `enabledKeyframes` filter — same as base tracks.
- **Reversed:** Respect `ClipDefinition.isReversed` + parametric (`isParametricInterpolation`) via `effectiveUForClip(clip, keyframes, u) → 1 - u` path.
- **Interpolation:** Reuse all interpolation types: `hold`, `linear`, `bezier` (with tangents), and parametric family `bounce`/`elastic`/`spring` via `evaluateSegment` (already shared by `#evaluateClipChannel:1252`). Morph name-resolution `fromShapeName/toShapeName → fromShapeId/toShapeId` at animationEvaluator.ts:817 also reuses verbatim.

Skipping `speed`/`Stretch` and the active-interval guard is the only divergence from the time-clip path; every other channel helper is shared.

### 5. Host vs descendant nesting — ancestor wins, depth-first parents-last

A Control owned by parent `P` drives leaves `D` by broadcasting `bindings[semanticName] → clipId` and evaluating each leaf's clip at `u`. If a leaf `D` itself owns a `ControlSet` (nested rigs), composition order is deterministically **parents-last**: collect all ControlSets in the scene, sort hosts by depth ascending and evaluate deepest first, still writing to leaf scratches with last-wins at the property. Thus an ancestor Control overwrites a descendant's own Control on the same leaf property — still last-wins, now across the tree. No validation forbidding nesting; no new double-write guard beyond property last-wins.

Rejected: forbidding nesting, or leaf-wins (which would make rig encapsulation surprising).

### 6. Control-drivable track whitelist — everything except visible/zIndex

v1 allows a Control clip to carry any interpolatable channel `ClipDefinition` already supports:

- uniform-six (`positionX/Y`, `rotation`, `scaleX/Y`, `opacity`)
- `morphCoefficient` (name-based, per ADR 0008)
- `shadow` properties (`offsetX/Y`, `scaleX/Y`, `skewX/Y`, `rotation`, `blur`, `color`, `opacity`, light params)
- `circle` (`radius`, `startAngle`, `endAngle`, `segments`)
- `table` (`borderRadius`, `padding`)
- `materialParameter` (any parameter where `parameterKindOf` resolves)
- `symmetry` (`axis`+`factor`) where present

**Excluded by validator:** `visible` and `zIndex` — both hold-only integer/boolean tracks (visible is static per node.visible, animationEvaluator.ts:220; zIndex only holds). Validator rejects bindings whose clip contains `visibleAnimation`/`zIndexAnimation` channels; they remain ordinary global tracks, not rig params.

## Consequences

- One new evaluator pass after `#applyClipInstances`; no change to `ClipDefinition` validation besides the two hold-only exclusions.
- Test seam: a regression where a time clip animates `head.rotation` and `Mouth.Openness` also targets `head.rotation` at overlapping time must assert Control wins; a second test asserts later Control in same set wins over earlier on same property, and a third asserts `isReversed` clip driven by a Control still flips parametric channels.
- Unlocks tickets #332 (controlTracks persistence is independent but ordering clarifies `controlTracks` are global-time tracks driving `u`), #333 (prototype can show drill-in normalized axis with `duration=1` guardrails), #335 (ReusableObject export inherits same ordering).

## Links

- Map: #328
- This grill: #331
- Data model: ADR 0010, CONTEXT.md § Controls, Priority, Control Track
- Research: #330 (evaluator reuse) — `animationEvaluator.ts:50,67,817,1083,1107,1252`, `clipDefinition.ts:164`, `clipManager.ts:601`
- Follow-ups: #332, #333, #334, #335, #336
- Code anchors: `frontend/src/engine/animationEvaluator.ts:50,67,189,1083,1107,1128,1252,817`, `frontend/src/engine/clipDefinition.ts:52,164,197`, `frontend/src/engine/nodeAnimation.ts`
