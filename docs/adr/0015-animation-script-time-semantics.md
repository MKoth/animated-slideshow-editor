# ADR 0015 — Animation Script Time Semantics

Date: 2026-09-24
Status: Accepted (grill #364, wayfinder map #360)
Deciders: MKoth + opencode (wayfinder grill)

## Context

Map #360 is charting a build-ready spec for an Animation Script — a per-slide authored program that compiles to ordinary timeline data in one Transaction (lowering contract #362; addressing/capability matrix #363). Ticket #364 locked the time + composition semantics that the acceptance-demo draft (#365) and the spec build on.

Engine constraints the model respects:

- Node keyframe times are seconds, validated `[0, slide.duration]`; evaluation clamps time to the slide duration and holds first/last values (`frontend/src/engine/animationProperties.ts:75-88`, `frontend/src/engine/animationEvaluator.ts:214`).
- Clip time is normalized: `u = clamp(((t − startTime) × speed) / clip.duration, 0, 1)`, active through `startTime + duration/speed`; visual-duration floor `MIN_VISUAL_DURATION = 0.25`, `MIN_CLIP_SPEED = 1e-4` (`frontend/src/engine/animationEvaluator.ts:73-83,1623`, `frontend/src/engine/animationManagerModel.ts:384-396`).
- Control tracks are seconds-based `[0, duration]`, value `[0,1]`, hold/linear/bezier only (ADR 0012).
- Video Export steps exact timestamps `t = i/fps`, `N = round(duration × fps)` (`frontend/src/engine/export.ts:52-67`).
- No marker or cue concept exists in the engine or timeline ("cue" is an avoided term in CONTEXT.md).

## Decision

### 1. Segment & cursor

- The script header declares `from` (required; `0 ≤ from < slide.duration`). The cursor starts at `from`; the segment ends at the cursor after the last statement.
- Sequential by default: every timed statement advances the cursor by its own extent. `at(t)` (absolute slide seconds, `from ≤ t ≤ slide.duration`) and `at('marker')` place a statement absolutely and set `cursor = max(cursor, statement end)` — the cursor never rewinds.
- Groups: `sequence` advances by the sum of its children's advances; `parallel` by the latest child end (absolute placements count); an empty group advances 0.
- Bounds: `at(t)` before `from` is a compile error; a statement ending past `slide.duration` is a compile error; underflow simply ends — compiled values hold, nothing is emitted after the last statement, no implicit end pin.

### 2. Operators (advance = extent)

- **tween** (property statement): `duration` + `ease`; start value is the evaluated value at its start (implicit start pin with the tween's ease); advances by `duration`. One duration/ease per statement for all its properties.
- **set**: instant hold keyframe at the cursor; advances 0.
- **play**: advances by visual duration (explicit `duration`, else `clip.duration / speed`); no ease — the clip owns its interpolation.
- **apply** (collection): advances by its placed span; timing only.
- **control write**: advances by duration; ease limited to hold/linear/bezier (ADR 0012); parametric is a compile error.
- **wait(d)**: advances `d`, emits nothing.
- **mark('name')**: labels the cursor time; advances 0; emits nothing.
- **repeat(n) / for x in [a, b, c]**: unrolled at compile time; cursor advances by the unrolled sum; counts/lists are compile-time constants; `repeat(0)` warns; no conditionals or while.
- **stagger(step, targets) { body }**: member `i` starts at `cursor + i×step`; the block advances `(n−1)×step + body extent`; targets is a binding list or group (deterministic scene pre-order); zero members is a compile error.
- `during` is not part of v1; `parallel { wait(d); ... }` expresses concurrent windows.

### 3. Markers

Compile-time source labels only — never persisted and not a timeline marker (the engine has no marker surface). Define-before-use: `mark('name')` labels the cursor at its source position; `at('name')` references it (backfill allowed — a placement may start before the cursor as long as the cursor never rewinds); duplicate labels error; labels inside repeat/for/stagger bodies error (duplicated per iteration); a mark inside a parallel child labels that child's local time; no arithmetic on labels.

`waitUntil` was dropped: with a monotonic cursor and define-before-use, a defined label can never lie ahead of the cursor, and forward references are circular (a placement at a forward label changes the cursor that defines it). The pause-for-explanation pattern is `mark('explain'); wait(2.5s); at('explain') <content>`.

### 4. Durations & ease

Bare number = seconds; `s`/`ms` suffixes accepted. Per-statement `duration:`/`ease:` with a script-wide header `defaults { duration, ease }`; a duration must come from the statement or the header or the compile errors (no silent default). Default ease `easeInOut`. Ease vocabulary is the engine's names: hold, linear, easeIn, easeOut, easeInOut, quadratic, cubic, quartic, quintic, back, bounce, elastic, spring; parametric is rejected on discrete kinds and on control tracks (existing engine rules). Per-property overrides and nested defaults are deferred.

### 5. Conflicts, precision, determinism

- Same-property raw writes overlapping within the script are a compile error; different properties of the same node may overlap freely; a script's own raw writes overlapping its own placed clip/collection/control on the same property in the window is an error (#362), while pre-existing clips/controls already driving a written property warn but do not block; priority is statement order (#362).
- Times and cursor arithmetic round to 1e-6 s at emission; no frame quantization; compile stays a pure function of (source, slide state) — no wall clock, no unseeded randomness (#362); export's `t = i/fps` determinism is inherited untouched.
- Expressions, user-defined variables, and numeric iteration lists are deferred to the reusable-function/typed-params ticket (#366).

### 6. Examples

Example 1 — narration pauses (sequential cursor, markers, backfill):

```
script "Slide 3" from 1.0
defaults { duration: 0.4s, ease: easeInOut }

bind hero   = node("Hero")
bind bubble = node("Speech Bubble")

hero.move({ x: 4, y: 2 })                   // 1.0 → 1.4
bubble.fadeIn()                             // 1.4 → 1.8
mark("explain")                             // label at 1.8
wait(2.5s)                                  // narration pause → 4.3
at("explain") bubble.pulse(0.6s, easeOut)   // backfills 1.8 → 2.4, cursor stays 4.3
hero.move({ x: 8, y: 2 })                   // 4.3 → 4.7
```

Example 2 — parallel + stagger (group broadcast):

```
script "Slide 5" from 0
defaults { duration: 0.3s }

bind title = node("Title")
bind cards = group("card")

parallel {
  title.fadeIn(0.5s, easeOut)
  stagger(0.15s, cards) { card.fadeIn() }   // (n−1)×0.15 + 0.3
}
wait(1s)                                    // cursor = max(0.5, total) + 1
```

Example 3 — clip placement and loops:

```
script "Slide 7" from 2.0

bind robot = node("Robot")
bind wave  = clip("Robot Wave")

repeat(2) {
  robot.play(wave, 1.2s)   // 2.0 → 3.2, then 3.2 → 4.4
  wait(0.3s)               // narration beat → 4.7
}
at(5.0) robot.play(wave, 1.2s)   // absolute placement, 5.0 → 6.2
```

## Alternatives Considered

- **Parallel-by-default with an explicit `sequence` group** — rejected: narration-driven scripts are linear; the common case should be the terse one.
- **Persisted timeline markers** — rejected for v1: no engine marker surface exists; pause visibility can graduate from fog if the demos demand it.
- **`waitUntil` / two-pass forward references** — rejected: circular (a forward placement moves the cursor that defines the label); define-before-use with backfill `at()` covers the pause pattern soundly.
- **Last-wins for overlapping same-property raw writes** — rejected: silently interleaving two statements' keyframes on one track is unpredictable; the overlap is almost always a bug, and sequencing is the fix.
- **Frame quantization of emitted times** — rejected: ties the script to an fps; the export path already samples exact timestamps.
- **Raw double times** — rejected: float artifacts (0.30000000000000004) make the timeline unreadable; 1e-6 s is far below frame resolution.
- **Per-property ease/duration overrides** — deferred: statement-level suffices for the demos; splitting statements covers the rest.

## Consequences

- The spec's time chapter can state "compile-time cursor, seconds, define-before-use markers, 1e-6 s emission, no frame quantization" and point at `export.ts:52-67`, `animationEvaluator.ts:73-83`, ADR 0012 for the constraints.
- The demo draft (#365) is unblocked and can be written in this vocabulary; the library ticket (#366) now owns expressions, variables, and numeric iteration lists.
- Fog: absolute marker beats (`mark('name', t)`) and `waitUntil` remain deferred until a demo demands fixed beats.

## Links

- Map: #360
- This grill: #364
- Lowering: #362; addressing: #363; research: #361 (`docs/research/animation-script-bridge-viability.md` on `research/bridge-viability`)
- Constraints: ADR 0012 (control tracks), `frontend/src/engine/export.ts:52-67`, `frontend/src/engine/animationEvaluator.ts:73-83`, `frontend/src/engine/animationManagerModel.ts:384-396`
- Follow-ups: #365 (demos), #366 (library/typed params — expressions, variables, numeric lists)
