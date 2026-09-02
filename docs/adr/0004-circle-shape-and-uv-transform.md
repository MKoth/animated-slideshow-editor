# ADR 0004 — Circle Procedural Shape and UV Transform

Date: 2026-09-02
Status: Accepted (grill #13-items)

Context: Mesh today is only imported asset → MeshData. Requests to attach texture to any mesh and to have procedural shapes (circle wedge with animatable slice) with UVs. Distinct from D3 raster-to-texture path; needs per-frame deterministic GPU geometry, not async SVG rasterization.

Decision: Keep MeshData as geometry+UVs owned by MeshComponent. Add CircleComponent {radius, startAngle, endAngle 0..360 wedge CCW from +X, segments auto max(16, ceil(arc/10°))} whose renderer generates triangle-fan MeshData on demand with radial UVs; startAngle/endAngle and UV-mapped texture are animatable (hold/linear/bezier for angles, hold for discrete material). Texture attachment is a command that sets MaterialInstance texture (assetDefinitionId) and writes UV Transform params (uvScale {u,v} default 1,1, uvOffset {u,v} default 0,0, fitMode stretch|cover|contain) — not by baking uvs directly, so stretch vs cover vs custom scale/offset are configurable and previewed by PixiJS. Default mapping is stretch 0..1 full-bleed; cover/offset computed in renderer/generator. Same UV Transform applies to mesh and circle.

Alternatives: Baking UVs into mesh per attach (rejected: loses parametric control, cannot animate offset); shader-only slice via uniform (rejected: cannot export Clip channels for angles); generic ProceduralShape type enum (rejected: premature abstraction, circle is well-scoped); asset→mesh only one-way (rejected per requirement).
