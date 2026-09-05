# ADR 0009 — Shadow Effect vocabulary and SceneNode ownership

Date: 2026-09-05
Status: Accepted (grill #290)
Deciders: MKoth + Muse Spark (wayfinder grill)

## Context

Wayfinder map #286 needs ubiquitous language for silhouette-based cast shadows (one shadow per group node, all 10 projection params animatable) that doesn't collide with existing `Material Instance`/`Shader Definition`/`Fullscreen Shader`/`Ghost`/`Group Node`/`Scale Group` or with code predicates like `isGroupNode` (`sceneNode.ts:172`).

## Decision

- **Effect noun: Shadow Effect** — a per-group-node effect (field `SceneNode.shadowEffect?`), not a `NodeComponents` entry; absent means no shadow, one per host group.
- **Source terms: Shadow Source** (filtered descendant set of the host), **Shadow Caster** (member node), **Cast Shadow** (boolean per `SceneNode`, default true for renderable, false for Bone/Ghost/Camera, gated with source mode `Children` vs `Entire hierarchy`).
- **Alpha terms: Silhouette** (combined, BBox-sized, pre-projection alpha, sampled pre-shader and post-morph-then-bones) → **Shadow Projection** (Silhouette after offset/scale/skew/rotation/blur/opacity/color and beneath-group compositing).
- **Glossary placement:** new `CONTEXT.md` section `### Scene Effects` between `Content` and `Animation`; terms are scene effects that are animatable but not animation or content primitives.
- **Ownership: `SceneNode.shadowEffect`** (alongside `visible`/`opacity`/`material` at `sceneNode.ts:37-50`), not `NodeComponents.shadowEffect` and not an external map. JSON `NodeJSON.shadowEffect?`, animation via bespoke `shadowTracks: Map<ShadowProperty, Keyframe[]>` (visible/morph pattern per research #289, not `ANIMATABLE_PROPERTIES`).

## Considered Options

- **NodeComponents.shadowEffect** — rejected: adding any component makes the host fail `isGroupNode` (`Object.keys(components).length===0`) and would imply shadow params belong on every mesh/node; would require refactoring every `isGroupNode` call site and leaks tracks onto non-group nodes.
- **External Map<groupId, ShadowEffect>** — rejected: second lifecycle (create/remove/reparent/bind) to keep in sync with scene graph; `SceneNode` field is the canonical owner and already handles copy/clone/serialization.
- **Material-param track** — rejected per #289: shadow is a group compositing effect, not shading; would attach to material instances and tie color/opacity to shader uniform machinery instead of per-group lanes.
- **Shadow Component / Layer / Sprite / Mask / Map** — rejected: Component collides with group definition, Layer implies global layer (per-group compositing was chosen in #288), Sprite leaks Pixi impl into domain, Mask implies binary threshold (we preserve soft alpha), Map collides with 3D shadow mapping.
- **Extending Animation or Content sections** — rejected: shadow is a scene-level effect whose projection params happen to be animatable; putting it under Animation would hide the rendering/compositing ownership, under Content would conflate it with reusable assets.

## Consequences

- `isGroupNode` stays `components.empty && children.length>0`; only groups with `shadowEffect` present cast; non-group nodes may still store `shadowEffect` but it is ignored until reparented as a group (validation will warn).
- Copy paths (`copyComponents`/`freezeComponents`/`ReusableObject` import) remain unchanged except `SceneNode` clone must remap `shadowEffect` and its `castShadow` flags like `visible`/`opacity`.
- Animation stack adds 10 bespoke shadow lanes (not 6 + polluted uniform names), evaluator inserts `evaluateShadow` after `evaluateVisible` (`animationEvaluator.ts:156`), color via `lerpHexColor` not numeric cast.
- Renderer can treat `ShadowEffect` absence as early-out; no table/cell owning-table indirection needed for the effect itself.

## Links

- Map: #286
- This grill: #290 (Grilling: Domain vocabulary for Shadow Effect, Shadow Source, Silhouette and projection)
- Research: #287 (Pixi RT+BlurFilter), #288 (SceneRenderer sibling-under), #289 (bespoke shadowTracks on SceneNode)
- Glossary: `CONTEXT.md` § Scene Effects (Shadow Effect, Shadow Source, Shadow Caster, Cast Shadow, Silhouette, Shadow Projection)
- Follow-ups: #291 (source-group resolution), #292 (projection params & defaults)
