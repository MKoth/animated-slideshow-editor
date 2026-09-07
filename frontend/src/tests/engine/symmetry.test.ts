import { describe, it, expect } from 'vitest'
import { createEngineInternal } from '../../engine/internal'
import { SymmetrizeSubtreeCommand } from '../../engine/commands/symmetrizeSubtreeCommand'
import { applyUVTransformToSingle } from '../../engine/uvTransform'

function setup() {
  const engine: any = createEngineInternal()
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  return { engine, slide }
}

describe('Symmetry', () => {
  it('direct symmetrize mirrors mesh vertices, shapes, UVs, transform and walks children', () => {
    const { engine, slide } = setup()
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'Parent', {
      transform: { x: 10, y: 5, rotation: 0.5, scaleX: 1, scaleY: 1 },
    })
    const child = engine.createNode(slide.scene.id, parent.id, 'ChildMesh', {
      transform: { x: 20, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    // give it a mesh
    const mesh = {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      faces: [
        { v0: 0, v1: 1, v2: 2 },
        { v0: 0, v1: 2, v2: 3 },
      ],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ],
    }
    engine.setMeshData(child.id, mesh as any)
    // create shape
    const shape = engine.createShape(child.id, 'ShapeA')
    // move shape vertex to be asymmetric
    engine.setShapeVertex(child.id, shape.id, 1, 20, 0) // make shape vertex different
    const originalChildVerts = engine.getNode(child.id).components.mesh!.mesh.vertices.map((v: any) => ({ ...v }))
    const originalChildUVs = engine.getNode(child.id).components.mesh!.mesh.uvs.map((uv: any) => ({ ...uv }))
    const originalParentX = parent.transform.x
    const originalParentRot = parent.transform.rotation
    const originalChildX = child.transform.x

    void ((): any => {
      // keep for type check
      return null
    })

    const cmd = new SymmetrizeSubtreeCommand({ nodeId: parent.id, axis: 'x' })
    cmd.validate(engine as any)
    const inv = cmd.execute(engine as any)

    const afterParent = engine.getNode(parent.id)
    const afterChild = engine.getNode(child.id)
    // Parent transform mirrored
    expect(afterParent.transform.x).toBe(-originalParentX)
    expect(afterParent.transform.rotation).toBe(-originalParentRot)
    // Child local transform mirrored as well (since walk includes child)
    expect(afterChild.transform.x).toBe(-originalChildX)
    // Mesh vertices mirrored on x
    const afterMesh = afterChild.components.mesh!.mesh
    expect(afterMesh.vertices[1].x).toBe(-originalChildVerts[1].x)
    expect(afterMesh.vertices[1].y).toBe(originalChildVerts[1].y)
    // UVs flipped
    expect(afterMesh.uvs[1].u).toBe(1 - originalChildUVs[1].u)
    // Shape vertices mirrored
    const afterShapes = engine.getShapes(child.id)
    expect(afterShapes[0]!.vertices[1].x).toBe(-20)
    // Faces winding flipped
    expect(afterMesh.faces[0].v1).toBe(2)
    expect(afterMesh.faces[0].v2).toBe(1)

    // Undo via inverse
    // Simulate undo handler
    for (let i = inv.snapshots.length - 1; i >= 0; i--) {
      const s = inv.snapshots[i]!
      engine.setTransform(s.nodeId, s.oldTransform)
      if (s.oldMesh) engine.setMeshData(s.nodeId, s.oldMesh as any)
      if (s.oldShapes !== undefined) {
        if (s.oldShapes.length > 0) engine.restoreShapes(s.nodeId, s.oldShapes as any)
        else engine.restoreShapes(s.nodeId, [] as any)
      }
    }
    const restoredChild = engine.getNode(child.id)
    expect(restoredChild.components.mesh!.mesh.vertices[1].x).toBe(originalChildVerts[1].x)
    expect(restoredChild.transform.x).toBe(originalChildX)
  })

  it('symmetry track animatable - blend 0->1 mirrors vertices via evaluator', () => {
    const { engine, slide } = setup()
    engine.setSlideDuration(slide.id, 2)
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'MeshNode', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const mesh = {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ],
      faces: [{ v0: 0, v1: 1, v2: 2 }],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 0.5, v: 1 },
      ],
    }
    engine.setMeshData(node.id, mesh as any)
    // add symmetry keyframes 0 at t0 axis x factor 0, 1 at t1 axis x factor 1
    engine.addKeyframe({ kind: 'symmetry', nodeId: node.id }, 0, { axis: 'x', factor: 0 })
    engine.addKeyframe({ kind: 'symmetry', nodeId: node.id }, 1, { axis: 'x', factor: 1 })
    // evaluator should mirror at t=1
    const base = mesh.vertices
    const at0 = engine.evaluateSymmetryVertices(node.id, 0, base)
    expect(at0![1]!.x).toBe(10)
    const at1 = engine.evaluateSymmetryVertices(node.id, 1, base)
    expect(at1![1]!.x).toBe(-10)
    const atHalf = engine.evaluateSymmetryVertices(node.id, 0.5, base)
    // linear blend 0.5 -> lerp 10 -> -10 = 0
    expect(atHalf![1]!.x).toBeCloseTo(0)

    // meshDeformation should apply symmetry after morph
    const deformed0 = engine.evaluateMeshDeformation(node.id, 0, new Map())
    expect(deformed0!.deformedVertices[1]!.x).toBe(10)
    const deformed1 = engine.evaluateMeshDeformation(node.id, 1, new Map())
    expect(deformed1!.deformedVertices[1]!.x).toBe(-10)
  })

  it('symmetrize creates keyframes when via helper', async () => {
    const { symmetryKeyframeCommandsForSubtree } = await import('../../engine/symmetryHelpers')
    const { engine, slide } = setup()
    engine.setSlideDuration(slide.id, 2)
    const parent = engine.createNode(slide.scene.id, slide.scene.root.id, 'P', {
      transform: { x: 5, y: 0, rotation: 0.3, scaleX: 1, scaleY: 1 },
    })
    const child = engine.createNode(slide.scene.id, parent.id, 'C', {
      transform: { x: 2, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const mesh = {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      faces: [{ v0: 0, v1: 1, v2: 2 }],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 0, v: 1 },
      ],
    }
    engine.setMeshData(child.id, mesh as any)
    const cmds = symmetryKeyframeCommandsForSubtree(engine as any, parent.id, 'x', 0.5)
    // Should produce at least 1 symmetry keyframe for child + transform keyframes
    expect(cmds.length).toBeGreaterThan(0)
    for (const c of cmds) {
      ;(c as any).validate(engine as any)
      ;(c as any).execute(engine as any)
    }
    expect(engine.getSymmetryKeyframes(child.id).length).toBe(1)
    expect(engine.getSymmetryKeyframes(child.id)[0]!.value).toEqual({ axis: 'x', factor: 1 })
    // parent transform keyframes for positionX and rotation should exist
    expect(engine.getKeyframes(parent.id, 'positionX').length).toBe(1)
    expect(engine.getKeyframes(parent.id, 'positionX')[0]!.value).toBe(-5)
  })

  it('JSON roundtrip preserves symmetry track', () => {
    const { engine, slide } = setup()
    engine.setSlideDuration(slide.id, 1)
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'N', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    engine.setMeshData(node.id, {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      faces: [{ v0: 0, v1: 1, v2: 2 }],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 0, v: 1 },
      ],
    } as any)
    engine.addKeyframe({ kind: 'symmetry', nodeId: node.id }, 0, { axis: 'y', factor: 0.5 })
    const json = engine.toJSON()
    const serialized = JSON.stringify(json)
    const parsed = JSON.parse(serialized)
    void parsed
    const slideJson = json.slides[0]!
    expect(slideJson.animation!.nodes[0]!.symmetryTrack).toBeDefined()
    expect(slideJson.animation!.nodes[0]!.symmetryTrack!.keyframes[0]!.value).toEqual({ axis: 'y', factor: 0.5 })
  })

  it('symmetrize flips texture uvTransform and mesh UVs together', () => {
    const { engine, slide } = setup()
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'TexMesh', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const mesh = {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      faces: [{ v0: 0, v1: 1, v2: 2 }],
      uvs: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ],
    }
    engine.setMeshData(node.id, mesh as any)
    const texId = 'test-tex-id'
    const mat: any = engine.getNode(node.id).material
    ;(engine.getNode(node.id) as any).material = {
      materialDefinitionId: mat.materialDefinitionId,
      overrides: { ...mat.overrides },
      textureId: texId,
      uvTransform: { uvScale: { u: 2, v: 1 }, uvOffset: { u: 0.1, v: 0 }, fitMode: 'stretch' as const },
    }
    engine.emitMaterialChanged(node.id)
    const beforeUV = engine.getNode(node.id).material.uvTransform!
    const beforeMeshU = engine.getNode(node.id).components.mesh!.mesh.uvs[1]!.u
    const cmd = new SymmetrizeSubtreeCommand({ nodeId: node.id, axis: 'x' })
    cmd.validate(engine as any)
    cmd.execute(engine as any)
    const after = engine.getNode(node.id)
    // mesh UV flipped
    expect(after.components.mesh!.mesh.uvs[1]!.u).toBe(1 - beforeMeshU)
    // uvTransform offset mirrored: 1 - scale - offset
    const expectedOffsetU = 1 - beforeUV.uvScale.u - beforeUV.uvOffset.u // 1 -2 -0.1 = -1.1
    expect(after.material.uvTransform!.uvOffset.u).toBeCloseTo(expectedOffsetU)
    expect(after.material.uvTransform!.uvScale.u).toBe(2)
    const beforeFinal = applyUVTransformToSingle({ u: beforeMeshU, v: 0 }, beforeUV)
    const afterFinal = applyUVTransformToSingle({ u: after.components.mesh!.mesh.uvs[1]!.u, v: 0 }, after.material.uvTransform!)
    expect(afterFinal.u).toBeCloseTo(1 - beforeFinal.u)
  })
})
