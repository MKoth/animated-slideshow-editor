# ADR 0007 — Shape storage as MeshComponent.shapes with hard topology freeze

Date: 2026-09-04
Status: Accepted (grill #271)
Deciders: MKoth + Muse Spark (wayfinder grill)
Context: Map #268 — Brush-based Shape Morph for Mesh, ticket #271

## Context

Mesh morph needs N absolute snapshots of rest vertices sharing one topology, plus copy/migration/portability rules that stay implementable in one session. Alternatives were `MeshComponent.shapes` vs `MorphSetComponent` vs per-node map, plus three topology-freeze policies and two persistence placements.

## Decision

1. **Ownership**: `MeshComponent {mesh: MeshData, shapes?: Shape[]}` (`frontend/src/engine/components.ts:54`). `Shape {id, name, vertices: MeshVertex[]}` — absolute snapshot; `faces`/`uvs`/`boneWeights`/`bindPose` stay on `mesh` and are never duplicated per Shape.
2. **Identity**: `newId('shape')` (`frontend/src/engine/ids.ts:1`), per-mesh unique name with block-on-duplicate (like `CONTEXT.md#Unique Name`), array order is storage order. Invariant `shape.vertices.length === mesh.vertices.length` validated on load; soft-warn drop on mismatch rather than failing the file.
3. **Persistence**: additive `NodeComponentsJSON.mesh.shapes?: ShapeJSON[]` (`frontend/src/engine/json.ts:29`), `ShapeJSON {id, name, vertices: {x,y}[]}`. `sceneNode.ts` `toJSON`/`componentsFromJSON` and `mesh.ts` `shapeFromJSON` handle it; `LessonSerializer` tolerates missing `shapes` → `[]`. No `librarySection.ts` change, no `Project.embeddedAssets` indirection, no version bump.
4. **Copy**: `copyComponents`/`freezeComponents` (`components.ts:112`, `sceneNode.ts:516`) deep-clone `shapes` with fresh ids; `cloneMeshData` stays geometry-only. `ReusableObject` (`reusableObject.ts:5`, `internal.ts:2549`) carries Shapes inside `NodeJSON` for free; import regenerates ids. Shapes never go to `embeddedAssets`.
5. **Topology freeze**: if `shapes.length > 0`, disable `delete`/`extrude`/`subdivide`/`mirror` (`stores/meshEditStore.ts:5`, `meshEditInteraction.ts:136`) with tooltip "Remove Shapes to edit topology" and Inspector lock banner — no silent wipe, no migration (out of scope per map).

## Alternatives Considered

- **MorphSetComponent** — rejected: cross-component invariant with no consumer, duplicates freeze/copy paths.
- **Per-SceneNode map** — rejected: widens scope past Mesh-only, invites Circle/Text morph asks.
- **Silent clear of Shapes on topology edit** — rejected: destructive without warning.
- **Interpolating Shapes through topology change** — rejected: complex, violates frozen-topology scope, not one-session.
- **Separate library/embeddedAssets for Shapes** — rejected: Shapes are node-owned, not reusable definitions; doubles persistence paths.

## Consequences

- One optional array on existing component; validators and copy paths stay local.
- Old `.lesson` files remain readable; new files port via normal `NodeJSON` + `ReusableObject` without extra snapshots.
- Clips/Collections morph portability remains owned by #276 and composes additively on top of this model (Shapes ride in node copy, coefficient/binding is separate).
- Topology UI needs a single `hasShapes` guard; prototype stays topology-frozen as intended.

## Links

- Map: #268
- This grill: #271
- Research: #269 (sculpt pipeline), #270 (track evaluator visible-pattern for coefficient)
- Glossary: `CONTEXT.md` § Rig & Skeleton (Shape, Morph)
- Follow-ups: #272 (brush), #273 (morph operation), #276 (Clips/Collections/Reusable Objects)
