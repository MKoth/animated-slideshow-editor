# Research: Pixi vertex update & Mesh Edit pipeline for morph sculpt — Findings

Branch: `research/morph-pixi-pipeline` · Issue #269 · 2026-09-04

## TL;DR recommendation (cheapest insertion)

**Sculpt = weight-paint interaction copy + mesh-edit drag-preview copy, but editing *rest* vertices and previewing *deformed world* vertices.**

1. New `MeshEditTool = 'sculpt'` in `frontend/src/stores/meshEditStore.ts:5` (alongside `select|delete|extrude|subdivide|mirror|weightPaint`).
2. New `frontend/src/pixi/renderer/sculptInteraction.ts` modeled on `weightPaintInteraction.ts:63-387` (face raycast + screen-space radius + `strength*(1-dist/radius)` falloff + `Transaction(PaintVertex)`) feeding a **preview layer** modeled on `meshEditInteraction.ts:395-426` (`#previewPositions → meshOverlay.setPreviewVertices → redraw → commit MoveVertex|Custom Transaction`). Dispatch should mutate **rest** vertices (`MeshData.vertices`), but hit-testing/preview must use `deformedMeshWorldVertices` so the brush feels bone-deformed.
3. Insert morph lerp **before** `evaluateMeshDeformation` in a shared composition owned by `frontend/src/pixi/renderer/deformedMeshWorld.ts:9` (and symmetrically in `frontend/src/pixi/renderer/meshOverlay.ts:52` / `sceneRenderer.ts:281`). Add a thin `resolveMorphedVertices(mesh, morphState): MeshVertex[]` that `evaluateMeshDeformation` consumers call first. Shape snapshots store only `Map<vertexIndex, delta>` (or `Float32Array` deltas) keyed by shapeId — no copy of `faces/uvs/boneWeights`.
4. Reuse `MoveVertexCommand` (`frontend/src/engine/commands/moveVertexCommand.ts:19`) / `TransactionCommand` already batch per-vertex edits and wire through `Engine.setMeshData → MeshChanged → sceneRenderer.handleMeshChanged → applyMeshVertices|remake` — cheapest path that preserves undo and GPU refresh without inventing a new data path.

---

## 1. Where vertices flow today

### Engine ownership

| File:line | Role |
|---|---|
| `frontend/src/engine/mesh.ts:26-33` | `MeshData { vertices, faces, uvs, boneWeights?, bindPose? }` canonical shape. `MeshVertex {x,y}` `MeshFace {v0,v1,v2}` `VertexBoneWeight {boneId,weight}` |
| `frontend/src/engine/mesh.ts:35-53` | `createDefaultRectangleMesh` (4 verts, 2 tris) |
| `frontend/src/engine/mesh.ts:236-258` | `cloneMeshData` deep-copies all fields — used by commands/undo |
| `frontend/src/engine/components.ts:54-57` | `MeshComponent { kind:'mesh', mesh: MeshData }` — node carries mesh |
| `frontend/src/engine/components.ts:118` | `copyComponents` clones via `cloneMeshData` |
| `frontend/src/engine/internal.ts:1955-1961` | `Engine.setMeshData(nodeId, mesh)` freezes new `MeshComponent` and emits `{type:'MeshChanged', nodeId}` |
| `frontend/src/engine/events.ts:284-285` | `MeshChanged` event contract |
| `frontend/src/engine/commands/moveVertexCommand.ts:19-68` | Mutates **one** rest vertex: copies `vertices.map` → `setMeshData`; undo stashes `oldX,oldY` |
| `frontend/src/engine/commands/deleteVerticesCommand.ts` et al. `extrude*`, `subdivide*`, `mirror*`, `generateMeshCommand.ts:52-56` | All mutate via `setMeshData` → `MeshChanged` |
| `frontend/src/engine/commands/paintWeightCommand.ts:106-149` | **Not vertices** — mutates `boneWeights`/`bindPose` but precedent for brush: clones `ensureBoneWeightsArray`, emits `setMeshData` |

### GPU / render path

| File:line | Role |
|---|---|
| `frontend/src/pixi/renderer/nodeRenderer.ts:229-264` | `createMeshPlaceholder` → `createDisplayMesh` (`MeshSimple {vertices,uvs,indices}`) + `setMeshPlaceholderSize` for hit-test |
| `frontend/src/pixi/renderer/nodeRenderer.ts:469-484` | `createDisplayMesh` flattens `MeshData` → `Float32Array` for Pixi `MeshSimple` |
| `frontend/src/pixi/renderer/nodeRenderer.ts:486-492` | `flattenVertices/Us` |
| `frontend/src/pixi/renderer/nodeRenderer.ts:368-373` | `applyMeshVertices(container, vertices)` — **cheap path**: in-place `displayMesh.vertices = flattenVertices(vertices)` for skinned deformation every frame, no recreate |
| `frontend/src/pixi/renderer/nodeRenderer.ts:387-403` | `applyMeshDataWithUV` — **expensive path**: destroys/recreates `MeshSimple` when topology changes (faces/uvs) |
| `frontend/src/pixi/renderer/nodeRenderer.ts:494-563` | `transformedMeshForNode` applies `uvTransform` before GPU upload |
| `frontend/src/pixi/renderer/sceneRenderer.ts:413-464` | `handleMeshChanged` branches: if placeholder type changed → `createNodeContainer` recreate; else `applyMeshDataWithUV`; then AABB from **rest** `mesh.vertices` + `refreshDeformedMeshSizes` |
| `frontend/src/pixi/renderer/sceneRenderer.ts:281-350` | `refreshDeformedMeshSizes` — the per-frame skin path: `bones = #engineWorldTransform` → `evaluateMeshDeformation(mesh,bones,meshWorld)` → `applyMeshVertices(container,deformed)` → bounds from **deformed** vertices |
| `frontend/src/engine/meshDeformationEvaluator.ts:16-84` | Skin evaluator: `mesh.vertices` × `boneWeights/bindPose` → `deformedVertices` (mesh-local). Consumed by both overlays and `sceneRenderer` |
| `frontend/src/pixi/renderer/deformedMeshWorld.ts:9-44` | Composition helper: `evaluateMeshDeformation` + `localToWorld(meshTransform)` = world vertices. Used by `weightPaintOverlay` + `weightPaintInteraction` |
| `frontend/src/engine/meshGenerator.ts:178-250` | Authoring-only path: alpha→contours→adaptive interior→`triangulateContour`→`computeUVs`→center |

### Overlay branch (edit-time visualization)

| File:line | Role |
|---|---|
| `frontend/src/pixi/renderer/meshOverlay.ts:52-67` | `getDeformedVertices(mesh,scene,meshTransform)` wraps `evaluateMeshDeformation` |
| `frontend/src/pixi/renderer/meshOverlay.ts:77-90` | `localToWorld` |
| `frontend/src/pixi/renderer/meshOverlay.ts:141-143,225-239` | `#previewVertices: Map<vertexIndex,{x,y}>` + `setPreviewVertices/clearPreviewVertices/worldVerticesFor` — the **ephemeral drag layer** |
| `frontend/src/pixi/renderer/meshOverlay.ts:201-223` | `#worldVerticesFor` merges deformed + preview offset → world |
| `frontend/src/pixi/renderer/meshOverlay.ts:241-248` | `deformedLocalVertices` exposes deformed-local for drag base capture |
| `frontend/src/pixi/renderer/meshOverlay.ts:299-408` | `#drawMesh/#drawWireframe` — draws deformed + preview |
| `frontend/src/pixi/renderer/meshOverlay.ts:453-540` | `hitTestVertex/Edge/Face` — all hit-test against **deformed+preview world** positions |

---

## 2. How live preview mutates (two precedents)

### A. Transform drag preview (cheap, overlay-only)

`renderer.ts:103,239-237` `previewPositions: Map<string,{x,y}>` fed into `EvaluatedWorldTransformSource` (`worldTransform.ts:60,181-210`) which threads through `SceneRenderer` and overlays as `getWorldTransform`. `CanvasSelection` (`renderer.ts:278-292`) calls `sceneRenderer.previewTransform` which directly mutates `container.position` without touching engine state. Cleared on `clearPreview` → `evaluateAndApply`.

### B. Mesh generation slider preview

`stores/meshPreviewStore.ts:4-17` `{previewMesh: MeshData|null, nodeId}` shared store. `components/panels/MeshGenerationSection.tsx:205` `setPreviewMesh(target.id, meshData)` on slider drag; `MeshOverlay.redraw():287-296` draws it via `#drawPreview` (`meshOverlay.ts:410-451`) as fill `alpha 0.3`. Cleared on pointer-up / generate. **Not** committed — pure overlay.

### C. Mesh-edit vertex drag — closest sculpt analog

`pixi/renderer/meshEditInteraction.ts:395-426` `#handleDrag`:
- waits `MOVE_START_DISTANCE=2` px
- seeds `#dragBasePositions` from `meshOverlay.deformedLocalVertices(scene,nodeId)` (`meshEditInteraction.ts:408`) — **base is deformed-local, not raw rest**
- for `indices = dragVertexIndices ∪ selectedVertexIndices` stores `previewPositions[idx] = base+{dx,dy}` in mesh-local deformed space
- `meshOverlay.setPreviewVertices(#previewPositions)` (`meshOverlay.ts:225`) then `redraw()` — no engine write yet
- `meshEditInteraction.ts:458-484` `#commitMove` materializes as `MoveVertexCommand` per vertex or `TransactionCommand(commands)` and dispatches. Reset clears preview (`#reset():550-559` + `clearPreviewVertices():229`).

Implication for sculpt: reuse the same **preview map + overlay** pattern; commit via batched `MoveVertexCommand` (or a new `SculptVertexCommand` if you want absolute deltas per shape).

---

## 3. Weight-paint brush precedent (the sculpt template)

`pixi/renderer/weightPaintInteraction.ts:63-539` is the complete reference for a falloff brush that must edit one attribute while rendering another:

| Aspect | File:line pattern to copy | Notes |
|---|---|---|
| Gate | `weightPaintInteraction.ts:119-121,160-163,206-210` + `renderer.ts:367-374` wiring | Only when `meshEditNodeId && meshEditTool==='weightPaint' && selectedBoneId` |
| Screen→world | `weightPaintInteraction.ts:322-323` via `screenToWorld.ts:3-18` `cursorToWorld(canvas,camera,clientX,clientY)` | Null-safe; same for sculpt |
| World vertices for hit | `weightPaintInteraction.ts:332-337` `deformedMeshWorldVertices(mesh,scene,worldTransform,getWorldTransform)` (`deformedMeshWorld.ts:9`) | **Must reuse for sculpt so brush follows deformed pose** |
| Face raycast guard | `weightPaintInteraction.ts:340-343` `hitTestFace(worldX,worldY,worldVertices,faces)` (`:44-61` private `pointInTriangle`) | Prevents painting through empty space; copy verbatim |
| Brush radius | `weightPaintInteraction.ts:345,410,460` `radiusScreen = brushRadius` (px, from `meshEditStore.brushRadius:71,87` — 25px default) | For sculpt, add to store alongside weightPaint brush fields |
| Distance + falloff | `weightPaintInteraction.ts:349-364` `distWorld=Math.hypot… ; distScreen=distWorld*scale` where `scale=max(camera.scaleX,scaleY)`; `factor=1-distScreen/radiusScreen`; `if(brushFalloff!==1) factor=pow(factor,falloff)`; `delta=strength*factor` | Exactly the `weight += strength*(1-dist/radius)` contract quoted in #269; maps 1:1 to sculpt displacement |
| Add/erase | `weightPaintInteraction.ts:140-141,190-191` `mode = shift/alt ? 'remove':'add'` threaded into `PaintWeightCommand` as `mode` | Sculpt should copy: `Shift`/`Alt` = push vs pull (or invert along normal) |
| Per-dab Transaction | `weightPaintInteraction.ts:371-386` `affected.map → new PaintWeightCommand({strength}) → TransactionCommand(commands)` (single → dispatch solo) | Per-dab (mouse-move event) is one undo step; continuous drag is many dabs — matches `moveVertex` commit pattern. Throttled at `screenDist<3` px `weightPaintInteraction.ts:178-185` |
| Heatmap overlay | `weightPaintOverlay.ts:152-184` `#drawHeatmap` via `deformedMeshWorldVertices` + per-vertex `getWeightForBone` + `weightToColor` gradient; subscribes to `MeshChanged|TransformChanged|IK*` and `subscribeTime` (`weightPaintOverlay.ts:86-98`) | Sculpt can ship without heatmap, but the same overlay mechanism serves sculpt strength preview if desired |
| Tooltip/inspection | `weightPaintInteraction.ts:204-263` hover nearest-vertex tooltip with `hitTestFace` guard | Reuse for sculpt displacement inspection |

**Store fields already present to reuse** (`stores/meshEditStore.ts:18-21,71-74,84-87`): `brushRadius`, `brushStrength`, `brushFalloff`, `selectedBoneId`/`weightPaintTool` — sculpt should add `sculptTool`/`sculptStrength` adjacent, not replace.

---

## 4. Where morph-then-bones lerp would insert

Agreed direction per #269: **rest → morph lerp → `evaluateMeshDeformation` → world** (morph before bones).

### Current composition (no morph)

```
MeshData.vertices (rest, mesh-local)
  → evaluateMeshDeformation(mesh, boneWorldTransforms, meshWorldTransform)
    → deformedLocal[]
  → localToWorld(deformedLocal, meshWorldTransform)  // deformedMeshWorld.ts:35 + meshOverlay.ts:77
  → world positions for hit-test / draw / sceneRenderer.applyMeshVertices
```

Call sites today (all two steps):

* `meshOverlay.ts:52-67` `getDeformedVertices` → `meshDeformationEvaluator.ts:16`
* `meshOverlay.ts:345` inside `#drawMesh`, `:305` inside `#drawWireframe`, `:208-222` `#worldVerticesFor`
* `weightPaintOverlay.ts:159` / `weightPaintInteraction.ts:332` → `deformedMeshWorld.ts:9`
* `sceneRenderer.ts:300,333-334` `refreshDeformedMeshSizes` via `evaluateMeshDeformation`
* `meshOverlay.ts:241-248` `deformedLocalVertices` exposed for drag bases

### Proposed insertion (single owner)

Add one helper that owners the morph composition so every consumer stays in sync:

```
resolveMorphedRestVertices(mesh, morphState): MeshVertex[]
  // mesh.vertices (base rest) + per-vertex deltas keyed by active shape lerped by name→weight
  // returns a NEW MeshVertex[] but reuses faces/uvs/boneWeights/bindPose object identity
  // → feed into evaluateMeshDeformation as the `mesh` argument
```

**File that should own it: `frontend/src/engine/meshDeformationEvaluator.ts`** (rename or add sibling `morphEvaluator.ts` imported there).

Rationale:
- `meshDeformationEvaluator.ts:16` already owns `boneWeights/bindPose` → skin contract and is the only file that knows `relativeTransform` math. Placing morph lerp there keeps "rest→skinned" atomic.
- Thin wrapper `evaluateMorphedMeshDeformation(mesh, morphState, boneTransforms, meshWorld)` = `lerp` then delegate to existing `evaluateMeshDeformation`.
- `deformedMeshWorld.ts:9-33` is the second owner for the `+ localToWorld` leg; once the evaluator exposes the morphed variant, `deformedMeshWorldVertices` just forwards `morphState` through.

Alternative considered and rejected: putting lerp in each overlay (`meshOverlay`/`weightPaintOverlay`/`sceneRenderer`) individually — duplicates math and risks desync between hit-test and GPU. Centralizing in `meshDeformationEvaluator.ts` also gives export/SSR a single deterministic entrypoint.

### Shape snapshot shape (no copying of faces/uvs/boneWeights)

Copying whole `MeshData` per shape is the cost to avoid. Per-shape storage should be `Map<vertexIndex, MeshVertex delta>` or a sparse `Float32Array(2*N)` of `dx,dy` parallel to `mesh.vertices`. The composed `morphState` is `Map<shapeId, weight>` → lerp is `base[v] + Σ weight_s * delta_s[v]`. `faces/uvs/boneWeights/bindPose` stay on the canonical `MeshData` at `components.ts:54`.

Commands: a new `SculptVertexCommand { nodeId, vertexIndex → sculptDelta }` or re-derive `MoveVertexCommand` style deltas on active shape rather than base `vertices`. The commit path stays `Engine.setMeshData` but `setMeshData` in that world would patch only the active shape's delta map and re-emit `MeshChanged`.

---

## 5. Cheapest sculpt insertion point — concrete plan

**Mirror `weightPaintInteraction` + `meshEditInteraction` exactly.**

1. **`stores/meshEditStore.ts:5-50`** — extend `MeshEditTool |= 'sculpt'`, add `sculptStrength/sculptRadius/sculptFalloff/activeShapeId` (`:18-21` pattern). No new store needed.

2. **`pixi/renderer/sculptInteraction.ts` (new, ~180 lines)** — fork `weightPaintInteraction.ts:63-130` attach/detach, `cursorToWorld` (`screenToWorld.ts:3`), `deformedMeshWorldVertices` (morphed variant), `hitTestFace` face guard (`weightPaintInteraction.ts:44-61`), screen-space `distScreen` + `pow(falloff)` loop (`:348-364`), `mode = shift?'remove':'add'` branch (`:140-141`) mapping to subtract/add delta along vertex normal or brush-space `+dy`, throttle `screenDist<3` (`:178-185`), per-dab `TransactionCommand` (`:370-386`) wrapping `SculptVertexCommand` (or `MoveVertexCommand` when sculpting base).

3. **Preview: reuse `meshOverlay.ts:142-229` `Map<vertexIndex,{x,y}>` preview layer.** During `mousemove` populate `previewPositions` from morphed-deformed base `+ delta*factor` (same loop as `meshEditInteraction.ts:407-425` which seeds from `deformedLocalVertices`), call `meshOverlay.setPreviewVertices → redraw()`. Commit on `mouseup` into same `TransactionCommand`.

4. **Morph composition: patch `meshDeformationEvaluator.ts:16` + `deformedMeshWorld.ts:9`.** Add `resolveMorphedVertices(mesh, morphState)` and `evaluateMorphedMeshDeformation(...)`. Change `meshOverlay.getDeformedVertices`, `deformedMeshWorldVertices`, and `sceneRenderer.refreshDeformedMeshSizes` to thread an optional `morphState` param (plumb from a lightweight `morphStore` analogous to `meshPreviewStore.ts:4` or directly from the node's material/mesh extension). `nodeRenderer.applyMeshVertices` (`:368`) stays the cheap GPU sink — no change except it receives already-skinned morphed vertices.

5. **`pixi/renderer/renderer.ts:347-374` wiring mirror** — instantiate `SculptInteraction` + optional `SculptOverlay` alongside `WeightPaintOverlay/Interaction` (`:356-374`), attach/detach symmetrically.

Why this is cheapest: zero new GPU path (reuses `applyMeshVertices:372`), zero new engine mutation contract (reuses `MoveVertex/Sculpt+Transaction` → `setMeshData` → `MeshChanged` → `handleMeshChanged/refreshDeformedMeshSizes`), reuses already-tested face-hit, screen-scaling, falloff, throttle, and preview machinery line-for-line.

---

## File:line index (all files requested in #269)

| Area | File:line pointer |
|---|---|
| Mesh shape | `frontend/src/engine/mesh.ts:1-33` `MeshData/MeshVertex/MeshFace/VertexBoneWeight/BoneBindPose` |
| Deep clone | `frontend/src/engine/mesh.ts:236-258` `cloneMeshData` |
| Edge helpers | `frontend/src/engine/mesh.ts:207-234` `edgeKey/extractEdges` |
| Component carrier | `frontend/src/engine/components.ts:54-57` `MeshComponent`; `:118` `copyComponents` clones mesh |
| Store selection | `frontend/src/stores/meshEditStore.ts:5-21` `MeshEditTool/SelectMode`; `:62-74` defaults; `:76-91` `enterMeshEdit` (resets brush 25px); `:183-189` `setBrush*` |
| Store preview | `frontend/src/stores/meshPreviewStore.ts:4-17` `previewMesh/nodeId` |
| Engine mutation | `frontend/src/engine/internal.ts:1955-1961` `setMeshData` → `MeshChanged` |
| Commands vertex | `frontend/src/engine/commands/moveVertexCommand.ts:19-68` `MoveVertexCommand`; `deleteVerticesCommand`, `extrude*`, `subdivide*`, `mirror*`, `generateMeshCommand:52-56` all via `setMeshData` |
| Skin evaluator | `frontend/src/engine/meshDeformationEvaluator.ts:16-84` `evaluateMeshDeformation`; `:86-106` `applyRelativeBoneTransform`; `:118-134` `relativeTransform` |
| World composition | `frontend/src/pixi/renderer/deformedMeshWorld.ts:9-33` `deformedMeshWorldVertices` |
| Overlay deformed | `frontend/src/pixi/renderer/meshOverlay.ts:37-50` `computeBoneWorldTransforms`; `:52-67` `getDeformedVertices`; `:77-90` `localToWorld` |
| Overlay preview | `frontend/src/pixi/renderer/meshOverlay.ts:137-144` fields; `:154-173` `attach` subscribes `meshPreviewStore` + `MeshChanged/TransformChanged`; `:208-239` `#worldVerticesFor/setPreviewVertices/clear`; `:241-248` `deformedLocalVertices` |
| Overlay draw | `frontend/src/pixi/renderer/meshOverlay.ts:250-451` `redraw/#drawMesh/#drawWireframe/#drawPreview` |
| Overlay hit | `frontend/src/pixi/renderer/meshOverlay.ts:453-540` `hitTestVertex/Edge/Face`; `verticesInRect/edgesInRect/facesInRect:542-601` |
| Drag interaction | `frontend/src/pixi/renderer/meshEditInteraction.ts:109-161` `onMouseDown` gates `weightPaint`; `:169-266` `handle*Click` selection; `:395-426` `#handleDrag` preview; `:458-484` `#commitMove` → `MoveVertexCommand+Transaction` |
| Weight overlay | `frontend/src/pixi/renderer/weightPaintOverlay.ts:55-193` heatmap via `deformedMeshWorldVertices:159`; `weightToColor:12-31` |
| Weight interaction | `frontend/src/pixi/renderer/weightPaintInteraction.ts:44-62` face utils; `:63-539` full brush class; `:140-141` erase `Shift/Alt`; `:178-185` throttle; `:340-386` face guard + falloff `strength*(1-dist/radius)` + `Transaction`; `:389-482` `smooth/fill/blur/auto` |
| Screen→world | `frontend/src/pixi/renderer/screenToWorld.ts:3-18` `cursorToWorld` |
| Scene render GPU | `frontend/src/pixi/renderer/sceneRenderer.ts:281-350` `refreshDeformedMeshSizes`; `:368-373` `applyMeshVertices`; `:413-464` `handleMeshChanged`; `:860-1004` `evaluateAndApply` (pivot, material, shader) |
| Node GPU | `frontend/src/pixi/renderer/nodeRenderer.ts:229-484` placeholders; `:368-373` `applyMeshVertices` (cheap); `:387-467` `applyMeshDataWithUV/applyUVTransformToContainer` (topology/UV recreate) |
| Generator | `frontend/src/engine/meshGenerator.ts:64-141` `triangulateContour` (poly2tri); `:178-250` `generateMesh` authoring path |
| Renderer wiring | `frontend/src/pixi/renderer/renderer.ts:103-109` preview map; `:228-271` `transformSource` + `meshOverlay` attach; `:278-354` `meshEditInteraction`; `:356-374` `weightPaint*` attach; `:413-464` `handleMeshChanged/refreshDeformedMeshSizes` + `MeshChanged` routing `:842-844` |

## Risks / open decisions

* **Sculpt space**: recommend sculpting **rest-local** `MeshData.vertices` (so a sculpted vertex still skins correctly) while previewing **deformed world** — matches the `#dragBasePositions` choice at `meshEditInteraction.ts:408`. If instead deltas are stored per-**deformed** space, bones would double-transform.
* **Undo granularity**: current weight paint = one `Transaction` per mousemove dab; mesh drag = one `Transaction` per mouse-up. For sculpt, prefer per-dab (brush fidelity) but coalesce on `mouseup` if undo noise is high — trivial to switch between the two proven patterns.
* **Morph storage**: keep off `MeshData.vertices` — either `mesh.morphDeltas?: Map<string, Float32Array>` extension or sibling node state. Lerp must be `O(affectedVertices × activeShapes)`, still trivial (<1k verts).

