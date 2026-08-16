# Feasibility: animating material parameters / uniforms, and a time uniform

Status: investigation (no code changed). Date: 2026-08-16.
Fits Spec 06 (Materials & Shaders, https://github.com/MKoth/animated-slideshow-editor/issues/26).

## TL;DR

Both requests are feasible and slot cleanly into the existing engine. The glossary in
`CONTEXT.md` already reserves the interpolation vocabulary (hold / linear / bezier) and
the animation pipeline already re-evaluates per playhead change, so keyframed uniforms
animate on scrub and playback with almost no new plumbing.

- **Animate uniforms/parameters** — extend the existing per-node keyframe model to carry
  material parameter values, and evaluate them at the playhead before shader resolution.
  Continuous kinds (number/float, color, vec2/3/4) interpolate linearly; discrete kinds
  (int, bool, sampler2D) use **hold** (the user's "changes immediately").
- **Time uniform** — reserve a `uTime` uniform (float seconds) that every shader may
  declare, like the already-reserved `uTexture`. The renderer uploads the slide playhead
  time; Pixi uploads it every draw for free.

## 1. How animation works today (the seams to extend)

- Keyframes are stored per node per property as `Keyframe { id, time, value }` where
  `value` is a single **number** — `engine/keyframe.ts:4-18`. Tracks live in
  `NodeAnimation` (`engine/nodeAnimation.ts:14-19`), one per node, in `SlideAnimation`
  (`engine/slideAnimation.ts:15-16`).
- The only animatable properties are `positionX/Y, rotation, scaleX/Y, opacity`
  (`engine/animationProperties.ts:4-13`). Material parameters are **not** animatable.
- Evaluation is pure and linear: `engine/animationEvaluator.ts:84-105` computes
  `from + (to - from) * ratio`; holds before the first and after the last keyframe
  (`:89-95`). There is no easing metadata, no bezier, no stepped mode — the domain
  glossary intends hold/linear/bezier + easing presets (`CONTEXT.md:90,94`), but the
  implementation has only linear today. (No ADR contradicts this; `docs/adr/` is empty.)
- Time flows: `playbackStore.play` advances via `requestAnimationFrame`, emits
  `CurrentTimeChanged` (`stores/playbackStore.ts:201-220`), the `Renderer` forwards to
  `SceneRenderer.handleTimeChanged` (`pixi/renderer/renderer.ts:442-451`), which
  re-evaluates every node (`pixi/renderer/sceneRenderer.ts:192-200`). Keyframe edits emit
  `KeyframeAdded/Removed/Moved/ValueChanged` → same re-evaluate path
  (`renderer.ts:512-517`).
- Material resolution is static per evaluation: `resolveShaderUniforms(parameters,
  overrides, scratch)` reads `node.material.overrides` (`sceneRenderer.ts:388-420`,
  `engine/materialResolution.ts:81-107`), then `#applyNodeShader` diffs the scratch and
  re-applies filter uniforms when changed (`sceneRenderer.ts:348-386`).

## 2. Feasibility per uniform kind

All material parameter kinds and their canonical JS value shapes
(`backend/app/parameters.py`, `frontend/src/engine/materialInstance.ts:4-8`):

| kind | value shape | interpolatable? | mode |
|---|---|---|---|
| `number` / `float` | number | yes | linear (existing `#evaluate`) |
| `color` | `'#rrggbb'` hex string | yes | linear per RGB channel → hex |
| `vec2` / `vec3` / `vec4` | `number[]` | yes | component-wise linear |
| `int` | integer number | no (by request) | **hold** — constant until next keyframe, then jumps |
| `bool` | boolean | no | **hold** |
| `sampler2D` | asset-id string | no | **hold** — texture swap at the keyframe time |
| built-ins `tint` (color), `opacityMultiplier` (number) | as above | yes | linear |

- "Hold" is exactly the user's requirement ("2s = 3, 5s = 6 → changes immediately") and is
  the glossary's first interpolation type (`CONTEXT.md:94`).
- Vec/color components should be clamped to [0,1] for `opacityMultiplier` and alpha
  channels to match today's behavior (`materialResolution.ts:189-191`,
  `uniformControls.tsx` clamps alpha to [0,1]). Hex color has no alpha — RGB only.
- Continuous interpolation of `tint`/`opacityMultiplier` must stay consistent with
  `resolveMaterial` (`materialResolution.ts:43-53`).
- No new interpolation machinery is required for hold: it's the existing
  before-first/after-last path applied between keyframes.

## 3. Time uniform (`uTime`)

Feasible; modeled exactly on the reserved `uTexture`:

- Reserve the key `uTime` (float, **seconds**). Mirror `RESERVED_TEXTURE_UNIFORM`
  (`shaders/reflection.ts:1`) and backend `RESERVED_UNIFORM_KEYS`
  (`backend/app/parameters.py:27`) so authors cannot define a conflicting default and the
  reflection/UI excludes it. A shader author simply writes `uniform float uTime;` in their
  fragment shader and it is fed.
- **Why seconds**: every time value in the system is seconds — `Keyframe.time`
  (`keyframe.ts:6`), the playhead, playback (`playbackStore.ts`). Shaders wanting ms/µs
  multiply (float32 seconds keeps ~7.8 µs resolution even at 60 s; ms at 60 s would be
  worse). Keep the source uniform in seconds and document the convention.
- **Value source**: the slide playhead, `CurrentTimeSource.getTime(slideId)`
  (`sceneRenderer.ts:37-42`). Deterministic, scrubbable, and identical across
  render/preview/export (see `CONTEXT.md:40` deterministic export).
- **Upload mechanism**: add `uTime` to the resolved shader scratch (`keys/kinds/values`)
  in `resolveShaderUniforms`, always. During playback the playhead moves every frame →
  `CurrentTimeChanged` → re-evaluate → scratch diff → `applyFilterUniforms` rewrites
  `uniforms.uTime` (`nodeShader.ts:48-53`). Pixi's generated sync uploads the uniform on
  every draw (uniform group is not static) — verified against
  `pixi.js/lib/rendering/renderers/gl/shader/utils/generateUniformsSync.mjs`.
  A shader that does **not** declare `uTime` is unaffected: Pixi skips group uniforms
  missing from the compiled program (`!uniformData[i]` → continue).
- Idle (playhead still) → `uTime` freezes at the playhead. That is the right authoring
  semantic and matches playback/scrub/export.
- Fullscreen slide shaders get the same treatment via `resolveFullscreenShaderState`
  (`fullscreenPass.ts:182-203`).
- Shader preview mini-renders tick continuously (`shaderPreviewStage.ts:39-42`) and could
  advance a `uTime` per tick — nice-to-have, not required for the feature.

## 4. How to organize it (model, engine, renderer, persistence)

### Model
- Generalize `Keyframe.value` from `number` to `MaterialOverrideValue`
  (`string | number | boolean | number[]`), and add a per-node **material track map**
  alongside the existing property tracks — e.g. `NodeAnimation.materialTracks:
  Map<string, Keyframe[]>` keyed by parameter key (`nodeAnimation.ts`). Parameter keys are
  not a fixed union (they come from material definitions), so they cannot join
  `AnimationProperty`.
- Validation per kind replaces `requireKeyframeValue` (`animationProperties.ts:50-58`).
- First cut: interpolation mode **implied by kind** (hold for int/bool/sampler2D, linear
  otherwise). Explicit per-keyframe `interpolation` metadata (bezier/tangents/easing
  presets) is the glossary's future shape (`CONTEXT.md:90,94`) — defer; the model change
  above does not block it.

### Engine / evaluation
- `AnimationEvaluator` gains a `#evaluateValue(kind, keyframes, time, fallback)` and the
  engine exposes evaluated material overrides at a time, e.g.
  `evaluateMaterialOverrides(nodeId, time)` = static overrides overlaid with keyframe
  tracks (later tracks win for the same key, matching the future clip layering idea in
  `CONTEXT.md:104`).
- `resolveMaterial` / `resolveShaderUniforms` take the **evaluated** overrides instead of
  `node.material.overrides` (`sceneRenderer.ts:388-420`). Commands
  (`OverrideMaterialParameterCommand`, `AddKeyframeCommand`) and `AnimationManager`
  (`animationManager.ts:53-128`) are extended so the keyframe and override systems stay
  coherent (auto-key on edit when the parameter already has a track, like
  `keyframeEdit.autoKeyCommands`).

### Renderer
- Zero new plumbing: `Keyframe*` events and `CurrentTimeChanged` already re-evaluate and
  re-apply (`renderer.ts:442-451,512-517`, `sceneRenderer.ts:192-200`).

### Persistence
- Frontend-only: `engine/json.ts:50-68` (`KeyframeJSON.value`),
  `engine/lessonSerializer.ts:379-417`, `engine/lessonValidation.ts`. The backend stores
  the lesson blob verbatim with only shallow top-level validation
  (`backend/app/projects/model.py`, `backend/app/projects/validation.py:23-47`) — no
  backend schema change.

## 5. UI perspective

- **Material Inspector** (`components/panels/MaterialInspectorSection.tsx`): each uniform
  field gets the existing keyframe affordance — the `state` indicator
  (static/animated/onKeyframe, `inspectorFields.tsx:83-91` + `app/keyframeActions.ts:57-80`)
  and an "Add keyframe at playhead" action; in Animation Mode, editing a field auto-keys
  (mirror `applyNodeFieldAutoKey`, `app/inspectorActions.ts:350-374`, generalized to
  non-numeric values). This matches how transform fields already behave.
- **Timeline** (`components/panels/timelineTracks.ts:56-70`): add a Material group of
  subtracks per parameter key of the node's assigned material, each with the existing `+`
  add-keyframe button (`TimelineBody.tsx:295-313`). Keyframe markers, drag, context-menu
  delete all operate on keyframe ids (`TimelineBody.tsx:178-268`) — generalized values
  flow through if the value rendering (context menu/delete) stays id-based.
- **Graph editor** (`CONTEXT.md:97`) is a future view; discrete kinds render as stepped
  curves. Out of scope now.
- `playing` disables the material picker/fields today (`MaterialInspectorSection.tsx`);
  keep it, and auto-key during play like transform fields.

## 6. Open decisions to grill before implementation

1. `uTime` in seconds vs ms — recommendation: seconds (system-wide convention).
2. Per-keyframe explicit `interpolation` metadata now, or kind-implicit hold/linear first?
   (recommend kind-implicit now; it satisfies the request and keeps `KeyframeJSON` flat.)
3. Keyframes for a parameter the material no longer defines (material swapped):
   ignore the track, or keep and warn? (recommend ignore + keep track data.)
4. Fullscreen slide-shader uniforms — keyframe them too, or per-node materials only for
   this phase?
5. Alignment with the future Animation Clips (`CONTEXT.md:99-104`): don't build clips now;
   the material-track layering above is shaped so clip channels can later resolve to it.

## Suggested next steps

- Spec it (issue #26 is the Materials & Shaders spec; this is a natural follow-up ticket).
- TDD seams: `engine/animationEvaluator.test.ts` (per-kind interpolation),
  `engine/materialResolution.test.ts` (evaluated overrides),
  `pixi/renderer/nodeShaderRender.test.ts` + `fullscreenPassRender.test.ts` (uTime
  upload + keyframed uniforms re-apply on time change),
  `components/panels/MaterialInspectorSection` DOM tests (keyframe affordance),
  `timelineTracks` DOM tests (material subtracks).

## Source references

- `CONTEXT.md:89-104` — keyframe/interpolation/timeline glossary (hold/linear/bezier).
- `engine/keyframe.ts`, `engine/nodeAnimation.ts`, `engine/slideAnimation.ts`,
  `engine/animationEvaluator.ts`, `engine/animationProperties.ts`,
  `engine/animationManager.ts`.
- `engine/materialInstance.ts`, `engine/materialResolution.ts`,
  `engine/materialDefinition.ts`.
- `backend/app/parameters.py` (kinds + reserved keys),
  `backend/app/projects/validation.py` (shallow persistence validation).
- `pixi/renderer/sceneRenderer.ts`, `pixi/renderer/renderer.ts`,
  `pixi/renderer/nodeShader.ts`, `pixi/renderer/fullscreenPass.ts`,
  `pixi/renderer/programCache.ts`.
- `stores/playbackStore.ts` (playhead + playback loop).
- UI: `components/panels/MaterialInspectorSection.tsx`, `inspectorFields.tsx`,
  `timelineTracks.ts`, `TimelineBody.tsx`, `app/inspectorActions.ts`,
  `app/keyframeActions.ts`, `engine/keyframeEdit.ts`.