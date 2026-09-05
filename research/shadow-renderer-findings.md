# Research: SceneRenderer insertion points, compositing, BBox sizing & dirty strategy for group shadows

Ticket: #288 · Map: #286 · Branch: `research/shadow-renderer` · Date: 2026-09-05

Wayfinder question: where does a **group-attached shadow effect** (one per group node, silhouette of its filtered subtree, composited **beneath** the group's subtree, respecting world transforms / opacity / visibility / z-order, with dirty-flag vs per-frame policy) insert given the current `SceneRenderer` + engine — specifically `PixiContainer` per `SceneNode`, `composeChain` / `evaluateNode` / `evaluateMeshDeformation` / `refreshDeformedMeshSizes`, and `walkPreOrder` traversal — plus `RenderTexture` ownership, BBox-based texture sizing with blur bleed, and whether the silhouette should sample post-deformed/morphed vertices, post-shader alpha, or pre-shader alpha.

> Ground rule: every factual claim cites `file:line`. No Pixi docs are consulted; only the local `frontend/src/**` tree.

---

## 1. SceneRenderer architecture (what exists)

### 1.1 Ownership

`SceneRenderer` is the sole bridge from engine state to Pixi (`frontend/src/pixi/renderer/sceneRenderer.ts:117`).

```
EnginePublic  --evaluateNode/evaluateCircle/evaluateTable/evaluateMeshDeformation-->  SceneRenderer
   |                                                                 |
   +- scene.root walkPreOrder                                  world: PixiContainer (injected)
   +-- containers: Map<string, PixiContainer>   (#containers :127)
        nodeIds: WeakMap<PixiContainer,string>  (#nodeIds :128)
        sizes: Map<string,WorldSize>            (#sizes :129)
        lastEvaluated: Map<string,EvaluatedNodeScratch> (#lastEvaluated :130)
        lastMaterials: Map<string,EffectiveMaterialScratch> (#lastMaterials :131)
        nodeShaders: Map<string,NodeShaderState> (#nodeShaders :132)
        missingNodes, ikOverrides, table/chart/text/circle hashes, etc. (:133-139)
```

Construction injects `engine, world, pixi, textureCache, resolveAssetUrl, programCache, onNodeSizeChanged, currentTime, isAssetMissing, resolveShaderSource, resolveDataSource` (`sceneRenderer.ts:150-162`). A `shapePreviewStore` subscription is wired in the constructor (`sceneRenderer.ts:174-181`) that calls `refreshDeformedMeshSizes()` and re-evaluates every mesh node — the prototype for any shadow-preview subscription.

### 1.2 Container tree mirrors scene tree — not flat

`*Container` per `SceneNode` is created by `createNodeContainer(pixi, node, cache)` (`nodeRenderer.ts:46`) which:

- sets `container.label = node.name` (`nodeRenderer.ts:52`),
- applies ordering via `applyTableNodeOrdering` (`nodeRenderer.ts:53`),
- applies `node.transform` + `visible` + `alpha` (`nodeRenderer.ts:54-56`),
- then branches on component kind: `table` / `chart` / `circle` / `mesh` / `assetInstance` / `text` / `bone` / `tableCell` / `ghost` (`nodeRenderer.ts:57-96`).

Each container's **first child** is its "placeholder" group (the drawable): `placeholderByContainer: WeakMap<PixiContainer,PixiContainer>` (`nodeRenderer.ts:21`, `placeholderOf:25`). Mesh placeholders hold a `MeshSimple` at `label='mesh-display'` (`nodeRenderer.ts:481`), text holds `PixiText` (`textRenderer.ts:22`), tables hold a Graphics border (`tableRenderer.ts:198`), charts hold a Sprite (`chartRenderer.ts:46`). Shaders are attached as `placeholder.filters = [filter]` (`sceneRenderer.ts:1169`), never on the outer container.

Parenting: `#attachToParent(container, node)` (`sceneRenderer.ts:1350-1354`) adds to either owning table container or logical parent container, falling back to `this.#world`:

```ts
const renderParent = node.components.tableCell ? this.#owningTable(node) : node.parent;
const parentContainer = renderParent ? this.#containers.get(renderParent.id) : undefined;
(parentContainer ?? this.#world).addChild(container);
```

Table cells render under the table's Graphics group, not their logical `tableRow` parent (`sceneRenderer.ts:1375-1380`, `tableRenderer.ts:28-40`). This matters for shadows: a shadow that naively walks `node.children` must replicate this special parent for correct z-order and for computing subtree world positions.

Lifecycle:

- `bind(scene, slideId)` (`sceneRenderer.ts:214-238`) tears down every existing container (`container.destroy({children:true})`), clears all maps, then `walkPreOrder(scene.root)` + `#addNode` for each node, finally `refreshDeformedMeshSizes()`.
- `handleNodeCreated(nodeId)` (`sceneRenderer.ts:240-250`) does a single `#addNode` + `#refreshOwningTable`.
- `handleNodeRemoved(nodeId)` (`sceneRenderer.ts:252-276`) finds the owning table, walks `walkContainers(container)` to delete every descendant entry from all maps, destroys the subtree, and reflows the table.
- `handleNodeReparented` (`sceneRenderer.ts:820-829`) just re-attaches the single container via `#attachToParent`.
- `handleNodeOrderChanged` (`sceneRenderer.ts:831-865`) reorders sibling containers under their parent by sorting `parent.children` indices — shadows inserted as sibling containers must participate in this reorder or they will drift.

### 1.3 Evaluated state path (per-node)

`#evaluateAndApply(nodeId)` (`sceneRenderer.ts:902-1046`) is the hot path. Every mutating handle ends by calling it (directly or via `handleTimeChanged` loop). Steps per node per frame:

1. `applyTableNodeOrdering`, table/chart/text hash-coalesced rebuilds (`sceneRenderer.ts:911-939`);
2. Circle: `engine.evaluateCircle` → `applyCircleDataWithUV` if hash changed (`sceneRenderer.ts:941-967`);
3. Table: `engine.evaluateTable` → `rebuildTableWithEvaluated` / `rebuildTableChildWithEvaluated` (`sceneRenderer.ts:968-996`);
4. `engine.evaluateNode(nodeId, time, scratch)` (`sceneRenderer.ts:997`), `engine.evaluateMaterialOverrides` (`sceneRenderer.ts:998-1002`), `#resolveMaterial` (`sceneRenderer.ts:1176-1192`), `#resolveShader` (`sceneRenderer.ts:1194-1217`), `#applyNodeShader` (`sceneRenderer.ts:1130-1174`);
5. Early-out if `evaluatedStatesEqual(previous, state)` and `materialChanged` and `shaderChanged` and `tableStyleChanged` all false (`sceneRenderer.ts:1013-1015`);
6. Otherwise `applyEvaluatedState(container, state, material.opacityMultiplier)` (`sceneRenderer.ts:1016`) which does `position/rotation/scale/pivot/alpha/visible` (`nodeRenderer.ts:110-121`), ghost-overlay gating, `applyPivotWithSize` (`sceneRenderer.ts:1027-1030`), IK rotation override (`sceneRenderer.ts:1032-1035`), and `applyMaterialTint` (`sceneRenderer.ts:1036-1038`).

`applyEvaluatedState` is `container.position/rotation/scale + alpha = state.opacity * opacityMultiplier + visible = state.visible` (`nodeRenderer.ts:119-120`). Opacity in the engine is a scalar multiplied with the material's `opacityMultiplier` (`materialResolution.ts:57-60`). Visibility is tri-valued: `node.visible` (base) overlaid by `evaluateVisible` hold track (`animationEvaluator.ts:163-192`) and by clip layers (`animationEvaluator.ts:684-753`).

Daily callers that already converge on `#evaluateAndApply`:

- `handleTransformChanged` (`sceneRenderer.ts:278-295`) → one node.
- `handleKeyframeChanged` (`sceneRenderer.ts:297-300`) → one node.
- `handleTimeChanged` (`sceneRenderer.ts:302-311`) → `walkPreOrder` over every node (`sceneRenderer.ts:307-308`) + `refreshDeformedMeshSizes`.
- `handleVisibilityChanged` (`sceneRenderer.ts:767-772`), `handleVisibleTrackChanged` (`sceneRenderer.ts:774-776`), `handleOpacityChanged` (`sceneRenderer.ts:789-791`), `handleMaterialChanged` (`sceneRenderer.ts:424-453`), plus hash-gated `handleTextChanged`/`handleTableChanged`/`handleChartChanged`/`handleCircleChanged`.

The owning `Renderer` (`frontend/src/pixi/renderer/renderer.ts:748-770`) wraps `sceneRenderer.handleTimeChanged()` in its own `#handleTimeChanged` which also calls `transformSource.updateIKOverrides` → `sceneRenderer.applyIKOverrides` → `sceneRenderer.refreshDeformedMeshSizes` → `sceneRenderer.applyConstraintOverrides`. Shadow per-frame work should be scheduled in this same tick, after transforms are final but before `fullscreenPass.renderFrame()`.

### 1.4 Group node definition

`isGroupNode(node)` (`frontend/src/engine/sceneNode.ts:172-174`) is:

```ts
export function isGroupNode(node: SceneNode): boolean {
  return Object.keys(node.components).length === 0 && node.children.length > 0;
}
```

So "group" is the absence of every component (`camera/assetInstance/text/bone/mesh/ghost/table/tableRow/tableCell/chart/circle` — `components.ts:103-115`). The complementary `walkPreOrder` (`sceneNode.ts:379-389`) is the canonical subtree iterator used everywhere in `SceneRenderer` (bind, handleTimeChanged, refreshDeformedMeshSizes, owning-table loops).

Implication: a shadow "attached to a group node, one per group" would gate on `isGroupNode` (or at minimum `children.length > 0` if bone/table ghosts should also cast). A node that later gains a component (e.g. a test assigns `mesh`) would flip from group to non-group — shadow lifecycle must handle that transition if we allow it.

`SceneNode` also carries `markDirty()` (`sceneNode.ts:72-80`) which cascades `_worldTransformDirty` to children. This is the **stored** (non-evaluated) world-transform cache used by `worldTransformOf` (`worldTransform.ts:20-32`). For shadows, the evaluated path is the one that matters (see §3).

---

## 2. World transform composition — `composeChain`

### 2.1 The chain

Both `worldTransformOf` (`worldTransform.ts:20-32`) and `evaluatedWorldTransformOf` (`worldTransform.ts:34-46`) build a `chainOf(node)` (`worldTransform.ts:48-55`):

```ts
for (let cursor=node; cursor!=null; cursor=cursor.parent) chain.push(cursor);
chain.reverse(); // root → node
```

Then `composeChain(chain, localOf)` (`worldTransform.ts:213-244`).

### 2.2 The formula

`composeChain` (`worldTransform.ts:213-244`) is deliberately documented:

> "WorldTransform is the **pivot point's world position**. Parent→pivot→rotation/scale→translate order: ... The pivot offset only affects the visual bounds (handled in hitTest/selection), keeping worldTransform position stable when pivot changes (only the bounds offset moves). This matches Pixi's container model where `container.position` is the pivot point and `container.pivot = pivot*size`."

Implementation (`worldTransform.ts:228-242`):

```ts
let x=0, y=0, rotation=0, scaleX=1, scaleY=1;
for (const link of chain) {
  const local = localOf(link);
  x += rotateX(local.x * scaleX, local.y * scaleY, rotation);
  y += rotateY(local.x * scaleX, local.y * scaleY, rotation);
  rotation += local.rotation;
  scaleX *= local.scaleX;
  scaleY *= local.scaleY;
}
return {x,y, rotation, scaleX, scaleY};
```

Helpers `rotateX/rotateY` (`worldTransform.ts:274-280`). Note: pivot does not appear — position `x,y` is always the pivot point in world space. The visual bounds center is at `worldPos + rotate(offsetX*scaleX, offsetY*scaleY, rotation)` where `offset = (size.offsetX, size.offsetY) + pivotOffset` (see `hitTest.ts:aabbOf:80-123`).

Inverse used in renderer constraints + IK: `relativeTransform(world, parentWorld)` (`worldTransform.ts:246-262`) — guarded for zero scale.

### 2.3 SceneRenderer's evaluated world transform

`#engineWorldTransform(nodeId, time)` (`sceneRenderer.ts:1085-1102`) reconstructs the chain via `engine.getNode` + `chain.reverse()` and calls `composeChain(chain, link => engine.evaluateNode(link.id, time, scratch).transform)` with IK rotation overrides patched (`sceneRenderer.ts:1097-1101`). This is the exact function `refreshDeformedMeshSizes` uses for every bone and every mesh node (`sceneRenderer.ts:323,333,373`). Its caller counterpart in the compositor is `EvaluatedWorldTransformSource` (`worldTransform.ts:57-211`) which adds preview positions, IK overrides, and constraint application — what `Renderer` threads into selection/hitTest (`renderer.ts:232-242`). For shadows, any BBox-to-world projection must reuse this evaluated world path, not the stored `worldTransformOf`.

### 2.4 Why this matters for shadows

- A shadow offset in **group-local** space vs **world** space gives different results under rotated parents. Spec says offset animatable; decide space: group-local (apply to shadow container as sibling under same parent so it inherits parent worldTransform) vs world-offset (apply as post-transform translation). Per-group sibling-under keeps offset in parent space automatically, which matches group-attachment semantics.
- Scale composes multiplicatively: a shadow placed inside the group container would inherit `group.scale`, doubling squash. Sibling-under avoids double-scale — shadow scale is independent.
- `composeChain` being pivot-free means `worldTransform.position` is always the pivot point; BBox center is offset from it. If shadow BBox is derived from `#sizes` (whose `offsetX/offsetY` is mesh center or text/size half — see §4), the world-space AABB must add the `offset*scale` + rotation term as `hitTest.aabbOf` does. Getting this wrong shears the shadow texture.

---

## 3. BBox sizing — per-node-type source of truth

### 3.1 Where `#sizes` comes from

`#sizes: Map<string, WorldSize>` (`sceneRenderer.ts:129`) where `WorldSize = {width, height, offsetX?, offsetY?}` (`worldGeometry.ts:1-6`). Written in exactly four places:

- `#recordSize(node, container)` (`sceneRenderer.ts:1219-1272`) — at `#addNode` time.
- `handleMeshChanged` raw mesh BBox fallback (`sceneRenderer.ts:486-504`) + `refreshDeformedMeshSizes`.
- `handleCircleChanged` radius*2 + `refreshDeformedMeshSizes` (`sceneRenderer.ts:508-558`).
- `refreshDeformedMeshSizes` (`sceneRenderer.ts:313-392`) — per-frame for meshes and circles.

Read everywhere else: `nodeSize(nodeId)` (`sceneRenderer.ts:184-186`), `Renderer`'s selection/mesh overlays (`renderer.ts:244-266`), `hitTest` (`hitTest.ts:26-60`), and the shadow would reuse it for texture sizing.

### 3.2 Non-deforming nodes (size is exact at creation)

- **Text** (`sceneRenderer.ts:1246-1253`, `textRenderer.ts:63-67`): `measureText` estimates `width = max(content.length * fontSize * 0.6, fontSize)`, `height = fontSize * 1.2` (`textRenderer.ts:87-92`), stored via `textSizeByContainer` (`textRenderer.ts:11,18,65`) and retrieved as `textSizeOf(placeholder)` (`sceneRenderer.ts:1248-1249`). When inside a table cell, wrapped with `padding + size/2` offset (`sceneRenderer.ts:1249-1250`, `1427-1443`). `handleTextChanged` rebuilds via `rebuildText` + re-measures (`sceneRenderer.ts:624-647`).
- **Table** (`sceneRenderer.ts:1220-1229`, `tableRenderer.ts:191-200`): `tableSizeOf(placeholder)` from `tableSizeByContainer` set by `populateTable` as `layout.totalWidth/Height` (`tableRenderer.ts:192-196`). `DEFAULT_TABLE_WIDTH = 400` (`tableRenderer.ts:7`). Child cells have `tableChildSizeOf` (`tableRenderer.ts:11,21,30-39`). Evaluated table state (animated `borderRadius`/`padding`) re-creates layout via `rebuildTableWithEvaluated` (`sceneRenderer.ts:981`, `tableRenderer.ts:111-131`).
- **Chart** (`sceneRenderer.ts:1239-1244`, `chartRenderer.ts:10-11`): constant `CHART_DEFAULT_WIDTH=400`, `CHART_DEFAULT_HEIGHT=300`, pivot centered (`chartRenderer.ts:41`).
- **Bone** (`sceneRenderer.ts:281-294`, `placeholder.ts:136-144`, `nodeRenderer.ts:173-198`): `setBoneSize(group, len, 10, len/2, 0)` at creation + on `handleTransformChanged` (`sceneRenderer.ts:289-290`). Width = length, height = 10, offset = half-length. No animation beyond bone length.
- **Ghost** (`nodeRenderer.ts:200-227`, `placeholder.ts:136`): `setBoneSize(group, 24, 24, 0, 0)` — never changes.
- **AssetPlaceholder / Sprite** (`placeholder.ts:29-60,120-134`): `body.width/height = PLACEHOLDER_WIDTH 160 / PLACEHOLDER_HEIGHT 100` (`placeholder.ts:14-15`) until a real texture loads, which then snaps to `texture.width/height` (`placeholder.ts:104-105`, `sceneRenderer.ts:1314-1318`). Used for plain asset instances with no mesh.
- **Circle (static)** (`sceneRenderer.ts:1254-1265`, `circleComponent.ts:189-195`): at `#recordSize`, `width = height = radius*2`, `offset 0,0`. Pivot scaled via `applyPivotWithSize` (`sceneRenderer.ts:1263`).
- **Mesh (static fallback before deformation)** (`placeholder.ts:146-154`, `nodeRenderer.ts:244-258`): min/max over `mesh.vertices` BBox, stored via `setMeshPlaceholderSize` (`nodeRenderer.ts:258`). Fallback in `handleMeshChanged` if not yet deformed (`sceneRenderer.ts:492-503`).

### 3.3 Deforming nodes — the per-frame BBox

`refreshDeformedMeshSizes()` (`sceneRenderer.ts:313-392`) is the only per-frame geometry-correct BBox pass. It:

1. Collects bone world transforms at current `time` via `#engineWorldTransform` (`sceneRenderer.ts:320-326`);
2. For each mesh node, resolves `effectiveMeshForPreview` (shapePreview override) or `engine.evaluateMeshDeformation(node.id, time, bones, meshTransform)` (`sceneRenderer.ts:331-342`), then `applyMeshVertices(container, vertices)` (`sceneRenderer.ts:344`) to push deformed vertices to the Pixi `MeshSimple`, and computes `min/max` over `deformedVertices` to set `this.#sizes` with `{width: maxX-minX, height: maxY-minY, offsetX: (minX+maxX)/2, offsetY: (minY+maxY)/2}` (`sceneRenderer.ts:346-358`);
3. Same for circles: `engine.evaluateCircle` → `generateCircleMeshData` → `evaluateMeshDeformation` with same bone map (`sceneRenderer.ts:360-391`), updating both vertices and `#sizes`.

Key details:

- `effectiveMeshForPreview` (`sceneRenderer.ts:94-115`) checks `useShapePreviewStore` (`shapePreviewStore.ts:1-19`) and if `previewNodeId === nodeId && previewShapeId`, substitutes `shape.vertices` as the rest mesh before deformation. This is the morph-preview wiring for the sculpt tool — shadow BBox must honor the same override or the preview shadow will lag.
- `engine.evaluateMeshDeformation` (`engine/internal.ts` delegates to `meshDeformationEvaluator.evaluateMeshDeformation`) if bound, otherwise is a no-op. The evaluator (`meshDeformationEvaluator.ts:40-108`) handles `boneWeights` + `bindPose` composition; without weights it returns `mesh.vertices` unchanged (`meshDeformationEvaluator.ts:51-53`).
- **Morph-then-bones** (`meshDeformationEvaluator.ts:19-38`, `shape.ts:96-134`, `animationEvaluator.ts:260-301`): the canonical order is `resolveMorphedVertices` (lerp between two shapes at `coefficient`) then `evaluateMeshDeformation`. `AnimationEvaluator.evaluateMorphVertices` (`animationEvaluator.ts:260-301`) implements clip-layered morph (last-wins) plus cross-blend between differing shape pairs (`shape.ts:238-262`). `sceneRenderer.refreshDeformedMeshSizes` currently does **not** call the morphed path — it calls `engine.evaluateMeshDeformation` which today does **not** internally lerp shapes; the pending `research/morph-brush` patch introduces `evaluateMorphedMeshDeformation` (`meshDeformationEvaluator.ts:19-38`) as the atomic wrapper. Until that lands, shadows that union `mesh.vertices` without morph will be wrong for morphing characters.
- Circle deformation also goes through the same `evaluateMeshDeformation` (`sceneRenderer.ts:375`), so bone-influenced circle arcs (if a circle gains boneWeights) still work.

### 3.4 World AABB of a subtree (shadow texture extent)

For a shadow that unions **all casters** in a group's subtree, the texture extent is the union of per-caster world AABBs. The canonical AABB helper is `hitTest.aabbOf` (`frontend/src/pixi/renderer/hitTest.ts:80-123`) which:

- expands half extents by `transform.scale` (`hitTest.ts:90-91`),
- rotates four corners by `transform.rotation` (`hitTest.ts:92-98` or `hitTest.ts:103-115` for pivot),
- returns `{minX,minY,maxX,maxY}`.

`worldAabbOf` (`hitTest.ts:62-78`) adds the size lookup + node pivot. `rectOf/expandRect/mergeRect` (`worldGeometry.ts:35-64`) are trivial combinators: `expandRect(rect, margin)` adds uniform margin, `mergeRect(a,b)` is componentwise min/max.

The shadow texture sizing would therefore be:

```
let union: WorldRect | null = null;
for (node of walkPreOrder(groupNode))
  if (shouldCast(node))
    union = union ? mergeRect(union, worldAabbOf(scene, node.id, sizes, transformOf)) : aabb;
pad = ceil(blur * K + extra); // K ~2..4, see research/shadow-pixi-findings.md
rtRect = union ? expandRect(union, pad) : null;
```

`shouldCast` includes `isGroupNode` exclusion, component exclusions (bone/ghost/camera/tableRow never cast), `node.visible` + `evaluateVisible` + `node.opacity * material.opacityMultiplier > epsilon`, and the proposed `castShadow` flag. None of those flags exist today — they would be new per-node fields/JSON.

Blur padding must be added at the **RenderTexture** level, not just as `BlurFilter.padding`, because the RT itself is bbox-sized (`research/shadow-pixi-findings.md:240-253` describes this pitfall).

---

## 4. Subtree silhouette: what to include, what to sample

### 4.1 Shadow source model (proposed, grounded in current code)

The ticket's preferred model is `Source: Children` / `Entire hierarchy` + per-object `Cast Shadow` bool, one shadow per group node.

Mapping to today:

- "Group" = `isGroupNode(node)` (`sceneNode.ts:172`), or any node with children if bone/ghost shadows are wanted.
- "Entire hierarchy" = `walkPreOrder(group)` includes the group itself; but a pure group has no drawable placeholder, so it contributes nothing — equivalent to Children.
- "Children" = `for (const child of group.children) walkPreOrder(child)`.
- `Cast Shadow` = new per-node property (likely on `SceneNode` or `MaterialInstance`, default true for mesh/circle/text/chart/table, false for bone/ghost/camera/tableRow). No such field exists today; closest precedent is `node.visible` (`sceneNode.ts:44`) which is per-node and already evaluated via `evaluateVisible` with hold interpolation. Shadow casting would be a static bool (not animated) or a future `visible`-like track — spec defers.

Engine traversal to collect casters would reuse `walkPreOrder` (`sceneNode.ts:379`, `sceneRenderer.ts:234,307,321,327`). A minimal shadow collector:

```ts
function* castersOf(group: SceneNode, castFlag: (id:string)=>boolean): IterableIterator<SceneNode> {
  for (const n of walkPreOrder(group)) {
    if (n === group) continue; // group itself has no pixels
    if (n.components.bone || n.components.ghost || n.components.camera || n.components.tableRow) continue;
    if (!castFlag(n.id)) continue;
    // visibility/opacity gating via evaluated state (see §6.1)
    yield n;
  }
}
```

### 4.2 What contributes alpha

Per-kind, the placeholder contributes pixels via:

- **Mesh / Circle**: `MeshSimple` with `vertices` (deformed), `uvs` (possibly transformed via `applyUVTransformToContainer` → `transformedMeshForNode` → `applyUVTransformToUVs` (`nodeRenderer.ts:405-467,494-563`)), `texture` (real or 1x1 placeholder), tint (`placeholder.ts:79-84`). Alpha comes from texture sample × `container.alpha`.
- **Text**: `PixiText` with fill `0xffffff` tinted via `text.style.fill = hexColorToTint(tint)` (`textRenderer.ts:55-61`), measured via `measureText` (`textRenderer.ts:87-92`). Alpha is `container.alpha`.
- **Table / TableCell**: `Graphics` rect/roundRect fill + stroke (`tableRenderer.ts:60-69,208-220`); alpha likewise `container.alpha`. `tableCell` containers are special-cased to parent under the table placeholder, but their `container.alpha` still propagates.
- **Chart**: `Sprite` sampling an SVG-derived `Texture` (`chartRenderer.ts:39-50,67-81`) re-rasterized via `svgToPixiTextureAsync` (`svgToPixiTexture.ts:1-54`). `sprite.texture` is swapped on `rebuildChartTexture`; `container.alpha` propagates.
- **Asset instance (non-mesh)**: `Sprite` at `bodyByGroup` (`placeholder.ts:19,33-37,99-114`), `tint` via `body.tint`, `alpha` via `container.alpha`.

All paths share `container.alpha = state.opacity * material.opacityMultiplier` (`sceneRenderer.ts:1016`, `nodeRenderer.ts:119`) and `container.visible = state.visible` (`sceneRenderer.ts:1024`).

### 4.3 Deformed / morphed vertices: which BBox matters

Two options for silhouette geometry:

- **Post-deformed, post-morphed world vertices** — the pixels you actually see — computed by `evaluateMorphedMeshDeformation` (`meshDeformationEvaluator.ts:20-38`) then `localToWorld` via `meshWorldTransform` (`deformedMeshWorld.ts:9-44`, `sceneRenderer.refreshDeformedMeshSizes:340-341`). This is correct for bone-animated and shape-morphing characters.
- **Pre-deformed rest vertices** — `mesh.vertices` directly — would freeze shadows while bones/morph animate, which is wrong for shadows cast by moving limbs.

The current `refreshDeformedMeshSizes` is already post-deformed for bones; morph is the gap. A shadow BBox that unions `placeholderSize` or raw `mesh.vertices` without calling `evaluateMeshDeformation`/`evaluateMorphedMeshDeformation` would be stale the moment the character moves. The silhouette itself (render to RT) sidesteps this if it re-renders the **live Pixi containers** — those already have `displayMesh.vertices = flattenVertices(deformedVertices)` applied each tick. But a separate computed BBox for RT sizing still needs the deformed arithmetic, or it should simply call `container.getBounds()` on the live tree (which reflects deformed vertices without manual math) — see note in `research/shadow-pixi-findings.md:464`.

### 4.4 Shader and filter interaction: pre-shader vs post-shader alpha

- **Per-node shader filters** (`nodeShader.ts:39-58`, `sceneRenderer.render`: `placeholder.filters = [filter]` at `sceneRenderer.ts:1169`) operate on the placeholder's output. `createNodeShaderFilter` builds a `Filter` with `GlProgram` from `shader.source` plus sampler bindings (`samplerBinding.ts:16-45`, `sceneRenderer.ts:1157-1169`). If silhouette renders the live subtree **with** its filters, then a node that modulates alpha in the fragment (e.g. dissolve, erasing) will naturally erase its shadow — arguably correct. But if a filter adds a glow or tints, the shadow should ignore that decoration and remain a solid silhouette.

- **Fullscreen pass** (`fullscreenPass.ts:34-179`) composites the entire `world` container through a single filter onto a stage quad. The shadow is inside `world`, so it would also be filtered by the fullscreen shader. That is likely desired (shadow darkens consistently with scene grading), but the silhouette render step must not double-apply the fullscreen shader.

Recommendation: silhouette samples **pre-shader** alpha for mesh/text/chart/table (white-material / color-matrix pre-pass), treating node `filters` as non-shadow. Two equivalent ways:

- Clone subtree, strip `placeholder.filters = []`, force `tint = 0xffffff` + `alpha = 1` and render into RT; or attach a one-line white-alpha filter `gl_FragColor = vec4(1,1,1, texture(uTexture, vUv).a)` (pre-multiply aware — see `research/shadow-pixi-findings.md:434-439`).
- Sampling **post-shader** alpha would require rendering with filters intact, which bakes glows into the shadow — undesirable for a clean contact shadow.

The current `applyFilterUniforms` path also feeds `uTime` (`nodeShader.ts:65-72`, `materialResolution.ts:115-117`) — if silhouette used filtered alpha, it would need the same `uTime` value as preview. Pre-shader avoids this coupling.

For Video Export determinism (`CONTEXT.md` Video Export), the same choice must be made in the offscreen export compositor; both must sample the same alpha.

---

## 5. Layering — where the shadow sits in the tree

### 5.1 Two strategies

**A. Per-group shadow container as sibling-under (recommended least-invasive):**

```
world
 ├─ groupA_container (zIndex from children order)
 │   ├─ placeholder (mesh/text/etc.)
 │   └─ children ... (walkPreOrder)
 ├─ groupA_shadowContainer  ← new PixiContainer label='shadow:<groupId>'
 │   └─ shadowSprite (texture=RT, tint=shadowColor, alpha=shadowOpacity, filters=[BlurFilter])
 └─ groupB_container
```

Shadow container is a **sibling** of the group container, added to the **same parent** (`parentContainer ?? world`) at index `parent.children.indexOf(groupContainer)` (i.e. immediately before the group) using `parent.addChildAt(shadowContainer, shadowIndex)` (`sceneRenderer.ts:473-474` / `535-537` show the `index` + `addChildAt` pattern for rebuilds). Parent's `sortableChildren = true` is already used for tables (`tableRenderer.ts:88`, `nodeRenderer.ts:39`) — shadows would also need `parent.sortableChildren = true` and a `zIndex` baked low (e.g. `groupContainer.zIndex - 0.5` or a fixed `shadowZIndex = -1` with `groupChildren zIndex >=0`). `handleNodeOrderChanged` (`sceneRenderer.ts:831-865`) rebuilds sibling order by iterating `parent.children` via `parent.children.indexOf(ordered[0])` and reinserting — a shadow container attached to `parent` but not inside `parent.children`'s logical node list would be swept. Fix: participate shadow in that reorder, or store sibling shadows in a sibling overlay that itself is re-sorted.

**Why sibling-under:**

- Inherits parent worldTransform (so group-local `offset` composes correctly) without inheriting `group.scale/rotation/skew` — shadow squash is independent.
- `group.visible = false` must also hide its shadow; sibling doesn't auto-hide. The renderer already has `applyEvaluatedState` toggling `container.visible` (`sceneRenderer.ts:1020`, `nodeRenderer.ts:120`) — shadow visibility must mirror it at the same call site.
- `group.alpha` multiplication: sibling doesn't inherit `group.alpha`; shadow alpha must incorporate `effectiveAlpha = product(chainAlpha)` or at least `state.opacity * opacityMultiplier` of the group chain. Could bake into `shadowSprite.alpha = state.opacity * opacityMultiplier * shadowOpacity`.
- Respects `zIndex` / `sortableChildren` already in use for table cells (`nodeRenderer.ts:42`) and table outer (`tableRenderer.ts:88`).

**B. Global shadow layer (single Container under world):**

```
world
 └─ shadowsLayer (zIndex = -100)
      ├─ shadowA_Sprite (tied to groupA worldTransform)
      └─ shadowB_Sprite
world
 ├─ groupA_container ...
 └─ groupB_container ...
```

One `PixiContainer` for all shadows, sorted behind every group. Simpler lifecycle (one layer, not per parent), but:

- Shadows must explicitly track world position: `shadowSprite.position = evaluatedWorldTransformOf(groupId) + offset` each frame — re-implementing `composeChain` logic at sprite level.
- z-order between shadows and interleaved groups (A behind B behind C, but shadows of C shouldn't appear behind A) is wrong unless the global layer sorts shadows by the same order as groups and interleaves rendering — at which point you have reimplemented per-group layering.
- Table special-parent (`tableCell` under table placeholder) makes global positioning harder for table-contained text.

Global layer is viable only if all shadows render behind the entire scene (flat backdrop). The ticket's "composites beneath the group's subtree" implies sibling semantics, so **per-group sibling-under** is the correct first implementation; global layer is the second-pass simplification if per-parent adoption proves brittle.

### 5.2 Insertion point in Pixi hierarchy

The present injection point is `SceneRenderer.#attachToParent` (`sceneRenderer.ts:1350-1354`). Shadow containers must be attached at the same level:

```ts
// inside shadow manager, for groupId:
const group = engine.getNode(groupId);
const groupContainer = this.#containers.get(groupId)!;
const parent = group.components.tableCell ? this.#owningTable(group) : group.parent;
const parentContainer = parent ? this.#containers.get(parent.id) ?? null : null;
(parentContainer ?? this.#world).addChildAt(shadowContainer, siblingIndex);
```

When `group` is reparented (`NodeReparented` → `handleNodeReparented` at `sceneRenderer.ts:820-829` / `renderer.ts:807-809`), shadow must reparent likewise. When `group` children reorder (`NodeOrderChanged` → `handleNodeOrderChanged` at `sceneRenderer.ts:831-865`), shadow index must be restored. When `group` is removed (`NodeRemoved` → `handleNodeRemoved` 252-276), walkContainers cleanup must destroy shadow.

If shadow lives inside a table cell subtree, the same `tableCell` indirection applies (`sceneRenderer.ts:1351`). A group whose parent is a `tableCell` indirectly parents through the owning table placeholder — shadow must follow.

---

## 6. Dirty strategy — when to re-render the silhouette & resize the texture

### 6.1 What already has dirty gating

`SceneRenderer` already avoids redundant work via three families of hashes/state:

- `#lastEvaluated: Map<string,EvaluatedNodeScratch>` (`sceneRenderer.ts:130`) compared via `evaluatedStatesEqual` (`animationEvaluator.ts:69-88`, consumed at `sceneRenderer.ts:1006-1014`). Early-out guards `applyEvaluatedState` and material/Shader changes.
- `#lastMaterials: Map<string,EffectiveMaterialScratch>` tint/opacityMultiplier compare (`sceneRenderer.ts:1009-1012`).
- Component hashes: `#tableComponentHashes`, `#chartComponentHashes`, `#textComponentHashes`, `#circleHashes`, `#tableHashes` (`sceneRenderer.ts:135-139`) gating `handleTextChanged`/`handleTableChanged`/`handleChartChanged`/`handleCircleChanged` and intra-`#evaluateAndApply` branches (`sceneRenderer.ts:912-995`).

None of these track shadow.

### 6.2 Shadow dirty flag model

Per-group shadow carries:

```
#shadows: Map<groupId, ShadowState> where ShadowState = {
  container: PixiContainer, sprite: PixiSprite, rt: PixiRenderTexture,
  blurFilter: BlurFilter | null,
  lastCasterHash: string,      // combined hash of subtree caster transforms/opacity/visibility/mesh/morph
  lastParamHash: string,       // shadow params (offset/scale/skew/rotation/blur/opacity/color, animatable)
  lastBBox: WorldRect | null,  // for texture sizing
  lastPad: number,
}
```

Dirty is true if **any** of:

- **Caster world transform changed** — any node in `castersOf(group)` whose `evaluateNode` result changed. Checked at `handleTransformChanged(nodeId)` (`sceneRenderer.ts:278`) and in the `handleTimeChanged` loop (`sceneRenderer.ts:307-308`). The `evaluatedStatesEqual` early-out is `false` precisely when transform/opacity/visible changed — reuse it.
- **Opacity / visibility** — `handleVisibilityChanged` (`sceneRenderer.ts:767-772`), `handleVisibleTrackChanged` (`sceneRenderer.ts:774-776`), `handleOpacityChanged` (`sceneRenderer.ts:789-791`), and clip instance events (`renderer.ts:862-870`) that all funnel through `handleKeyframeChanged` → `#evaluateAndApply`. Must mark owning group's shadow dirty when a caster's evaluated state changed.
- **Mesh/circle/table/text/chart geometry** — `handleMeshChanged` (`sceneRenderer.ts:455-506`), `handleCircleChanged` (`sceneRenderer.ts:508-558`), `handleTableChanged` (`sceneRenderer.ts:560-607`), `handleTextChanged` (`sceneRenderer.ts:624-647`), `handleChartChanged` (`sceneRenderer.ts:609-622`), and `ChartChanged` via `rebuildChartTexture` async (`chartRenderer.ts:67-81`). Also bone-driven size changes via `refreshDeformedMeshSizes` (`sceneRenderer.ts:313-392`).
- **Morph / bone deformation** — `shapePreviewStore` subscription (`sceneRenderer.ts:174-181`) calls `refreshDeformedMeshSizes` then re-evaluates all meshes; morph clip keyframes flow through `evaluateMorphVertices` (`animationEvaluator.ts:260-301`) and the pending `evaluateMorphedMeshDeformation` (`meshDeformationEvaluator.ts:20-38`). A shadow should mark dirty in `refreshDeformedMeshSizes` after vertices are applied, and the time-changed morph track should produce a hash change.
- **Shadow param changes** — any shadow property animation track or static override change (future `ShadowChanged` engine event, or material-like `Keyframes` for offset/blur/etc.). Until a real engine event/type exists, the shadow manager can store `lastParamHash` built from `JSON.stringify(shadowParams)` plus `uTime` samples; an animated shadow would compare `engine.evaluateNode(groupId, time, scratch)` for a hypothetical shadow-channel if it were a `MaterialParameter` — or, more pragmatically, re-hash every frame when `handleTimeChanged` fires, and early-out if hash equal.
- **Clip layering** — `ClipInstanceAdded/Removed/EnabledChanged/TimeChanged/SpeedChanged/ParamOverridden/LayerMoved` (`events.ts:198-239`, consumed at `renderer.ts:862-870`) all call `handleKeyframeChanged` today. Morph clip channels (`morphAnimation` in `clipDefinition`) would need the shadow dirty to fire through the same handler even if the group's own transform hash hasn't changed.

The cheapest correct implementation is **frame-coherent dirty, not event-driven**: at `handleTimeChanged`, loop over every group with a shadow, rebuild a compact hash of its caster subtree sliced to the fields shadow cares about (world `x,y,rotation,scaleX,scaleY`, `opacity*opacityMultiplier`, `visible`, deformed AABB hash, morph coefficient hash, shadow param hash), compare to stored, and only `resize RT + render silhouette` on mismatch. Event-driven per-`handleTransformChanged` can refine this to avoid O(groups * subtree) per tick when playback is paused — mark `shadowDirty.add(ancestorGroupId)` inside `handleTransformChanged`/`handleOpacityChanged`/… by climbing `node.parent` until a shadow-owning ancestor is found, then flush in the same microtask.

For N=10–20 shadow groups with M≈20 casters/group, the full per-frame hash scan is ~200 evaluated-node lookups — affordable at 60fps, but worth coalescing with the existing `handleTimeChanged` loop (`sceneRenderer.ts:307-309`) so `evaluateNode` is not called twice.

### 6.3 Least-invasive hook ledger

| Hook | File:line | When fired | What shadow must do |
|------|-----------|------------|---------------------|
| `bind(scene, slideId)` | `sceneRenderer.ts:214` | Scene/slide switch, project load | Create/destroy all group shadow containers + RTs; `resize` + `clear` each RT; seed hashes |
| `handleNodeCreated(nodeId)` | `sceneRenderer.ts:240` | `NodeCreated` | If `isGroupNode(newNode)` optionally auto-create `ShadowState`; if new node is a caster under an existing group shadow, mark ancestor group dirty (in its parent chain) |
| `handleNodeRemoved(nodeId)` | `sceneRenderer.ts:252` | `NodeRemoved` | If removed node owned a shadow, destroy its RT/sprite/filter; if it was a caster, mark ancestor group dirty and (for table) reflow as `handleNodeRemoved` does (`sceneRenderer.ts:273-275`). Remove from `walkContainers` maps to avoid leaking shadow keys |
| `handleTransformChanged(nodeId)` | `sceneRenderer.ts:278` | `TransformChanged` | Re-evaluate one node (already does) + climb to shadow-owning ancestors and set `shadowDirty`; call `refreshDeformedMeshSizes` afterward which already pushes deformed vertices to Pixi |
| `handleKeyframeChanged(nodeId)` | `sceneRenderer.ts:297` | Any `Keyframe{Added,Moved,ValueChanged,InterpolationChanged,TangentsChanged}` (node tracks) incl. `morph`/`visible`/`circle`/`table` | Same as TransformChanged; additionally if `kind==='morph'` or `kind==='visible'` guarantee shadow dirty for that caster's group |
| `handleTimeChanged()` | `sceneRenderer.ts:302` | Playhead change, scrub, playback tick (`renderer.ts:748` + `renderer.ts:217` subscription) | Full pass: for each shadow group compute caster hash vs `lastCasterHash`; for shadow param tracks compute `lastParamHash`; if dirty or `time` advanced, recompute BBox via `worldAabbOf` + `mergeRect` + `expandRect(pad)` and call `RT.resize()` if needed, then `app.renderer.render({container: silhouetteClone, target: rt, clear:true, clearColor:0x00000000})`, finally update `sprite.texture = rt`, `sprite.tint/color`, `sprite.alpha=shadowOpacity`, `sprite.filters=[BlurFilter]`, sync `shadowContainer.visible/position/scale/rotation/skew` from evaluated state |
| `refreshDeformedMeshSizes()` | `sceneRenderer.ts:313` | After every `handleTransformChanged`, `handleKeyframeChanged`, `handleMeshChanged`, `handleCircleChanged`, `handleTimeChanged`, shape preview (`sceneRenderer.ts:174-175`), IK (`renderer.ts:763`), constraints (`renderer.ts:764`) | Bones/morph already applied to display meshes and `#sizes`; shadow containers do not need a separate `applyMeshVertices` call if they re-render the live containers. But the computed BBox for RT sizing must reflect the deformed vertices — either by re-hashing post-deform (`#sizes` changed) or by sampling `container.getBounds()` directly (see `hitTest.aabbOf` vs deform path discussion). Mark shadows dirty for any group whose subtree contains a bone or morphed mesh |
| `shapePreviewStore.subscribe` | `sceneRenderer.ts:174` | Inspector morph preview | Already forces `refreshDeformedMeshSizes` + mesh re-eval; hook shadow dirty the same way (treat as morph binding change) |
| `handleMaterialChanged(nodeId)` | `sceneRenderer.ts:424` | `MaterialAssigned`/`MaterialParameterChanged` | Material tint/opacityMultiplier affects live silhouette tint? Pre-shader silhouette ignores material tint (white), but opacityMultiplier still modulates overall alpha — shadow dirty if caster's `opacityMultiplier` changed and we include opacity in hash. Also if the shadow's own material (color/opacity) is stored as a material parameter |
| `handleMeshChanged` / `handleCircleChanged` | `sceneRenderer.ts:455`, `508` | `MeshChanged`/`CircleChanged` | Source geometry hash changed → ancestor group shadow dirty; RT size likely changes |
| `handleTextChanged` / `handleTableChanged` / `handleChartChanged` | `sceneRenderer.ts:560`, `609`, `624` | Content/structure change | Same; table rebuild re-sizes cells (`tableRenderer.ts`) |
| `handleOpacityChanged` / `handleVisibilityChanged` / `handleVisibleTrackChanged` | `sceneRenderer.ts:767`, `789`, etc. | Opacity/visibility track | Caster visibility toggles → shadow dirty; `group.visible=false` should hide shadow container as well |
| `handleNodeReparented` / `handleNodeOrderChanged` | `sceneRenderer.ts:820`, `831` | Scene tree structure | Reattach shadow to new parent via `#attachToParent` analogue; restore correct `addChildAt` index; World's `zIndex` re-sort would otherwise orphan shadows |
| `refreshAssetTextures` | `sceneRenderer.ts:1323` | Asset library refresh | Texture load callbacks already call `applyAssetTexture` + `#sizes` update (`sceneRenderer.ts:1288-1320`) — a newly-real texture changes placeholder visual BBox; mark ancestor group shadows dirty for mesh/sprite/texture-bearing nodes |
| `applyIKOverrides` / `applyConstraintOverrides` | `sceneRenderer.ts:394`, `405` | IK drag / constraint solve (`renderer.ts:758-764`) | Post-IK rotations overwrite `container.rotation` after `handleTimeChanged`; shadow world-transform hash must include `IKOverrides` and constraint-derived transforms, not just `evaluateNode` |
| `clearPreview` / `previewTransform` / `previewFullTransform` | `sceneRenderer.ts:705`, `723`, `763` | Drag/preview (selection, move gesture, pivot interaction) | Preview positions bypass engine until commit; shadows should either follow preview (copy `previewPositions` into shadow offset) or remain at last committed position. The `Renderer` threads `previewPositions: Map<string,{x,y}>` (`renderer.ts:107`) into `EvaluatedWorldTransformSource` (`worldTransform.ts:60-81,192-210`). If shadows use `transformSource.transformOf` they already incorporate preview |

Missing events that a real shadow feature would need but that do not exist today: `ShadowEffectAdded`/`Removed`/`ParamChanged` (or reuse `MaterialParameterChanged` on a per-group `ShadowComponent`). Without an explicit engine model for shadows, the manager must infer change from a secondary store (new `shadowStore`) or from a per-group `components.shadow` check in `handleNodeCreated`/poll on `handleTimeChanged`.

---

## 7. Texture lifecycle — how to own `RenderTexture` inside `SceneRenderer`

### 7.1 What today's renderer does for textures

- **Pixi shim** (`frontend/src/pixi/renderer/pixi.ts:1-86`): re-exports `RenderTexture` via `realPixi.RenderTexture.create` (`pixi.ts:47-52,69-70`). The shadow needs `BlurFilter` as well — not currently exported (`pixi.ts:1-13` only exports `Application,Assets,Container,Filter,GlProgram,Graphics,MeshSimple,RenderTexture,Sprite,Text,Texture`). Adding `BlurFilter` is a one-line export change, as noted in `research/shadow-pixi-findings.md:470-487`.
- **TextureCache** (`frontend/src/pixi/renderer/textureCache.ts:10-144`): per-key placeholder + real texture + async `Assets.load`; not used for RenderTextures but its `placeholderColor`/`toRgb`/`hslToHex` show the 1×1 fallback pattern the shadow should not reuse.
- **Asset loading race** (`sceneRenderer.ts:1288-1320`): awaiting texture load guards with `currentTextureId !== definitionId` and `container.destroyed`. A shadow silhouette rendered before a caster's real texture resolves (still 1×1 placeholder) will be too small; shadow must either (a) mark dirty again when `applyAssetTexture` lands, or (b) re-hash on `refreshAssetTextures` (`sceneRenderer.ts:1341`).

### 7.2 Reference implementation to mirror — `FullscreenPass`

`FullscreenPass` (`frontend/src/pixi/renderer/fullscreenPass.ts:34-180`) is the repo's single canonical user of an offscreen RT:

```
#activate: RenderTexture.create({width:1,height:1,dynamic:true}) + container+target pair + Sprite(quad)
resize(w,h): texture.resize(w,h) if changed; quad.width/height = w/h
renderFrame: scene.visible=true; renderScene(options); scene.visible=false
#deactivate: quad.filters destroy, quad destroy, texture destroy
destroy: deactivate + texture destroy
```

`Renderer` injects `renderScene: (opts)=>app.renderer.render(opts)` (`renderer.ts:190-191`, type `RenderSceneToTexture` `fullscreenPass.ts:20-23`). `Renderer.#tick` (`renderer.ts:605-657`) calls `fullscreenPass.resize(w,h)` + `fullscreenPass.renderFrame()` each tick before devOverlay (`renderer.ts:641-644`). At init, `world` is `new Container` (`renderer.ts:176-178`), `camera` wraps it, `grid` is drawn behind axis lines, `app.stage.addChild(world)`.

Shadow should reuse the same injection: `SceneRenderer` constructor gains `(renderScene: RenderSceneToTexture) => void` or reads `app.renderer` via the shim. The per-group RT reuses the `resize` pattern (only call `texture.resize` when BBox+pad changed) and the deactivate pattern (`container.destroy({children:true})`, `rt.destroy()`, `filter.destroy()`). Never allocate a new RT per frame — `RenderTexture.create` pool is managed by Pixi.

### 7.3 Sizing + blur bleed

`BlurFilter` (to be imported) has `strength`, `quality`, `kernelSize`, `repeatEdgePixels`, `padding` (`research/shadow-pixi-findings.md:214-227`). Filter padding expands the **filter pass** allocation, not the source RT. If RT is tight to AABB, filter samples off-texture and clamps to transparent — halo truncated. Correct fix is RT padding:

```ts
const pad = Math.ceil(shadowBlur * 2 + 4); // or strength*0.5*quality + kernelSize heuristic; tune per spec
const rtW = Math.max(1, Math.ceil(worldAABB.width  + pad*2));
const rtH = Math.max(1, Math.ceil(worldAABB.height + pad*2));
if (rt.width !== rtW || rt.height !== rtH) rt.resize(rtW, rtH);
// render silhouette centered at (pad, pad) inside RT
silhouette.position.set(pad - worldAABB.minX, pad - worldAABB.minY);
```

`worldGeometry.expandRect(rect, margin)` (`worldGeometry.ts:48-55`) already implements the margin arithmetic — reuse it for `expandRect(aabb, pad)` with optional clamping to a max cap (1024/2048 to avoid 16 MP allocations at large blur).

Premultiplied alpha caveat: RT's `source.alphaMode` is `premultiply-alpha-on-upload` by default in v8; a white-alpha filter must write `vec4(a,a,a,a)` not `vec4(1,1,1,a)` — `research/shadow-pixi-findings.md:434-439` covers the fragment. Rendering with `clearColor: 0x00000000` (transparent) is required; default clear is canvas background white (`renderer.ts:640`).

### 7.4 Destroy ordering

Mirror `FullscreenPass#destroy` (`fullscreenPass.ts:140-146`) and `Renderer.dispose` (`renderer.ts:535-602`):

```
shadowSprite.destroy()
shadowContainer.destroy({children:true})   // if it held the sprite + filter
blurFilter.destroy()                      // after sprite.filters cleared
rt.destroy()                              // last — GPU free
```

On `SceneRenderer.bind(null)` (`sceneRenderer.ts:214-221` already destroys every container and clears all maps) extend to also destroy every entry in `#shadows`. On `handleNodeRemoved`, destroy the dead group's shadow if the removed node owned it, and prune shadows whose group was inside the removed walk (`walkContainers` walk `sceneRenderer.ts:1447-1457`).

---

## 8. Compositing interaction — filters, tables, charts, IK

### 8.1 Node shader filters (`frontend/src/pixi/renderer/nodeShader.ts`)

Per-node filters sit on `placeholder.filters = [filter]` (`sceneRenderer.ts:1169`). `bindFilterSamplers` (`samplerBinding.ts:16-45`) swaps sampler `TextureSource` placeholders. If silhouette cloned the live placeholder containers, it would carry their filters unless explicitly cleared. Recommendation (§4.4): clone and set `placeholder.filters = []` before rendering into RT — shadow is geometric, not filtered.

### 8.2 Fullscreen shader (`fullscreenPass.ts`, `renderer.ts:184-196,641-645,928-938`)

`Renderer.#syncFullscreenShader` (`renderer.ts:928-938`) resolves `slide.fullscreenShader` via `resolveFullscreenShaderState` (`fullscreenPass.ts:188-210`) into `fullscreenScratch`. `renderFrame` toggles `scene.visible` (`fullscreenPass.ts:120-122`). Shadow containers are inside `scene` (`world`), so they participate in the fullscreen pass normally. No special handling — shipping.

### 8.3 Table special parenting (`sceneRenderer.ts:1350-1353,1375-1380`)

`tableCell` containers parent to `#owningTable` placeholder, not to `tableRow`. Silhouette walk that uses `node.parent` naively yields wrong container parenting for AABB projection.Shadow manager must replicate `owningTable` indirection both for "collect casters" and for "attach shadow to correct parent container".

### 8.4 Chart rasterization (`chartRenderer.ts:33-81`, `svgToPixiTexture.ts:8-54`)

`rebuildChartTexture` is async (`sceneRenderer.ts:618` `void rebuildChartTexture(...).then(...)`), so `handleChartChanged` updates `#sizes` asynchronously. A shadow that sizes its RT during `handleChartChanged` would be before the texture arrived. Hash after the `.then` callback (where `#onNodeSizeChanged` fires) or dirty-check on `chartComponentHashes` change the next frame.

### 8.5 IK & constraints post-overrides (`sceneRenderer.ts:394-422,1048-1083`, `worldTransform.ts:57-211`)

`applyIKOverrides` (`sceneRenderer.ts:394-403`) patches `container.rotation` from `transformSource.getIKOverrides()` (`renderer.ts:759-761, worldTransform.ts:172-179,101-169`). `applyConstraintOverrides` (`sceneRenderer.ts:405-422, renderer.ts:764`) resolves `worldTransform` via `applyConstraints`. Both run **after** `handleTimeChanged` inside `Renderer.#handleTimeChanged`. A shadow's world AABB must incorporate these patched rotations; calling `transformSource.transformOf(groupId)` after `updateIKOverrides` is the correct source. Polling `engineWorldTransform` alone would miss them.

### 8.6 Preview positions (`renderer.ts:107,282-289,468-484`)

`Renderer` keeps `previewPositions: Map<string,{x,y}>` during drag gestures (`renderer.ts:107`), threaded into `EvaluatedWorldTransformSource#localOf` (`worldTransform.ts:67-81`). If shadows track `transformOf` that includes preview, they move with the drag — desirable for interactive handles. If shadows instead read `engine.evaluateNode` directly, they stall until commit. Decide one way and stay there for export parity.

---

## 9. Stores (`frontend/src/stores/*`) — what exists, what shadow needs

Existing stores (36 under `frontend/src/stores/`):

```
shapePreviewStore.ts:1-19        — previewNodeId/previewShapeId, used by sceneRenderer refreshDeformedMeshSizes (only store today that sceneRenderer subscribes to)
overlayVisibilityStore.ts:1-33   — meshVisible/bonesVisible/ikHandlesVisible/poleHandlesVisible, sceneRenderer.setBonesVisible/setGhostsVisible
selectionStore.ts, uiStore.ts, editingModeStore.ts, playbackStore.ts, timelineViewStore.ts, ...
(no shadow/ambient/ground store exists)
```

`shapePreviewStore` is the template for a new `shadowStore` / `shadowEffectStore`: a zustand store holding `Map<groupId, ShadowParams>` (offset/scale/skew/rotation/blur/opacity/color + optional sourceMode/castFlag overrides) that `SceneRenderer` subscribes to. Constructor pattern to mirror:

```ts
void useShadowStore.subscribe(() => {
  // mark affected groups dirty, or rebuild shadow containers
});
```

No existing store carries per-group effect state; material/chart/text stores are library-level (`materialLibraryStore`, `chart` lives on component). Shadow params would be most parallel to `ShaderDefinition` per-slide overrides or `MaterialInstance` overrides — though simpler to keep as a standalone store until the engine JSON shape (`Project`/`Slide`/`LessonJSON`) gains `shadowEffects` (see spec ticket decomposition).

`useSelectionStore` and `useOverlayVisibilityStore` are already observed by `Renderer` (`renderer.ts:218-229`); shadowing would add a third subscription.

---

## 10. Open issues and risks (not yet ticketed on map #286)

These are the gaps the wayfinder map (§ "Not yet specified", `issues/286`) lists; this section ties each to a concrete code line so the grilling ticket can pick them up:

- **Source picker UX** — "Children vs Entire hierarchy + Cast Shadow" requires a new per-node boolean (`node.castShadow?: boolean`) and JSON field (`NodeJSON` `json.ts:114-126`). No field exists; `sceneNode.ts:37-70` frozen components make adding a top-level field easier than a component. Blocked by: spec decision whether default is `true` for mesh/circle/text/chart/table and `false` for bone/ghost/camera/tableRow.
- **Filter + shadow double-darken** — if silhouette samples post-shader alpha and the group also has a fullscreen shader, the shadow could be tinted twice. Mitigate by ordering: silhouette before fullscreen, filtering after.
- **Many shadows → many filter passes** — each `BlurFilter` with `quality=4` adds 4 render passes (`research/shadow-pixi-findings.md:254-255`). Ten shadows at 1080p with `strength=8` ≈ 80 passes/frame. Budget mitigation: fix `quality=2` for shadows, cap RT resolution by camera zoom, and dirty-skip idle shadows.
- **Max RT cap** — at 4K with blur 32, padded RT could reach ~4K+64px square ≈ 16 MP per shadow. Cap at 1024/2048 and downscale; no cap code exists today.
- **Text/table/circle alpha completeness** — `measureText` heuristic (`textRenderer.ts:87-92`) and table `roundRect` radius clamping (`tableRenderer.ts:223-227`) produce slightly different CPU and GPU bounds; `container.getBounds()` after layout is the GPU truth, `#sizes` is the CPU estimate. For shadow AABB, `getBounds()` is safer if available (requires `container` in-world and `updateTransform` flushed).
- **Async chart texture** — RT sizing must wait for `rebuildChartTexture` promise to settle (`sceneRenderer.ts:618-621`) or it will size to the pre-texture 400×300 placeholder.
- **Deformed+morphpath coverage** — until `evaluateMorphedMeshDeformation` lands (pending `research/morph-brush` merge), shadows for morphing characters will use rest mesh, not blended vertices (`meshDeformationEvaluator.ts:19-38` prototype vs `sceneRenderer.ts:340-341` current `evaluateMeshDeformation` call).
- **HitTest vs SelectionOutline alignment** — `hitTest.aabbOf` (`hitTest.ts:80`) and `selectionOverlay` both use `WorldSize.offsetX/offsetY`; shadowing that derives its own `WorldRect` from the same inputs will align; deriving from raw `mesh.vertices` without `offset` will drift.

---

## 11. Recommended least-invasive implementation plan (for the prototype ticket)

Ordered by invasiveness; steps 1–3 are enough for a throwaway branch that proves the loop; steps 4–5 are correctness polish:

**Step 1 — Shadow state + containers (no RT yet, validates layering):** Add `#shadows: Map<string,{container:PixiContainer,sprite:PixiSprite,rt:PixiRenderTexture|null,filter:PixiFilter|null,lastCasterHash:string,lastBBox:WorldRect|null}>` to `SceneRenderer` (`sceneRenderer.ts:126-139` block). On `bind` (`sceneRenderer.ts:214`) create one per-group shadow container as sibling-under via `parentContainer.addChildAt` (`sceneRenderer.ts:473` pattern). Gate creation on `isGroupNode` or a temporary allowlist. Validate: shadows hide/show in sync with `applyEvaluatedState` by mirroring `container.visible`/`alpha`, reorder correctly with `handleNodeOrderChanged`, reparent with `handleNodeReparented`, destroy with `handleNodeRemoved` walk.

**Step 2 — Per-frame dirty pass (no RT, just color rect to prove BBox):** Add a `#markShadowDirty(groupId)` helper called from every existing dirty entry point (§6.3 table) by walking ancestors of the mutated node until a shadow owner is found. Add `#flushShadowsIfNeeded(time)` invoked from `handleTimeChanged` (`sceneRenderer.ts:302`) and `refreshDeformedMeshSizes` (`sceneRenderer.ts:313`) after the regular work, which computes `casterHash` + `worldAabb` via `worldAabbOf`/`mergeRect`/`expandRect` (`hitTest.ts`, `worldGeometry.ts`) and updates `sprite` tint/alpha/transform/visibility. Use a solid `Graphics` rect as stand-in for the shadow texture.

**Step 3 — RenderTexture silhouette loop (proves the real path):** Inject `renderScene: RenderSceneToTexture` into `SceneRenderer` constructor (`fullscreenPass.ts:20-23` reference). For each dirty group: snapshot `worldAabb` with blur pad (`expandRect` by `ceil(blur*2+4)`), `rt.resize(w,h)` (`fullscreenPass.ts:132`), build a lightweight clone of `castersOf(group)` subtree (or clone the live `groupContainer` and temporarily strip `placeholder.filters=[]` + `tint=0xffffff`), position it at `pad - aabb.min` inside a temporary `Container`, call `renderScene({container: clone, target: rt})` with `clearColor:0x00000000`, swap `sprite.texture = rt`, apply `BlurFilter` (`pixi.ts` shim extended with `BlurFilter`), set `sprite.position = aabb.center + offset`, `sprite.scale/skew/rotation`, `container.visible`. Destroy clone.

**Step 4 — Correct BBox: include deformation, morph, circle arcs.** Switch RT sizing from `worldAabbOf` on `#sizes` to deformed-aware math: either compute deformed AABB by reproducing `refreshDeformedMeshSizes` vertex math per caster (heavier) or simply call `candidateContainer.getBounds().clone()` after `refreshDeformedMeshSizes` (reflects live deformed vertices with no extra math). Keep `expandRect` for bleed and clamp to max.

**Step 5 — Params as animatable + persistence stubs.** Define shadow params shape (offset/scale/skew/rotation/blur/opacity/color + sourceMode) as a standalone store, hash with `uTime` via `animationEvaluator` or sampled per frame, feed into `#flushShadowsIfNeeded` dirty check. Wire `handleTimeChanged` to include param anim. Persistence (JSON + `SlideAnimation` extension, `.lesson` library, `ReusableObject`, `ClipCollection`/`Clip` channels, Video Export frame parity) is deferred to later spec tickets on map #286; the prototype can keep params static + t=0.

---

## 12. Key files & line anchors (quick index)

| Area | File | Lines | Role |
|------|------|-------|------|
| Renderer class | `sceneRenderer.ts` | `117`, `126-139`, `150-162`, `174-181` | Containers, maps, ctor, shapePreview subscription |
| Bind / create / destroy | `sceneRenderer.ts` | `214-238`, `240-250`, `252-276`, `867-900` | `bind`, `handleNodeCreated`, `handleNodeRemoved`, `#addNode` |
| Attach + ordering | `sceneRenderer.ts` | `1350-1354`, `831-865`, `820-829` | `#attachToParent`, `handleNodeOrderChanged`, `handleNodeReparented` + tableCell indirection `1375-1380` |
| Evaluated loop | `sceneRenderer.ts` | `902-1046`, `302-311`, `278-300` | `#evaluateAndApply`, `handleTimeChanged`, `handleTransformChanged` / `handleKeyframeChanged` |
| Deform + BBox | `sceneRenderer.ts` | `313-392`, `94-115`, `1219-1272`, `455-558` | `refreshDeformedMeshSizes`, `effectiveMeshForPreview`, `#recordSize`, Mesh/Circle changed |
| Materials/Shaders | `sceneRenderer.ts` | `1130-1217`, `424-453`, `152-163` | `#applyNodeShader`, `#resolveMaterial`, `#resolveShader`, `applyMaterialTint` |
| WorldTransform | `worldTransform.ts` | `20-32`, `34-46`, `48-55`, `213-244`, `246-262`, `57-211` | `worldTransformOf`, `evaluatedWorldTransformOf`, `chainOf`, `composeChain`, `relativeTransform`, `EvaluatedWorldTransformSource` |
| SceneNode/group | `sceneNode.ts` | `37-70`, `72-80`, `172-174`, `379-389` | Node fields, `markDirty`, `isGroupNode`, `walkPreOrder` |
| Deformation | `meshDeformationEvaluator.ts` | `19-38`, `40-108`, `110-158` | `evaluateMorphedMeshDeformation`, `evaluateMeshDeformation`, helpers |
| World projection | `deformedMeshWorld.ts` | `9-44` | `deformedMeshWorldVertices` + `localToWorld` helper |
| Node container | `nodeRenderer.ts` | `21-25`, `46-98`, `110-151`, `229-288`, `332-373`, `405-467` | `placeholderOf`, `createNodeContainer`, `applyEvaluatedState`/`applyPivotWithSize`, mesh/circle placeholders, UV helpers |
| Placeholders + tint | `placeholder.ts` | `14-15`, `29-60`, `79-84`, `120-154`, `156-159` | Sizes, `createPlaceholder`, `applyTint`, `placeholderSize`, `hexColorToTint` |
| Geometry primitives | `worldGeometry.ts` | `1-6`, `48-64` | `WorldSize/Rect`, `expandRect`, `mergeRect` |
| AABB / hit | `hitTest.ts` | `62-78`, `80-123` | `worldAabbOf`, `aabbOf` (pivot-aware) |
| Text/Chart/Table/Circle | `textRenderer.ts` | `21-37`, `63-92`; `chartRenderer.ts` `33-81`; `tableRenderer.ts` `7,17-32,84-91,76-200`; `circleComponent.ts` `134-186` | Per-type create/measure/layout; `CHART_DEFAULT_WIDTH/HEIGHT`, `DEFAULT_TABLE_WIDTH` |
| Shaders | `nodeShader.ts` | `39-73`; `samplerBinding.ts` `16-45`; `programCache.ts` `1-43`; `pixi.ts` `1-86` | Filter create, uniform helper, sampler binding, program cache, Pixi shim |
| Animation eval | `animationEvaluator.ts` | `69-88`, `114-161`, `163-192`, `260-301`, `601-675`, `684-753` | `evaluatedStatesEqual`, `evaluateNode`, `evaluateVisible`, morph vertices, table/circle, clip layering |
| Shape / morph | `shape.ts` | `18-40`, `63-79`, `96-134`, `238-262` | `createShape`, `MorphBinding`, `resolveMorphedVertices`, `resolveCrossBlendedVertices` |
| Mesh data | `mesh.ts` | `1-33`, `54-156`, `236-258` | `MeshData` shape, `meshDataFromJSON`, `cloneMeshData` |
| Stores | `shapePreviewStore.ts` | `1-19`; `overlayVisibilityStore.ts` `1-33` | Preview binding, visibility flags — template for new shadow store |
| Compositor | `renderer.ts` | `107,176-181`, `184-242`, `217,232-242`, `605-657`, `748-770`, `772-898`, `900-920` | World creation, `SceneRenderer` wiring, tick + `#handleTimeChanged`, event switch, `#syncScene` |
| Fullscreen RT | `fullscreenPass.ts` | `20-23`, `34-180` | `RenderSceneToTexture`, `FullscreenPass` RT lifecycle, resize, renderFrame |
| Events | `events.ts` | `58-108`, `198-239`, `284-408` | Node/Transform/Visibility/material/keyframe/clip mesh/chart/table events |

---

## 13. Concluding note on fidelity

What this research **does** answer: exact insert shape (per-group sibling-under container), how the subtree is walked and filtered, how BBox must include post-deformed/morphed vertices and per-type sizes, how `composeChain` determines world positioning and why shadow offset lives in parent space, the full dirty surface and the least-invasive hook sites already converging on `#evaluateAndApply`/`handleTimeChanged`/`refreshDeformedMeshSizes`, and the `RenderTexture` lifecycle pattern already canonical in `FullscreenPass`. What it **defers** to the prototype/grilling tickets: the concrete `ShadowComponent` / `ShadowStore` shape, the white-alpha filter fragment, the async chart/morph edge cases, and the tuning of blur-padding/quality/cap under the many-shadows ceiling on map #286.

