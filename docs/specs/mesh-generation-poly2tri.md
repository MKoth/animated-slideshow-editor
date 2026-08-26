# Spec: Replace earcut with poly2tri and add bone-aware mesh generation parameters

## Problem Statement

The current mesh generation in the AI Slideshow Editor uses earcut for triangulation and exposes only a single "Density" parameter. This produces poor topology for character rigging because:

1. The mesh doesn't follow the silhouette accurately
2. There's no way to increase vertex density around bone joints where deformation happens
3. The resulting topology deforms poorly when bones are rotated

Through prototype testing, we discovered that poly2tri (constrained Delaunay triangulation) combined with bone-aware point generation produces significantly better rigging meshes. The prototype validated parameters for mesh density, boundary spacing, joint density, joint radius, joint minimum distance from edge, and max vertices.

## Solution

Replace the earcut triangulation with poly2tri and expand the parameter set from 1 slider to 6 sliders that give users control over mesh topology quality. The new parameters are derived from the prototype at `prototypes/mesh-generation-prototype.html`.

## User Stories

1. As a character animator, I want mesh density to control interior vertex count, so that I can balance quality vs performance
2. As a character animator, I want boundary spacing to control how closely vertices follow the silhouette, so that curved edges like shoulders and fingers render accurately
3. As a character animator, I want joint density to increase vertices near bone connections, so that elbows and knees deform smoothly
4. As a character animator, I want joint radius to control how far from a joint the density increase extends, so that I can tune deformation zones
5. As a character animator, I want a minimum distance from edge parameter, so that bone endpoints near the silhouette don't create unnecessary dense zones
6. As a character animator, I want max vertices to cap the total count, so that GPU performance stays acceptable
7. As a character animator, I want the mesh to update live as I drag sliders, so that I can see the effect immediately
8. As a character animator, I want the same parameters to always produce the same mesh, so that I can iterate reliably
9. As a character animator, I want bones to automatically create joints at their endpoints, so that I don't have to manually mark joints
10. As a character animator, I want bone endpoints far from the silhouette edge to automatically become joints, so that mid-body deformation zones get proper density
11. As a character animator, I want the mesh generation to handle images with holes (transparent regions inside the silhouette), so that complex character shapes work
12. As a character animator, I want the mesh to be centered at the origin with UVs in image space, so that it integrates with the existing deformation system
13. As a character animator, I want collinear points to be automatically removed from contours, so that poly2tri doesn't fail
14. As a character animator, I want tiny perturbations applied to avoid collinearity errors, so that generation is robust
15. As a character animator, I want the UI to show all 6 parameters with clear labels, so that I understand what each controls

## Implementation Decisions

### 1. Replace earcut with poly2tri

**Current state:** `meshGenerator.ts` imports earcut and calls it once in `triangulateContour()` (line 72). The function flattens contour + holes into a numeric array, calls `earcut(flat, holeIndices, 2)`, then manually inserts interior points by splitting containing triangles.

**New approach:** Use poly2tri's constrained Delaunay triangulation which natively supports Steiner points (interior points). No manual triangle splitting needed.

**Key difference:** poly2tri requires:
- Contour in clockwise winding order
- No collinear points on the contour
- Interior points passed as Steiner points via `swctx.addPoints()`

The existing `removeCollinear()` function already handles collinear removal. Add a small deterministic perturbation (±0.02px) to break remaining collinearity.

### 2. Expand MeshGeneratorInput interface

Current:
```typescript
interface MeshGeneratorInput {
  readonly imageData: ImageData
  readonly density: number
}
```

New:
```typescript
interface MeshGeneratorInput {
  readonly imageData: ImageData
  readonly meshDensity: number      // 10-80, higher = more interior points
  readonly boundarySpacing: number  // 2-30, silhouette vertex spacing in px
  readonly jointDensity: number     // 1.0-5.0, multiplier near joints
  readonly jointRadius: number      // 10-150, radius of joint influence in px
  readonly jointMinDist: number     // 5-80, min distance from edge for bone endpoints to become joints
  readonly maxVertices: number      // 50-1000, vertex budget
}
```

The old `density` parameter maps to `meshDensity` for backward compatibility during migration.

### 3. Add bone awareness to mesh generation

The mesh generator needs access to bone positions to detect joints. Two types of joints:

**Connected joints:** Where 2+ bones share an endpoint (e.g., shoulder where upper arm meets torso). Always treated as joints.

**Edge-distant joints:** Bone endpoints that are far from the silhouette edge (distance ≥ `jointMinDist`). These become joints because there's enough interior area to benefit from increased density.

The `generateMesh` function needs a new optional parameter for bone positions:
```typescript
interface MeshGeneratorInput {
  // ... existing params
  readonly bones?: ReadonlyArray<{ readonly sx: number; readonly sy: number; readonly ex: number; readonly ey: number }>
}
```

### 4. Point generation algorithm

From the prototype, the working algorithm is:

1. Extract contour using existing marching squares / edge-walking (already in codebase)
2. Subsample contour by `boundarySpacing`
3. Remove collinear points
4. Detect joints (connected endpoints + edge-distant endpoints)
5. Generate interior grid points:
   - Base grid spacing = `80 - meshDensity + 5` (inverted: higher density = smaller spacing)
   - Near joints (within `jointRadius`): add sub-grid points, count scales with `jointDensity`
   - Away from joints: sparse sampling (every other point)
6. Add concentric ring points around joints (more rings with higher `jointDensity`)
7. Combine boundary + interior, limit to `maxVertices`
8. Triangulate with poly2tri

### 5. UI changes to MeshGenerationSection

Replace the single Density slider with 6 sliders:

| Parameter | Range | Default | Label |
|-----------|-------|---------|-------|
| meshDensity | 10-80 | 30 | Mesh Density |
| boundarySpacing | 2-30 | 8 | Boundary Spacing |
| jointDensity | 1.0-5.0 | 2.0 | Joint Density |
| jointRadius | 10-150 | 60 | Joint Radius |
| jointMinDist | 5-80 | 20 | Joint Min Dist from Edge |
| maxVertices | 50-1000 | 300 | Max Vertices |

All sliders should auto-regenerate the mesh on change (debounced).

### 6. Dependency changes

- Remove: `earcut` from package.json
- Add: `poly2tri` to package.json

### 7. Backward compatibility

The old `density` parameter (0-100) should map to the new `meshDensity` (10-80) during any migration period. The `MeshGeneratorInput` interface change is a breaking change to the engine module, but since `generateMesh` is only called from `MeshGenerationSection.tsx`, the blast radius is contained.

## Testing Decisions

### What makes a good test

- Test external behavior (mesh output), not implementation details (which triangulator is used)
- Verify mesh validity: correct vertex count, all face indices reference valid vertices, no degenerate triangles
- Verify parameter effects: increasing meshDensity increases vertex count, increasing boundarySpacing decreases boundary vertices
- Verify bone awareness: with bones, joints should have higher local vertex density
- Verify determinism: same inputs produce same outputs

### Modules to test

- `meshGenerator.ts` - core generation logic
- `MeshGenerationSection.tsx` - UI parameter binding (integration test)

### Prior art

Existing tests in `meshGenerator.test.ts` cover:
- Rectangular image mesh generation
- Concave shapes with holes
- Density scaling
- Centering around origin
- Collinear point removal
- Validation errors

These tests should continue to pass (with updated parameter names). Add new tests for:
- Joint detection from bone endpoints
- Edge-distance joint detection
- Max vertices budget enforcement
- Parameter determinism

## Out of Scope

- Real-time preview during slider drag (existing preview system works, just needs new parameters wired)
- Weight painting integration (separate feature)
- IK chain interaction with mesh generation
- Automatic bone placement (bones are still user-placed)
- Export/import of mesh generation parameters

## Further Notes

The prototype at `prototypes/mesh-generation-prototype.html` validated this approach. Key findings from prototype testing:

1. Marching squares contour extraction works well (1780 points from test image)
2. Collinear removal with perpendicular distance tolerance (0.5px) is essential for poly2tri
3. Deterministic point generation (position-based hashing) ensures reproducibility
4. Sub-grid sampling near joints creates visible density increases
5. Joint min distance from edge prevents unnecessary density at silhouette boundaries

The earcut→poly2tri swap is isolated to `triangulateContour()` in `meshGenerator.ts`. The rest of the pipeline (alpha extraction, contour tracing, UV computation, centering) remains unchanged.
