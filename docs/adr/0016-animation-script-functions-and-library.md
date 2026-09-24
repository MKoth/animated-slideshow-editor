# ADR 0016 — Animation Script Functions and Library

Date: 2026-09-24
Status: Accepted (grill #366, wayfinder map #360)
Deciders: MKoth + opencode (wayfinder grill)

## Context

Map #360 is charting a build-ready spec for an Animation Script — a per-slide authored program that compiles to ordinary timeline data in one Transaction (lowering #362; addressing #363; time #364, ADR 0015). The demo verdict (#365) proved the four acceptance demos expressible over existing primitives and handed the remaining language holes to ticket #366: expressions and arithmetic, user-defined variables, numeric iteration lists (deferred from ADR 0015), function bodies, `pointArrowAt` math, and typed params/data rows.

Engine and product constraints this model respects:

- Compile stays a pure function of (source, slide state) — no wall clock, no unseeded randomness; a clean compile dispatches one `TransactionCommand` (ADR 0015, #362).
- The engine's world math already exists: rotation is radians and composes additively, and world→local inversion is `relativeTransform` (`frontend/src/engine/worldTransform.ts:292-308`, rotation = `world.rotation - parentWorld.rotation`); the runtime `lookAt` constraint is precedent. The evaluator exposes solved world transforms (`evaluatedWorldTransformOf`, `EvaluatedWorldTransformSource`).
- Project data is embedded and tolerant-additive: `LessonJSON.library` carries assets/materials/shaders/data_sources/clips/clipCollections (`frontend/src/engine/json.ts:423-430`); clip definitions are project-local snapshots even though a global backend library exists as a source. `ReusableObjectJSON` carries rigs (nodes, clips, ControlSets) and deliberately never carries per-slide animation (`frontend/src/engine/internal.ts:4496-4500`).
- The chart `data_sources` are chart/flowchart data (`EmbeddedDataPoint { label, value, series?, tooltip?, color? }`) — a project library resource, not a scripting value type.
- AI surfaces are spec-only today: the Context Snapshot is a token-budgeted digest, and AI Edit Proposals are validated by a static pass and executed as one transaction, never as a runtime player.

## Decision

### 1. Functions are compile-time-inlined fragments

- An **Animation Script Function** is a named, typed, compile-time-inlined fragment of a script: parameters, immutable locals, expressions, loops, calls, and ordinary statements. Nothing runs at runtime; the compiled output is ordinary keyframes/instances (ADR 0015, #362).
- Calling a function is a statement: the **cursor advances by the body's extent**, exactly like a group (ADR 0015). `parallel`, `at()`, and `stagger` semantics apply to the call as to any statement.
- **Recursion is a compile error** — direct or mutual (the call graph must be acyclic), because inlining would never terminate.
- Definitions may be **local** (in the script source, script-scoped) or **library entries** (persisted, shared). Local definitions use the same syntax; a local definition must precede its use (define-before-use), and a local name colliding with a library entry or a built-in is a compile error.
- A function body is a **closed scope**: it sees its parameters, its own locals and loop variables, library entries, and built-ins — never the calling script's `bind` aliases, local functions, or marks. Library entries are **independent compilation units**; caller state enters only through typed parameters.
- **Markers inside a body are per-invocation local**: `mark('x')` / `at('x')` resolve within that call; two calls never collide, and a caller's marks stay invisible. This deliberately differs from `repeat`/`for`/`stagger` bodies (labels there are compile errors, ADR 0015) because an invocation is a scope while a loop body is inline in one scope — and it lets a reusable fill-with-pauses entry use the backfill pause pattern internally.

### 2. Expressions and variables

- **`let`** declares an immutable, block-scoped compile-time value; it advances the cursor 0 and emits nothing. No reassignment, no mutation (v1).
- Operators: `+ − * / %`, parentheses, unary minus. Number literals are seconds; `s`/`ms` suffixes per ADR 0015. Division by zero (or a non-finite result) is a compile error. No comparisons, no conditionals, no string operations, no wall-clock, no unseeded randomness (v1, consistent with #362/#364).
- #363's compile-time reads act as expressions: evaluated transform/opacity at `t`, exposed Control values, `cellRect(...)`, world bounds — plus the world-transform read added in §5.
- Built-in math: `abs`, `min`, `max`, `clamp`, `lerp`, `atan2`, `sin`, `cos`, `deg`, `rad`.
- **Numeric iteration**: list literals `[0, 0.5, 1]` and `range(start, end, step)` (positive, non-zero step; compile error otherwise), unrolled at compile time under the loop rules of ADR 0015. This is what un-sugars sampled tracking (`over:`/`every:`) into ordinary statements.

### 3. Types, parameters, and data rows

- Parameter/value types: `number` (seconds — `time`/`duration` are documentation roles, not distinct types), `color` (hex string), `string`, the binding kinds `node`, `group`, `table`, `cellRef`, `clip`, `collection`, `list<T>`, and **inline structural records**.
- A **data row** is a record value: the signature declares its shape inline — e.g. `rows: [{ target: node, cell: cellRef, color: color }]` — and call sites pass record literals. Fields are compile-time checked and accessed by name (`row.target`). Records are values, not a persisted entity; the chart `data_sources` remain chart data. No zip-of-parallel-lists.
- Parameters bind exactly like ordinary values: a `node`/`group`/`table` param behaves as a binding alias inside the body; a `number` param feeds cursor arithmetic (durations); a `list<node>` param is a legal `stagger` target list.
- **Signatures are positional and required**: explicitly typed parameters, no optional/default parameters, no named arguments for user functions in v1 (records carry the optionality; built-ins keep named variant forms because they are compiler-level). Type mismatches are compile diagnostics naming the parameter and source location.

### 4. Library storage, names, and versions

- Library entries live **project-local and embedded**: `LessonJSON.library.scriptFunctions` — the same tolerant-additive pattern as `library.clips` (no `.lesson` version bump). A `.lesson` file is self-contained and portable by construction; a global backend library (mirroring `clip_definitions`) and file import are deferred — the shape mirrors clips, so a later global library lands without a format change.
- **Naming**: project-scoped unique name, case-insensitive, block-on-duplicate; stable id.
- **Versioning**: each entry carries a monotonic `version`, bumped whenever its source is edited. A script's `lastCompiled` records the entry versions it compiled against, so a recompile after an edit can flag drift. Editing an entry never rewrites a dependent script's source; recompiles stay explicit.
- Resolution is by name at compile time, from source. A missing or renamed entry is a compile error whose diagnostic lists near-miss candidates (mirroring the #363 `bind` diagnostics); the source is never silently rewritten.
- Entries are **self-contained**: the caller's header `defaults { duration, ease }` never cross the call boundary; an entry may declare its own `defaults`. An entry's compiled output is a pure function of its arguments.
- `.lesson_object` **does not carry functions** in v1: objects carry rigs (nodes, clips, ControlSets), while scripts and functions are project-level programs. A function referring to an imported rig resolves by name at compile time and fails loudly if the rig is absent.
- **Discovery**: an editor library panel lists entries with name, signature, description, and version; the AI Context Snapshot carries entry names, signatures, and one-line descriptions — never bodies.

### 5. Built-ins and the world-transform read

- **Animation Script Built-ins** are compiler-provided stock functions shipped with the language, addressed by reserved names, not editable and not library entries (a user definition colliding with a built-in name is a compile error). `pointArrowAt` ships in v1:
  - `pointArrowAt(arrow, target, at: t)` — one rotation keyframe at `t` facing the target.
  - `pointArrowAt(arrow, target, over: d, every: s)` — sampled tracking: rotation re-sampled and **baked** into keyframes across `d`; the spec owns the default sample rate and sampling count.
- Implementation is compiler-level against the solver: target/arrow pivot world positions at each sample, `atan2`, then world→local rotation via the parent chain (the `relativeTransform` composition, `worldTransform.ts:292-308`) — no engine change, mirrors the `lookAt` constraint.
- **Read-surface amendment to #363**: a general world-transform read `worldAt(t)` is added — world x, y, rotation of a node at any `t`, compile-time and side-effect free (out-of-bounds `t` is a compile error). It supports hand-rolled pointing in user functions and does **not** reopen the recorded no-world→local-projection boundary: writes remain local-transform only.

### 6. AI safety: compile is the dry-run

- The static compile pass **is** the dry-run: a pure function of (source, slide state) that returns diagnostics plus the prospective command list without dispatching anything.
- AI proposals may author library entries and script sources through ordinary undoable commands (`SetScriptLibraryEntry`, `SetSlideAnimationScript`) inside the proposal's one Transaction (Spec 14 R7); the compiled **Run stays an explicit user gesture** — AI never silently animates a slide.
- **Compile budgets** (maximum unrolled statements / emitted keyframes / call depth) turn pathological scripts into diagnostics instead of compiler hangs.
- Sandboxing is moot: nothing executes at runtime.

### 7. Example signatures

Hablar filler — a user library entry (Demo A, #365):

```
function fillConjugationTable(
  table: table,
  rows: [{ target: node, cell: cellRef, color: color }],
  timings: { fly: number, pause: number }
) {
  defaults { duration: 0.4s, ease: easeInOut }

  for row in rows {
    row.target.tint(row.color)          // set @cursor
    row.target.fadeIn(0.2s)
    row.target.tween({ x: 0, y: 0 }, timings.fly)
    wait(timings.pause)
  }
}

// call site (in a script that bound `conj`, `endingRows`, `timing`):
fillConjugationTable(conj, endingRows, timing)
```

Arrow pointer — a built-in (Demo D, #365):

```
pointArrowAt(arrow, butterfly, at: 2.0)                       // snaps to face the target at 2.0
pointArrowAt(arrow, butterfly, over: 1.2s, every: 0.05s)      // baked tracking keyframes
```

## Alternatives Considered

- **Value-returning / first-class functions** — deferred: the demos need statement-emitting fragments; a return type system adds surface without acceptance pressure.
- **Closures over caller state** — rejected: bodies reading caller bindings/marks would make entries non-reusable and AI-unpredictable; parameters are the interface.
- **Markers banned inside function bodies** (loop consistency) — rejected: it kills the reusable pause/backfill pattern; per-invocation scoping is the principled fix.
- **Optional named params with literal defaults** — deferred: record params carry optionality; positional call sites are simpler for humans and AI.
- **Named record type declarations** (`type Row = {…}`) — deferred: inline structural records suffice for v1 signatures.
- **Zip of parallel lists instead of records** — rejected: records are named, checked, and match the "data rows" intent.
- **Distinct `time`/`duration` types** — deferred: seconds as `number` avoids unit algebra; role labels live in docs and diagnostics.
- **No user arithmetic (all math in built-ins)** — rejected: data-driven functions and hand-rolled pointing need expressions; the surface stays small.
- **Conditionals (`if`/`else`) in v1** — deferred: unrolled loops over compile-time lists cover the demos; comparisons/branching would widen the language.
- **Caller defaults inherited by library bodies** — rejected: an entry's output must depend only on its arguments (reproducibility, drift reasoning).
- **Global backend library in v1** — deferred: project-embedded entries keep `.lesson` self-contained; the clips pattern is the future template.
- **Functions carried in Reusable Objects** — rejected: objects carry rigs; programs stay project-level.
- **AI dispatching runs after validation** — rejected: the Run gesture stays with the user; validation alone never animates.
- **No AI integration in v1** — rejected: compile-as-dry-run is free and the library is a natural AI authoring surface.

## Consequences

- The spec's language/library chapters can state: compile-time inlined functions with closed scope and acyclic call graphs, immutable `let`, the operator/math/list surface, positional typed params with inline record types, the embedded versioned library with drift reporting, built-in stock functions, the `worldAt(t)` read, compile budgets, and the AI authoring path (`SetScriptLibraryEntry` / `SetSlideAnimationScript`, explicit Run, one Transaction).
- The map's fog "script execution safety (sandboxing, dry-run for AI calls)" is settled: sandboxing is moot, dry-run is the compile pass.
- #368 (script lifecycle on duplication) and #367 (bridge ADR) are unaffected; the remaining DSL surface (method vocabulary, read syntax, prelude grammar, sampling default) stays spec work, as #365 assigned.
- New glossary terms: Animation Script Function, Animation Script Library Entry, Animation Script Built-in; Animation Script Marker gains its per-invocation scope inside function bodies.

## Links

- Map: #360
- This grill: #366
- Prior decisions: #361 (research), #362 (lowering), #363 (addressing; read-surface amendment in §5), #364 (time, ADR 0015), #365 (demos)
- Engine facts: `frontend/src/engine/worldTransform.ts:259-308` (composition, `relativeTransform`), `frontend/src/engine/constraintEvaluator.ts:45-68` (`lookAt` precedent), `frontend/src/engine/json.ts:423-430` (`LessonLibraryJSON`), `frontend/src/engine/internal.ts:4496-4500` (objects never carry per-slide data), `frontend/src/engine/embeddedDataSource.ts` (chart `data_sources`)
- Follow-ups: #367 (bridge ADR), #368 (script lifecycle); spec build (the destination of map #360)
