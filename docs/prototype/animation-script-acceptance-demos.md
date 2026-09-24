# Prototype — Acceptance demos in the Animation Script DSL

**Throwaway sketch for wayfinder [#365](https://github.com/MKoth/animated-slideshow-editor/issues/365).** Not production code, not the spec. It exists to be reacted to.

**Question it answers:** is the proposed Animation Script DSL — as locked by [Lowering #362](https://github.com/MKoth/animated-slideshow-editor/issues/362), [Addressing #363](https://github.com/MKoth/animated-slideshow-editor/issues/363), [Time #364](https://github.com/MKoth/animated-slideshow-editor/issues/364) (ADR 0015) — expressive enough to author the four acceptance demos? Where does it demand **engine additions**, and where are the **open language holes**?

**Method:** each demo is written as a script against the locked decisions, annotated with what it lowers to and the cursor arithmetic. Scenes are **pre-authored by hand** (structure stays manual, per the map's standing preference). The DSL surface below is *invented for the sketch* — method names, read syntax, and free-function calls are the things on trial, not settled.

## Notation used in the sketches

| construct | meaning |
|---|---|
| `script "name" from t` / `defaults { duration, ease }` | header, per ADR 0015 |
| `bind a = node("Unique Name")` / `group("sem")` / `table("Unique Name")` / `clip("…")` / `collection("…")` | binding prelude, per #363 |
| `a.tween({ props }, d, ease)` | property tween; start = evaluated value at its start; lowers to raw node keyframes |
| `a.set({ props })` | instant hold keyframe; advances 0 |
| `a.fadeIn(d, ease)` / `fadeOut` / `pulse` | invented gesture sugar (opacity / scale keyframes) — surface undefined |
| `a.tint("#hex", d, ease)` | material-parameter keyframe (`tint`) |
| `a.play(clip, d)` | `AssignClip`, per #362 |
| `wait(d)` / `mark("m")` / `at(t) …` / `at("m") …` | cursor, per ADR 0015 |
| `parallel { }` / `repeat(n) { }` / `for e in [..] { }` / `stagger(step, set) { }` | groups, per ADR 0015 |

---

## Demo A — Hablar conjugation fill

**What you see:** "Hablar" sits above a 6-row table of pronouns with empty form cells. The `-ar` ending drops off and flies away (R-drop), leaving the stem "Habl". Then the six endings (o, as, a, amos, áis, an) fly one at a time out of a source pile into their cells — each a different colour — with a narration pause after each landing.

**Scene prep (manual):** "Hablar" pre-split with the existing *Split into Morphemes* inspector action (`SplitIntoMorphemesCommand`, `frontend/src/engine/commands/splitIntoMorphemesCommand.ts:27`) into `Habl` + `ar`; the `ar` node renamed `ar Ending`. Table `Conjugation` (6 rows, 2 columns); each form cell holds a pre-authored ending text node named `Ending o` … `Ending an`, each authored at its fly-in origin (offset from the cell, opacity 0), each tagged `semanticName: "ending"`. The endings' rest pose is `(0,0)` local inside the cell.

```
script "Hablar conjugation" from 0.5
defaults { duration: 0.5s, ease: easeInOut }

bind stem    = node("Habl")
bind dropped = node("ar Ending")
bind table   = table("Conjugation")
bind e0 = node("Ending o")
bind e1 = node("Ending as")
bind e2 = node("Ending a")
bind e3 = node("Ending amos")
bind e4 = node("Ending áis")
bind e5 = node("Ending an")

stem.tint("#2E6DB4")                                    // set @0.5 — the stem's colour
parallel {                                              // 0.5 → 1.2
  dropped.tween({ x: 6, y: -2.5, rotation: -0.5 }, 0.7s, easeIn)   // the R-drop flight
  dropped.fadeOut(0.7s)                                 // different property — overlap is legal
}
wait(0.6s)                                              // narration beat → 1.8

e0.tint("#D64545")                                      // per-part colours; sets advance 0
e1.tint("#E08A3C")
e2.tint("#3E9B5F")
e3.tint("#2E6DB4")
e4.tint("#8A5BD6")
e5.tint("#C24E8E")                                      // cursor still 1.8

for e in [e0, e1, e2, e3, e4, e5] {                     // unrolled → 6 × (0.4 + 0.8)
  e.tween({ x: 0, y: 0, opacity: 1 }, 0.4s)             // flies home from its authored origin
  wait(0.8s)                                            // explanation pause
}                                                       // cursor 1.8 → 9.0
```

**Lowers to:** one `TransactionCommand` of raw keyframes — `positionX/Y`, `rotation`, `opacity` on `ar Ending` and the six endings; `tint` material-parameter keyframes on the stem and each ending. Boundary pins at `from = 0.5` hold every written track's authored pose until its tween starts. No clips, no controls, no new commands.

**Cursor:** `0.5 → 1.2` (parallel) `→ 1.8` (wait) `→ 9.0` (for). Needs `Slide.duration ≥ 9.0`.

---

## Demo B — Sentence gap-fill

**What you see:** "El gato ___ en la alfombra" with the gap pulsing during the explanation pause. Then "duerme" appears at the side and flies into the gap.

**Scene prep (manual):** `Sentence` container with `El gato`, `Gap`, `en la alfombra` children (pre-split). `duerme` is a child of `Sentence`, authored at the word-bank pose (offset from the gap) with opacity 0, so its rest pose `(0,0)` is the gap.

```
script "Gap fill — El gato ___ en la alfombra" from 0.5
defaults { duration: 0.45s, ease: easeInOut }

bind word = node("duerme")
bind gap  = node("Gap")

wait(0.5s)                                   // beat → 1.0
gap.pulse(0.6s)                              // attention on the gap → 1.6
wait(2.5s)                                   // narration pause → 4.1
word.fadeIn(0.3s)                            // appears at the bank → 4.4
wait(0.4s)                                   // → 4.8
word.tween({ x: 0, y: 0 }, 0.8s)             // flies into the gap → 5.6
```

**Lowers to:** opacity keyframes on `Gap` (pulse = scale keyframes), opacity + `positionX/Y` keyframes on `duerme`. Boundary pin at 0.5 keeps the word hidden until its fade-in. No text-content keyframes anywhere — the sentence was pre-split and the word is a node, per the settled "no timed text" rule (#362/#363).

**Cursor:** `0.5 → 1.6 → 4.1 → 4.4 → 4.8 → 5.6`.

---

## Demo C — Images appear / disappear / group / stack

**What you see:** three cards fade in one after another, drift together into a pile with different rotations, stack in z-order, then disappear together — leaving the top card.

**Scene prep (manual):** `Card 1..3` image (asset-instance) nodes, tagged `semanticName: "card"`.

```
script "Card pile" from 0
defaults { duration: 0.4s, ease: easeOut }

bind cards = group("card")
bind c1 = node("Card 1")
bind c2 = node("Card 2")
bind c3 = node("Card 3")

cards.set({ opacity: 0 })                          // broadcast set @0, per-member pin
stagger(0.2s, cards) { c.fadeIn() }                // appear one by one → 0.8
wait(0.6s)                                         // → 1.4

c1.tween({ x: 0, y: 0, rotation: -0.10 })          // gather → 1.8
c2.tween({ x: 0.4, y: 0.2, rotation: 0.06 })       // → 2.2
c3.tween({ x: -0.3, y: -0.15, rotation: 0.02 })    // → 2.6
c1.set({ zIndex: 1 })                              // integer hold sets — stacking
c2.set({ zIndex: 2 })
c3.set({ zIndex: 3 })
wait(0.5s)                                         // → 3.1

cards.fadeOut()                                    // disappear together → 3.5
c3.fadeIn(0.3s)                                    // top card stays → 3.8
```

**Lowers to:** `opacity` / `positionX/Y` / `rotation` keyframes on the three asset instances, `zIndex` hold keyframes (integer, hold-only — `frontend/src/engine/animationEvaluator.ts:251-345`). Group statements broadcast with a per-member boundary pin in scene pre-order (#363). Appear/disappear are opacity, never `visible` (`evaluateVisible` ignores keyframes by design, `animationEvaluator.ts:242-249`).

**Cursor:** `0 → 0.8 → 1.4 → 2.6 → 3.1 → 3.8`.

---

## Demo D — Arrow image points at a target

**What you see:** an arrow image flies from its start locator to its end locator over 1.2 s, staying pointed at a butterfly that drifts the other way. Earlier, at t = 2.0, it snaps to face the butterfly.

**Scene prep (manual):** `Arrow` image node with its **local pivot pre-set at the tail** (static in v1, `CONTEXT.md` → Local Pivot); `Arrow Start` / `Arrow End` locator nodes; `Butterfly` image node.

```
script "Arrow points at the butterfly" from 0.5
defaults { duration: 0.4s, ease: easeInOut }

bind arrow     = node("Arrow")
bind butterfly = node("Butterfly")
bind from      = node("Arrow Start")
bind to        = node("Arrow End")

arrow.set({ x: from.x, y: from.y })                 // read a locator's position into a set
pointArrowAt(arrow, butterfly, at: 2.0)             // one rotation keyframe: face the target now
arrow.tween({ x: to.x, y: to.y }, 1.2s)             // fly start → end
parallel {                                          // tracking flight: rotation re-sampled
  pointArrowAt(arrow, butterfly, over: 1.2s, every: 0.05s)
  arrow.tween({ scaleX: 1.1, scaleY: 1.1 }, 1.2s)
}
```

**Lowers to:** `positionX/Y` keyframes on the arrow; `rotation` keyframes computed at compile time from the target's evaluated world position and **baked** (tracking is compile-time sampled, no live constraint — #363). `from.x` / `to.x` are compile-time reads (evaluated transform / world bounds at t), not runtime expressions.

**Cursor:** `0.5 → 0.5` (sets) `→ 2.0 → …`; the `parallel` block advances to the latest child end.

---

## Coverage — what the demos exercised

| beat | construct | lowers to | status |
|---|---|---|---|
| fly a node home from an authored offset | `tween({x,y,opacity})` | raw keyframes | existing |
| drop / fade a morpheme | `tween` + `fadeOut` | raw keyframes | existing |
| per-part colours | `tint` sets | material-param keyframes | existing |
| gradual fill with pauses | `for` / `wait` | unrolled keyframes | existing |
| attention pulse | `pulse` | scale keyframes | **sugar undefined** |
| appear / disappear | opacity, never `visible` | raw keyframes | existing |
| group broadcast | `group("card")` | per-member keyframes | existing |
| stacking | `zIndex` set | hold keyframes | existing |
| clip playback | `play` | `AssignClip` | existing |
| table targeting | `table(...)` / `cellRect` | compile-time read | existing |
| arrow rotation math | `pointArrowAt` | baked rotation keyframes | **DSL hole** |
| sampled tracking | `pointArrowAt(over:, every:)` | baked keyframes | **DSL hole** |

**Engine verdict: the four demos are expressible over existing primitives** — no new command, lane, or evaluator feature is demanded. The pressure lands on the *language surface*, not the engine.

## Engine gaps and caveats

1. **None blocking.** Every beat lowers through the #362 command set; every read through the #363 capability matrix.
2. **`SplitIntoMorphemesCommand` spacing is approximate** — `segment.length × fontSize × 0.6` (`splitIntoMorphemesCommand.ts:6,95`). Split children are named `Segment 1…n` inside a `"<content> Morphemes"` container; the demo renames them by hand. Renderer-measured text metrics are not used at split time (the #363 text-metrics caveat). Hand-nudging fixes it in the demos; worth noting for the spec.
3. **No text merge** — not needed by these demos; future work if a demo needs re-joining morphemes.
4. **World→local projection absent** — Demo B works because `duerme` is parented to the sentence container and its fly-in origin is a local offset. Flying a node that is parented *elsewhere* to a world-space target (e.g. a word genuinely living in a separate word-bank subtree) needs a world→local conversion the DSL does not have. **Demo-shaped, not demo-blocking.**
5. **No timed text** — confirmed: pre-split nodes + opacity is the v1 way (#362/#363). Demos comply.

## Open DSL holes (spec input)

1. **Method vocabulary.** `tween` / `set` / `move` / `fadeIn` / `fadeOut` / `tint` / `pulse` are invented here. Which are language built-ins, which are library entries (#366), and what is the property-name surface (`x`/`y` vs `positionX`/`positionY`)?
2. **Read syntax.** `from.x`, `to.x`, `target.at(t)`, `cellRect(t, r, c)` as statement values have no syntax. The capability matrix grants the reads; the language has no expression form for them (expressions are deferred to #366 — but Demo D needs them *now*, or a built-in).
3. **`pointArrowAt` math.** Needs `atan2` + a world→local rotation conversion (engine rotation is radians, `transform.ts:54-65`). A library function can encapsulate it only if function bodies may do arithmetic — or it is a built-in.
4. **Tracking sample rate.** `over:` / `every:` are invented; the spec must state the default sampling and the bake size (how many keyframes a 1.2 s track emits).
5. **`for` over aliases.** `for e in [e0, …, e5]` — are aliases legal list elements? (`for` is specified over compile-time constants; `stagger` explicitly takes a binding list or group.)
6. **Per-part data.** Demo A hand-writes six colour sets because a group broadcast applies one value to all members, and `for` cannot zip parallel lists (endings × colours × origins). Typed params / data rows are #366's; the demo shows the pressure.
7. **Structure in the script.** Splitting "Hablar" is manual. A script-driven `split` inside the run Transaction would break replace-by-footprint idempotence (re-running would split again; the original node is gone). v1 keeps structure manual — worth stating in the spec.
8. **Group member addressing.** A group is broadcast-only (#363); per-member values need individual aliases. Is there a deterministic member-index form (`endings[i]`)?
9. **Absolute beats.** The demos' pauses are `wait()`s; no demo needed `mark("m", t)`. Fog can stay fog.
10. **`table(...)` binding syntax** — `bind t = table("Unique Name")` is assumed from #363's "a table binding gains structural selectors"; the prelude grammar should pin it.

## Reactions wanted

- Does the scene model per demo match the intended lesson animation? (Especially A: is the R-drop "drop the `-ar`", and do endings land in *empty* cells or next to a per-row stem?)
- Are holes 1–4 (method vocabulary, read syntax, arrow math, sampling) spec work, or should some move to the library ticket #366?
- Is hole 6 (per-part data) acceptable as hand-written statements for v1, with typed params coming from #366?
- Any beat that reads as "the language contorts here" — that's the signal this sketch exists to catch.

## Verdict (HITL reaction, 2026-09-24)

- **Demo A scene model confirmed:** endings land in empty form cells; the stem is shown once above the table. R-drop = drop the `-ar`.
- **No beat reads as a contortion** — the four sketches are accepted as the expressiveness proof.
- **Hole ownership:** the **spec owns the language surface** (method vocabulary, read syntax, `table(...)` grammar, `for` over aliases, member addressing, sample-rate default); **#366 owns expressions and the `pointArrowAt` body math**.
- **Per-part data:** hand-written per-node statements are acceptable for v1; typed params / data rows arrive from #366.
- **Negative findings:** no fixed beats (`mark('m', t)`) were needed; no engine addition is demanded. World→local projection stays a recorded v1 boundary, not a blocker.
