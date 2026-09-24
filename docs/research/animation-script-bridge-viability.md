# Bridge viability — Motion Canvas / Theatre.js vs thin own layer

Status: investigation (no code changed). Date: 2026-09-24.
Fits wayfinder map https://github.com/MKoth/animated-slideshow-editor/issues/360,
ticket https://github.com/MKoth/animated-slideshow-editor/issues/361.
Standing preference under test: Animation Script compiles to the existing timeline
inside one Transaction (timeline stays editable, deterministic Video Export via
exact-timestamp evaluation). Manual clip/collection authoring is out of scope.

## Verdict: build thin (compile-to-timeline). Do not embed or wrap either player.

The Animation Script should be a thin own layer that type-checks a small script
DSL and emits the repo's existing serializable Commands (keyframes, Clip
Instances, Collection placements) inside one `TransactionCommand`, exactly like
every other editor mutation. Neither Motion Canvas nor Theatre.js should drive
the Pixi scene or own any timeline state at runtime:

- **Motion Canvas** owns its scene graph and its canvas. Its `2d` package *is*
  "the default renderer for 2D motion graphics", scenes are trees of its own
  `Node` instances, and animation is authored as generator functions (`yield*`
  tweens), not as data. There is no supported path to point it at an external
  Pixi scene graph, and its export model (play through, save frames as images,
  assemble with ffmpeg) contradicts this repo's exact-timestamp evaluator
  (`t = i / fps`). Embedding it would mean two renderers, two scene graphs, and
  a non-editable code artifact instead of timeline keyframes.
- **Theatre.js** is architecturally closer (renderer-agnostic: `sheet.object` +
  `onValuesChange` lets *our* code push values into Pixi; `sequence.position` is
  settable so it scrubs; project state is JSON), and `@theatre/core` alone is
  Apache-2.0 + ~0.9 MB. But adopting it still means a **second keyframe store**
  with its own prop-type system (number/compound/rgba/boolean/string/image —
  no morph vertices, bone weights, symmetry, or control blends) that must be
  kept in sync with the repo's `NodeAnimation`/Clip/Collection model, mapped
  into repo Commands for undo, and re-evaluated per export frame through a
  foreign engine. Worse, the visual editor (`@theatre/studio`, ~22 MB) is
  **AGPL-3.0** — it must never ship inside this editor's bundle, so the
  "author visually, keep timeline editable" story collapses: either we ship
  AGPL code or users hand-edit Theatre state JSON. A thin compiler gets the
  scriptability without the second store, the license hazard, or the bundle.
- The thin layer reuses every existing seam for free: `TransactionCommand`
  atomic flatten + inverse rollback, `ClipInstance`/`ClipCollection` lanes,
  pure `evaluateX(nodeId, time)` shared by preview and export. A script run
  becomes one undo step and the output is ordinary editable keyframes.

## 1. How the repo works today (seams the bridge must respect)

- **Evaluation is pure and engine-owned.** `engine/animationEvaluator.ts`
  (2303 lines) exposes `evaluateX(nodeId, time)`-style pure functions of
  (scene, keyframes, clips, time). The Pixi `SceneRenderer`
  (`frontend/src/pixi/renderer/sceneRenderer.ts`) *pulls* evaluated state at
  time `t` and applies it to Pixi containers (`#evaluateAndApply`,
  `applyEvaluatedState` in `nodeRenderer.ts`). Preview and export share the
  evaluator — export timestamps are exactly `t = i / fps`
  (`engine/export.ts:60-67`, `getExportFrameTimestamps`).
- **Mutations are serializable Commands with inverses; Transactions are
  atomic.** `engine/commands/command.ts` (`Command { validate, execute →
  inverse, toJSON }`); `engine/commands/transactionCommand.ts:19-63`
  flattens nested transactions and rolls back children on failure. 177 command
  files under `engine/commands/`. Undo = `applyUndo` + `undoStack.ts`. Any
  script output that is not expressible as Commands does not participate in
  undo.
- **Clips/Collections are lanes, not players.** `ClipInstance { id, clipId,
  startTime, speed, enabled, paramOverrides }` (`engine/clipInstance.ts:11-22`);
  `ClipCollection` is semantic-name → clipId bindings
  (`engine/clipCollection.ts:9-34`). No embedded runtime; instances are data
  the evaluator reads.
- **Slide model.** `Slide { scene, animation, duration }`
  (`engine/slide.ts:14-22`); per-node tracks in `NodeAnimation`
  (`engine/nodeAnimation.ts`, 1270 lines).

## 2. Cited facts

### Motion Canvas (motion-canvas/motion-canvas, MIT)

1. **Own renderer + own scene graph.** The monorepo's `2d` package is "the
   default renderer for 2D motion graphics" and `core` is "all logic related
   to running and rendering animations"
   (https://github.com/motion-canvas/motion-canvas — README packages table).
   Scenes are "collections of nodes … organized in a tree hierarchy, with the
   scene view at its root", where "each node is an instance of a class
   extending the base `Node` class" and JSX maps "directly to Node instances"
   with "no virtual DOM" (https://motioncanvas.io/docs/hierarchy). Driving an
   external Pixi `Container` tree is not a documented capability; the bridge
   would have to mirror two scene graphs per frame.
   License: MIT (https://raw.githubusercontent.com/motion-canvas/motion-canvas/main/LICENSE).
2. **Code-is-the-artifact, not data.** "Scenes are declared using generator
   functions — they serve as a description of how the animation should play
   out" and `yield*` chains tweens (`fill(...).to(...).wait(...)`) with flow
   combinators `all/chain/delay/sequence/loop`
   (https://motioncanvas.io/docs/flow, https://motioncanvas.io/api/core/flow).
   Node properties are `Signal`s (lazy, cached, dependency-tracked) animated
   by yielding tweens (https://motioncanvas.io/docs/signals). A generator
   cannot be serialized back into this repo's editable keyframe tracks — the
   compile-to-timeline preference kills the embed option on its own.
3. **Export = record frames, not evaluate timestamps.** "Motion Canvas will
   play through the animation and save each frame as an image … import the
   rendered image sequence into a video editor … or convert … using ffmpeg"
   (https://motioncanvas.io/docs/rendering). That is wall-clock playback
   capture, incompatible with `export.ts`'s deterministic `N =
   round(duration × fps)`, `t = i / fps` contract.
4. **Editor/player packaging assumes MC owns the app.** The repo ships a
   `player` "custom element for displaying animations", a `vite-plugin` "for
   developing and bundling animations", and a `ui` "user interface used for
   editing" (same README packages table). Adopting any of these drags in MC's
   project/editor model; the Vite dev-server editor has no story for emitting
   repo `Command` JSON.
5. **Weight.** `@motion-canvas/core` 3.17.2 ~0.87 MB + `@motion-canvas/2d`
   ~1.7 MB unpacked (npm registry, 2026-09-24) — small in absolute terms, but
   it buys a parallel renderer the repo (already carrying pixi.js 8.21.0,
   ~75 MB unpacked) would still need alongside.

### Theatre.js (theatre-js/theatre; core Apache-2.0, studio AGPL-3.0)

6. **Renderer-agnostic by design (the closest fit — still rejected).**
   "Everything that is animated is represented as an object. Objects can be
   THREE.js objects or virtual objects" and "props can be changed via
   Theatre's UI or via code"
   (https://www.theatrejs.com/docs/latest/concepts). The documented pattern
   is `sheet.object(...)` + `onValuesChange(values => { /* update YOUR
   object */ })` (https://www.theatrejs.com/docs/latest/manual/sequences,
   https://www.theatrejs.com/docs/latest/api/core#object.onvalueschange_callback_).
   A Pixi adapter is technically possible — but it makes Theatre a shadow
   keyframe store beside `NodeAnimation`, with per-frame callbacks instead of
   the repo's pull-evaluator.
7. **Scrubbable + serializable state.** `sequence.position` is gettable *and*
   settable ("set the animation position to 1 second") with
   `play/pause/play({range, rate, direction, iterationCount})`
   (https://www.theatrejs.com/docs/latest/api/core#sequence.position). Project
   state "is stored as a JSON object … and can be exported as a JSON file",
   reloadable via `getProject(id, { state })`
   (https://www.theatrejs.com/docs/latest/manual/projects). Deterministic
   export *could* step `position = i / fps` — but keyframe semantics (tweens,
   aggregate keyframes, bezier handles) would then be defined by Theatre's
   engine, not `animationEvaluator.ts`, breaking the single-evaluator export
   guarantee.
8. **Prop types don't cover this repo's value domain.** Animatable props are
   `number / compound / rgba / boolean / string / stringLiteral / image /
   file` (https://www.theatrejs.com/docs/latest/api/core#prop-types).
   Repo keyframe values include morph-vertex sets, bone weights, symmetry
   params, control blends, material overrides
   (`animationEvaluator.ts` imports). Everything would have to be flattened
   to numbers with a lossy reverse mapping for timeline editability.
9. **License split is the hard blocker for the visual story.** "`@theatre/core`
   is released under the Apache License. … The studio (`@theatre/studio`) is
   released under the AGPL 3.0" and "your project's final bundle only includes
   `@theatre/core`, so only the Apache License applies"
   (https://github.com/theatre-js/theatre/blob/main/packages/studio/README.md;
   same text on https://www.npmjs.com/package/@theatre/studio; dual text in
   https://raw.githubusercontent.com/theatre-js/theatre/main/LICENSE).
   Shipping Theatre's visual editor inside this editor = shipping AGPL code.
   Core-only use keeps Apache-2.0 but leaves script authors with hand-written
   state JSON and no UI — strictly worse than a thin DSL with repo-native
   validation errors.
10. **Weight.** `@theatre/core` 0.7.2 ~0.9 MB unpacked — shippable;
    `@theatre/studio` 0.7.2 ~22.3 MB unpacked — dev-only, must never be
    bundled (npm registry, 2026-09-24). (For scale: pixi.js 8.21.0 ~75 MB
    unpacked.)

## 3. Why the losers lose (per judging axis)

| Axis | Motion Canvas (embed) | Theatre.js (wrap core) | Thin own layer (compile) |
|---|---|---|---|
| Player+timeline coupling vs Pixi | Fails: MC *is* the renderer; no Pixi-target path. Two scene graphs. | Possible via `onValuesChange`, but callback-push fights the pull-evaluator; second playhead beside slide playhead. | Native: emits keyframes/Clip Instances the existing evaluator already reads. |
| Variable-animation vs scene-graph ownership | Signals own MC Nodes; repo owns Pixi containers. Ownership collision. | Clean (plain values, owner updates scene) — its one real advantage. | Trivially clean: output is data, no runtime ownership at all. |
| Licensing | MIT — fine. | Core Apache-2.0 fine; **studio AGPL-3.0** poisons any in-editor visual authoring. | No dependency — no risk. |
| Bundle weight | ~2.6 MB for a redundant renderer. | ~0.9 MB core-only is fine; studio 22 MB must be excluded by build config (fragile). | ~0. |
| Determinism / scrubbability | Generator forward-play + frame-capture export; conflicts with `t = i/fps`. | Scrubbable, but semantics owned by foreign engine; export guarantee splits in two. | Single evaluator; script output is ordinary keyframes, export path untouched. |
| Undo fit | No path to repo Commands (artifact is code). | Studio has its own `studio.transaction`; mapping Theatre edits to repo inverses is a sync project of its own. | One `TransactionCommand` → one undo step; free rollback via existing flatten logic. |
| Timeline editability (standing preference) | Fails outright (code ≠ keyframes). | State JSON is editable only via AGPL studio or by hand. | Output *is* the timeline; editable immediately. |

## 4. Shape of the thin layer (for the spec author, not this ticket)

- Grammar: sequenced statements over (node selector, property, keyframe list
  with hold/linear/bezier, clip-instance placements with
  startTime/speed/paramOverrides, collection bindings by semantic name).
- Compiler: pure function `scriptSource → Command[]` (all existing command
  types: `AddKeyframe`, `AssignClip`, `ApplyClipCollection`, …), validated
  before execution; execution wraps them in one `TransactionCommand` so
  validate-then-execute + rollback semantics hold.
- Preview = run compiler against a scratch engine or dry-run, show resulting
  keyframes; Export untouched (evaluator already handles the emitted data).
- Deliberately out of scope: visual script editing, live two-way binding,
  embedding either studio.

## 5. Open risks

1. **DSL scope creep.** A "thin" layer can fatten into a general expression
   language (loops, conditionals, randomness break determinism). Spec must fix
   a minimal statement set and forbid wall-clock/random sources so export
   stays a pure function of (project, fps).
2. **Selector stability.** Scripts referencing nodes by name/path break on
   rename. Prefer stable node ids with a resolve-and-report step (unresolved
   selector = validation error, transaction never executes).
3. **Clip param surface.** `paramOverrides: Record<string, number>` is the
   natural script knob for clips; scripts needing richer params will pressure
   the ClipDefinition schema — keep the v1 boundary at numbers.
4. **Theatre envy.** Future "visual script editing" requests will re-raise
   Theatre studio; the AGPL finding here should be recorded in an ADR so it
   isn't re-litigated.
5. **Motion Canvas inspiration without dependency.** MC's flow combinators
   (`all/sequence/loop`) and tween vocabulary are good DSL design input
   (MIT-licensed docs, not code) — borrow the semantics, not the package.

## Sources (primary only; all fetched 2026-09-24)

- https://github.com/motion-canvas/motion-canvas (packages table, MIT-adjacent
  README claims; license file below)
- https://raw.githubusercontent.com/motion-canvas/motion-canvas/main/LICENSE (MIT)
- https://motioncanvas.io/docs/flow ("yield means the current frame is ready…")
- https://motioncanvas.io/docs/hierarchy (Node tree, JSX→Node, no VDOM)
- https://motioncanvas.io/docs/signals (lazy/cached signals, tween-by-yield)
- https://motioncanvas.io/api/core/flow (`all/chain/delay/sequence/loop`)
- https://motioncanvas.io/docs/rendering (play-through frame capture + ffmpeg)
- https://www.theatrejs.com/docs/latest/concepts (objects/props/sheets/sequences)
- https://www.theatrejs.com/docs/latest/manual/sequences (`onValuesChange`
  update-your-object pattern, keyframes, tween editor, programmatic control)
- https://www.theatrejs.com/docs/latest/api/core (`sequence.position`
  get/set, `play` opts, `object.value/props/onValuesChange`, prop types)
- https://www.theatrejs.com/docs/latest/manual/projects (JSON state
  export/import via `getProject(id, { state })`)
- https://github.com/theatre-js/theatre/blob/main/packages/studio/README.md
  (core Apache-2.0 / studio AGPL-3.0 split)
- https://raw.githubusercontent.com/theatre-js/theatre/main/LICENSE (dual license text)
- npm registry `dist.unpackedSize`: @theatre/core 0.7.2 / @theatre/studio
  0.7.2 / @motion-canvas/core 3.17.2 / @motion-canvas/2d 3.17.2 / pixi.js 8.21.0
- Repo seams: `frontend/src/engine/animationEvaluator.ts`,
  `frontend/src/engine/export.ts:60-67`,
  `frontend/src/engine/commands/command.ts`,
  `frontend/src/engine/commands/transactionCommand.ts:19-63`,
  `frontend/src/engine/clipInstance.ts:11-22`,
  `frontend/src/engine/clipCollection.ts:9-34`,
  `frontend/src/engine/slide.ts:14-22`,
  `frontend/src/pixi/renderer/sceneRenderer.ts`

## Placement note

Ticket suggested `research/animation-script-bridge-viability.md` if it fits.
`research/` currently holds only the `morph-brush/` prototype folder (with its
own README), while prior single-file wayfinder research lives flat under
`docs/research/` (`d3-svg-to-pixijs-texture-pipeline.md`,
`uniform-animation-and-time-uniform.md`). This file follows that convention:
`docs/research/animation-script-bridge-viability.md`.
