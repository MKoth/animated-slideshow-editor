# ADR 0018 — Dormant Controls: Default Pose, Raw Animation Wins Until Keyframed

Date: 2026-09-26
Status: Accepted (fix for #392)
Deciders: MKoth + opencode

## Context

ADR 0011 locked `base → ClipInstances → Controls` last-wins with Controls "always active", and ADR 0012 §3 locked `controlTracks.get(key) empty or absent → value = Control.default`. Combined, a Control that has been assigned/bound but never keyframed still evaluates its bound clip at `Control.default` and overwrites base keyframes and clip instances on every bound channel. ADR 0013 §1/§2 then hides the corresponding raw lanes in the Timeline and ADR 0014 §2 relies on the default fallback so an imported rig with empty instance tracks appears posed.

Reported bug (#392): after assigning a Control to an object, the user cannot animate individual parts with raw keyframes on a slide where they have not authored any control keyframes — the raw lanes are replaced by non-interactive `hiddenSubtrack` placeholders and, even if keyframes are added programmatically, the evaluator overwrites them with the control default. The user cannot reach the control's first keyframe without first giving up raw animation on that slide.

## Decision

### 1. Dormancy definition

- A Control is **dormant** on a slide when its `NodeAnimation.controlTracks` entry for that slide has **no enabled keyframes** (all keyframes absent, or all `disabled === true`). Disabled keyframes are absent for dormancy purposes, matching the evaluator's existing `enabledKeyframes` filtering.
- Dormancy is **per slide**, because `controlTracks` are per-slide instance data (ADR 0012 §1): keyframes authored on slide B do not activate the control on slide A.
- A Control with at least one enabled keyframe is **active**.

### 2. Evaluation — dormant controls yield per channel to the target's time animation

- A dormant Control still resolves to `Control.default` (ADR 0012 §3 fallback retained) and still applies its bound clip to bound channels — **except** on a channel where the _target node's own time animation_ drives at the evaluated time. There, the target's animation wins and the dormant control does not write that channel.
- "Target's own time animation drives" means either:
  - the target `NodeAnimation` has at least one enabled keyframe on that channel, or
  - the target has an enabled `ClipInstance` active at the evaluated time whose clip carries at least one enabled keyframe on that channel (reusing `isClipInstanceActive` + `enabledKeyframes`).
- The rule applies per channel family across every Control pass: uniform six (`positionX/Y`, `rotation`, `scaleX/Y`, `opacity`), `zIndex`, morph (value and vertices), symmetry, circle, table, material parameters and shadow properties.
- An **active** Control is unchanged: ADR 0011 priority applies, Controls win over base and ClipInstances on all bound channels.
- Consequently, adding the first enabled control keyframe re-locks all of that control's bound channels to control priority for the whole slide; existing raw keyframes remain stored (never deleted) and become visible/editable again only if the control track becomes empty or all-disabled.
- Non-goals: the exported read API `controlValueAt` (`animationScriptReads.ts`) keeps its "empty track → default" semantics — it reads the parameter value, it does not decide drives. The exported `evaluateControlTrack` / `evaluateHostWithBlends` helpers keep their fallback contract; dormancy is enforced by the evaluator passes that consume them.

### 3. Timeline filtering — hide raw lanes only for active exposed Controls

- `getExposedControlOwners()` (and therefore `timelineRows`, the `N hidden` badge, `getHiddenCountForNode`) treats an exposed bound Control as an owner only when the control is active on the current slide. Dormant Controls do not hide raw lanes.
- Dormant bound lanes render as ordinary `subtrack` rows: existing keyframes are visible, the `+` button and lane context menu work, and `Authoring Mode` is still available as today.
- Active bound lanes keep the ADR 0013 behavior: muted `hiddenSubtrack` placeholder with `Controlled via <key>` and click-to-navigate; deferred to [ADR 0013].
- The node-level badge count follows automatically: only lanes hidden by active Controls are counted.

### 4. Scope of the dormancy lookup

- The rule lives on `NodeAnimation.hasEnabledControlKeyframes(key)` so engine and Timeline UI share one definition of "active".
- Import of a reusable object with an empty `controlTracks` (ADR 0014 §2) keeps the default pose on channels with no user animation, so imported rigs still appear posed; the consumer can raw-animate individual parts on any channel until they keyframe the control.

## Alternatives Considered

- **Fully inert Controls (zero keyframes = control contributes nothing):** simplest single gate, but exported/imported rigs would appear at their unposed base until a keyframe is added, breaking the ADR 0014 test seam and requiring import-time keyframe seeding. Rejected.
- **UI-only fix (unhide lanes, keep evaluator overwrite):** does not satisfy the bug — raw keyframes would still be invisible under the default pose. Rejected.
- **Per-node override (skip the whole dormant control for a target node if any bound channel is raw-keyframed):** loses the default pose on untouched bound channels; contradicts "on channels you didn't touch". Rejected.
- **Dormant Controls evaluated before base/clips rather than yielding per channel:** requires restructuring every evaluator pass and changing the base-fallback semantics; per-channel write gating reuses existing scratch flow. Rejected.

## Consequences

- One new `NodeAnimation` accessor plus a shared private evaluator helper (`#nodeTimeDrivesChannel`) consumed by the 9 Control passes; no JSON/validation/persistence changes.
- Timeline raw lanes are editable while a control is dormant; adding the first control keyframe switches the lane back to `hiddenSubtrack` and re-locks priority (expected, documented).
- ADR 0011 "always active" and ADR 0012 §3/§4 and ADR 0013 §1/§2 are amended by this ADR; ADR 0014 §2 behavior (imported rig default pose) is preserved.
- Test seams: dormant + raw keyframes → raw wins; dormant + untouched channel → default pose; active → control wins over raw/clip; all-disabled → dormant; per-slide isolation; active clip beats dormant control, inactive clip does not; timeline rows show `subtrack` for dormant and `hiddenSubtrack` for active with correct badge.

## Links

- Issue: #392
- Amends: ADR 0011, ADR 0012, ADR 0013; ADR 0014 unchanged in outcome
- Data model: ADR 0010, CONTEXT.md § Controls, § Priority, § Control Track
- Code anchors: `frontend/src/engine/nodeAnimation.ts` (`hasEnabledControlKeyframes`), `frontend/src/engine/animationEvaluator.ts` (`#evaluateRawU:1829`, `#evaluateHostWithBlends:1844`, `#getGroupClips:1856`, `#applyControls:1666`), `frontend/src/components/panels/timelineTracks.ts:359`, `frontend/src/engine/animationManagerModel.ts:124`
