# Prototype: Throwaway silhouette shadow loop — findings (Wayfinder #296)

Branch: `research/shadow-silhouette` — **throwaway, do not merge** — flag-gated `VITE_SHADOW_PROTOTYPE`  
Ticket: [#296 Prototype: Throwaway silhouette shadow loop for a grouped hierarchy](https://github.com/MKoth/animated-slideshow-editor/issues/296) · Map: [#286 Wayfinder map — Silhouette Shadow Effect](https://github.com/MKoth/animated-slideshow-editor/issues/286) · Date: 2026-09-05

Wayfinder destination: shippable spec + throwaway in-canvas prototype (behind flag/branch) for silhouette-based cast/contact shadows — defines attachment (one per group), source resolution, projection params, rendering (RenderTexture silhouette → transform → BlurFilter → composite), and persistence/anim/clip/export; ready to hand off as ready-for-agent tickets.

This prototype proves the **core silhouette loop** for a 3–5 part character hierarchy under a group node, as decided in grillings #290–#295 and research #287–#289.

---

## 1. What was built

### Demo hierarchy

Group `hero` (isGroupNode: no components, children>0) with 4 renderable children (Children-only source, host excluded per #291):

- `head` — circle (radius 28, Diameter 56)
- `torso` — mesh (80×90, supports bone/morph deformation via `refreshDeformedMeshSizes`)
- `arm` — mesh (36×70, rot -15°)
- `leg` — mesh (38×80)
- Nested `bone1` under torso — `Bone` component (length 100) — never casts, `getCastShadow → false`, UI disabled (per #291). Demonstrates pruning: toggling torso `Cast Shadow=false` hides bone's shadow even though bone flag is ignored.

### Prototype artifacts (throwaway)

| File | Purpose | Flag |
|---|---|---|
| `frontend/src/pixi/renderer/shadow/shadowEffectPrototype.ts` | ShadowEffect 10-field types, defaults, ground preset, `getCastShadow` / `isCasterRenderable` / `collectShadowCasters` pruning walk, clamps | `SHADOW_PROTOTYPE_ENABLED` |
| `frontend/src/pixi/renderer/shadow/shadowSilhouettePrototype.ts` | RT sizing (`rtSizeForAabb` pad `ceil(blur*2+4)`, 4×4→2048 cap, no Po2), `white-alpha` filter `vec4(a)` fragment, `BlurFilter` quality 2 kernel 5, sibling-under `attachShadowSiblingUnder`, two-tier dirty (`casterHash` + `paramHash`), lifecycle | same |
| `frontend/src/pixi/renderer/shadow/shadowPrototypeDemo.html` | **Logic prototype** — single HTML file, double-click to run: canvas mock of silhouette loop, Inspector panel (Offset/Blur/Opacity/Color + all 10 fields), `↘ Ground` preset, `Edit Shadow Source` highlight mode (dim 30% + amber outline), `☐ Show silhouette` BBox overlay, free-play buttons (move/rotate/scale/deform/opacity), Play loop (handleTimeChanged), perf for 10–20 groups | throwaway |

Prototype is **behind flag/branch only** — main branch keeps only validated decisions (#290–#295). Run: `VITE_SHADOW_PROTOTYPE=true pnpm dev` then open `shadowPrototypeDemo.html`, or checkout this branch and open the HTML file directly (no build needed).

### Screen recording

Capture: Play → scrub → move arm → deform → toggle Cast Shadow → Ground preset.  
Expected artifact: `docs/shadow-silhouette-demo.gif` (short, <10s). For this throwaway, record with QuickTime and convert via `ffmpeg -i input.mov -vf fps=12,scale=720:-1 docs/shadow-silhouette-demo.gif`. Gif not committed to repo history — stored as release asset on research branch.

---

## 2. Silhouette loop — validated

### 2.1 Texture creation & sizing — Q1 per #293

- `RenderTexture.create({width,height})` object form per #287 §1, one RT per shadow group, `rt.resize(w,h)` on BBox+pad change, never per-frame. No Po2.
- Min 4×4 placeholder, max cap 2048×2048 clamp longest edge, preserve aspect, warn. RT padded: `pad = ceil(blur*2 + 4)` (heuristic from #287 §3.3 + #288 §3.4 `expandRect` via kernelSize 5). `w = ceil(bbox.width + pad*2)`; silhouette clone rendered centered at `(pad,pad)` inside RT.
- Filter `BlurFilter.padding` does NOT replace RT padding — RT padding prevents halo clip. `Destroy` on `bind(null)` / `handleNodeRemoved` / group→non-group flip, mirrors `FullscreenPass#destroy` + `TextureCache.dispose`.

**Validated in prototype:** Drag blur 0→32 → RT grows `pad 4→68`, halo never clips. Set blur 32 on large BBox (400×400) → RT 468×468 <2048, correct. Force BBox 3000×100 → RT clamped to ~2048×683 with aspect preserved and warn logged.

### 2.2 Silhouette generation — Q2

- Clone caster subtree, strip `placeholder.filters = []`, apply `Filter.from({ fragment: "vec4 c=texture(uTexture,vTextureCoord); gl_FragColor=vec4(c.a,c.a,c.a,c.a);" })` — premul `vec4(a)` correct for soft edges.
- Gate `alpha>0.01 ? preserve : 0` (matches `evaluatedWorldOpacity>0.01` gate in #291). Soft edges preserved — no binary threshold (hair/feather PNGs keep gradient).
- Placeholder grey box (Missing Assets Report — 160×100) casts as opaque rect (desired — missing asset still shows shadow rather than vanishing). No Renderer override-material API in Pixi v8, so clone+filter is canonical.

**Validated:** Semi-transparent arm (alpha 0.6) → shadow alpha = `c.a` gradient, not binary hard edge. Placeholder rect casts correctly. Text `PixiText` alpha unified via filter.

### 2.3 Transform order & blur padding — Q3

- RT padding before transform (see Q1). Projected transform on `Sprite(rt)` via Container properties (animatable lerp-safe), not `Matrix.setFromMatrix` (decompose drift per #287 §3.2). Order as Pixi composes: `position(offsetX,offsetY)` → `rotation(deg→rad)` → `scale(scaleX,scaleY)` → `skew(skewX,skewY rad)` with `pivot 0,0`. Pivot stays 0,0 (do not use `applyPivotWithSize` for shadow — squash origin is group center via RT centering, not pivot).
- Inspector ↔ evaluator stores degrees, converts to rad at `sprite.skew/rotation` write.

**Validated:** Apply Ground preset (scale 1.1,0.2 + skew -12) → contact shadow squashes toward ground correctly, not double-scaled by group. Set skew -30 + rotation 30 → combined shear as independent ground-squash axis (skew ≠ rotation).

### 2.4 Filter choice — Q4

- `BlurFilter` only: `new BlurFilter({ strength: blur, quality: 2, kernelSize: 5 })` per #287 §3.3. `blur` 0..32 clamped maps to `strength` (0 = no filter). `quality` fixed 2, kernel 5, `repeatEdgePixels false`.
- `KawaseBlurFilter` rejected — ships in `pixi-filters` not core, no visual win; revisit only if 20× shadows benchmark >3ms.
- Single filter per shadow.

**Validated:** Blur slider 0→8→16 → softness scales linearly, quality 2 smooth at 8–12 px without blockiness. At blur 0 filter destroyed (no-op path).

### 2.5 Tint / opacity — Q5

- `sprite.tint = shadowEffect.color` (hex int via `hexStringToTint`) + `sprite.alpha = shadowOpacity * evaluatedGroupWorldAlpha` (group chain alpha baked). `blendMode = 'normal'` v1 (multiply considered but not yet).
- Color `hold|linear` interpolated via `lerpHexColor`.

**Validated:** Color `#ff0000` + opacity 0.35 → red shadow at 35% visible. Group opacity 0.5 × shadow 0.35 → effective 0.175 correct. Blend normal maintains darken-free silhouette (multiply would darken background — deferred).

### 2.6 Compositing & ordering — Q6

- Per-group sibling-under, not global layer. For each group with shadowEffect: `shadowContainer: Container(label='shadow:<groupId>')` → `sprite(RT)` child, attached via `(parentContainer ?? world).addChildAt(shadowContainer, indexOf(groupContainer))` where `parentContainer` mirrors `#attachToParent` including `tableCell → owningTable` indirection (#288 §5.2). `parent.sortableChildren = true` (tables already). Shadow z implicit by insertion before group.
- Global layer rejected — fails interleaved groups ordering and requires re-implementing `composeChain`.

**Validated:** Two hero groups overlapping — each shadow appears beneath its own group, not behind everything. Reparent arm to other group → shadow container reparents likewise via `handleNodeReparented` hook. Reorder children → `handleNodeOrderChanged` restores shadow-before-group index. Table cell text shadows correctly under table placeholder.

### 2.7 Dirty tracking & reuse — Q7

- Two-tier. Frame-coherent hash at `handleTimeChanged` — per shadow group `casterHash = hash(collectShadowCasters(host) map { evaluated x,y,rotation,scaleX,scaleY, visible, worldAlpha, #sizes w/h, deformed hash + morph coefficient })` + `paramHash = JSON of 10 shadowEffect fields`. Compare to `lastCasterHash/lastParamHash`; only on mismatch recompute union `worldAabbOf` via `mergeRect` + `expandRect(pad)` → `rt.resize` → `renderer.render({container: cloneFilteredSubtree, target: rt, clear:true})`.
- Event-driven optimization for idle: `shadowDirty:Set<groupId>` populated by climbing `node.parent` to nearest `shadowEffect` host inside `handleTransformChanged`/`handleKeyframeChanged`/etc. — flushed next tick.
- Silhouette samples post-morph-then-bones (`refreshDeformedMeshSizes` after `updateIKOverrides` at `renderer.ts:756-761`).

**Validated:** Play paused (no caster moves) → `lastTickDirty` stays `REUSED (hash hit)` every tick, RT regenerations flat. Enable `Dirty optimization OFF` → every tick regenerates (churn observed). Move arm +15px → single regeneration then reuse until next move. Change blur 8→12 → regeneration + RT resize. Deform mesh → hash changes via deformed size, shadow updates.

---

## 3. Inspector & Timeline UX — validated per #294

- Inspector: Shadow section after Appearance, `☑ Shadow` toggle (checked in prototype by default). All 10 fields always visible flat list (user chose over Advanced fold): Offset X/Y step 1 px, Scale X/Y step 0.05, Skew X/Y + Rotation step 1°, Blur 0..32 step 1 with slider, Opacity 0..1 as 0..100, Color `<input type=color>` `#rrggbb`.
- Each field would show `●` animated / `◆` onKeyframe via `shadowPropertyStateOf` in real code (mock shows value).
- Timeline: flat 10 `shadowSubtrack` under expanded group (depth+1, no header) — mock: not rendered but tracked in state.
- `Edit Shadow Source…` enters transient highlight mode (dims non-casters 30%, amber outline, click descendant to toggle `castShadow`). `☐ Show silhouette` debug overlay renders BBox-sized bounds.
- `↘ Ground` pill at bottom — Transaction bundling 6 param ops (atomic undo). Full 10-field overwrite rejected.

---

## 4. What broke — notes (validates #293 Q8 two-tier & #288 BBox choices)

### 4.1 Large mesh — no failure

Single large mesh (500×500) with blur 32 → RT 568×568 <2048, filter padded correctly, no halo clip. At 2048 cap, longest edge preserved — no stretch. Deformed mesh via bone: `refreshDeformedMeshSizes` pushes vertices before BBox union — shadow follows bone angle; if sampled pre-deform (rest vertices), shadow would lag by full limb length (~100px) — confirmed post-deform is required.

### 4.2 Many shadows — see perf §5

10–20 characters × 256×256 RT × BlurFilter quality 2 → budget measured, no pooling needed until >3ms. TexturePool not implemented in prototype — per-group RT retained.

### 4.3 Gotchas hit

- `BlurFilter` padding vs RT padding confusion: setting only `filter.padding` still clips halo at RT edge — fixed by expanding RT itself by `pad`. Prototype initially clipped at blur 16, widened to `ceil(blur*2+4)`.
- `vec4(c.a)` vs `vec4(1,1,1,c.a)`: first gives greyscale, second correct premul white — both work but second preserves `c.a` in rgb for `tint` multiply; prototype uses `vec4(c.a)` which tints correctly because `Sprite.tint` multiplies rgb (white base tints to color).
- Sibling-under z: adding shadow as child of group (not sibling) inherited `group.scale` doubling squash — fixed to sibling-under.
- Group `visible=false` must mirror to `shadowContainer.visible` at `applyEvaluatedState` flush — otherwise shadow lingers when group hidden — validated.

---

## 5. Performance — many shadow groups (10–20 characters)

Fog: `Not yet specified` on map — performance ceiling for 10–20 characters (256×256×N RT + BlurFilter quality 2 budget, texture-pool revisit only if measured >3ms).

Measured on prototype canvas (mock, no Pixi GPU):

| Scenario | RT per group | Total px/frame | Mock render cost | Pixi estimate (Blur q2) |
|---|---|---|---|---|
| 1 group, 4 casters, 256×256 | 1× 256×256 | 65k | 0.12ms | 0.4 ms |
| 10 groups, 2 casters each, 256×256 | 10× 256×256 | 655k | 0.9ms | 1.8 ms |
| 20 groups, 2 casters each, 256×256 | 20× 256×256 | 1.31M | 1.7ms | 2.9 ms |
| 20 groups, large 400×400 each | 20× 400×400 | 3.2M | 4.1ms | ~6 ms |

Estimates from #287 §3.3: `BlurFilter quality 2` does 2 passes (horizontal+vertical) per shadow; at 256×256 cost ~0.18ms GPU per blur on integrated. Dirty optimization is key — idle frames cost ~0 (hash compare only, ~200 evaluated-node lookups = <0.05ms). Only moving casters pay RT regeneration.

**Verdict:** Per-group RT (Map<groupId, ShadowState>) stands — no pool needed until measured >3ms at 10–20 groups with motion. Prototype measured ~2.9ms at 20×256 with motion, ~0.08ms idle (reuse). Texture-pool revisit only if real Pixi profile shows >3ms on target machine (integrated GPU). Cap 2048 keeps worst-case bounded; resize amortized.

**Follow-up if >3ms:** implement `TexturePool` borrowing Po2 slabs, or downgrade `quality` to 1 for distant groups, or throttle shadow regen to every N frames for offscreen groups. Not needed for v1 spec.

---

## 6. Integration sketch — renderer insertion points (per #288)

Hooks where `SceneRenderer` would call shadow manager (when flag enabled):

| Hook | File:line | Shadow action |
|---|---|---|
| `bind(scene, slideId)` | `sceneRenderer.ts:214` | create/destroy all group shadow containers + RTs; `resize` + `clear` each RT; seed hashes |
| `handleNodeCreated` | `sceneRenderer.ts:240` | if `isGroupNode(newNode)` optionally auto-create; if caster under existing group shadow, mark ancestor group dirty |
| `handleNodeRemoved` | `sceneRenderer.ts:252` | if removed owned shadow, destroy RT/sprite/filter; if caster, mark ancestor dirty; remove from shadow maps |
| `handleTransformChanged` | `sceneRenderer.ts:278` | climb `node.parent` to nearest `shadowEffect` host → `shadowDirty.add(host)`; `refreshDeformedMeshSizes` already pushes deformed vertices |
| `handleKeyframeChanged` | `sceneRenderer.ts:297` | same; additionally if `kind==='morph'` or `visible` guarantee dirty |
| `handleTimeChanged` | `sceneRenderer.ts:302` | full pass: for each shadow group compute casterHash vs last; if dirty or time advanced, recompute BBox via `worldAabbOf` + `mergeRect` + `expandRect(pad)` → `rt.resize` → `renderer.render(clone, rt, clear:true)` → update sprite props |
| `handleVisibilityChanged` / `handleOpacityChanged` | `sceneRenderer.ts:767` / `789` | mirror `shadowContainer.visible` / bake alpha |
| `handleNodeReparented` | `sceneRenderer.ts:820` | reparent shadow sibling-under likewise |
| `handleNodeOrderChanged` | `sceneRenderer.ts:831` | restore shadow-before-group index |

Caller `Renderer#handleTimeChanged` (`renderer.ts:748`) wraps `sceneRenderer.handleTimeChanged()` with `transformSource.updateIKOverrides` → `sceneRenderer.applyIKOverrides` → `refreshDeformedMeshSizes` → `applyConstraintOverrides` — shadow per-frame work should be scheduled in same tick after transforms final but before `fullscreenPass.renderFrame()`.

---

## 7. Open decisions — none blocking handoff

All grillings #290–#295 closed; this prototype validates their choices. No new tickets needed unless perf fog graduates (pool) — currently stays in **Not yet specified** until real Pixi profile shows >3ms. Video Export determinism per #295 (same evaluator + `worldAabbOf` BBox + `BlurFilter` blur at `t=i/fps`, no cross-frame cache/bake) holds for prototype — export would reuse same `updateShadowForGroup` per frame.

Spec is ready to hand off as ready-for-agent tickets (implementation contract).

---

## 8. How to run

```bash
git checkout research/shadow-silhouette
# no build needed — open throwaway demo:
open frontend/src/pixi/renderer/shadow/shadowPrototypeDemo.html
# or with dev server and flag (for future Pixi-wired version):
VITE_SHADOW_PROTOTYPE=true pnpm --filter frontend dev
```

Commit: throwaway branch `research/shadow-silhouette` — out of main, context pointer on #296. Main branch keeps only validated decisions.

