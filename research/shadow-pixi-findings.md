# Research: PixiJS v8 RenderTexture silhouette + blur + tint + skew pipeline

Ticket: #287 · Map: #286 · Branch: `research/shadow-pixi-v8` · Pixi: `8.19.x` (`frontend/package.json:20`) · Date: 2026-09-05

Wayfinder destination (map #286): one shadow effect per group node, silhouette from subtree-combined alpha -> offscreen `RenderTexture` -> transform (offset/scale/skew/rotation) -> `BlurFilter` -> tint/darken -> composite beneath source. All params animatable (offsetX/Y, scaleX/Y, skewX/Y, rotation, blur, opacity, color). This note answers: what is the **exact v8.19 API** that would work inside `frontend/src/pixi/renderer/sceneRenderer.ts`, with imports, minimal code sketch, and gotchas.

---

## 1. RenderTexture — creation, sizing, lifecycle

**Import/canon:**

```ts
import { RenderTexture, Sprite, Container, BlurFilter, Matrix } from 'pixi.js';
```

`Texture.from`, `RenderTexture.create`, `Sprite`, `Container`, `BlurFilter`, `Matrix` are all re-exported from the single entry `'pixi.js'` in v8 (no `@pixi/core` deep imports).

**`RenderTexture.create` (v8, this repo's shim already wraps it):**

```ts
// pixijs.download/release/docs/rendering.RenderTexture.html#create
const rt = RenderTexture.create({
  width: 256,
  height: 256,
  // optional:
  // resolution: window.devicePixelRatio,
  // antialias: false,
});
```

Signature: `static create(options: RenderTextureOptions): RenderTexture` where `RenderTextureOptions = { width, height, resolution?, antialias? }`. The docs mark the old positional `create(width, height, scaleMode, resolution)` deprecated since 6.0.0; object form is current. Source: https://pixijs.download/release/docs/rendering.RenderTexture.html, https://pixijs.com/8.x/guides/components/renderers

This repo wraps it identically in `frontend/src/pixi/renderer/pixi.ts:48-70`:

```ts
// frontend/src/pixi/renderer/pixi.ts:47-70
readonly RenderTexture: { create: (options: PixiRenderTextureOptions) => PixiRenderTexture }
RenderTexture: { create: (options) => RenderTexture.create(options) }
```

**Resize (BBox + blur padding changes every frame):**

```ts
rt.resize(newWidth, newHeight); // also accepts third arg `resolution` in v8
```

`resize(width, height, resolution?)` mutates the underlying `TextureSource`. Pooled filter textures are a separate path; `RenderTexture.resize` is explicit resize (see `rendering.RenderTexture.html#resize`).

**Destroy:**

```ts
rt.destroy();          // destroys texture only
rt.destroy(true);     // also destroys source — not wanted if texture is shared
sprite.destroy();     // destroys sprite; sprite.texture is NOT destroyed unless destroy(true)
filter.destroy();     // BlurFilter extends Filter extends Shader — destroys GPU resources
```

Lifecycle rule: cache one `RenderTexture` per shadow group, call `resize()` when BBox+padding changes, `destroy()` on group removal or `sceneRenderer.bind(null)` (mirrors `FullscreenPass#destroy` at `frontend/src/pixi/renderer/fullscreenPass.ts:140-146`). Do NOT create a new RT every frame — GPU alloc is on first render and is pooled internally; churn causes GC stalls. See Pixi note: "Don't create renderTextures each frame just to delete them; reuse them" (legacy doc preserved in v8 perf guide https://pixijs.com/8.x/guides/concepts/performance-tips and noted in `RenderTexture` docs).

**Resolution:** `RenderTexture.create` takes `resolution`; the renderer has `renderer.resolution` (devicePixelRatio). For crisp shadows at HiDPI, pass `resolution: renderer.resolution` or `window.devicePixelRatio`. Mismatch causes 0.5px blur on retina. If RT is BBox-sized in world units, divide by camera zoom; else render at fixed canvas resolution and let `world.transform` handle zoom (simpler; matches `FullscreenPass` which uses `width:1,height:1` then `resize(w,h)` to screen size).

---

## 2. Rendering a Container subtree into a RenderTexture

### 2.1 Canonical v8 API (what FullscreenPass already uses)

Pixi v8 `WebGLRenderer`/`AbstractRenderer` exposes:

```ts
renderer.render(options: RenderOptions): void
// RenderOptions = { container: Container, target?: Texture|RenderTexture|RenderSurface, clear?, clearColor?, transform?, flipY?, ... }

renderer.generateTexture(options: Container | GenerateTextureOptions): Texture
```

Docs: https://pixijs.download/release/docs/rendering.WebGLRenderer.html#render, https://pixijs.com/8.x/guides/components/renderers ("Rendering a Scene", "Generating Textures"). `generateTexture(container)` is convenience that allocates a new `Texture` internally and copies — not suitable for per-frame reuse (allocates). For a reusable RT, use `render({ container, target: rt })`.

This repo's `Renderer` already uses this shape (`frontend/src/pixi/renderer/renderer.ts:190-191` and `fullscreenPass.ts:121`):

```ts
// frontend/src/pixi/renderer/renderer.ts:185-193
this.#fullscreenPass = new FullscreenPass(
  this.#pixi, this.#programCache, app.stage, world,
  (options) => { app.renderer.render(options); }, // <- RenderSceneToTexture
  ...
);
// frontend/src/pixi/renderer/fullscreenPass.ts:19-23
export type RenderSceneToTexture = (options: { container: PixiContainer; target: PixiRenderTexture }) => void
// frontend/src/pixi/renderer/fullscreenPass.ts:115-123
renderFrame() { this.#scene.visible = true; this.#renderScene(options); this.#scene.visible = false; }
```

So the shadow pass should reuse exactly this `app.renderer.render({ container, target })` callback; no new renderer creation.

**Clear semantics:** `render({ container, target, clear: true })` clears the target before drawing (default `clear: true`). For silhouette you want `clear: true` and optionally `clearColor: [0,0,0,0]` (transparent) so stale shadow does not persist. If `clearColor` omitted, the renderer's `background.color` is used — in this app that's canvasBackground white (`renderer.ts:640`), which would produce white bleed if not overridden. Explicit `clearColor: 0x00000000` or `[0,0,0,0]` is required.

**Transform param:** `render({ ..., transform: Matrix })` lets you apply an extra world transform. For silhouette, simpler to bake the world offset into the container's `position`/`scale`/`skew` and pass identity; but if rendering a cloned subtree at origin, use `transform: new Matrix().translate(-bbox.x, -bbox.y)` to center it in the RT.

### 2.2 Silhouette via "white material" — what works in Pixi v8

Classic silhouette trick: render subtree with a solid-white/alpha-only material into the RT, then sample its alpha for tint+blur. In Pixi v8 there is no per-object "override material" API (unlike Three.js). Two viable approaches:

**A. Clone + tint hack (recommended for prototype):**

```ts
const clone = sourceContainer.clone(true); // deep clone or manual clone of Pixi tree
clone.tint = 0xffffff;
clone.alpha = 1;
// Walk clone: set every Sprite.tint=0xffffff, Graphics fill=0xffffff, Mesh texture tint white
renderer.render({ container: clone, target: rt, clear: true, clearColor: 0x00000000 });
```

This repo's tint path (`placeholder.ts:79-84`, `nodeRenderer.ts:152-163`, `textRenderer.ts`) multiplies `tint` over texture. A white tint is identity (no change), so to get pure white silhouette you must replace texture with white or use `ColorMatrixFilter` / `Filter.from()` that outputs `vec4(1.0, 1.0, 1.0, alpha)` in the fragment. Simpler: attach a temporary `ColorMatrixFilter` or custom `Filter` to the clone that flattens RGB to white but preserves alpha:

```ts
// Fragment that keeps alpha, sets rgb=1
const whiteAlphaFilter = Filter.from({
  glProgram: GlProgram.from({
    vertex: Filter.defaultVertexSrc, // or omitted — v8 Filter.from handles defaults
    fragment: `in vec2 vTextureCoord; uniform sampler2D uTexture; void main(){ vec4 c = texture(uTexture, vTextureCoord); gl_FragColor = vec4(1.0, 1.0, 1.0, c.a); }`,
  }),
  resources: {},
});
clone.filters = [whiteAlphaFilter];
renderer.render({ container: clone, target: rt, clear: true });
clone.filters = null;
whiteAlphaFilter.destroy();
```

This preserves alpha (premultiplied-safe, see §6) and works for Sprite/Mesh/Graphics/Text uniformly. Text nodes are `Text` objects; Graphics are vector — all are affected by filter post-processing, so alpha is unified.

**B. Cache-as-texture + custom shader (production):**

`container.cacheAsTexture(true)` exists in v8 (`scene.Container.html#cacheastexture`) but it creates its own internal RT and does not give you a handle for silhouette reuse, plus it re-renders when `updateCacheTexture()` is called. Not recommended for shadow; use explicit RT.

> Note: Do NOT use `renderer.generateTexture(container)` per frame as silhouette source — it allocates a new Texture each call (caller must `destroy()`); use `render({ target: rt })` for reuse.

---

## 3. Sprite(tint, alpha, transform, filters) -> BlurFilter

### 3.1 Sprite creation & tint/alpha

```ts
import { Sprite } from 'pixi.js';

const shadowSprite = new Sprite(rt); // or new Sprite({ texture: rt }) in v8 alias
shadowSprite.anchor.set(0, 0); // or (0.5,0.5) if you want center pivot
shadowSprite.tint = 0x000000;          // ColorSource: number | string | Color. 0x000000 = black shadow
shadowSprite.alpha = 0.45;             // opacity*shadowOpacity
shadowSprite.blendMode = 'normal';     // or 'multiply' for darken blend

// Add to a layer beneath source:
shadowContainer.addChild(shadowSprite); // shadowContainer.zIndex < source, with sortableChildren=true
```

Docs: `scene.Sprite.html`, `scene.ViewContainer.html#tint`, `pixijs.com/8.x/guides/components/color`, `pixijs.com/8.x/guides/components/scene-objects#tinting`. `tint` is `ColorSource` (hex int, hex string, `Color` instance); `0xffffff` disables tint. `tint` multiplies RGB, preserves alpha. `alpha` multiplies opacity (0..1), cascades through parent `Container.alpha`. For shadow you set `sprite.tint = shadowColor` (e.g. `0x000000`) and `sprite.alpha = shadowOpacity * globalAlpha`.

Related repo usage: `applyMaterialTint` uses `hexColorToTint` -> `sprite.tint = hex` (`placeholder.ts:79-84`, `nodeRenderer.ts:152-163`). Silhouette `Sprite.tint` would be the shadow color, not node material tint.

### 3.2 Transform: position / rotation / scale / skew / pivot / anchor

All on `Container` (base of `Sprite`):

| Prop | Type | Notes | Repo parallel |
|------|------|-------|---------------|
| `position` | `ObservablePoint` | `sprite.position.set(x,y)` or `sprite.x / sprite.y` | `sceneRenderer.ts:722-760` |
| `scale` | `ObservablePoint` | `sprite.scale.set(sx,sy)`; `sprite.width/height` is derived (do not set directly) | `sceneRenderer.ts:754` |
| `rotation` | `number` rad | `sprite.rotation = rad`; `sprite.angle` is deg alias | `sceneRenderer.ts:753` |
| `skew` | `ObservablePoint` | `sprite.skew.set(skewX, skewY)` in radians. Docs: `skew.x` rotates line x=0 by α, `skew.y` rotates line y=0 by β; `skew.x=-θ, skew.y=θ` == `rotation=θ`. Commutative with rotation. | **No current usage** — `skew` is never touched in `sceneRenderer`/`nodeRenderer`; must be added for ground-squash. |
| `pivot`/`anchor` | `ObservablePoint` / `Point` | `Sprite.anchor` is percent (0..1); `Container.pivot` is pixels. This repo uses `pivot` in pixels scaled by size (`nodeRenderer:applyPivotWithSize:149` => `pivot.set(pivot.x*width, pivot.y*height)`). For shadow, anchor 0.5,0.5 simplifies centering; or keep pivot 0,0 and offset via position. | `nodeRenderer.ts:136-150` |
| `alpha` | `number` | See above | `sceneRenderer.ts:1016` |

**Shadow spec params map to Pixi:**

```ts
// From map: offsetX, offsetY, scaleX, scaleY, skewX, skewY, rotation, blur, opacity, color
shadowSprite.position.set(offsetX, offsetY);
shadowSprite.scale.set(scaleX, scaleY);
shadowSprite.rotation = rotation;                 // radians (storage is degrees -> convert)
shadowSprite.skew.set(skewX, skewY);             // radians
shadowSprite.alpha = opacity;                     // 0..1
shadowSprite.tint = color;                        // e.g. 0x111111
shadowSprite.filters = blur > 0 ? [new BlurFilter({ strength: blur })] : null;
```

If shadow should track source bounds: `shadowSprite.position` is relative to `shadowContainer`; set `shadowContainer.position` to source world position, then offset. Alternatively set `shadowSprite.x/y` directly in world layer and use `pivot` to anchor.

**Skew pipeline:** Use `Container.skew` (ObservablePoint). Do NOT manually construct a `Matrix` unless you need pivot-compensated shear. If you do need `Matrix` (e.g. combined with BBox centering):

```ts
import { Matrix } from 'pixi.js';
const m = new Matrix();
m.translate(-bboxMidX, -bboxMidY);
m.scale(scaleX, scaleY);
m.rotate(rotation);
// skew as matrix: [1, tan(skewY), tan(skewX), 1] pre-rotate
const skewM = new Matrix(1, Math.tan(skewY), Math.tan(skewX), 1, 0, 0);
m.prepend(skewM); // or append depending on order; test
m.translate(bboxMidX + offsetX, bboxMidY + offsetY);
shadowSprite.setFromMatrix(m); // ViewContainer.setFromMatrix decomposes into pos/rot/scale/skew
```

Decomposition via `setFromMatrix` is available (`scene.Container.html#setfrommatrix`). Prefer `scale/skew/rotation` properties for animatable lerp — matrix decomposition round-trips may jitter.

### 3.3 BlurFilter / KawaseBlurFilter, padding, quality

**Built-in `BlurFilter` (this repo should use this):**

```ts
import { BlurFilter } from 'pixi.js';

const bf = new BlurFilter({
  strength: 8,    // default 8, number = both axes. Also strengthX/Y for anisotropic
  quality: 4,     // default 4, int passes. Higher = smoother but more render targets
  kernelSize: 5,  // default 5, odd 5..15. Larger kernel = wider blur per pass
});
// or post-creation:
bf.strength = shadowBlur;
bf.strengthX = shadowBlurX; bf.strengthY = shadowBlurY;
bf.quality = 2; // cheaper for shadows
bf.repeatEdgePixels = false; // true clamps edge pixels (avoid transparent fringing)
bf.padding; // auto?
```

Docs: https://pixijs.download/release/docs/filters.BlurFilter.html, https://pixijs.com/8.x/guides/components/filters. Default options: `strength=8, quality=4, kernelSize=5` (see `BlurFilterOptions` table at `pixi.download/v8.5.0/docs/filters.html`). Constructors: `new BlurFilter({ strength, quality, kernelSize })` preferred; legacy `new BlurFilter(strength, quality, resolution, kernelSize)` deprecated since 8.0.0.

**`KawaseBlurFilter`:** NOT in `pixi.js` core. It ships in the community package `pixi-filters@6.x` (`pixi-filters/kawase-blur`, `@pixi/filter-kawase-blur`). The v8 core re-exports only 5 built-in filters (`AlphaFilter`, `BlurFilter`, `ColorMatrixFilter`, `DisplacementFilter`, `NoiseFilter`); blend filters require `import 'pixi.js/advanced-blend-modes'`. Source: https://pixijs.com/8.x/guides/components/filters ("Built-In Filters Overview"), https://pixijs.io/filters/docs/KawaseBlurFilter.html. To use Kawase, add dep `pixi-filters` and `import { KawaseBlurFilter } from 'pixi-filters/kawase-blur'` with options `{ blur, quality, clamp }` — but this ticket's spec explicitly says `BlurFilter`, so Kawase is research-only.

**Filter padding (blur bleed):**

```ts
// Base class: Filter.padding / FilterOptions.padding
// "the amount of pixels to pad the container when applying filter. A blur extends the container; padding ensures extra detail renders without clipping."
bf.padding = Math.ceil(blur * 2); // or rely on BlurFilter internal auto-padding?
```

In Pixi v8 `Filter` has `padding: number` (default 0) and `BlurFilter` internally sets padding based on `strength` and `kernelSize` so that bounds expansion covers blur radius. Empirically: `BlurFilterPass` computes padding as `strength * 0.5 * quality` etc. However, when the **RenderTexture itself is bbox-sized**, the blur will bleed off the RT edge and be clipped regardless of filter padding — filter padding expands the filter's render target, not the source RT. Correct approach: pad the RT size by `blur * 2 + kernelSize` (or at least `strength * 4`) on each side, and center the source sprite with that inset.

```ts
const pad = Math.ceil(blur * 2 + 4); // heuristic; tune 2..4x strength. BlurFilter docs suggest ~strength*quality factor
const rtW = Math.ceil(bbox.width + pad * 2);
const rtH = Math.ceil(bbox.height + pad * 2);
rt.resize(rtW, rtH);
shadowSprite.texture = rt;
// render silhouette centered at (pad, pad)
clone.position.set(pad, pad);
```

Also set `shadowSprite.filters = [bf]` — the filter system will call `getBounds` / `getGlobalBounds` on the sprite and allocate a Po2 filter texture expanded by `bf.padding`. If `rt` was created without padding, the filter's input is already clipped; so RT padding is mandatory.

**Quality/perf tradeoff:** Each `BlurFilter.quality` step adds a pair of render passes (horizontal + vertical via `BlurFilterPass`). At `quality=4` the filter does 4 passes; at `quality=1` it does 1 pass (blockier). Shadow typically needs `quality 2..4` and `strength 4..12`. For many shadows (10–20 groups) keep `quality <=2` and `kernelSize=5` and throttle per-frame updates with a dirty flag (only re-render RT when source hierarchy, time, or params changed — don't render every tick if idle).

---

## 4. Minimal code sketch that would compile in `sceneRenderer.ts` (Pixi 8.19)

This sketch reuses the app's renderer callback pattern from `FullscreenPass` and respects `pixi.ts` shim boundaries. It is not wired; it shows the exact calls.

```ts
// sceneRenderer.ts — shadow manager (sketch, not production)
import { BlurFilter, Sprite, Container, RenderTexture } from 'pixi.js';
import type { RendererPixi, PixiContainer, PixiRenderTexture } from './pixi';
import { placeholderOf } from './nodeRenderer';

type ShadowParams = {
  offsetX: number; offsetY: number;
  scaleX: number;  scaleY: number;
  skewX: number;   skewY: number; // radians
  rotation: number; // radians
  blur: number;
  opacity: number;
  color: number; // 0xrrggbb
};

class GroupShadow {
  #pixi: RendererPixi;
  #rt: PixiRenderTexture;
  #sprite: Sprite;
  #blurFilter: BlurFilter | null = null;
  #container: PixiContainer; // owns sprite, added to world beneath source
  #renderScene: (opts: { container: PixiContainer; target: PixiRenderTexture }) => void;

  constructor(
    pixi: RendererPixi,
    parentWorld: PixiContainer,
    renderScene: (opts: { container: PixiContainer; target: PixiRenderTexture }) => void,
    initialParams: ShadowParams,
  ) {
    this.#pixi = pixi;
    this.#renderScene = renderScene;
    this.#rt = pixi.RenderTexture.create({ width: 4, height: 4 }); // placeholder: resized on first update
    this.#sprite = new pixi.Sprite(this.#rt);
    this.#sprite.anchor.set(0.5, 0.5);
    this.#container = new pixi.Container();
    this.#container.label = 'shadow';
    this.#container.addChild(this.#sprite);
    // z-order: add before source so shadow is beneath. Caller controls addChildAt index or sortableChildren+zIndex.
    parentWorld.addChild(this.#container);
    this.applyParams(initialParams);
  }

  applyParams(p: ShadowParams) {
    this.#sprite.position.set(p.offsetX, p.offsetY);
    this.#sprite.scale.set(p.scaleX, p.scaleY);
    this.#sprite.rotation = p.rotation;
    this.#sprite.skew.set(p.skewX, p.skewY);
    this.#sprite.alpha = p.opacity;
    this.#sprite.tint = p.color as any;

    if (p.blur > 0.01) {
      if (!this.#blurFilter) {
        this.#blurFilter = new BlurFilter({ strength: p.blur, quality: 2, kernelSize: 5 });
        this.#sprite.filters = [this.#blurFilter as any];
      } else {
        this.#blurFilter.strength = p.blur;
      }
      // Filter.padding is managed by BlurFilter internally; however RT padding still needed (see update()).
    } else {
      this.#sprite.filters = null;
      this.#blurFilter?.destroy();
      this.#blurFilter = null;
    }
  }

  /**
   * Every frame (or dirty-flagged): clear RT -> render source subtree silhouette -> present sprite.
   * source: the group's PixiContainer (and its descendants). Must already have updated transforms.
   */
  update(source: PixiContainer, pad = 16) {
    // 1. Measure source bbox in local/parent space for RT sizing (use getBounds or this repo's WorldSize cache)
    const bounds = source.getBounds(); // or SceneRenderer.nodeSize(sourceId)
    const rtW = Math.max(1, Math.ceil(bounds.width + pad * 2));
    const rtH = Math.max(1, Math.ceil(bounds.height + pad * 2));
    if (this.#rt.width !== rtW || this.#rt.height !== rtH) this.#rt.resize(rtW, rtH);

    // 2. Build a temporary silhouette: clone or offscreen group.
    //    Simplest for prototype: reuse source as-is but with a white-alpha filter (see §2.2 B).
    //    For a true clone approach:
    const silhouette = this.#makeWhiteSilhouette(source);
    silhouette.position.set(pad - bounds.x, pad - bounds.y); // center inside padded RT

    // 3. Render silhouette into RT, clearing to transparent.
    //    app.renderer.render({ container: silhouette, target: this.#rt, clear: true, clearColor: 0x00000000 })
    //    This repo's pattern passes a callback bound to app.renderer.render.
    (this.#renderScene as any)({
      container: silhouette,
      target: this.#rt,
      clear: true,
      clearColor: 0x00000000,
    });

    // cleanup temp clone
    silhouette.destroy({ children: true });

    // 4. Sprite already references this.#rt; position it beneath source.
    //    In world space, shadowContainer should share source parent's transform so offset is in source-local space.
    //    e.g.: this.#container.position.copyFrom(source.position)  (if not sharing parent)
  }

  destroy() {
    this.#blurFilter?.destroy();
    this.#sprite.destroy();
    this.#container.destroy({ children: true });
    this.#rt.destroy();
  }

  #makeWhiteSilhouette(source: PixiContainer): PixiContainer {
    // Minimal: deep clone the container subtree and force tint white; real impl swaps texture or applies filter.
    // For brevity, shallow container clone with children moved:
    const c = new this.#pixi.Container();
    // Walk source recursively and create white proxies — placeholder for real silhouette builder.
    // Prototype shortcut: use a Filter that maps rgb->white, alpha preserved, avoiding clone color swap:
    //   const f = Filter.from({ glProgram: GlProgram.from({ fragment: '...' }), resources: {} });
    //   source.filters = [f]; render; source.filters = null; // but this mutates live scene — clone is safer.
    c.addChild(source.clone ? (source as any).clone(true) : source);
    return c;
  }
}
```

### Where this plugs into `SceneRenderer`

`SceneRenderer` already holds `world: PixiContainer`, `pixi: RendererPixi`, and per-node `containers: Map<string, PixiContainer>` (`sceneRenderer.ts:126-127`). A `GroupShadow` would be owned by the group node's container parent, e.g.:

```ts
// In SceneRenderer.bind / handleNodeCreated
const groupContainer = this.#containers.get(groupNodeId)!;
const shadow = new GroupShadow(this.#pixi, groupContainer.parent!, appRenderCallback, params);
// store in #shadows: Map<groupId, GroupShadow>
// In handleTimeChanged / per-frame tick: shadow.update(groupContainer, padForBlur(blur))
```

`appRenderCallback` is the same one `Renderer` gives to `FullscreenPass`: `(opts) => app.renderer.render(opts)` (`renderer.ts:190`). If `SceneRenderer` doesn't have `app`, pass it in constructor or add `RendererPixi.render` to the shim:

```ts
// pixi.ts — needed addition for SceneRenderer to call without app reference
export interface RendererPixi { /* ... */ readonly renderer?: { render: (opts:any)=>void } }
```

Alternatively thread `app.renderer` explicitly; current `fullscreenPass.ts:18-24` already requires the caller to inject it.

### `generateTexture` alternative (not preferred for silhouette pipeline)

```ts
// One-shot, allocates:
const tex = app.renderer.generateTexture({ container: source, region: bounds, resolution: devicePixelRatio, antialias: false });
const shadowSprite = new Sprite(tex);
// caller must tex.destroy() when obsolete — leaks if used per frame without destroy.
```

Use only for static snapshots (e.g. export); silhouette wants reuse.

---

## 5. Repo-specific notes (frontend/src/pixi/renderer/*)

| File | What it tells us |
|------|------------------|
| `pixi.ts:1-14,47-70` | Shim only exports `Application, Container, Graphics, MeshSimple, Text, Sprite, Texture, Filter, GlProgram, RenderTexture, Assets`. Needs `BlurFilter` added: `import { BlurFilter } from 'pixi.js'` then `readonly BlurFilter: typeof BlurFilter` and `realPixi.BlurFilter = BlurFilter`. Without this, mock pixi in tests can't stub blur. |
| `sceneRenderer.ts:1-49,117-182` | Uses `Container` tree rooted at `world`; `#containers` holds per-node containers whose children are `placeholderOf(container)` sprite/mesh/text/table. Evaluated transform is applied via `applyEvaluatedState` + `applyPivotWithSize`. Any shadow layer must be inserted at `world` or group parent level — not inside `placeholder` — so `transform` params compose with node worldTransform separately. |
| `nodeRenderer.ts:46-98,136-163` | `createNodeContainer` decides display type; `applyMaterialTint` tints `Sprite`/`Mesh`/`Text`. Silhouette must bypass this tint; hence the white-alpha filter or texture swap. |
| `renderer.ts:149-194,605-645,190` | `App.init({ resizeTo: host, antialias:true, autoDensity:true })` then `app.renderer.render(options)` per frame when `FullscreenPass.active`. Shadow pass would add a second `render({ container, target })` per shadow group every dirty frame; keep it inside `#tick` before `fullscreenPass.renderFrame()` so shadows are part of the scene already. |
| `fullscreenPass.ts:148-179` | Reference implementation for RT reuse: `RenderTexture.create({width:1,height:1,dynamic:true})`, `resize(w,h)` on `resize()`, `renderScene` callback injection, `destroy()` on deactivate, `clear` not configurable (relies on renderer's background). Shadow should mirror this pattern but with explicit `clearColor: transparent`. See also `renderer.ts:191` injection. |
| `textureCache.ts:96-99` | Shows `Texture.from({ resource: Uint8Array, width:1,height:1 })` for placeholders — not needed for RT. |
| `placeholder.ts:29-56,156-159` | `hexColorToTint` helper reused for shadow `tint`. |

---

## 6. Gotchas

### 6.1 Premultiplied alpha

Pixi framebuffers are **premultiplied by alpha** (core doc: "both input and output are premultiplied by alpha" — `PIXI.Filter` doc at https://api.pixijs.io/@pixi/core/PIXI/Filter.html). That means `rgb` in the RT is stored as `rgb * a`. When rendering silhouette, the filter that does `gl_FragColor = vec4(1,1,1,c.a)` must output premultiplied: `vec4(c.a, c.a, c.a, c.a)` if the pipeline expects premultiplied input, or `vec4(1,1,1,c.a) * c.a` equivalently. For a `Filter` used as `container.filters`, Pixi's FilterSystem handles premultiply/unmultiply; for direct `render({ container, target })` with no filter, the color written is already premultiplied by the pipeline's blend, so a white-alpha write is safe if you write `vec4(1,1,1,1) * alpha`. Testing tip: if shadows look semi-transparent grey instead of solid black at `alpha=1`, you wrote non-premultiplied white; multiply rgb by a.

Sprites that sample `RenderTexture` must have `texture.source.alphaMode` / `premultipliedAlpha` matching. `RenderTexture` defaults to `premultipliedAlpha: true`; keep default. Don't set `Sprite.blendMode = 'add'` for a dark shadow — that brightens; use `'normal'` or `'multiply'` (requires `import 'pixi.js/advanced-blend-modes'` for some advanced modes). Core `normal` is `SRC_ALPHA * src + (1 - SRC_ALPHA) * dst`, correct for shadow compositing.

### 6.2 Filter padding / blur bleed

`BlurFilter` expands its **filter bounds** by `padding` so the blur halo isn't clipped on the main canvas. That expansion allocates a pooled Po2 texture sized `bounds + padding` and draws the blurred result back. It does NOT expand the **source RenderTexture** that you rendered the silhouette into. If the RT is tight to `bbox`, the blur kernel samples off the edge (transparent) and the halo is truncated. Fix: pad RT by `pad = ceil(strength * quality * 0.5) + kernelSize` or conservatively `blur * 2 + 8` (this repo uses `placeholder: 160x100`, so pad +4 is typical). Also set `BlurFilter.repeatEdgePixels = false` (default) to avoid smearing edge pixels; `true` clamps and can darken edges — usually wrong for shadows. For large blur (e.g. `strength=16`), pad 32px each side.

If shadow is filtered on the **sprite** (as `shadowSprite.filters = [bf]`), the filter operates on the sprite's bounds in screen space. The sprite's `getBounds()` is RT-sized, so filter padding auto-covers. If you instead filter the **RT rendering step**, padding is moot — you blurred before sampling. Filter the sprite, pad the RT.

### 6.3 Texture lifecycle / dispose

- One `RenderTexture` per shadow group, reused. Call `resize()` not recreate when BBox changes; `create` does GPU alloc lazily, resize reallocates.
- Destroy order: `sprite.destroy()` -> `container.destroy({children:true})` -> `rt.destroy()` -> `filter.destroy()`. If using `generateTexture`, caller owns the returned `Texture` and must `texture.destroy(true)` to free GPU and remove from texture cache; leak if forgotten.
- In `SceneRenderer.bind(null)` and `handleNodeRemoved`, iterate `#shadows` and destroy RTs. Matches `FullscreenPass#deactivate` / `Renderer.dispose` pattern (`renderer.ts:535-602`, `textureCache.ts:74-85`).
- `FilterSystem` pools textures; don't hold references to pooled ones. Only destroy filters/textures you created.
- If a shadow is hidden (group `visible=false`), skip RT render for that frame; but keep RT alive (empty) so toggling back is instant.

### 6.4 Skew handling: `Container.skew` vs `Matrix`

- **`Container.skew`** (`ObservablePoint`, radians): per-container shear. Docs: `skew.x` shears Y along X, `skew.y` shears X along Y; `skew.x = -θ, skew.y = θ` == `rotation = θ`. Commutative with rotation. This is what the editor should animate; it lerps cleanly and composes with `scale`/`rotation` inside `localTransform`. Used as `shadow.skew.set(sx, sy)`. Not currently touched anywhere in `renderer/*` — easy to add.
- **`Matrix`** shear: if you need non-Container shear (e.g. applying skew in render `transform` param), build `new Matrix(1, tan(skewY), tan(skewX), 1, 0, 0)` and `prepend/append` to existing matrix. But then you cannot read back `skew` separately; `setFromMatrix(matrix)` will decompose into `position/scale/rotation/skew` with potential numerical drift. Prefer Container.skew for keyframable params; reserve Matrix for one-shot centering (`-bboxMid`).
- **Ground-squash preset:** `scaleY 0.15–0.2, scaleX 1.1, skewX ~0.2rad, skewY 0` — achieved by setting those Container props, not a custom matrix.
- Pivot interaction: changing `pivot` shifts where `skew`/`rotation` origin is. For shadow, leave `pivot` at `0,0` and use `position` offset; otherwise `pivotWithSize` (`nodeRenderer:149`) will offset shadow by `pivot*size` and squash will look like shear about wrong point.

### 6.5 Other pitfalls

- **Clear color:** Passing `clear: true` without `clearColor` uses `renderer.background.color` (white in this app). Must pass `clearColor: 0x00000000` or transparent.
- **Deformed meshes / bones:** `sceneRenderer.refreshDeformedMeshSizes` applies `evaluateMeshDeformation` post-bones to `vertices` each frame. A silhouette that snapshots `container.getBounds()` automatically includes deformed vertices (they're already on the GPU), but a naive clone that copies `mesh.vertices` without deformation will be stale. Either render the live `sourceContainer` (recommended — already deformed) or call `evaluateMeshDeformation` for clone vertices.
- **Text / Table / Chart / Circle:** These nodes use `Text`, `Graphics` (outline), and `Sprite` children — all rendered by container traversal, so they contribute alpha to RT correctly. Caveat: `Text` has subpixel antialiasing; silhouette will include fringed alpha; acceptable.
- **Filter stacking & render groups:** In Pixi v8, containers with filters are render groups (`enableRenderGroup`). Having N shadow groups each with a `BlurFilter` creates N filter passes per frame. Keep `renderGroup` count low; shadows under ~10 groups at 1080p is fine, but profile `renderer.render` cost.
- **Video export determinism:** `Renderer.extract.canvas(stage)` snapshots the canvas; if shadow RT is updated only on dirty frames, ensure frame `t = i/fps` evaluation happens before extraction. Same lerp path as preview (`animationEvaluator`) so export matches preview.

---

## 7. What to change in `pixi.ts` for the real ticket

```ts
// frontend/src/pixi/renderer/pixi.ts
import { Application, Assets, Container, Filter, GlProgram, Graphics, MeshSimple, RenderTexture, Sprite, Text, Texture, BlurFilter } from 'pixi.js'
// ...
export interface RendererPixi {
  // ... existing
  readonly BlurFilter: typeof BlurFilter
  readonly Filter: typeof Filter // already there
}
export const realPixi: RendererPixi = {
  // ...
  BlurFilter,
  Filter, GlProgram, RenderTexture, ...
}
```

Add optional `render` passthrough if `SceneRenderer` should call renderer directly; otherwise inject `app.renderer.render` callback as `FullscreenPass` does. The `BlurFilter` import is the only new runtime dep — no `pixi-filters` needed.

---

## 8. Open questions for the prototype ticket (not answered here)

- Shadow compositing order when sibling groups each have a shadow — global shadow layer vs per-group `shadowContainer` as child of group's parent (affects z-index with sortableChildren). Prototype should try per-group child with `zIndex = group.zIndex - 0.5`.
- Whether silhouette includes node's `filters` (e.g. a character with a glow filter) — filtering the source before silhouette would bake glow into shadow; likely skip: silhouette renders with node filters disabled.
- Per-shadow RT max cap — at 4K with blur 32, padded RT could be 4K+64px square = ~16MP per shadow; cap at 1024 or 2048 and downscale.
- `quality` exposed as param vs fixed 2 — tradeoff note above suggests exposing `quality` is deferred to avoid over-filtering.

---

## 9. Sources

- PixiJS v8 `RenderTexture` API & `create`/`resize`/`dynamic`: https://pixijs.download/release/docs/rendering.RenderTexture.html
- PixiJS v8 `BlurFilter` options, defaults, `strength/quality/kernelSize/repeatEdgePixels`: https://pixijs.download/release/docs/filters.BlurFilter.html, https://pixijs.download/v8.5.0/docs/filters.html, https://pixijs.com/8.x/guides/components/filters
- `KawaseBlurFilter` is in `pixi-filters` (v6 for Pixi v8), not core: https://pixijs.io/filters/docs/KawaseBlurFilter.html, https://pixijs.com/8.x/guides/components/filters ("only Alpha/Blur/ColorMatrix/Displacement/Noise are built-in; rest via pixi-filters")
- `Filter.padding`, `FilterSystem` pooling, premultiplied framebuffers note: https://pixijs.download/release/docs/filters.Filter.html, https://api.pixijs.io/@pixi/core/PIXI/Filter.html
- Renderer `render({ container, target, clear, transform, flipY })` & `generateTexture`: https://pixijs.download/release/docs/rendering.WebGLRenderer.html#render, https://pixijs.com/8.x/guides/components/renderers
- `Container.skew` / `position`/`scale`/`rotation`/`pivot`/`alpha`/`tint` / `setFromMatrix`: https://pixijs.download/release/docs/scene.Container.html, https://pixijs.download/release/docs/scene.Sprite.html, https://pixijs.com/8.x/guides/components/scene-objects, https://pixijs.com/8.x/guides/components/color
- Repo files cited inline: `frontend/src/pixi/renderer/{pixi.ts,renderer.ts,sceneRenderer.ts,nodeRenderer.ts,placeholder.ts,fullscreenPass.ts,textureCache.ts}`

---

*Commit: `research/shadow-pixi-v8` branch, file `research/shadow-pixi-findings.md`. No code changes to `main`; branch is throwaway for wayfinder map #286.*
