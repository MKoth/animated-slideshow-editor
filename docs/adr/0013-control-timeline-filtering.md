# ADR 0013 — Timeline Filtering: Normal vs Authoring Mode Lanes

Date: 2026-09-12
Status: Accepted (grill #334, wayfinder map #328) — amended by ADR 0018 (dormant Controls)
Deciders: MKoth + Muse Spark (wayfinder grill)

## Context

Map #328's destination requires a two-level UI: Normal Mode shows a rig as one object with few lanes (exposed Controls), Authoring Mode reveals bindings. ADR 0010 locked the definition model (`SceneNode.controlSet` embedded, `Control {key, exposed, bindings: Record<semanticName, clipId>}`, `ControlSet` ordered), ADR 0011 locked evaluation (`base → ClipInstances → Controls` last-wins, ControlSet order = Priority, `u=clamp(value,0,1)` always-active), ADR 0012 locked persistence (`NodeAnimation.controlTracks: Map<controlKey, Keyframe[]>` seconds-based with `hold|linear|bezier` + `disabled`, `NodeAnimationJSON.controlTracks?: {key,keyframes}[]` tolerant array, host `NodeAnimation` + `KeyframeTarget {kind:'control'}`), prototype #333 locked Variant A authoring surface (Animation Manager 4th tab Controls + drill-in normalized timeline `Editing Control: Mouth.Openness 0…1` with `t∈[0,1] duration=1`, `0 CLOSED — 1 OPEN` ruler, per-descendant lanes reusing diamond/tangent). Ticket #334 must lock how Controls appear in the main Timeline and Curve Editor, how the two-level disclosure is toggled/filtered, lane rendering and selection plumbing, and orphan interaction.

Code anchors: `frontend/src/engine/nodeAnimation.ts:40`, `frontend/src/engine/slideAnimation.ts:107,237,283`, `frontend/src/engine/clipDefinition.ts:164`, `frontend/src/engine/animationEvaluator.ts:50,67,1083,1252`, `frontend/src/app/animationManagerModel.ts` (Animated Child/Param filter), `frontend/src/stores/timelineViewStore.ts`, `frontend/src/stores/curveEditorViewStore.ts`, `frontend/src/stores/timelineSelectionStore.ts` (inferred), `CONTEXT.md` Animated Child / Animated Param / Priority / Control Track.

## Decision

### 1. Normal Mode filter — per-rig eye-cone, default filtered

When a subtree root `P` owns a `ControlSet` and at least one `Control.exposed === true`, the **main Timeline** in Normal Mode shows for that rig:

- **Included:** every `controlTrack` on `P` where `Control.exposed` is true (lanes labeled `Mouth.Openness` etc., value axis `[min,max]` = `0…1` in v1), plus any remaining non-driven transform/material/shadow/circle lanes on `P` and its descendants that are **not** targeted by any exposed Control binding at the property level (i.e. the rig owner left them exposed).
- **Hidden (not deleted):** any raw property lane on `P` or a descendant `D` that is driven by an exposed Control's normalized clip at the same property (same `AnimationProperty | morphCoefficient | shadowProperty | ...` and same descendant semantic). Hidden lanes remain in `NodeAnimation` (no data loss) and are simply filtered from `animationManagerModel.ts`'s `Animated Child` enumeration and from Timeline's `buildTimelineRows()`.

> Amended by ADR 0018: "driven" requires the exposed Control to be **active** — at least one enabled keyframe on the current slide. An exposed but dormant Control leaves its raw lanes visible/editable; the muted placeholder and badge appear only once the Control is keyframed.

**Toggle:** per-rig affordance, not global. Each host row in the main Timeline carries an eye-cone / authoring badge; each Animation Manager → Controls tab header carries a `Show internal lanes` toggle that mirrors the same per-host boolean. State is `timelineViewStore.expandedNodeIds` companion `authoringExpanded[hostNodeId]: boolean` or `timelineViewStore.authoringModeByHost: Record<hostNodeId, boolean>` persisted via `zustand/persist` `partialize` (like `expandedNodeIds`, `zoomLevel`). Default: **filtered (Normal) = false** — consumer sees single object. No global "show all" pref.

Rejected: global Timeline header checkbox (loses per-rig granularity — a scene with Cat rig + Tail rig needs independent), Manager-only toggle (Timeline would still show clutter), always-show-all (defeats spec's "few parameters" promise).

### 2. Hidden-lane affordance — muted + tooltip, not ghost lane

In Normal Mode a hidden raw lane leaves a **muted placeholder row** under its owner (light grey, lock icon, italic property name) with tooltip `Controlled via Mouth.Openness` (and `Roundness`, etc., comma-joined if multiple Controls target it, though v1 last-wins makes this rare). Clicking the placeholder jumps to `Animation Manager → Controls` and highlights the owning Control; hover does not create keyframes. The node row itself shows a badge count `N hidden`.

No error toast, no validation failure. Authoring Mode removes the muted rows and restores the full lanes.

Rejected: fully invisible with no hint (user forgets data exists), ghost disabled lane with grey diamonds (visual noise, suggests editability where evaluator would overwrite).

### 3. Authoring / Rig Mode entry — two equivalent surfaces

Authoring is entered **either**:

- **(a) Animation Manager → Controls → Edit** — the drill-in prototyped in #333: clicking `Edit Animation` on a Control row replaces the Manager body with the normalized-axis timeline `Editing Control: Mouth.Openness (0…1)` (header `0 CLOSED — 1 OPEN`, `t∈[0,1]` `duration=1` guardrails at `clipDefinition.ts:164` / `ClipManager:601`, 5 descendant lanes `Head/Morph` etc. reusing diamond/tangent UI, yellow playhead tracks control slider `u`). This is the binding-authoring surface.
- **(b) Main Timeline / Scene Tree right-click host node → `Rig / Authoring Mode`** — toggles the per-host boolean above, expanding the Timeline to show all `Animated Child` / `Animated Param` lanes per `animationManagerModel.ts` plus the Control lanes side-by-side so binding can be inspected in context. Same boolean as (a)'s mirror.

Both write the same `authoringModeByHost[hostId]` flag; entering via either surfaces the same full set. Exiting returns to Normal. No new modal.

Rejected: Manager-only (not discoverable from canvas), context-menu-only (hides primary authoring surface behind right-click).

### 4. Lane rendering & selection — same Dope Sheet row / Curve Editor curve per Control, reuse stores

- **Dope Sheet:** one row per exposed `Control` (key = `controlKey`), same diamond gizmos (`hold`=yellow, `linear`=blue, `bezier` with tangents) as any `NodeAnimation` lane. Time axis is global `Slide.duration` (seconds), value axis is `[min,max]` (0…1). Curve Editor shows one curve per Control, same spline math via `evaluateSegment` / `enabledKeyframes` (disabled respected).
- **KeyframeTarget:** reuses ADR 0012's new discriminator `{kind:'control', nodeId: hostNodeId, controlKey: string}` in `keyframeTarget.ts:resolveKeyframeTrack`. All operations — `addKeyframe`, `deleteKeyframes`, `moveKeyframes`, `scaleKeyframes`, `setKeyframeValue`, `setKeyframeInterpolation`, `setKeyframeTangents`, `setKeyframeDisabled`, `paste/duplicate` — route through existing `AnimationManager` (`animationManager.ts:154,177,322`) and emit the existing `Keyframe*` events (`KeyframeAdded` etc.) with `control` payload.
- **Stores:** `timelineSelectionStore` and `curveEditorViewStore` extend their union to handle `control` kind (like `material`/`shadow`) — no new `controlSelectionStore` or `controlCurveViewStore`. `timelineViewStore` gains only the per-host `authoringModeByHost` map above; zoom/scroll/gridSnap reuse verbatim. `SlideAnimation.clampKeyframesTo:107` already loops `controlTracks` per ADR 0012; filtering respects it.

Rejected: separate `ControlLane` component + new selection/curve stores (duplicates 90% of `TimelineRow` / `CurveCanvas` logic), Manager-only control lanes (would hide keyframeability from main Timeline, contradicting ADR 0012's "host NodeAnimation lane").

### 5. Orphan handling & ClipCollection coexistence — unchanged, 4th tab, disjoint phases

- **Orphans:** validating a `ClipCollection` still requires **zero Orphan Keyframes** (`Orphan Keyframe` = keyframe not contained in any Clip; `CONTEXT.md` Orphan definition). The Controls tab does not affect the Orphan count. Animation Manager keeps four tabs `Orphaned | Clips | Controls | Collections` (Variant A, #333): `Orphaned` lists only unclipped base `NodeAnimation` keyframes, `Controls` lists Controls + bindings, `Collections` lists `ClipCollection`s. An Orphan is not "fixed" by adding a Control binding — only by `Add to clip` extraction.
- **ClipCollection vs ControlSet:** v1 treats them as **disjoint** — `ClipCollection` is time-based (`ClipInstance {clipId, startTime, speed}` evaluated at `u = ((time-startTime)*speed)/duration` gated by `isClipInstanceActive`), `ControlSet` is value-based (`value → u=clamp(value,0,1) → effectiveUForClip → #evaluateClipChannel` always-active). Both may be attached to the same rig; evaluator order remains `base → ClipInstances → Controls` (ADR 0011) so Controls win unconditionally. No new `ControlsCollection` type in v1; additive blending across Controls remains last-wins (ADR 0011 §3).
- **Visibility in Manager:** `Animated Child` / `Animated Param` filtering respects Normal Mode: in Normal, `animationManagerModel` filters to only exposed Control children; in Authoring, it enumerates all children with any track.

Rejected: counting Controls as orphan resolvers (mixes time vs value concerns), mutually exclusive Collections/Controls (would forbid a rig that has both a walk cycle collection and a mouth Control).

## Consequences

- One new persisted per-host boolean in `timelineViewStore` (`authoringModeByHost`) + muted placeholder affordance in Timeline rows + one context-menu entry on host nodes; otherwise reuse of existing `NodeAnimation.controlTracks`, `KeyframeTarget`, `AnimationManager`, `timelineSelectionStore`/`curveEditorViewStore`, and `clampKeyframesTo`.
- Test seams: (1) Normal Mode filters 5 raw lanes to 3 exposed Controls + badge count 2; toggling Authoring restores all; (2) muted row click navigates to Manager → Controls and highlights owner; (3) `CurveEditor` renders Control curve with `0…1` value axis and disabled keyframe is skipped; (4) `Orphaned` tab count unchanged by adding a Control; (5) host with both a ClipCollection and Controls at same property asserts Controls win.
- Frontier unblocks spec's UI chapter; #335 (ReusableObject export) can now state "imported rig appears as one object with only exposed Controls in Normal Mode; Authoring Mode is per-host and not persisted across import."
- No new glossary term required — existing `Control Set` entry already notes "while bindings stay hidden unless Authoring Mode is entered"; `Animated Child` / `Animated Param` / `Priority` / `Control Track` entries remain accurate. If a future ticket wants an explicit `Normal Mode` / `Authoring Mode` glossary, it can propose there.

## Links

- Map: #328
- This grill: #334
- Data model: ADR 0010, #329
- Evaluation: ADR 0011, #331
- Persistence: ADR 0012, #332
- Prototype: #333 (`prototype/controls-authoring` → `frontend/src/prototype/controls-authoring-prototype.html` Variant A, `6a632e05`)
- Follow-ups: #335, #336 (both independent; #336's direct-mapping sugar if kept will hide its binding radio when Normal vs Authoring already settled here)
- Code anchors: `frontend/src/engine/nodeAnimation.ts:40`, `frontend/src/engine/slideAnimation.ts:107,237,283`, `frontend/src/engine/animationManager.ts:154,177,322`, `frontend/src/engine/keyframeTarget.ts`, `frontend/src/engine/clipDefinition.ts:164`, `frontend/src/engine/animationEvaluator.ts:50,67,1083,1252`, `frontend/src/stores/timelineViewStore.ts`, `frontend/src/stores/curveEditorViewStore.ts`, `CONTEXT.md` Controls / Priority / Animated Child / Orphan
