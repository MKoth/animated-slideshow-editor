# Prototype — Brush-based Shape Morph for Mesh (research/morph-brush)

Branch: `research/morph-brush` · Map #268 · Ticket #275  
Prototype type: **Logic + UI placement throwaway** — proves end-to-end loop from ADR 0007 + #272/#273/#274/#276.  
Throwaway from day one; not production. Close to modules it prototypes (`frontend/src/engine/shape.ts`, `meshDeformationEvaluator.ts`, `stores/meshEditStore.ts`, `pixi/renderer/sculptInteraction.ts`) but the runnable artifact is a single HTML file.

## Destination (from map)

> A working in-canvas prototype (behind a throwaway branch/flag) where a MeshComponent node stores multiple Shapes (absolute vertex snapshots sharing one topology), a falloff brush sculpts any Shape in Mesh Edit mode, and a single active morph From → To + coefficient (0→1) lerps any two Shapes with Timeline-keyframable presentation — enough to decide the programmatic model and UI placement for a future spec. Topology is fixed once Shapes exist.

## What this branch contains

| File | Role (decision it proves) |
|---|---|
| `frontend/src/engine/shape.ts` | **Shape model** — `Shape {id,name,vertices}` absolute snapshot, `MeshComponent.shapes?`, `resolveMorphedVertices(base, shapes, morph) → lerp(from→to, coeff)` before bones, `validateShapesInvariant`, `MorphBinding/MorphState`. Mirrors ADR 0007. |
| `frontend/src/engine/components.ts` | Adds optional `shapes?: Shape[]` to `MeshComponent`, `copyComponents` deep-clones shapes (fresh ids on ReusableObject import per ADR 0008). |
| `frontend/src/engine/meshDeformationEvaluator.ts` | Adds `evaluateMorphedMeshDeformation(mesh, morph, shapes, bones, world)` — `lerp→evaluateMeshDeformation` atomic composition. Central insertion point for all consumers (`deformedMeshWorldVertices`, `meshOverlay.getDeformedVertices`, `sceneRenderer.refreshDeformedMeshSizes`). |
| `frontend/src/stores/meshEditStore.ts` | Adds `MeshEditTool='sculpt'` (alongside select/delete/extrude/subdivide/mirror/weightPaint), `sculptRadius/Strength/Falloff` (25px/1.0/1.0) + `activeShapeId`, setters. |
| `frontend/src/pixi/renderer/sculptInteraction.ts` | Throwaway `SculptInteraction` forked from `weightPaintInteraction.ts` pattern — `cursorToWorld` + `deformedMeshWorldVertices` (deformed world for hit), face guard, `pow(1-dist/radius, falloff)`, drag-dir push `vertex+=dir*strength*falloff`, Shift invert, throttle 3px, preview via `meshOverlay.setPreviewVertices`, commit as `Transaction(MoveVertexCommand…)`. |
| `frontend/src/prototype/morph-brush-prototype.html` | **Primary artifact** — single double-clickable HTML file (no build) with free-play + tabbed guided walkthroughs. Proves loop: Duplicate → Sculpt (falloff) → any-to-any morph → Timeline keyframes → bone-then-morph determinism. Surfaces full state after every action. See “How to run” below. |
| `docs/adr/0007-shape-storage-and-topology-freeze.md` + `0008-…` | Decisions validated by this prototype (already on map). Included here so branch is self-contained. |

## How to run (trivial)

### Option A — double-click (logic demo, no build)

```sh
open frontend/src/prototype/morph-brush-prototype.html
# or: double-click the file in Finder — state lives in memory, no persistence
```

Canvas is 640×420, 8×8 grid (81 verts) — enough to feel falloff without needing 10k-vert perf path. Controls are mocked Inspector/Mesh Edit/Timeline placements per #274.

### Option B — in-app wiring (optional, not required to judge model)

This branch does **not** wire the prototype into Vite dev server; the stores/types are updated but `renderer.ts` still instantiates only `WeightPaintInteraction`. To see sculpt in the real editor, temporarily add to `frontend/src/pixi/renderer/renderer.ts` (mirroring weightPaint wiring):

```ts
import { SculptInteraction } from './sculptInteraction'
// in constructor / attach: new SculptInteraction({canvas, getScene, getCameraTransform, dispatch, meshOverlay}).attach()
```

Then `pnpm dev` (from `frontend/`). Prototype branch is throwaway — undo before merging.

## Walkthrough (mirrors prototype tabs)

1. **Duplicate Base → Sculpted** — click *Duplicate → Sculpted* (unique name, `newId('shape')`, `vertices.length` invariant). From=Base To=Sculpted, banner “Topology locked” appears.
2. **Sculpt Sculpted** — select *sculpt* tool, drag on canvas (push), Shift+drag to pull. Radius/Strength/Falloff sliders live-update. Preview follows deformed world, edit is rest-local.
3. **Any-to-any morph** — pick From/To any pair (Base→Sculpted, Sculpted→Base, Sculpted→Third), scrub coeff 0→1 (and 1.5 exaggeration, preview only). Observe live vertex update (Canvas mirrors Pixi `applyMeshVertices` cheap path; no topology recreate).
4. **Timeline** — *Add keyframe at playhead* (hold/linear/bezier), scrub playhead, Play, Simulate Export (fps=24 deterministic frames at `t=i/fps` via same `lerp→evaluateMeshDeformation`).
5. **Edge cases** — try: delete a shape used in From/To (soft warn + fallback to base), topology-locked extrude attempt, UV/boneWeight sharing check (no drift), large-mesh perf note.

## What broke / what spec must fix

- **Topology freeze** must be hard-disabled (tooltip “Remove Shapes to edit topology” + Inspector lock banner) — implemented as store guard, not yet wired to `meshEditInteraction.ts:136` delete/extrude/subdivide/mirror handlers.
- **Brush accumulation / undo granularity** — prototype uses per-dab preview + per-stroke `Transaction`; product needs decision on per-dab vs per-stroke undo steps (weightPaint is per-dab, mesh drag is per-stroke).
- **Screen↔world radius scaling** at extreme zoom diverges without clamping `max(camera.scaleX,scaleY)`; add guard in `sculptInteraction.ts`.
- **1.5 exaggeration** can fold mesh; spec should clamp store 0..1, allow preview 1.5 only with warning and not persist beyond 1.
- **UV/boneWeight inheritance** verified shared — no drift in prototype; needs invariant test `shape.vertices.length === mesh.vertices.length` on load (soft-warn drop, not file-fatal).
- **Large-mesh perf** — brute-force O(vertices in radius) fine to ~5k verts at 60fps; >10k needs spatial index (follow-up, not prototype).
- **Clip/Collection/ReusableObject portability** — spec in ADR 0008 is proven composable; prototype does not yet implement `ClipDefinition#morphAnimation` persistence + `ClipCollection` broadcast + `ReusableObject` `shapeIdMap` remap — those are tracer-bullet after prototype acceptance.

## Links

- Map: https://github.com/MKoth/animated-slideshow-editor/issues/268
- Ticket: https://github.com/MKoth/animated-slideshow-editor/issues/275
- Research: #269 (`research/morph-pixi-pipeline.md`), #270 (`research/morph-track-evaluator.md`)
- Grills: #271 (Shape storage), #272 (Brush), #273 (Morph operation), #274 (UI), #276 (Portability)
- Glossary: `CONTEXT.md` § Rig & Skeleton (Shape, Morph)
- Primary artifact: `frontend/src/prototype/morph-brush-prototype.html` (this README points to it)
