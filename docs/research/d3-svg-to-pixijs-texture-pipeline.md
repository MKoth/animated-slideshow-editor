# D3 SVG to PixiJS Texture Pipeline Research

**Ticket:** #176
**Date:** 2026-08-22
**Status:** Research Complete

## Executive Summary

Rasterizing D3-generated SVG into PixiJS textures is a well-established pattern: `XMLSerializer -> Blob URL -> Image -> Canvas 2D drawImage -> PIXI.Texture.from(canvas)`. The pipeline works reliably across modern browsers but has critical edge cases around font loading, CSS isolation, alpha premultiplication, and DPI scaling. For per-frame re-rendering, this approach is **not recommended**. Render to texture only on data changes, and use PixiJS-native primitives for frame-to-frame animation.

---

## 1. Step-by-Step Pipeline

### Stage 1: D3 SVG Generation

D3 creates SVG elements in the DOM or as detached nodes via `d3.create()`.

```typescript
const svg = d3.create("svg")
  .attr("viewBox", `0 0 ${width} ${height}`)
  .attr("width", width)
  .attr("height", height);

// D3 rendering
svg.append("path").attr("d", arcGenerator(data));
```

### Stage 2: Serialize SVG to String

Use `XMLSerializer` to convert the DOM SVG to an XML string. The `xmlns` attribute is handled automatically.

```typescript
const svgNode = svg.node();
const svgString = new XMLSerializer().serializeToString(svgNode);
```

### Stage 3: Convert to Image Source

| Method | Pros | Cons |
|--------|------|------|
| `encodeURIComponent()` | Handles Unicode | Larger URL string |
| `btoa()` (base64) | Smaller string | Fails on non-Latin characters |
| `Blob` + `createObjectURL` | Cleanest, no length limits | Must revoke URL to avoid leak |

**Recommended:** Blob URL approach.

```typescript
const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
const url = URL.createObjectURL(blob);
```

### Stage 4: Load into Image Element

The browser rasterizes the SVG when loading as an image source. This is asynchronous.

```typescript
const img = new Image();
img.src = url;

await new Promise<void>((resolve, reject) => {
  img.onload = () => resolve();
  img.onerror = () => reject(new Error("Failed to load SVG as image"));
});
```

**Safari/iOS gotcha (snapdom #394):** `img.decode()` alone does not guarantee inner content is composited. Attach the image offscreen and wait for two `requestAnimationFrame` ticks before drawing.

### Stage 5: Draw to Canvas

```typescript
const canvas = document.createElement("canvas");
canvas.width = targetWidth;
canvas.height = targetHeight;

const ctx = canvas.getContext("2d");
ctx.clearRect(0, 0, canvas.width, canvas.height);
ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
```

### Stage 6: Upload to PixiJS Texture

```typescript
const texture = PIXI.Texture.from(canvas, {
  resolution: window.devicePixelRatio || 1,
  alphaMode: "premultiply-alpha-on-upload",
});
```

---

## 2. Complete TypeScript Code Pattern

```typescript
import * as PIXI from "pixi.js";
import * as d3 from "d3";

interface SVGTextureOptions {
  width: number;
  height: number;
  resolution?: number;       // default: devicePixelRatio
  premultiplyAlpha?: boolean; // default: true
}

/**
 * Async rasterize a D3-generated SVG element into a PixiJS Texture.
 * Call on data changes, NOT per animation frame.
 */
async function svgToPixiTextureAsync(
  svgElement: SVGSVGElement,
  options: SVGTextureOptions
): Promise<PIXI.Texture> {
  const {
    width,
    height,
    resolution = window.devicePixelRatio || 1,
    premultiplyAlpha = true,
  } = options;

  // 1. Serialize SVG DOM to XML string
  const svgString = new XMLSerializer().serializeToString(svgElement);

  // 2. Create blob URL (avoids btoa Unicode issues)
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    // 3. Load into Image (browser rasterizes SVG here)
    const img = new Image();
    img.src = url;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG image load failed"));
    });

    // 4. Safari safety: wait for inner content compositing
    if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
      img.style.cssText =
        "position:fixed;left:-99999px;top:-99999px;pointer-events:none;";
      document.body.appendChild(img);
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r))
      );
      document.body.removeChild(img);
    }

    // 5. Draw to offscreen canvas at target resolution
    const canvas = document.createElement("canvas");
    canvas.width = width * resolution;
    canvas.height = height * resolution;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // 6. Upload canvas as PixiJS texture
    const texture = PIXI.Texture.from(canvas, {
      resolution,
      alphaMode: premultiplyAlpha
        ? "premultiply-alpha-on-upload"
        : "no-premultiply-alpha",
    });

    return texture;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Usage: create a slide sprite from D3 rendering
 */
async function createSlideSprite(
  renderSlide: (
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>
  ) => void,
  slideWidth: number,
  slideHeight: number
): Promise<PIXI.Sprite> {
  // Create detached SVG
  const svgSelection = d3
    .create("svg")
    .attr("viewBox", `0 0 ${slideWidth} ${slideHeight}`)
    .attr("width", slideWidth)
    .attr("height", slideHeight);

  // Render slide content via D3
  renderSlide(svgSelection);

  // Rasterize to texture (2x for Retina)
  const texture = await svgToPixiTextureAsync(svgSelection.node()!, {
    width: slideWidth,
    height: slideHeight,
    resolution: 2,
  });

  // Create sprite
  const sprite = new PIXI.Sprite(texture);
  sprite.width = slideWidth;
  sprite.height = slideHeight;

  return sprite;
}
```

---

## 3. Performance Budget Estimates

### Per-Operation Cost (approximate)

| Operation | Time | Memory |
|-----------|------|--------|
| `XMLSerializer.serializeToString()` | <1ms | String (~SVG size x 1.5) |
| `Blob` + `URL.createObjectURL` | <1ms | Blob in memory |
| `Image.src = blobUrl` (load) | 5-50ms | Image decoded by browser |
| `canvas.drawImage()` | 2-10ms | Canvas pixel buffer (W x H x 4 bytes) |
| `PIXI.Texture.from(canvas)` | 1-5ms | GPU texture upload (W x H x 4 bytes) |
| **Total SVG to Texture** | **~10-70ms** | **~2x canvas memory (CPU + GPU)** |

### WebGL Texture Limits

| Platform | Typical MAX_TEXTURE_SIZE | Notes |
|----------|--------------------------|-------|
| Desktop (modern GPU) | 8192-16384 px | Safe up to 8192 |
| Mobile (high-end) | 4096-8192 px | Check gl.getParameter(gl.MAX_TEXTURE_SIZE) |
| Mobile (low-end) | 2048-4096 px | Conservative limit |
| **WebGL spec minimum** | **4096 px** | Must support at least this |

**PixiJS note:** PixiJS v8 documents texture size limited to 4096x4096 as safe minimum. For larger content, use Graphics (vector) mode.

### Memory Budget

- 1920x1080 RGBA texture = **8.3 MB** (GPU) + **8.3 MB** (CPU during upload)
- 4K (3840x2160) RGBA texture = **33.2 MB** (GPU)
- At 2x DPI: 1920x1080 display becomes 3840x2160 texture = 33 MB per texture
- **Budget for 10 slide textures at 2x:** ~330 MB GPU memory

### Re-render Cost

- At 60 FPS: ~16ms budget per frame
- SVG-to-Texture pipeline takes 10-70ms
- **Conclusion: NOT viable for per-frame re-rendering**

---

## 4. Resizing and Scaling

### SVG viewBox vs Canvas Size vs PixiJS Sprite

```typescript
// SVG: logical coordinate space
svg.attr("viewBox", "0 0 1920 1080");

// Canvas: physical pixel size (DPI-scaled)
canvas.width = 1920 * devicePixelRatio;   // e.g., 3840
canvas.height = 1080 * devicePixelRatio;  // e.g., 2160

// PixiJS Sprite: CSS pixel size
sprite.width = 1920;
sprite.height = 1080;
// PixiJS uses the texture's resolution to map correctly
```

### DPI/Retina Handling

```typescript
const dpr = window.devicePixelRatio || 1;

// Option A: 1x render, let PixiJS upscale (blurry on Retina)
svgToPixiTexture(svg, { width: 1920, height: 1080, resolution: 1 });

// Option B: Device DPI (sharp, more memory)
svgToPixiTexture(svg, { width: 1920, height: 1080, resolution: dpr });

// Option C: Fixed 2x (safe for most displays)
svgToPixiTexture(svg, { width: 1920, height: 1080, resolution: 2 });
```

**Recommendation:** Use `resolution: 2` fixed. Covers all Retina displays without waste on 3x+.

---

## 5. Transparency / Alpha Channel

### The Premultiplication Problem

**Critical gotcha from PixiJS source:** PixiJS defaults `alphaMode` to `"premultiply-alpha-on-upload"`. RGB values are multiplied by alpha on upload, which **darkens semi-transparent areas**. A 50% transparent red (1,0,0,0.5) becomes (0.5,0,0,0.5).

```typescript
// For solid shapes: default is fine
const texture = PIXI.Texture.from(canvas);

// For semi-transparent overlays: preserve straight alpha
const texture = PIXI.Texture.from(canvas, {
  alphaMode: "no-premultiply-alpha",
});
```

### Transparent SVG Background

D3 SVGs with no background fill are transparent by default. Ensure:

1. SVG has no `<rect>` background fill
2. Canvas is cleared before `drawImage`
3. `alphaMode` handles alpha correctly
4. PixiJS sprite has `sprite.alpha = 1` (default)

---

## 6. Text Rendering Quality

### The Font Loading Problem

When SVG is rasterized via the `Image` element, **external fonts are NOT loaded**. The SVG becomes self-contained.

**Solutions (in order of reliability):**

1. **Inline font as base64 in SVG `<defs>`** -- embed the font data directly
2. **Use system fonts** -- only if you control the target environment
3. **Use PixiJS-native text rendering** -- overlay PIXI.Text on top of rasterized SVG

### DPI Scaling for Text

SVG text at 1x rendered to canvas at 2x will be blurry. Either render SVG at higher resolution, or use PixiJS `Text` objects for crisp text overlay.

### Anti-aliasing

SVG-to-canvas rasterization uses the browser's native anti-aliasing. Thin lines (< 1px) and small fonts may disappear at low resolution. Use `resolution >= 2` to preserve detail.

---

## 7. Real-World Examples

### D3 + PixiJS Integration Patterns

**Pattern A: D3 for layout, PixiJS for rendering (recommended)**
- D3 force simulation computes positions, PixiJS Graphics/Sprites render
- References: [ahoak/pixi-svg-visualization](https://github.com/ahoak/pixi-svg-visualization), [Jan Zak article on Neo4j blog](https://medium.com/neo4j/scale-up-your-d3-graph-visualisation-webgl-canvas-with-pixi-js-63f119d96a28)
- Key insight: D3 was refactored for modularity; you can use d3-force for layout and replace SVG rendering entirely with PixiJS

**Pattern B: SVG rasterization to texture**
- Render D3 SVG to canvas, upload as PixiJS texture
- Used for complex vector graphics that change infrequently
- PixiJS v8 supports this natively via `Assets.load("file.svg")` which rasterizes to texture

**Pattern C: SVG as Graphics context (PixiJS v8)**
- `Assets.load({ src: "file.svg", data: { parseAsGraphicsContext: true } })`
- Parses SVG into vector geometry, stays crisp at any scale
- Good for icons and UI elements, not for complex D3 charts

### Key Takeaways from Real Projects

1. **D3 excels at layout computation** (force, hierarchy, scales) -- keep it for that
2. **PixiJS excels at GPU-accelerated rendering** -- use it for drawing
3. **SVG rasterization is for static content** -- not for per-frame animation
4. **Performance scales with sprite count** -- batch sprites, reuse textures
5. **BitmapText and SDF text** are critical for performance with many text labels

---

## 8. Known Gotchas and Browser Quirks

| Issue | Impact | Mitigation |
|-------|--------|------------|
| External fonts not loaded in SVG-to-Image | Wrong fonts in rasterized output | Inline fonts as base64 in SVG `<defs>` |
| `foreignObject` rendering inconsistent across browsers | HTML-in-SVG may not render | Avoid `foreignObject`; use pure SVG elements |
| Safari/iOS compositing race condition | Blank areas in rasterized output | Attach offscreen, wait 2x `requestAnimationFrame` |
| `btoa()` fails on non-Latin characters | Crash on international text | Use `encodeURIComponent()` or Blob URL |
| PixiJS premultiplies alpha by default | Darkened semi-transparent areas | Set `alphaMode: "no-premultiply-alpha"` |
| Canvas tainted by cross-origin SVG resources | `toDataURL()` throws SecurityError | Host all assets same-origin, use CORS |
| Firefox strict about SVG `xmlns` | Rendering fails silently | Always use `XMLSerializer` (handles xmlns) |
| WebGL MAX_TEXTURE_SIZE varies by device | Texture upload fails on mobile | Check limits, cap at 4096 for safe cross-device |
| CSS styles lost when SVG serialized | Missing colors, strokes | Inline all styles or use `<style>` inside SVG `<defs>` |

---

## 9. Recommended Approach for Per-Frame Render Loop

**Do NOT re-rasterize SVG every frame.** The pipeline takes 10-70ms and 60 FPS needs <16ms per frame.

### Recommended Architecture

```
Data Change Event
    |
    v
D3 re-renders SVG (layout + styling)
    |
    v
svgToPixiTextureAsync() -- async, off main thread if possible
    |
    v
PIXI.Texture.from(canvas) -- GPU upload
    |
    v
Update PIXI.Sprite.texture -- swap texture reference
    |
    v
PixiJS render loop handles frame-to-frame drawing
```

### Texture Reuse Strategy

```typescript
class SlideTextureManager {
  private textures = new Map<string, PIXI.Texture>();

  async updateSlide(
    slideId: string,
    svgElement: SVGSVGElement,
    options: SVGTextureOptions
  ): Promise<void> {
    // Destroy old texture to free GPU memory
    const old = this.textures.get(slideId);
    if (old) {
      old.destroy(true); // destroy=true frees the texture source
    }

    // Create new texture
    const newTexture = await svgToPixiTextureAsync(svgElement, options);
    this.textures.set(slideId, newTexture);
  }

  destroy(): void {
    for (const tex of this.textures.values()) {
      tex.destroy(true);
    }
    this.textures.clear();
  }
}
```

### Frame Loop Pattern

```typescript
// PixiJS application tick -- runs every frame
app.ticker.add((ticker) => {
  // Update sprite positions, alpha, transforms (cheap)
  // Do NOT re-rasterize SVG here

  // Only swap texture reference if a new one was prepared
  if (pendingTexture) {
    sprite.texture = pendingTexture;
    pendingTexture = null;
  }
});
```

---

## 10. Better Alternatives?

### Direct Canvas Rendering (No SVG Intermediate)

| Approach | Pros | Cons |
|----------|------|------|
| **D3 + Canvas 2D** | Fast, no SVG overhead, direct pixel control | No vector scaling, manual hit testing |
| **D3 + PixiJS (direct)** | GPU-accelerated, best performance | Must recreate D3 drawing commands as PixiJS API calls |
| **D3 SVG to Texture** | Preserves full D3/SVG fidelity | Async, memory-heavy, not per-frame viable |
| **PixiJS SVG parsing** | Native SVG-to-vector in PixiJS v8 | Limited SVG feature support |

### Recommendation

For the animated slides use case:

1. **Use D3 for data computation and layout** (scales, axes, force layouts)
2. **Use PixiJS for rendering** (Sprites, Graphics, Text)
3. **Use SVG-to-Texture only for complex static vector content** (charts that change on data updates but not per-frame)
4. **For animated transitions**, interpolate PixiJS sprite properties (position, alpha, scale) rather than re-rasterizing
5. **For text overlays**, use PixiJS `Text` or `BitmapText` objects on top of rasterized SVG backgrounds

This hybrid approach gives you D3's powerful data binding and layout algorithms with PixiJS's GPU-accelerated rendering performance.
