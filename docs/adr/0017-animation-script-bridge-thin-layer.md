# ADR 0017 — Animation Script Bridge: Thin Compile-to-Timeline Layer, No Foreign Runtime

Date: 2026-09-24
Status: Accepted (task #367, wayfinder map #360)
Deciders: MKoth + opencode (wayfinder task)

## Context

Map #360 is charting a build-ready spec for an Animation Script — a per-slide authored program that compiles to ordinary timeline data in one Transaction (lowering #362; addressing #363; time semantics ADR 0015; functions/library ADR 0016). Before fixing the language layer, ticket #361 asked whether an existing animation runtime — Motion Canvas or Theatre.js — should own the script instead of a thin own layer. The research verdict (`docs/research/animation-script-bridge-viability.md` on branch `research/bridge-viability`: 10 primary sources, comparison table per judging axis, thin-layer shape, 5 open risks) was: build thin. Ticket #367 records that decision here so the spec and future sessions do not re-litigate it (research open risk 4 — "Theatre envy").

Engine constraints the decision respects (verified in-repo):

- Evaluation is pure and engine-owned: `evaluateX(nodeId, time)`-style functions in `frontend/src/engine/animationEvaluator.ts`, shared by preview and Video Export at exact timestamps `t = i/fps` (`frontend/src/engine/export.ts:60-67`).
- Mutations are serializable Commands with inverses; `TransactionCommand` flattens nested transactions and rolls back children on failure (`frontend/src/engine/commands/transactionCommand.ts:19-63`); 177 command files under `frontend/src/engine/commands/`.
- Clip Instances and Clip Collections are data lanes the evaluator reads, not players (`frontend/src/engine/clipInstance.ts:11-22`, `frontend/src/engine/clipCollection.ts:9-34`).
- Determinism contract: compile stays a pure function of (source, slide state) — no wall clock, no unseeded randomness (ADR 0015, #362).

## Decision

### 1. Thin own layer — compile to existing Commands

The Animation Script is a thin own layer that type-checks a code-like DSL and emits the repo's existing serializable Commands — node keyframes, Clip Instance placements, Collection placements — wrapped in one `TransactionCommand`. A script run is one undo step, and its output is ordinary editable timeline data; no script output exists outside the Command system.

### 2. No foreign runtime

Neither Motion Canvas nor Theatre.js drives the Pixi scene or owns any timeline state at runtime; no foreign package becomes a dependency of the editor.

- **Motion Canvas — rejected.** It owns its renderer and its scene graph (the `2d` package is "the default renderer for 2D motion graphics"; scenes are trees of its own `Node` instances; there is no supported path to point it at an external Pixi scene graph), and its artifact is code — generator functions and signals — not serializable data, so it cannot compile back into editable keyframe tracks. Its export is play-through frame capture + ffmpeg, contradicting this repo's exact-timestamp evaluator. Embedding would mean two renderers, two scene graphs, and a non-editable code artifact.
- **`@theatre/core` — rejected as a second keyframe store.** Renderer-agnostic and scrubbable (the closest fit), but adopting it means a shadow keyframe store beside `NodeAnimation` with its own prop types (number/compound/rgba/boolean/string/image) that do not cover morph vertices, bone weights, symmetry, or control blends; it must be synced with the repo model, mapped into Commands for undo, and re-evaluated per export frame through a foreign engine — splitting the single-evaluator export guarantee.
- **`@theatre/studio` (AGPL-3.0) — must never ship in the bundle.** The visual-editing story under Theatre would ship AGPL code; core-only use leaves script authors hand-editing state JSON with no UI, strictly worse than a thin DSL with repo-native compile diagnostics. This licensing split is the ADR's load-bearing finding.
- **Motion Canvas flow semantics — design input only.** Its flow combinators (`all` / `sequence` / `loop`) and tween vocabulary are borrowed as semantics from MIT-licensed docs, with no code and no dependency; the DSL's own flow model is ADR 0015's (`sequence` / `parallel` / `stagger`).

### 3. Judging axes (why thin wins)

| Axis                             | Motion Canvas (embed)                                    | Theatre.js (wrap core)                                                                | Thin own layer                                                 |
| -------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Pixi scene / timeline coupling   | Fails — MC _is_ the renderer; two scene graphs           | Possible via callbacks, but the push model fights the pull-evaluator; second playhead | Native — emits keyframes/instances the evaluator already reads |
| Artifact vs timeline editability | Code, not data; cannot return to tracks                  | State JSON editable only via AGPL studio or by hand                                   | Output _is_ the timeline; editable immediately                 |
| Licensing                        | MIT — fine                                               | Core Apache-2.0 fine; studio AGPL-3.0 poisons in-editor authoring                     | No dependency — no risk                                        |
| Determinism / scrubbability      | Forward-play + frame capture; conflicts with `t = i/fps` | Scrubbable, but semantics owned by a foreign engine                                   | Single evaluator; export path untouched                        |
| Undo fit                         | No path to repo Commands                                 | Theatre transactions ≠ repo inverses; sync project                                    | One `TransactionCommand` → one undo step                       |
| Bundle weight                    | ~2.6 MB redundant renderer                               | ~0.9 MB core; 22 MB studio must be excluded by build config (fragile)                 | ~0                                                             |

## Alternatives Considered

- **Embed Motion Canvas (MIT)** — rejected: own renderer/scene graph, code-not-data artifact, play-through export; two renderers for one scene.
- **Wrap `@theatre/core` (Apache-2.0)** — rejected: second keyframe store with a narrower value domain, foreign evaluator in the export path, and the visual-editor story still blocked by AGPL.
- **Ship `@theatre/studio` for visual script authoring** — rejected: AGPL-3.0; never in the bundle.
- **Fork/vendor either runtime** — rejected: a fork inherits the architecture mismatch (Motion Canvas) or the second-store sync burden (Theatre) while adding maintenance.
- **No language layer (hand-authored keyframes only)** — rejected: the destination demos (#365) need parameterized, data-driven animation.

## Consequences

- The spec's architecture chapter assumes compile-to-Commands in one Transaction; no foreign runtime appears anywhere in it.
- The AGPL finding is recorded: future "visual script editing" requests that re-raise Theatre studio are answered by this ADR rather than re-litigated (research open risk 4).
- Research risks handed forward to the spec: DSL scope creep (bounded by #362/#364/#366 decisions), selector stability (#363 bindings), clip param surface (#362/#363) — none reopen the bridge question.
- ADR 0015 (time) and ADR 0016 (functions/library) stand unchanged; #368 (script lifecycle on duplication) is unaffected.
- Map fog "Prompter/audio-marker sync future" is untouched — v1 remains explicit waits.

## Links

- Map: #360
- This task: #367
- Research: #361 — `docs/research/animation-script-bridge-viability.md` on branch `research/bridge-viability` (verdict, 10 primary sources, comparison table, thin-layer shape, 5 open risks)
- Prior decisions: #362 (lowering), #363 (addressing), #364 (time, ADR 0015), #365 (demos), #366 (functions/library, ADR 0016)
- Engine facts: `frontend/src/engine/animationEvaluator.ts`, `frontend/src/engine/export.ts:60-67`, `frontend/src/engine/commands/transactionCommand.ts:19-63`, `frontend/src/engine/clipInstance.ts:11-22`, `frontend/src/engine/clipCollection.ts:9-34`, `frontend/src/engine/slide.ts:14-22`
- Follow-ups: #368 (script lifecycle); spec build (the destination of map #360)
